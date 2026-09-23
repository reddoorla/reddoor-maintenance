import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyticsAudit,
  classifyAnalytics,
  classifyPropertyError,
  determineEmission,
  gtagLoaderIds,
  readTagConfig,
  type AnalyticsDeps,
  type AnalyticsFacts,
} from "../../src/audits/analytics.js";

const BASE: AnalyticsFacts = {
  config: { measurementId: null, productionHost: null },
  propertyId: null,
  siteUrl: "https://www.example.com/",
  evidence: { probe: null, htmlIds: null },
  property: null,
  windowDays: 7,
};

const facts = (over: Partial<AnalyticsFacts>): AnalyticsFacts => ({ ...BASE, ...over });

describe("gtagLoaderIds", () => {
  it("finds the ID in the inline snippet seven fleet sites actually ship", () => {
    const html = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-6ZY38G41KJ"></script>`;
    expect(gtagLoaderIds(html)).toEqual(["G-6ZY38G41KJ"]);
  });

  it("does not count a measurement ID that is merely mentioned", () => {
    // A bare `G-…` match would make this audit green on a site whose only
    // analytics is a code comment about analytics.
    const html = `<!-- we used to run G-OLDOLDOLD here --><meta name="ga" content="G-NOPENOPEXX">`;
    expect(gtagLoaderIds(html)).toEqual([]);
  });

  it("does not mistake a GTM container for a GA4 tag", () => {
    const html = `<script src="https://www.googletagmanager.com/gtm.js?id=GTM-5FVCTMK7"></script>`;
    expect(gtagLoaderIds(html)).toEqual([]);
  });

  it("reports EVERY occurrence, not a deduplicated set", () => {
    // Two loaders for the SAME property is what doubles a session. A Set made
    // that case indistinguishable from one healthy load, so the warning that
    // names it could only ever have fired for two different properties.
    const html = `
      <script src="https://www.googletagmanager.com/gtag/js?id=G-AAAAAAAAAA"></script>
      <script src="https://www.googletagmanager.com/gtag/js?id=G-AAAAAAAAAA"></script>
      <script src="https://www.googletagmanager.com/gtag/js?l=dataLayer&id=G-BBBBBBBBBB"></script>`;
    expect(gtagLoaderIds(html)).toEqual(["G-AAAAAAAAAA", "G-AAAAAAAAAA", "G-BBBBBBBBBB"]);
  });
});

describe("determineEmission", () => {
  it("takes the browser probe as authoritative in both directions", () => {
    expect(determineEmission({ probe: { requestedIds: ["G-X"] }, htmlIds: null }).emitting).toBe(
      true,
    );
    expect(determineEmission({ probe: { requestedIds: [] }, htmlIds: ["G-X"] }).emitting).toBe(
      false,
    );
  });

  it("treats the HTML scan as positive-only, NEVER as proof of absence", () => {
    // This is the rule the whole design rests on. `initAnalytics` appends the
    // loader from JS, so a plain GET of a correctly-migrated site returns no
    // loader at all. Reading that as "not emitting" would fail every site the
    // sweep fixed, the moment no browser was available.
    expect(determineEmission({ probe: null, htmlIds: ["G-X"] }).emitting).toBe(true);
    expect(determineEmission({ probe: null, htmlIds: [] }).emitting).toBeNull();
    expect(determineEmission({ probe: null, htmlIds: null }).emitting).toBeNull();
  });
});

describe("classifyAnalytics — the fleet states measured on 2026-09-22", () => {
  it("29 Navy: nothing at either end on a maintained site is a warn, not a fail", () => {
    const v = classifyAnalytics(facts({ evidence: { probe: { requestedIds: [] }, htmlIds: [] } }));
    expect(v.status).toBe("warn");
    expect(v.summary).toContain("no tag and has no GA4 property");
  });

  it("revogen: emitting with no property on the row fails", () => {
    const v = classifyAnalytics(
      facts({ evidence: { probe: { requestedIds: ["G-Y0VSL1KFNT"] }, htmlIds: ["G-Y0VSL1KFNT"] } }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("no GA4 property");
  });

  it("la-homelessness-youth: a property with no tag fails", () => {
    const v = classifyAnalytics(
      facts({ propertyId: "500039567", evidence: { probe: { requestedIds: [] }, htmlIds: [] } }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("can only ever answer zero");
  });

  it("beachfront: both ends, emitting, property answering — pass", () => {
    const v = classifyAnalytics(
      facts({
        config: { measurementId: "G-51J638HZPL", productionHost: "www.beachfrontdentistry.com" },
        siteUrl: "https://www.beachfrontdentistry.com/",
        propertyId: "551435715",
        evidence: { probe: { requestedIds: ["G-51J638HZPL"] }, htmlIds: [] },
        property: { ok: true, users: 1051 },
      }),
    );
    expect(v.status).toBe("pass");
    expect(v.unchecked).toEqual([]);
  });
});

describe("classifyAnalytics — the failures that are invisible from one end", () => {
  const both = {
    config: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
    propertyId: "111111111",
  };

  it("catches a production host the tag can never match", () => {
    const v = classifyAnalytics(
      facts({
        ...both,
        config: { measurementId: "G-AAAAAAAAAA", productionHost: "www.oldbrand.com" },
        siteUrl: "https://www.example.com/",
        evidence: { probe: { requestedIds: [] }, htmlIds: [] },
      }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("inert in production");
  });

  it("catches a declared ID with no production host at all", () => {
    const v = classifyAnalytics(
      facts({ ...both, config: { measurementId: "G-AAAAAAAAAA", productionHost: null } }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("keeps the tag off everywhere");
  });

  it("catches the live site loading a different property than the checkout declares", () => {
    const v = classifyAnalytics(
      facts({ ...both, evidence: { probe: { requestedIds: ["G-ZZZZZZZZZZ"] }, htmlIds: [] } }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("Traffic is going to a property nobody reads");
  });

  it("warns when ONE property is loaded twice — the case that actually doubles", () => {
    const v = classifyAnalytics(
      facts({
        ...both,
        evidence: { probe: { requestedIds: ["G-AAAAAAAAAA", "G-AAAAAAAAAA"] }, htmlIds: [] },
        property: { ok: true, users: 10 },
      }),
    );
    expect(v.status).toBe("warn");
    expect(v.summary).toContain("double every session");
  });

  it("warns separately when two DIFFERENT properties are loaded", () => {
    const v = classifyAnalytics(
      facts({
        ...both,
        evidence: { probe: { requestedIds: ["G-AAAAAAAAAA", "G-OLDOLDOLD"] }, htmlIds: [] },
        property: { ok: true, users: 10 },
      }),
    );
    expect(v.status).toBe("warn");
    expect(v.summary).toContain("different properties");
  });

  it("warns on a property that answers zero — the shape of a tag that stopped", () => {
    const v = classifyAnalytics(
      facts({
        ...both,
        evidence: { probe: { requestedIds: ["G-AAAAAAAAAA"] }, htmlIds: [] },
        property: { ok: true, users: 0 },
      }),
    );
    expect(v.status).toBe("warn");
    expect(v.summary).toContain("quietly stopped firing");
  });

  it("fails when the Data API cannot read the property at all", () => {
    const v = classifyAnalytics(
      facts({
        ...both,
        evidence: { probe: { requestedIds: ["G-AAAAAAAAAA"] }, htmlIds: [] },
        property: { ok: false, kind: "denied", error: "PERMISSION_DENIED" },
      }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("PERMISSION_DENIED");
  });
});

describe("classifyAnalytics never reports a check it did not run", () => {
  it("softens a fail to a warn when emission was only inferred", () => {
    // Same defect as the la-homelessness-youth case, but with no browser and
    // no HTML scan. The finding still surfaces; it just does not claim to have
    // been observed. A red build that means "no browser on this runner"
    // teaches people to ignore the audit.
    const v = classifyAnalytics(
      facts({ propertyId: "500039567", evidence: { probe: null, htmlIds: null } }),
    );
    expect(v.status).toBe("warn");
    expect(v.unchecked.join(" ")).toContain("whether the tag fires");
  });

  it("names the GA property as unchecked when there are no credentials", () => {
    const v = classifyAnalytics(
      facts({
        config: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
        propertyId: "111111111",
        evidence: { probe: { requestedIds: ["G-AAAAAAAAAA"] }, htmlIds: [] },
        property: null,
      }),
    );
    expect(v.status).toBe("pass");
    expect(v.unchecked.join(" ")).toContain("no credentials");
  });

  it("skips rather than accusing when no fleet row was available", () => {
    const v = classifyAnalytics(
      facts({
        config: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
        propertyId: undefined,
        evidence: { probe: { requestedIds: ["G-AAAAAAAAAA"] }, htmlIds: [] },
      }),
    );
    expect(v.status).toBe("skip");
    expect(v.summary).toContain("no fleet row");
  });

  it("skips when it could neither read the checkout nor see the page", () => {
    const v = classifyAnalytics(facts({ config: null, evidence: { probe: null, htmlIds: null } }));
    expect(v.status).toBe("skip");
    expect(v.unchecked).toEqual(["everything"]);
  });
});

describe("readTagConfig", () => {
  async function siteWith(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "rd-cfg-"));
    await mkdir(join(dir, "src", "lib"), { recursive: true });
    for (const [rel, body] of Object.entries(files)) {
      await mkdir(join(dir, rel.split("/").slice(0, -1).join("/")), { recursive: true });
      await writeFile(join(dir, rel), body);
    }
    return dir;
  }

  it("reads the hook the recipe writes", async () => {
    // The audit and the recipe MUST agree on where the ID lives. They did not,
    // and the audit consequently found no declaration on any fleet site.
    const dir = await siteWith({
      "src/hooks.client.ts": `initAnalytics({
  measurementId: "G-AAAAAAAAAA",
  productionHost: "www.example.com",
});`,
    });
    expect(await readTagConfig(dir)).toEqual({
      measurementId: "G-AAAAAAAAAA",
      productionHost: "www.example.com",
      foreignAnalytics: false,
    });
  });

  it("falls back to site-config.json for a site that uses that convention", async () => {
    const dir = await siteWith({
      "src/lib/site-config.json": JSON.stringify({
        analytics: { measurementId: "G-BBBBBBBBBB", productionHost: "www.y.com" },
      }),
    });
    expect(await readTagConfig(dir)).toEqual({
      measurementId: "G-BBBBBBBBBB",
      productionHost: "www.y.com",
      foreignAnalytics: false,
    });
  });

  it("notices a hand-rolled loader, so 'declares nothing' is not read as 'emits nothing'", async () => {
    // Before the sweep, beachfront injects its loader from its OWN component
    // and msot from an inline app.html snippet. Neither is visible to the hook
    // reader, and beachfront's is invisible to a plain GET as well — so without
    // this the audit would confidently accuse a site emitting 1,051 users a
    // month of having a property with nothing feeding it.
    const dir = await siteWith({
      "src/lib/components/Analytics.svelte": `script.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;`,
    });
    const cfg = await readTagConfig(dir);
    expect(cfg?.measurementId).toBeNull();
    expect(cfg?.foreignAnalytics).toBe(true);
  });

  it("distinguishes 'could not look' from 'looked, it declares nothing'", async () => {
    // No src/ at all is a bad path or a failed clone — the audit must say it
    // could not look. A readable checkout with no analytics anywhere is a real
    // measurement, and it is the left half of the pairing.
    const missing = await mkdtemp(join(tmpdir(), "rd-empty-"));
    expect(await readTagConfig(missing)).toBeNull();

    const readable = await siteWith({ "src/app.html": "<html></html>" });
    expect(await readTagConfig(readable)).toEqual({
      measurementId: null,
      productionHost: null,
      foreignAnalytics: false,
    });
  });

  it("says it could not look when site-config.json is corrupt", async () => {
    const dir = await siteWith({ "src/lib/site-config.json": "{ not json" });
    expect(await readTagConfig(dir)).toBeNull();
  });
});

describe("gtagLoaderIds does not mistake a mention for a tag", () => {
  // Every one of these was confirmed to match the first version of this regex,
  // and a false positive here is not harmless: it makes determineEmission
  // report `emitting: true`, which drove a confident, wrong accusation —
  // "the live site loads G-OLD but the checkout declares G-NEW".
  it("ignores a commented-out snippet, which is a normal mid-sweep state", () => {
    const html = `<!-- <script src="https://www.googletagmanager.com/gtag/js?id=G-OLDOLDOLD"></script> -->`;
    expect(gtagLoaderIds(html)).toEqual([]);
  });

  it("ignores a look-alike host, so a path segment cannot impersonate Google", () => {
    const html = `<script src="https://evil.test/googletagmanager.com/gtag/js?id=G-SPOOFSPOOF"></script>`;
    expect(gtagLoaderIds(html)).toEqual([]);
  });

  it("requires the id parameter itself, not a parameter ending in id", () => {
    const base = "https://www.googletagmanager.com/gtag/js?";
    expect(gtagLoaderIds(`<script src="${base}cid=G-NOTITSID12"></script>`)).toEqual([]);
    expect(gtagLoaderIds(`<script src="${base}gtm_id=G-NOTITSID12"></script>`)).toEqual([]);
    expect(gtagLoaderIds(`<script src="${base}l=dataLayer&id=G-REALREAL1"></script>`)).toEqual([
      "G-REALREAL1",
    ]);
  });
});

describe("classifyPropertyError", () => {
  it("calls a standing access fault denied", () => {
    for (const m of [
      "PERMISSION_DENIED",
      "7 PERMISSION_DENIED: The caller does not have permission",
      "The caller does not have permission",
      "5 NOT_FOUND: Property not found",
      "invalid_grant",
      "Request failed with status code 403",
    ]) {
      expect(classifyPropertyError(new Error(m))).toBe("denied");
    }
  });

  it("calls upstream weather unavailable, so a quota blip cannot red a site", () => {
    // One Airtable quota once reddened six workflows here.
    for (const m of [
      "Quota exceeded for quota metric 'Tokens'",
      "getaddrinfo ENOTFOUND analyticsdata.googleapis.com",
      "503 Service Unavailable",
      "socket hang up",
    ]) {
      expect(classifyPropertyError(new Error(m))).toBe("unavailable");
    }
  });

  it("is not fooled by digits that merely CONTAIN 403 or 404", () => {
    // A hand-rolled /…|403|404|…/ matched every one of these, which turned a
    // quota blip into a hard fail — the regression the denied/unavailable split
    // existed to prevent. Any 9-digit GA4 property ID containing 403 did it too.
    for (const m of [
      "8 RESOURCE_EXHAUSTED: Exhausted property tokens. Requested 403, available 0.",
      "8 RESOURCE_EXHAUSTED: quota exceeded, tokens remaining 1403",
      "4 DEADLINE_EXCEEDED: Deadline exceeded after 60.403s",
      "13 INTERNAL: Internal error encountered. request_id=a403f1",
      "GA read failed for properties/403210987 after 3 attempts",
    ]) {
      expect(classifyPropertyError(new Error(m))).toBe("unavailable");
    }
  });
});

describe("the pairing is CERTAIN and must not be softened by a missing observation", () => {
  const configured = {
    config: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
    propertyId: "111111111",
  };

  it("fails a property with no declared tag WITHOUT a browser and WITHOUT credentials", () => {
    // Both operands are read off disk: the checkout declares nothing, the row
    // carries a property. No observation makes that more or less true. Routing
    // it through the softening helper meant the four sites this audit exists to
    // find produced an exit-0, un-written-back `warn` on every default run —
    // and `warn` reaches no dashboard, no write-back and no exit code.
    const v = classifyAnalytics(
      facts({ propertyId: "500039567", evidence: { probe: null, htmlIds: [] }, property: null }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("can only ever answer zero");
  });

  it("fails a declared tag with no property WITHOUT a browser", () => {
    const v = classifyAnalytics(
      facts({
        config: { measurementId: "G-Y0VSL1KFNT", productionHost: "www.example.com" },
        propertyId: null,
        evidence: { probe: null, htmlIds: null },
      }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("no GA4 property ID");
  });

  it("softens only while a legacy snippet could still be hiding in the markup", () => {
    // `htmlIds: null` means the page was never fetched, so an inline snippet
    // has not been ruled out and "declares no tag" is not yet "emits no tag".
    const v = classifyAnalytics(
      facts({ propertyId: "500039567", evidence: { probe: null, htmlIds: null } }),
    );
    expect(v.status).toBe("warn");
  });

  it("passes a correctly-onboarded site, and says what it did not watch", () => {
    // The instrument has to pass on a known-good input before any FAIL it
    // produces is evidence. A site whose checkout declares a tag, whose row
    // carries the property, and whose gate matches the live host is the
    // known-good input — and the default run has no browser and no credentials.
    const v = classifyAnalytics(facts({ ...configured, evidence: { probe: null, htmlIds: [] } }));
    expect(v.status).toBe("pass");
    expect(v.summary).toContain("was not observed");
    expect(v.unchecked.join(" ")).toContain("whether the tag fires");
  });

  it("does not let an HTML-only hit claim the tag loads", () => {
    // A <link rel=preload> for the gtag loader is a standard performance
    // pattern that fires no tag, and the HTML scan cannot tell it from a live
    // one. The pass must not say the loader was seen to load.
    const v = classifyAnalytics(
      facts({ ...configured, evidence: { probe: null, htmlIds: ["G-AAAAAAAAAA"] } }),
    );
    expect(v.summary).not.toContain("network requests");
    expect(v.summary).toContain("name its loader");
  });

  it("softens a fail to a warn when only the HTML said so", () => {
    // An HTML positive cannot tell a live tag from a loader URL in a JSON blob
    // or a branch that never runs, so nothing derived from it alone is a fail.
    const html = classifyAnalytics(
      facts({
        config: { measurementId: "G-RIGHTRIGH", productionHost: "www.example.com" },
        propertyId: "111111111",
        evidence: { probe: null, htmlIds: ["G-WRONGWRON"] },
      }),
    );
    expect(html.status).toBe("warn");

    // The same shape, seen by the browser, is a fail.
    const probed = classifyAnalytics(
      facts({
        config: { measurementId: "G-RIGHTRIGH", productionHost: "www.example.com" },
        propertyId: "111111111",
        evidence: { probe: { requestedIds: ["G-WRONGWRON"] }, htmlIds: null },
      }),
    );
    expect(probed.status).toBe("fail");
  });

  it("warns rather than fails when the Data API was merely unreachable", () => {
    const v = classifyAnalytics(
      facts({
        ...configured,
        evidence: { probe: { requestedIds: ["G-AAAAAAAAAA"] }, htmlIds: [] },
        property: { ok: false, kind: "unavailable", error: "503" },
      }),
    );
    expect(v.status).toBe("warn");
    expect(v.unchecked.join(" ")).toContain("unreachable");
  });
});

describe("analyticsAudit wiring", () => {
  async function siteDir(config: unknown | null): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "rd-audit-"));
    if (config !== null) {
      await mkdir(join(dir, "src", "lib"), { recursive: true });
      await writeFile(join(dir, "src", "lib", "site-config.json"), JSON.stringify(config));
    }
    return dir;
  }

  const run = (path: string, deployedUrl: string | undefined, analyticsDeps: AnalyticsDeps) =>
    analyticsAudit({
      site: deployedUrl === undefined ? { path } : { path, deployedUrl },
      analyticsDeps,
    });

  it("reads the GA property on the site's OWN hostnames, as the report does", async () => {
    // The report reads through measuredHostnames(siteRow.url). An unfiltered
    // read here answers a different number than the report renders — 13,417
    // against 105 on Reddoor's own property — and the zero-users warning could
    // never fire while localhost traffic held the count up.
    const seen: string[][] = [];
    const dir = await siteDir({
      analytics: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
    });
    await run(dir, "https://www.example.com/", {
      propertyId: "111111111",
      fetchHtml: async () => "<html></html>",
      probeTag: async () => ({ requestedIds: ["G-AAAAAAAAAA"] }),
      readUsers: async (_id, _days, hostnames) => {
        seen.push(hostnames);
        return { ok: true, users: 7 };
      },
    });
    expect(seen).toEqual([["example.com", "www.example.com"]]);
  });

  it("reads the hook the analytics-tag recipe writes, not just site-config.json", async () => {
    // These two PRs disagreed about this and it was the whole ballgame: the
    // recipe writes the measurement ID into src/hooks.client.ts, the audit read
    // src/lib/site-config.json, only 4 of 28 checkouts have that file and none
    // has an analytics block — so the audit found no declaration anywhere and
    // answered "nothing was checked" for the entire fleet, identically whether
    // or not the row carried a property.
    const dir = await mkdtemp(join(tmpdir(), "rd-hook-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "src", "hooks.client.ts"),
      `import { initAnalytics } from "@reddoorla/maintenance/client";
export const init = () => {
  initAnalytics({
    measurementId: "G-AAAAAAAAAA",
    productionHost: "www.example.com",
  });
};`,
    );
    const res = await run(dir, "https://www.example.com/", {
      propertyId: "111111111",
      fetchHtml: async () => "<html></html>",
    });
    expect(res.status).toBe("pass");
    expect(res.summary).toContain("G-AAAAAAAAAA");
  });

  it("fails the same checkout once the property is taken off the row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-hook2-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "src", "hooks.client.ts"),
      `initAnalytics({ measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" });`,
    );
    const res = await run(dir, "https://www.example.com/", {
      propertyId: null,
      fetchHtml: async () => "<html></html>",
    });
    expect(res.status).toBe("fail");
  });

  it("does not read the property at all when there are no hostnames to filter by", async () => {
    // An empty list means UNFILTERED to fetchPeriodUsers, which answers with
    // every environment's traffic — 13,417 against 105 on reddoor's own
    // property. Passing a site on that is worse than not reading it.
    let called = 0;
    const dir = await siteDir(null);
    await run(dir, undefined, {
      propertyId: "111111111",
      readUsers: async () => {
        called++;
        return { ok: true, users: 13417 };
      },
    });
    expect(called).toBe(0);
  });

  it("trims the property id it sends, not merely the one it validates", async () => {
    // A trailing newline is what a `gh api --jq` round-trip leaves behind, and
    // it would ride into properties/${id} and 404.
    const seen: string[] = [];
    const dir = await siteDir(null);
    await run(dir, "https://www.example.com/", {
      propertyId: " 111111111\n",
      readUsers: async (id) => {
        seen.push(id);
        return { ok: true, users: 5 };
      },
    });
    expect(seen).toEqual(["111111111"]);
  });

  it("refuses a measurement ID pasted into the property column", async () => {
    // The Data API takes the numeric property id. Pasting the `G-…` one there
    // would otherwise read as a configured property that went unmeasured.
    const dir = await siteDir(null);
    const res = await run(dir, "https://www.example.com/", { propertyId: "G-AAAAAAAAAA" });
    expect(res.status).toBe("fail");
    expect(res.summary).toContain("not a numeric");
  });

  it("treats a probe that threw as unchecked, never as a missing tag", async () => {
    // A browser failure reported as a site defect is how an audit loses its
    // credibility.
    const dir = await siteDir({
      analytics: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
    });
    const res = await run(dir, "https://www.example.com/", {
      propertyId: "111111111",
      fetchHtml: async () => "<html></html>",
      probeTag: async () => {
        throw new Error("browser would not launch");
      },
    });
    expect(res.summary).toContain("whether the tag fires");
    expect(res.status).not.toBe("fail");
  });

  it("launches nothing and claims nothing for a site with no deployed URL", async () => {
    let probed = 0;
    const dir = await siteDir(null);
    const res = await run(dir, undefined, {
      propertyId: "111111111",
      probeTag: async () => {
        probed++;
        return { requestedIds: [] };
      },
      fetchHtml: async () => "<html></html>",
    });
    expect(probed).toBe(0);
    expect(res.status).not.toBe("pass");
  });
});
