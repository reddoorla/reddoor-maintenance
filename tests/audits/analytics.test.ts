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

  it("reports every distinct loader once, which is how double-tagging surfaces", () => {
    const html = `
      <script src="https://www.googletagmanager.com/gtag/js?id=G-AAAAAAAAAA"></script>
      <script src="https://www.googletagmanager.com/gtag/js?id=G-AAAAAAAAAA"></script>
      <script src="https://www.googletagmanager.com/gtag/js?l=dataLayer&id=G-BBBBBBBBBB"></script>`;
    expect(gtagLoaderIds(html).sort()).toEqual(["G-AAAAAAAAAA", "G-BBBBBBBBBB"]);
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
    expect(v.summary).toContain("no GA4 property ID");
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

  it("warns on two loaders, which double every session", () => {
    const v = classifyAnalytics(
      facts({
        ...both,
        evidence: { probe: { requestedIds: ["G-AAAAAAAAAA", "G-OLDOLDOLD"] }, htmlIds: [] },
        property: { ok: true, users: 10 },
      }),
    );
    expect(v.status).toBe("warn");
    expect(v.summary).toContain("double every session");
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
  async function siteWith(contents: string | null): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "rd-analytics-"));
    if (contents !== null) {
      await mkdir(join(dir, "src", "lib"), { recursive: true });
      await writeFile(join(dir, "src", "lib", "site-config.json"), contents);
    }
    return dir;
  }

  it("reads the analytics block", async () => {
    const dir = await siteWith(
      JSON.stringify({ analytics: { measurementId: "G-AAAAAAAAAA", productionHost: "www.x.com" } }),
    );
    expect(await readTagConfig(dir)).toEqual({
      measurementId: "G-AAAAAAAAAA",
      productionHost: "www.x.com",
    });
  });

  it("distinguishes 'could not look' from 'looked, it is off'", async () => {
    // A missing or corrupt file is null, which makes the audit say it could not
    // check. A valid file with no analytics block is a real, readable "off".
    expect(await readTagConfig(await siteWith(null))).toBeNull();
    expect(await readTagConfig(await siteWith("{ not json"))).toBeNull();
    expect(await readTagConfig(await siteWith(JSON.stringify({ nav: { items: [] } })))).toEqual({
      measurementId: null,
      productionHost: null,
    });
  });

  it("treats a blank or non-string value as unset", async () => {
    const dir = await siteWith(
      JSON.stringify({ analytics: { measurementId: "   ", productionHost: 42 } }),
    );
    expect(await readTagConfig(dir)).toEqual({ measurementId: null, productionHost: null });
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
    for (const m of ["PERMISSION_DENIED", "NOT_FOUND", "403 Forbidden", "invalid_grant"]) {
      expect(classifyPropertyError(m)).toBe("denied");
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
      expect(classifyPropertyError(m)).toBe("unavailable");
    }
  });
});

describe("classifyAnalytics never passes on an unobserved site", () => {
  const configured = {
    config: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
    propertyId: "111111111",
  };

  it("skips — does not pass — when neither half could be checked", () => {
    // THE failure mode this audit could have had. After the sweep every loader
    // is JS-injected, so an HTML scan returns [] for every healthy site; add no
    // browser and no GA credentials and this is the NORMAL path. Returning
    // `pass` from it would green the whole fleet on the strength of two config
    // values agreeing with each other. `status` is what the cockpit and the
    // fleet write-back aggregate on, so a disclosure in `unchecked` is not
    // enough.
    for (const evidence of [
      { probe: null, htmlIds: null },
      { probe: null, htmlIds: [] },
    ]) {
      const v = classifyAnalytics(facts({ ...configured, evidence, property: null }));
      expect(v.status).toBe("skip");
      expect(v.summary).toContain("nothing about");
    }
  });

  it("passes only once something was actually seen", () => {
    const v = classifyAnalytics(
      facts({
        ...configured,
        evidence: { probe: { requestedIds: ["G-AAAAAAAAAA"] }, htmlIds: [] },
        property: null,
      }),
    );
    expect(v.status).toBe("pass");
    expect(v.summary).toContain("not read");
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

  it("does not pass a site it could not observe at all", async () => {
    const dir = await siteDir({
      analytics: { measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" },
    });
    const res = await run(dir, "https://www.example.com/", { propertyId: "111111111" });
    expect(res.status).toBe("skip");
    expect(res.summary).toContain("Not checked");
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
    expect(res.status).toBe("skip");
    expect(res.summary).toContain("whether the tag fires");
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
