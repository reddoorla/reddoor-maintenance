import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyticsAudit,
  classifyAnalytics,
  classifyPropertyError,
  collectLoaderIds,
  defaultAnalyticsDeps,
  determineEmission,
  gtagLoaderIds,
  probePage,
  probeRequested,
  readTagConfig,
  type EmissionEvidence,
  type ProbePage,
  type TagConfig,
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
    expect(determineEmission({ probe: { loadedIds: ["G-X"] }, htmlIds: null }).emitting).toBe(true);
    expect(determineEmission({ probe: { loadedIds: [] }, htmlIds: null }).emitting).toBe(false);
    expect(determineEmission({ probe: { loadedIds: [] }, htmlIds: [] }).emitting).toBe(false);
  });

  it("calls a probe that saw nothing, beside HTML that names a loader, conflicting — not absent", () => {
    // reddoor's loader waits for the first interaction, which a probe never
    // makes. The served HTML names it. That is not an observed absence.
    const e = determineEmission({ probe: { loadedIds: [] }, htmlIds: ["G-REDDOOR001"] });
    expect(e.emitting).toBeNull();
    expect(e.authoritative).toBe(false);
    expect(e.source).toContain("conflicting evidence");
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
    const v = classifyAnalytics(facts({ evidence: { probe: { loadedIds: [] }, htmlIds: [] } }));
    expect(v.status).toBe("warn");
    expect(v.summary).toContain("no tag and has no GA4 property");
  });

  it("revogen: emitting with no property on the row fails", () => {
    const v = classifyAnalytics(
      facts({ evidence: { probe: { loadedIds: ["G-Y0VSL1KFNT"] }, htmlIds: ["G-Y0VSL1KFNT"] } }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("no GA4 property");
  });

  it("la-homelessness-youth: a property with no tag fails", () => {
    const v = classifyAnalytics(
      facts({ propertyId: "500039567", evidence: { probe: { loadedIds: [] }, htmlIds: [] } }),
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
        evidence: { probe: { loadedIds: ["G-51J638HZPL"] }, htmlIds: [] },
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
        evidence: { probe: { loadedIds: [] }, htmlIds: [] },
      }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("inert in production");
  });

  it("does not call a host it could not read 'off everywhere'", () => {
    // A static read that cannot see the host (an identifier, a dev/prod
    // ternary, two calls) is not evidence the tag is off. It was a hard fail.
    for (const probe of [null, { loadedIds: [] }]) {
      const v = classifyAnalytics(
        facts({
          ...both,
          config: { measurementId: "G-AAAAAAAAAA", productionHost: null },
          evidence: { probe, htmlIds: [] },
        }),
      );
      expect(v.status).toBe("warn");
      expect(v.summary).toContain("could not be read");
      expect(v.summary).not.toContain("off everywhere");
      expect(v.unchecked.join(" ")).toContain("host gate");
    }
  });

  it("lets a probe that saw the tag load stand in for the host it could not read", () => {
    const v = classifyAnalytics(
      facts({
        ...both,
        config: { measurementId: "G-AAAAAAAAAA", productionHost: null },
        evidence: { probe: { loadedIds: ["G-AAAAAAAAAA"] }, htmlIds: null },
      }),
    );
    expect(v.status).toBe("pass");
  });

  it("catches the live site loading a different property than the checkout declares", () => {
    const v = classifyAnalytics(
      facts({ ...both, evidence: { probe: { loadedIds: ["G-ZZZZZZZZZZ"] }, htmlIds: [] } }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("Traffic is going to a property nobody reads");
  });

  it("warns when ONE property is loaded twice — the case that actually doubles", () => {
    const v = classifyAnalytics(
      facts({
        ...both,
        evidence: { probe: { loadedIds: ["G-AAAAAAAAAA", "G-AAAAAAAAAA"] }, htmlIds: [] },
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
        evidence: { probe: { loadedIds: ["G-AAAAAAAAAA", "G-OLDOLDOLD"] }, htmlIds: [] },
        property: { ok: true, users: 10 },
      }),
    );
    expect(v.status).toBe("warn");
    expect(v.summary).toContain("different properties");
  });

  it("warns on a property that answers zero, and does not call a tag it saw load 'stopped'", () => {
    const v = classifyAnalytics(
      facts({
        ...both,
        evidence: { probe: { loadedIds: ["G-AAAAAAAAAA"] }, htmlIds: [] },
        property: { ok: true, users: 0 },
      }),
    );
    expect(v.status).toBe("warn");
    expect(v.summary).toContain("loads on the live page");
    expect(v.summary).not.toContain("not firing");
    const unseen = classifyAnalytics(
      facts({ ...both, evidence: { probe: null, htmlIds: [] }, property: { ok: true, users: 0 } }),
    );
    expect(unseen.status).toBe("warn");
    expect(unseen.summary).toContain("the shape of a tag that is not firing");
  });

  it("fails when the Data API cannot read the property at all", () => {
    const v = classifyAnalytics(
      facts({
        ...both,
        evidence: { probe: { loadedIds: ["G-AAAAAAAAAA"] }, htmlIds: [] },
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
        evidence: { probe: { loadedIds: ["G-AAAAAAAAAA"] }, htmlIds: [] },
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
        evidence: { probe: { loadedIds: ["G-AAAAAAAAAA"] }, htmlIds: [] },
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
    expect(await readTagConfig(dir)).toMatchObject({
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
    expect(await readTagConfig(dir)).toMatchObject({
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
      "Request failed with status code 403",
    ]) {
      expect(classifyPropertyError(new Error(m))).toBe("denied");
    }
  });

  it("calls the shared credentials being refused a fleet-wide fault, never this site's", () => {
    // invalid_grant, unauthorized_client and UNAUTHENTICATED are the service
    // account itself refused, for every site at once. Calling them `denied`
    // reddened every row in a sweep over one expired key.
    for (const m of [
      "invalid_grant",
      "invalid_grant: Invalid JWT Signature.",
      "unauthorized_client: Client is unauthorized to retrieve access tokens",
      "16 UNAUTHENTICATED: Request had invalid authentication credentials.",
      "Request failed with status code 401",
    ]) {
      expect(classifyPropertyError(new Error(m))).toBe("credentials");
    }
    expect(classifyPropertyError(Object.assign(new Error("x"), { code: 16 }))).toBe("credentials");
    expect(
      classifyAnalytics(
        facts({
          config: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
          propertyId: "111111111",
          evidence: { probe: { loadedIds: ["G-AAAAAAAAAA"] }, htmlIds: null },
          property: { ok: false, kind: "credentials", error: "invalid_grant" },
        }),
      ).status,
    ).toBe("warn");
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
        evidence: { probe: { loadedIds: ["G-WRONGWRON"] }, htmlIds: null },
      }),
    );
    expect(probed.status).toBe("fail");
  });

  it("warns rather than fails when the Data API was merely unreachable", () => {
    const v = classifyAnalytics(
      facts({
        ...configured,
        evidence: { probe: { loadedIds: ["G-AAAAAAAAAA"] }, htmlIds: [] },
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
      probeTag: async () => ({ loadedIds: ["G-AAAAAAAAAA"] }),
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
    expect(res.status).toBe("warn"); // advisory: the audit never fails a site (round seven);
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
    const dir = await siteDir({});
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
    expect(res.status).toBe("warn"); // advisory: the audit never fails a site (round seven);
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
        return { loadedIds: [] };
      },
      fetchHtml: async () => "<html></html>",
    });
    expect(probed).toBe(0);
    expect(res.status).not.toBe("pass");
  });
});

describe("readTagConfig does not take prose, or a guess, for a declaration", () => {
  async function hookSite(hook: string, extra?: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "rd-hook3-"));
    await mkdir(join(dir, "src", "lib", "components"), { recursive: true });
    await writeFile(join(dir, "src", "hooks.client.ts"), hook);
    for (const [rel, body] of Object.entries(extra ?? {})) {
      await writeFile(join(dir, rel), body);
    }
    return dir;
  }

  it("ignores a commented-out call sitting above the real one", async () => {
    // The single most likely artefact of THIS rollout. Taking the first match
    // turned it into a red build naming a host nobody configured.
    const dir =
      await hookSite(`// initAnalytics({ measurementId: "G-OLDOLDOLD", productionHost: "old.example.com" });
/* Example:
   initAnalytics({ measurementId: "G-DOCSDOCSX", productionHost: "docs.example" });
*/
initAnalytics({ measurementId: "G-REALREALX", productionHost: "www.example.com" });`);
    expect(await readTagConfig(dir)).toMatchObject({
      measurementId: "G-REALREALX",
      productionHost: "www.example.com",
    });
  });

  it("declares nothing legible when two live calls disagree", async () => {
    // A dev/prod pair. Guessing between them reported a site as gated on its
    // staging host, which then read as "inert in production".
    const dir = await hookSite(`if (dev) {
  initAnalytics({ measurementId: "G-STAGINGXX", productionHost: "staging.example.com" });
} else {
  initAnalytics({ measurementId: "G-PRODPRODX", productionHost: "www.example.com" });
}`);
    const cfg = await readTagConfig(dir);
    expect(cfg?.measurementId).toBeNull();
    expect(cfg?.productionHost).toBeNull();
  });

  it("still scans for a hand-rolled loader when only the host is legible", async () => {
    // beachfront's real shape: the ID comes from an imported identifier, not a
    // string literal. The partial-declaration path used to return
    // `foreignAnalytics: false` WITHOUT scanning — an assertion nothing tested —
    // and the verdict then flatly claimed "nothing in its checkout references
    // one" about a site emitting 1,051 users a month.
    const dir = await hookSite(
      `import { PUBLIC_GA_ID } from "$env/static/public";
export const init = () => initAnalytics({ measurementId: PUBLIC_GA_ID, productionHost: "live.example.com" });`,
      {
        "src/lib/components/Analytics.svelte":
          'script.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;',
      },
    );
    const cfg = await readTagConfig(dir);
    expect(cfg?.measurementId).toBeNull();
    expect(cfg?.foreignAnalytics).toBe(true);
  });
});

describe("classifyAnalytics: a verdict must not argue with itself", () => {
  it("does not tell you to re-run the probe that already answered", async () => {
    // The probe authoritatively established there is no loader. Saying
    // "whether the two describe the same property cannot be told from here,
    // re-run with REDDOOR_ANALYTICS_PROBE=1" sends the operator back to the
    // instrument that just answered.
    const v = classifyAnalytics(
      facts({
        config: { measurementId: null, productionHost: null, foreignAnalytics: true },
        propertyId: "123456789",
        evidence: { probe: { loadedIds: [] }, htmlIds: null },
      }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).not.toContain("Re-run with");
    expect(v.unchecked.join(" ")).not.toContain("the site's own loader");
  });

  it("reports a refused property ahead of any emission warning", () => {
    // `denied` is documented as a standing fault and therefore a fail. Three
    // emission branches returned `warn` first and threw the read away — the
    // audit paid for the GA call, was told the property is gone, and said warn.
    const v = classifyAnalytics(
      facts({
        config: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
        propertyId: "111111111",
        evidence: { probe: { loadedIds: ["G-AAAAAAAAAA", "G-AAAAAAAAAA"] }, htmlIds: null },
        property: { ok: false, kind: "denied", error: "PERMISSION_DENIED" },
      }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("refused property");
  });

  it("does not call a preload plus a script tag two loads", () => {
    // Both match the loader URL in the markup, and neither is a second LOAD.
    // Only the probe counts actual requests.
    const v = classifyAnalytics(
      facts({
        config: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
        propertyId: "111111111",
        evidence: { probe: null, htmlIds: ["G-AAAAAAAAAA", "G-AAAAAAAAAA"] },
      }),
    );
    expect(v.summary).not.toContain("double every session");
  });
});

describe("classifyPropertyError does not blame the site for our own bad request", () => {
  it("treats a malformed request as upstream, not as a missing property", () => {
    // GA4 answers INVALID_ARGUMENT for any malformed request. Both of these are
    // OUR bug — the hostname dimension and the date range are ours to get right.
    for (const m of [
      "3 INVALID_ARGUMENT: Field hostName is not a valid dimension.",
      "3 INVALID_ARGUMENT: date_ranges[0].start_date is invalid.",
    ]) {
      expect(classifyPropertyError(new Error(m))).toBe("unavailable");
    }
  });

  it("still blames the row when the invalid argument IS the property", () => {
    expect(classifyPropertyError(new Error("3 INVALID_ARGUMENT: property must be numeric"))).toBe(
      "denied",
    );
  });
});

describe("round four: guards that had moved and reopened the same hole", () => {
  it("a refused property outranks the pairing, not just the emission section", () => {
    // The three sweep targets are exactly this shape: a property on the row and
    // no declared tag. With the denied return sitting after the pairing, the
    // audit said "run analytics-tag" while the Data API had already answered
    // NOT_FOUND for the property that tag would install into.
    const v = classifyAnalytics(
      facts({
        propertyId: "500039567",
        evidence: { probe: null, htmlIds: [] },
        property: { ok: false, kind: "denied", error: "5 NOT_FOUND: Property not found" },
      }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("refused property");
    expect(v.summary).toContain("before anything is installed");
    // The refusal IS the property check; listing it as "not checked" too
    // contradicts the verdict (A07).
    expect(v.unchecked.join(" ")).not.toContain("the GA4 property");
  });

  it("discloses a failed property read on every path", () => {
    // A verdict that returns without mentioning a read it made and lost claims
    // a completeness it does not have.
    const v = classifyAnalytics(
      facts({
        propertyId: "111111111",
        evidence: { probe: { loadedIds: [] }, htmlIds: [] },
        property: { ok: false, kind: "unavailable", error: "503" },
      }),
    );
    expect(v.unchecked.join(" ")).toContain("the read failed");
  });

  it("never claims 'nothing references one' about a checkout measured as foreign", () => {
    // foreign=true with an authoritative empty probe is a blocked or dead
    // legacy snippet, and the old wording contradicted a fact this same verdict
    // had measured.
    const v = classifyAnalytics(
      facts({
        config: { measurementId: null, productionHost: null, foreignAnalytics: true },
        propertyId: "111111111",
        evidence: { probe: { loadedIds: [] }, htmlIds: null },
      }),
    );
    expect(v.summary).not.toContain("nothing in its checkout references one");
    expect(v.summary).toContain("Remove it");
  });

  it("does not prescribe analytics-tag for a hook it could not read", () => {
    // The scan SKIPS hooks.client.ts, so an unparseable hook used to read as
    // "nothing references one" — and the prescribed command no-ops on a file
    // that already exists. A permanent red with no reachable fix.
    const v = classifyAnalytics(
      facts({
        config: {
          measurementId: null,
          productionHost: null,
          unreadableCall: "src/hooks.client.ts",
        },
        propertyId: "111111111",
        evidence: { probe: null, htmlIds: [] },
      }),
    );
    expect(v.summary).toContain("no measurement ID could be read out of the checkout");
    expect(v.summary).not.toContain("Fix: run `reddoor-maint analytics-tag`");
  });

  it("tells you to remove the old loader first, which is what the recipe requires", () => {
    // The audit's only remediation used to be a command the recipe now refuses
    // for exactly these sites.
    const v = classifyAnalytics(
      facts({
        config: { measurementId: null, productionHost: null, foreignAnalytics: true },
        propertyId: "481951114",
        evidence: { probe: null, htmlIds: ["G-BZ0WQMEE8L"] },
      }),
    );
    expect(v.summary).toContain("REMOVE");
    expect(v.summary).toContain("refuses while one is present");
  });

  it("passes a declared, paired site whose probe saw its loader arrive", () => {
    expect(
      classifyAnalytics(
        facts({
          config: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
          propertyId: "111111111",
          evidence: { probe: { loadedIds: ["G-AAAAAAAAAA"] }, htmlIds: null },
        }),
      ).status,
    ).toBe("pass");
  });
});

describe("integration with main: the no-analytics opt-out (#936, spec D8) and a bare checkout", () => {
  async function hookDir(hook: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "rd-int-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "hooks.client.ts"), hook);
    return dir;
  }
  const DECLARED = `initAnalytics({ measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" });`;

  it("skips a site whose row accepts `no analytics`, and reads nothing to say so", async () => {
    // D8: the audit skips an opted-out site through the one predicate the
    // setup check and the cockpit use. It must not GET the page, launch a
    // browser or spend a Data API call on a site nobody is asking about.
    const calls: string[] = [];
    const res = await analyticsAudit({
      site: {
        path: await hookDir(DECLARED),
        deployedUrl: "https://www.example.com/",
        analyticsOptedOut: true,
        meta: { siteId: "recSONDER" },
      },
      analyticsDeps: {
        propertyId: "480126732",
        fetchHtml: async () => {
          calls.push("fetchHtml");
          return "";
        },
        probeTag: async () => {
          calls.push("probeTag");
          return { loadedIds: [] };
        },
        readUsers: async () => {
          calls.push("readUsers");
          return { ok: true, users: 0 };
        },
      },
    });
    expect(res.status).toBe("skip");
    expect(res.summary).toContain("no analytics");
    expect(calls).toEqual([]);
  });

  it("knows the difference between 'the row has no property' and 'no row was read'", async () => {
    // A roster site always carries ga4PropertyId, null when the row has none
    // (selectFleetSites). A bare path (`audit --only analytics ./checkout`,
    // init's closing audit) read no row, and carries nothing.
    expect((await defaultAnalyticsDeps({})).propertyId).toBeUndefined();
    expect((await defaultAnalyticsDeps({ ga4PropertyId: null })).propertyId).toBe(null);
    expect((await defaultAnalyticsDeps({ ga4PropertyId: "111111111" })).propertyId).toBe(
      "111111111",
    );
  });

  it("does not accuse a bare checkout of a row it never read", async () => {
    // The pilot's own flow: run analytics-tag on a checkout, then audit that
    // checkout. With no row read, "its fleet row has no GA4 property ID" is a
    // confident fail about something nobody looked at.
    const res = await analyticsAudit({ site: { path: await hookDir(DECLARED) } });
    expect(res.status).toBe("skip");
    expect(res.summary).toContain("no fleet row");
    expect(res.summary).not.toContain("has no GA4 property ID");
  });

  it("still fails a roster site whose row really has no property", async () => {
    const res = await analyticsAudit({
      site: { path: await hookDir(DECLARED), ga4PropertyId: null },
    });
    expect(res.status).toBe("warn"); // advisory: the audit never fails a site (round seven);
    expect(res.summary).toContain("has no GA4 property ID");
  });
});

describe("hookUnreadable reaches every branch it can land on, not only the non-emitting one", () => {
  const unreadable = {
    measurementId: null,
    productionHost: null,
    unreadableCall: "src/hooks.client.ts",
  } as const;

  it("does not tell a site to remove the package's own loader", () => {
    // A hook reading its ID from an import is ordinary. When the page loads a
    // tag, the old wording called it "a mechanism this audit did not install"
    // and said to REMOVE it and run a recipe that no-ops on an existing hook.
    const v = classifyAnalytics(
      facts({
        config: unreadable,
        propertyId: "111111111",
        evidence: { probe: { loadedIds: ["G-AAAAAAAAAA"] }, htmlIds: null },
      }),
    );
    expect(v.status).toBe("warn");
    expect(v.summary).toContain("src/hooks.client.ts");
    expect(v.summary).not.toContain("REMOVE");
    expect(v.summary).not.toContain("did not install");
  });

  it("does not say a site with a hook declares no tag", () => {
    for (const probe of [null, { loadedIds: [] }, { loadedIds: ["G-AAAAAAAAAA"] }]) {
      const v = classifyAnalytics(
        facts({ config: unreadable, propertyId: null, evidence: { probe, htmlIds: null } }),
      );
      expect(v.summary).toContain("src/hooks.client.ts");
      expect(v.summary).not.toContain("declares no tag");
    }
  });

  it("does not claim 'emits no tag' when emission was never observed", () => {
    const v = classifyAnalytics(facts({ evidence: { probe: null, htmlIds: [] } }));
    expect(v.summary).not.toContain("emits no tag");
    expect(v.summary).toContain("no tag and has no GA4 property");
  });
});

describe("readTagConfig pins the round-four reader fixes, not just the classifier", () => {
  async function hookDir(hook: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "rd-r4-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "hooks.client.ts"), hook);
    return dir;
  }

  it("marks a hook with nothing legible as unreadable", async () => {
    // The round-four classifier test injects hookUnreadable by hand, so the
    // reader could stop setting it and nothing would notice.
    const cfg = await readTagConfig(
      await hookDir(
        `import { ID, HOST } from "$lib/ga";\nexport const init = () => initAnalytics({ measurementId: ID, productionHost: HOST });`,
      ),
    );
    expect(cfg).toMatchObject({
      measurementId: null,
      productionHost: null,
      unreadableCall: "src/hooks.client.ts",
    });
  });

  it("marks a hook with only the host legible as unreadable", async () => {
    const cfg = await readTagConfig(
      await hookDir(`initAnalytics({ measurementId: ID, productionHost: "www.example.com" });`),
    );
    expect(cfg).toMatchObject({ measurementId: null, unreadableCall: "src/hooks.client.ts" });
  });

  it("reads a declaration on the same line as a string containing //", async () => {
    // The round-four test of this name drove the classifier with a parsed
    // config and never reached the stripper.
    const cfg = await readTagConfig(
      await hookDir(
        `const u = new URL("https://x.example"); initAnalytics({ measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" });`,
      ),
    );
    expect(cfg).toMatchObject({ measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" });
  });
});

describe("round six: the reader sees every way a site runs the package", () => {
  async function checkout(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "rd-r6-"));
    for (const [rel, body] of Object.entries(files)) {
      await mkdir(join(dir, rel, ".."), { recursive: true });
      await writeFile(join(dir, rel), body);
    }
    return dir;
  }
  const CALL = `initAnalytics({ measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" });`;

  it("reads a call from the root layout, where the package's own docs put it", async () => {
    const dir = await checkout({
      "src/routes/+layout.svelte": `<script lang="ts">\n  import { onMount } from "svelte";\n  import { initAnalytics } from "@reddoorla/maintenance/client";\n  onMount(() => ${CALL});\n</script>\n<slot />\n`,
    });
    expect(await readTagConfig(dir)).toMatchObject({
      measurementId: "G-AAAAAAAAAA",
      productionHost: "www.example.com",
      declaredIn: "src/routes/+layout.svelte",
    });
  });

  it("reads a hooks.client.js, and an aliased import", async () => {
    for (const [rel, body] of [
      [
        "src/hooks.client.js",
        `import { initAnalytics } from "@reddoorla/maintenance/client";\nexport const init = () => ${CALL}`,
      ],
      [
        "src/hooks.client.ts",
        `import { initAnalytics as startGA } from "@reddoorla/maintenance/client";\nexport const init = () => startGA({ measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" });`,
      ],
    ] as const) {
      expect(await readTagConfig(await checkout({ [rel]: body }))).toMatchObject({
        measurementId: "G-AAAAAAAAAA",
        declaredIn: rel,
      });
    }
  });

  it("does not hard-fail a site whose layout runs the package with an imported ID", async () => {
    // Default path: no browser, a plain GET that shows nothing (the loader is
    // JS-injected), a property on the row. This was "can only ever answer
    // zero", a confident fail about a site that may be working.
    const dir = await checkout({
      "src/routes/+layout.svelte": `<script>\n  import { initAnalytics } from "@reddoorla/maintenance/client";\n  import { GA_ID, HOST } from "$lib/ga";\n  initAnalytics({ measurementId: GA_ID, productionHost: HOST });\n</script>\n`,
    });
    const res = await analyticsAudit({
      site: { path: dir, deployedUrl: "https://www.example.com/", ga4PropertyId: "111111111" },
      analyticsDeps: { propertyId: "111111111", fetchHtml: async () => "<html></html>" },
    });
    expect(res.status).toBe("warn");
    expect(res.summary).toContain("src/routes/+layout.svelte references initAnalytics");
    expect(res.summary).not.toContain("can only ever answer zero");
  });

  it("reads a dev/prod host as unknown, and does not fail the site for it", async () => {
    const dir = await checkout({
      "src/hooks.client.ts": `import { dev } from "$app/environment";\ninitAnalytics({ measurementId: "G-AAAAAAAAAA", productionHost: dev ? "localhost" : "www.example.com" });`,
    });
    const cfg = await readTagConfig(dir);
    expect(cfg).toMatchObject({ measurementId: "G-AAAAAAAAAA", productionHost: null });
    const res = await analyticsAudit({
      site: { path: dir, deployedUrl: "https://www.example.com/" },
      analyticsDeps: { propertyId: "111111111", fetchHtml: async () => "<html></html>" },
    });
    expect(res.status).toBe("warn");
    expect(res.summary).not.toContain("off everywhere");
  });

  it("calls two references that name different IDs unreadable, not a guess", async () => {
    const cfg = await readTagConfig(
      await checkout({
        "src/hooks.client.ts": CALL,
        "src/routes/+layout.svelte": `<script>initAnalytics({ measurementId: "G-BBBBBBBBBB", productionHost: "www.example.com" });</script>`,
      }),
    );
    expect(cfg?.measurementId).toBeNull();
    expect(cfg?.unreadableCall).toContain("src/hooks.client.ts");
  });

  it("does not count a hooks.client.ts that never mentions the package as analytics", async () => {
    const cfg = await readTagConfig(
      await checkout({ "src/hooks.client.ts": "export const handleError = () => {};\n" }),
    );
    expect(cfg).toMatchObject({ measurementId: null, foreignAnalytics: false });
    expect(cfg?.unreadableCall).toBeUndefined();
  });

  it("pins every foreign-loader shape: msot's inline app.html, gtag(), dataLayer", async () => {
    for (const [rel, body] of [
      [
        "src/app.html",
        `<head>\n<!-- Google tag (gtag.js) -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=G-BZ0WQMEE8L"></script>\n</head>`,
      ],
      ["src/lib/a.ts", "window.gtag ('config', ID);"],
      ["src/lib/b.ts", "window.dataLayer = window.dataLayer || [];"],
    ] as const) {
      expect(await readTagConfig(await checkout({ [rel]: body }))).toMatchObject({
        foreignAnalytics: true,
        foreignFile: rel,
      });
    }
  });

  it("counts a loader the comment stripper would lose, so the scan fails closed", async () => {
    // An unquoted attribute is valid HTML, and its `//` reads as a JS line
    // comment to a stripper. The recipe's refusal to install alongside an
    // existing loader must not depend on the stripper parsing markup.
    const cfg = await readTagConfig(
      await checkout({
        "src/app.html":
          "<head><script async src=https://www.googletagmanager.com/gtag/js?id=G-BZ0WQMEE8L></script></head>",
      }),
    );
    expect(cfg).toMatchObject({ foreignAnalytics: true, foreignFile: "src/app.html" });
  });

  it("scans for a foreign loader when site-config.json declares only a host", async () => {
    // Round three's partial-declaration guard never reached this branch.
    const cfg = await readTagConfig(
      await checkout({
        "src/lib/site-config.json": JSON.stringify({ analytics: { productionHost: "x.com" } }),
        "src/lib/components/Analytics.svelte":
          'script.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;',
      }),
    );
    expect(cfg).toMatchObject({ measurementId: null, foreignAnalytics: true });
  });

  it("says so when the walk stopped at its cap, instead of reporting no loader", async () => {
    const dir = await checkout({
      "src/a.ts": "export {};",
      "src/b.ts": "export {};",
      "src/z.ts": "window.dataLayer = [];",
    });
    const cfg = await readTagConfig(dir, 2);
    expect(cfg).toMatchObject({ foreignAnalytics: false, scanIncomplete: true });
    const v = classifyAnalytics(
      facts({ config: cfg, propertyId: "111111111", evidence: { probe: null, htmlIds: [] } }),
    );
    expect(v.status).toBe("warn");
    expect(v.summary).not.toContain("nothing in its checkout references one");
  });

  it("pins beachfront's default-path warn: its own loader, a property, no browser", async () => {
    const dir = await checkout({
      "src/lib/components/Analytics.svelte":
        '<script>onMount(() => { const s = document.createElement("script"); s.src = "https://www.googletagmanager.com/gtag/js?id=G-51J638HZPL"; });</script>',
    });
    const res = await analyticsAudit({
      site: { path: dir, deployedUrl: "https://www.beachfrontdentistry.com/" },
      analyticsDeps: { propertyId: "551435715", fetchHtml: async () => "<html></html>" },
    });
    expect(res.status).toBe("warn");
    expect(res.summary).toContain("src/lib/components/Analytics.svelte");
  });
});

describe("round six: the probe counts a loader that arrived, not one that was asked for", () => {
  function fakePage() {
    const handlers: Record<string, Array<(x: unknown) => void>> = {};
    return {
      on(event: string, h: (x: unknown) => void) {
        (handlers[event] ??= []).push(h);
      },
      emit(event: string, x: unknown) {
        for (const h of handlers[event] ?? []) h(x);
      },
    };
  }
  const LOADER = "https://www.googletagmanager.com/gtag/js?id=G-AAAAAAAAAA";

  it("counts a 2xx response, and records a CSP-refused or failed request as failed", () => {
    const page = fakePage();
    const seen = collectLoaderIds(page as unknown as ProbePage);
    page.emit("requestfailed", {
      url: () => LOADER,
      failure: () => ({ errorText: "net::ERR_BLOCKED_BY_CSP" }),
    });
    page.emit("response", { url: () => LOADER, status: () => 404, ok: () => false });
    expect(seen.loadedIds).toEqual([]);
    expect(seen.failed).toEqual([
      { id: "G-AAAAAAAAAA", reason: "net::ERR_BLOCKED_BY_CSP" },
      { id: "G-AAAAAAAAAA", reason: "HTTP 404" },
    ]);
    page.emit("response", { url: () => LOADER, status: () => 200, ok: () => true });
    expect(seen.loadedIds).toEqual(["G-AAAAAAAAAA"]);
  });

  it("fails the exact CSP case the recipe exists to fix, and says it was refused", () => {
    const v = classifyAnalytics(
      facts({
        config: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
        propertyId: "111111111",
        evidence: {
          probe: {
            loadedIds: [],
            failed: [{ id: "G-AAAAAAAAAA", reason: "net::ERR_BLOCKED_BY_CSP" }],
          },
          htmlIds: null,
        },
      }),
    );
    expect(v.status).toBe("fail");
    expect(v.summary).toContain("net::ERR_BLOCKED_BY_CSP");
    expect(v.summary).toContain("Content-Security-Policy");
  });
});

describe("round six: minors", () => {
  const both = {
    config: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
    propertyId: "111111111",
  };

  it("counts only GA4 IDs, not Ads, Floodlight or Google-tag IDs on the same loader", () => {
    const html = ["AW-123", "DC-456", "GT-ABC", "G-AAAAAAAAAA"]
      .map((id) => `<script src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>`)
      .join("");
    expect(gtagLoaderIds(html)).toEqual(["G-AAAAAAAAAA"]);
  });

  it("keeps a successful property read when the live ID does not match", () => {
    const v = classifyAnalytics(
      facts({
        ...both,
        evidence: { probe: { loadedIds: ["G-OTHEROTHER"] }, htmlIds: null },
        property: { ok: true, users: 42 },
      }),
    );
    // 42 users contradicts "the configured one reads zero": a conflict, named.
    expect(v.status).toBe("warn");
    expect(v.summary).toContain("recorded 42 users");
    expect(v.summary).toContain("the evidence conflicts");
    expect(v.summary).not.toContain("reads zero");
  });

  it("does not say 'emitting' in a pass that did not observe emission", () => {
    const v = classifyAnalytics(
      facts({ ...both, evidence: { probe: null, htmlIds: [] }, property: { ok: true, users: 9 } }),
    );
    expect(v.status).toBe("pass");
    expect(v.summary).not.toContain("emitting");
    expect(v.summary).toContain("is declared");
  });

  it("does not assert collection it never observed for a declared tag with no property", () => {
    const v = classifyAnalytics(facts({ config: both.config, propertyId: null }));
    expect(v.status).toBe("fail");
    expect(v.summary).not.toContain("while the data exists");
  });

  it("names a failed property read once, and a missing row once", () => {
    const unreachable = classifyAnalytics(
      facts({
        ...both,
        evidence: { probe: { loadedIds: ["G-AAAAAAAAAA"] }, htmlIds: null },
        property: { ok: false, kind: "unavailable", error: "503" },
      }),
    );
    expect(unreachable.unchecked.filter((u) => u.startsWith("the GA4 property"))).toHaveLength(1);
    const noRow = classifyAnalytics(facts({ ...both, propertyId: undefined }));
    expect(noRow.unchecked.filter((u) => u.startsWith("the GA4 property"))).toHaveLength(1);
  });

  it("does not call any non-numeric property a measurement ID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-mal-"));
    await mkdir(join(dir, "src"), { recursive: true });
    const odd = await analyticsAudit({ site: { path: dir }, analyticsDeps: { propertyId: "abc" } });
    expect(odd.status).toBe("warn"); // advisory: the audit never fails a site (round seven);
    expect(odd.summary).not.toContain("G-…");
    const g = await analyticsAudit({
      site: { path: dir },
      analyticsDeps: { propertyId: "G-AAAAAAAAAA" },
    });
    expect(g.summary).toContain("measurement ID");
  });

  it("does no IO for a verdict that needs none", async () => {
    const calls: string[] = [];
    const deps = {
      fetchHtml: async () => {
        calls.push("fetchHtml");
        return "";
      },
      readUsers: async () => {
        calls.push("readUsers");
        return { ok: true as const, users: 1 };
      },
    };
    const noSrc = await mkdtemp(join(tmpdir(), "rd-nosrc-"));
    await analyticsAudit({
      site: { path: noSrc, deployedUrl: "https://www.example.com/" },
      analyticsDeps: { ...deps, propertyId: "111111111" },
    });
    await analyticsAudit({
      site: { path: noSrc, deployedUrl: "https://www.example.com/" },
      analyticsDeps: { ...deps, propertyId: "G-AAAAAAAAAA" },
    });
    expect(calls).toEqual([]);
  });

  it("turns the probe on only for a truthy REDDOOR_ANALYTICS_PROBE", async () => {
    for (const v of ["1", "true", "YES", "on"]) expect(probeRequested(v)).toBe(true);
    for (const v of [undefined, "", "0", "false", "no", "off"])
      expect(probeRequested(v)).toBe(false);
  });
});

describe("round seven: the audit is advisory — it warns, and never fails a site", () => {
  async function dir(files: Record<string, string> | null): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "rd-r7-"));
    if (files === null) return d; // no src/ at all
    await mkdir(join(d, "src"), { recursive: true });
    for (const [rel, body] of Object.entries(files)) {
      await mkdir(join(d, rel, ".."), { recursive: true });
      await writeFile(join(d, rel), body);
    }
    return d;
  }
  const ID = "G-AAAAAAAAAA";
  const OTHER = "G-BBBBBBBBBB";
  const loader = (id: string) => `https://www.googletagmanager.com/gtag/js?id=${id}`;
  const hook = (host: string) =>
    `import { initAnalytics } from "@reddoorla/maintenance/client";\nexport const init = () => initAnalytics({ measurementId: "${ID}", productionHost: "${host}" });\n`;

  it("returns no `fail` anywhere in the full verdict table (row × declared × evidence × GA read)", async () => {
    const checkouts: Array<[string, string]> = [
      ["no src/", await dir(null)],
      ["declares nothing", await dir({ "src/lib/x.ts": "export {};" })],
      ["literal hook", await dir({ "src/hooks.client.ts": hook("www.example.com") })],
      ["literal hook, wrong host", await dir({ "src/hooks.client.ts": hook("other.example.org") })],
      [
        "unreadable call",
        await dir({
          "src/routes/+layout.svelte": `<script>import { initAnalytics } from "@reddoorla/maintenance/client"; initAnalytics({ measurementId: GA_ID, productionHost: HOST });</script>`,
        }),
      ],
      [
        "foreign loader",
        await dir({ "src/app.html": `<script async src="${loader(ID)}"></script>` }),
      ],
      [
        "hook plus foreign",
        await dir({
          "src/hooks.client.ts": hook("www.example.com"),
          "src/app.html": `<script async src="${loader(OTHER)}"></script>`,
        }),
      ],
      [
        "site-config.json",
        await dir({
          "src/lib/site-config.json": JSON.stringify({
            analytics: { measurementId: ID, productionHost: "www.example.com" },
          }),
        }),
      ],
    ];
    const rows: Array<string | null | undefined> = [undefined, null, "123456789", ID, "abc"];
    const probes: Array<AnalyticsDeps["probeTag"]> = [
      undefined,
      async () => ({ loadedIds: [ID] }),
      async () => ({ loadedIds: [OTHER] }),
      async () => ({ loadedIds: [ID, ID] }),
      async () => ({ loadedIds: [] }),
      async () => ({ loadedIds: [], failed: [{ id: ID, reason: "csp" }] }),
      async () => {
        throw new Error("navigation answered HTTP 503");
      },
    ];
    const pages: Array<AnalyticsDeps["fetchHtml"]> = [
      undefined,
      async () => "<html></html>",
      async () => `<script async src="${loader(ID)}"></script>`,
      async () => `<script async src="${loader(OTHER)}"></script>`,
      async () => {
        throw new Error("GET → 401");
      },
    ];
    const reads: Array<AnalyticsDeps["readUsers"]> = [
      undefined,
      async () => ({ ok: true, users: 0 }),
      async () => ({ ok: true, users: 92 }),
      async () => ({ ok: false, kind: "denied", error: "5 NOT_FOUND" }),
      async () => ({ ok: false, kind: "unavailable", error: "503" }),
      async () => ({ ok: false, kind: "credentials", error: "invalid_grant" }),
    ];
    const fails: string[] = [];
    const seen = new Set<string>();
    let n = 0;
    for (const [label, path] of checkouts)
      for (const propertyId of rows)
        for (const [pi, probeTag] of probes.entries())
          for (const [hi, fetchHtml] of pages.entries())
            for (const [ri, readUsers] of reads.entries()) {
              const res = await analyticsAudit({
                site: { path, deployedUrl: "https://www.example.com/" },
                analyticsDeps: { propertyId, probeTag, fetchHtml, readUsers },
              });
              n++;
              seen.add(res.status);
              if (res.status === "fail") {
                fails.push(`${label} row=${String(propertyId)} probe=${pi} html=${hi} ga=${ri}`);
              }
            }
    expect(n).toBe(8 * 5 * 7 * 5 * 6);
    expect(fails).toEqual([]);
    expect([...seen].sort()).toEqual(["pass", "skip", "warn"]);
  }, 120_000);

  it("turns an unexpected throw inside the audit into a warn, not a fail", async () => {
    const res = await analyticsAudit({
      site: { path: await dir({}) },
      analyticsDeps: {
        get propertyId(): string {
          throw new Error("boom");
        },
      },
    });
    expect(res.status).toBe("warn");
    expect(res.summary).toContain("could not complete (boom)");
  });

  it("reddoor's shape: an interaction-gated loader, HTML naming the ID, 92 users — a named conflict", async () => {
    // Round seven, 3/3: the probe never interacts, so the loader never came,
    // and the verdict was a confident "blocked or dead legacy snippet" FAIL
    // that threw away both the HTML hit and 92 real users.
    const gated = `<script>
  addEventListener("pointerdown", () => {
    const s = document.createElement("script");
    s.src = "https://www.googletagmanager.com/gtag/js?id=G-REDDOOR001";
    document.head.appendChild(s);
  }, { once: true });
</script>`;
    const path = await dir({ "src/app.html": gated });
    for (const fetchHtml of [async () => gated, async () => "<html></html>"]) {
      const res = await analyticsAudit({
        site: { path, deployedUrl: "https://reddoorla.com/" },
        analyticsDeps: {
          propertyId: "471936475",
          probeTag: async () => ({ loadedIds: [] }),
          fetchHtml,
          readUsers: async () => ({ ok: true, users: 92 }),
        },
      });
      expect(res.status).toBe("warn");
      expect(res.summary).toContain("the evidence conflicts");
      expect(res.summary).toContain("recorded 92 users");
      expect(res.summary).toContain("the probe saw no gtag loader arrive");
      expect(res.summary).not.toMatch(/zero|not firing|\bdead\b|recording nothing/i);
    }
  });

  it("never claims zero, not firing, dead or recording nothing beside a GA read of users > 0", () => {
    const configs: TagConfig[] = [
      { measurementId: null, productionHost: null },
      {
        measurementId: null,
        productionHost: null,
        foreignAnalytics: true,
        foreignFile: "src/app.html",
      },
      { measurementId: ID, productionHost: "www.example.com" },
      { measurementId: ID, productionHost: "other.example.org" },
    ];
    const evidence: EmissionEvidence[] = [
      { probe: null, htmlIds: null },
      { probe: null, htmlIds: [] },
      { probe: { loadedIds: [] }, htmlIds: null },
      { probe: { loadedIds: [] }, htmlIds: [ID] },
      { probe: { loadedIds: [OTHER] }, htmlIds: null },
      { probe: { loadedIds: [], failed: [{ id: ID, reason: "csp" }] }, htmlIds: null },
    ];
    for (const config of configs)
      for (const ev of evidence) {
        const v = classifyAnalytics(
          facts({
            config,
            propertyId: "111111111",
            evidence: ev,
            property: { ok: true, users: 92 },
          }),
        );
        expect(v.summary).not.toMatch(/zero|not firing|\bdead\b|recording nothing/i);
      }
  });
});

describe("round seven: a probe whose page did not answer 2xx checked nothing", () => {
  function page(nav: { ok(): boolean; status(): number } | null) {
    const waits: number[] = [];
    return {
      waits,
      on: () => undefined,
      goto: async () => nav,
      waitForTimeout: async (ms: number) => {
        waits.push(ms);
      },
    };
  }

  it("throws on a 503, a 401, or no response, and settles only after a 2xx", async () => {
    for (const status of [503, 401]) {
      await expect(
        probePage(page({ ok: () => false, status: () => status }), "https://x.example/", 10),
      ).rejects.toThrow(`HTTP ${status}`);
    }
    await expect(probePage(page(null), "https://x.example/", 10)).rejects.toThrow("nothing");
    const ok = page({ ok: () => true, status: () => 200 });
    await expect(probePage(ok, "https://x.example/", 10)).resolves.toEqual({
      loadedIds: [],
      failed: [],
    });
    expect(ok.waits).toEqual([10]);
  });

  it("lists 'whether the tag fires' as not checked when the probe threw", async () => {
    const d = await mkdtemp(join(tmpdir(), "rd-r7p-"));
    await mkdir(join(d, "src"), { recursive: true });
    await writeFile(
      join(d, "src", "hooks.client.ts"),
      `initAnalytics({ measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" });`,
    );
    const res = await analyticsAudit({
      site: { path: d, deployedUrl: "https://www.example.com/" },
      analyticsDeps: {
        propertyId: "111111111",
        probeTag: () =>
          probePage(page({ ok: () => false, status: () => 503 }), "https://www.example.com/", 10),
      },
    });
    expect(res.summary).toContain("Not checked: whether the tag fires");
  });
});

describe("round seven, check: a recorded refusal is an observation, and an HTML mismatch is not a pass", () => {
  const A = "G-AAAAAAAAAA";
  const B = "G-BBBBBBBBBB";

  it("keeps a CSP-refused loader named in the HTML as emitting: false", () => {
    const e = determineEmission({
      probe: { loadedIds: [], failed: [{ id: A, reason: "net::ERR_BLOCKED_BY_CSP" }] },
      htmlIds: [A],
    });
    expect(e.emitting).toBe(false);
    expect(e.authoritative).toBe(true);
  });

  it("case L: hook plus a same-ID snippet, the loader CSP-refused, HTML naming it — not a pass", async () => {
    const d = await mkdtemp(join(tmpdir(), "rd-caseL-"));
    await mkdir(join(d, "src"), { recursive: true });
    await writeFile(
      join(d, "src", "hooks.client.ts"),
      `initAnalytics({ measurementId: "${A}", productionHost: "www.example.com" });`,
    );
    const html = `<script async src="https://www.googletagmanager.com/gtag/js?id=${A}"></script>`;
    await writeFile(join(d, "src", "app.html"), html);
    const res = await analyticsAudit({
      site: { path: d, deployedUrl: "https://www.example.com/" },
      analyticsDeps: {
        propertyId: "111111111",
        probeTag: async () => ({
          loadedIds: [],
          failed: [{ id: A, reason: "net::ERR_BLOCKED_BY_CSP" }],
        }),
        fetchHtml: async () => html,
      },
    });
    expect(res.status).not.toBe("pass");
    expect(res.summary).toContain("net::ERR_BLOCKED_BY_CSP");
    expect(res.summary).toContain("Content-Security-Policy");
  });

  it("case H: hook G-A, a probe that saw nothing, HTML naming G-B — warns with the mismatch", () => {
    const v = classifyAnalytics(
      facts({
        config: { measurementId: A, productionHost: "www.example.com" },
        propertyId: "111111111",
        evidence: { probe: { loadedIds: [] }, htmlIds: [B] },
      }),
    );
    expect(v.status).toBe("warn");
    expect(v.summary).toContain(`the live site loads ${B} but the checkout declares ${A}`);
  });

  it("turns a thrown null or undefined into a warn, not a crash", async () => {
    for (const thrown of [null, undefined]) {
      const res = await analyticsAudit({
        site: { path: "/nonexistent" },
        analyticsDeps: {
          get propertyId(): string {
            throw thrown;
          },
        },
      });
      expect(res.status).toBe("warn");
      expect(res.summary).toContain(`could not complete (${String(thrown)})`);
    }
  });
});
