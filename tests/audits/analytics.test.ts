import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyAnalytics,
  determineEmission,
  gtagLoaderIds,
  readTagConfig,
  type AnalyticsFacts,
} from "../../src/audits/analytics.js";

const BASE: AnalyticsFacts = {
  config: { measurementId: null, productionHost: null },
  propertyId: null,
  siteUrl: "https://www.example.com/",
  evidence: { probe: null, htmlIds: null },
  property: null,
  preLaunch: false,
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

  it("vida-legacy-foundation: the same shape before launch is expected, not broken", () => {
    const v = classifyAnalytics(
      facts({
        propertyId: "500039567",
        preLaunch: true,
        evidence: { probe: { requestedIds: [] }, htmlIds: [] },
      }),
    );
    expect(v.status).toBe("warn");
    expect(v.summary).toContain("Expected before launch");
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
        property: { ok: false, error: "PERMISSION_DENIED" },
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
