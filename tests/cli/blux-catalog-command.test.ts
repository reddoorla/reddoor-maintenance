import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { runBluxCommand } from "../../src/cli/commands/blux.js";
import { minimalSite } from "../blux/fixtures/minimal-site.js";

// Band 0 is heading-only: the breadth router classifies it TitleBand →
// BluxSection, proving the plan-only (no sidecar) write path. Band 4 is a
// FEED band (empty after the template drop) whose site.json item — the
// positional join items[4] — declares `sources`, so it must emit a
// blux_collection query-spec slice.
const twoBandHtml =
  `<div id="page-content"><section class="blocks0" id="page-block-0">` +
  `<div class="block-content"><h1 class="block-title text5">Hi</h1></div></section>` +
  `<section class="blocks0" id="page-block-4">` +
  `<div class="block-content"><h2 class="block-title text5">Team</h2></div></section></div>`;

/** Write a minimal Blux export dir: the shared minimal site plus a feed band
 * item at index 4 sourcing the fixture's Team feed (cloned — the shared
 * fixture stays pristine for the other suites). */
async function makeExportDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "blux-catalog-"));
  // Widen the fixture's literal item-shape union so the feed item can land.
  const site = structuredClone(minimalSite) as unknown as {
    content: { pages: { items: unknown[] }[] };
    media: Record<string, unknown>;
    footer: unknown[];
  };
  site.content.pages[0]!.items[4] = {
    sources: ["feed-1"],
    sourceConfig: { sort: "title" },
    styles: {},
  };
  // Task 4 chrome: a footer logo media that appears NOWHERE in the page html
  // (real exports download chrome images locally, so the scrape misses them) —
  // site-config.json must carry the reconstructed CDN url (base + uuid + ext),
  // the same fallback the convert action's resolveLogo uses.
  site.media["logo-1"] = { name: "logo.png", type: "image/png", siteID: "site-1" };
  site.footer = [
    {
      items: [
        {
          text: "Footer Item",
          link: "",
          items: [
            {
              text: "Sub-Footer Item",
              link: "",
              title: "Logo",
              hideTitle: true,
              media: { media: "logo-1", "max-width": "150px" },
            },
            { text: "Sub-Footer Item", link: "", title: "© Minimal" },
          ],
        },
      ],
    },
  ];
  await writeFile(join(dir, "site.json"), JSON.stringify(site));
  await writeFile(join(dir, "index.html"), twoBandHtml);
  return dir;
}

describe("blux catalog", () => {
  let exportDir: string;
  let out: string;
  let result: { output: string; code: number };

  beforeAll(async () => {
    exportDir = await makeExportDir();
    out = join(exportDir, "out");
    result = await runBluxCommand("catalog", exportDir, { out });
  });

  it("exits 0", () => {
    expect(result.code).toBe(0);
  });

  it("writes migration-plan.json whose first slice is a blux_section", async () => {
    const planPath = join(out, "migration-plan.json");
    expect(existsSync(planPath)).toBe(true);
    const plan = JSON.parse(await readFile(planPath, "utf-8"));
    expect(plan.documents[0]).toMatchObject({ type: "page", uid: "home" });
    expect(plan.documents[0].data.slices[0].slice_type).toBe("blux_section");
  });

  it("writes NO blux-presentation.json sidecar (plan-only)", () => {
    expect(existsSync(join(out, "blux-presentation.json"))).toBe(false);
  });

  it("emits the feed band as a blux_collection query-spec slice", async () => {
    const plan = JSON.parse(await readFile(join(out, "migration-plan.json"), "utf-8"));
    const slices = plan.documents[0].data.slices as {
      slice_type: string;
      primary: Record<string, unknown>;
    }[];
    const collection = slices.find((s) => s.slice_type === "blux_collection");
    expect(collection).toBeDefined();
    expect(collection!.primary).toMatchObject({
      collection_type: "person", // Team → person (frozen §8 mapping)
      feed_ids: "feed-1",
      sort: "title",
      layout: "grid",
    });
  });

  // Task 4 (plan 4d): site chrome + theme ride beside the plan.
  it("writes site-config.json with nav + full footer columns beside the plan", async () => {
    const cfgPath = join(out, "site-config.json");
    expect(existsSync(cfgPath)).toBe(true);
    const cfg = JSON.parse(await readFile(cfgPath, "utf-8"));
    expect(cfg.nav).toMatchObject({ items: [{ label: "Home" }] });
    expect(cfg.footer).toEqual({
      columns: [
        {
          items: [
            // Unscraped chrome media resolve via the reconstructed CDN url;
            // the row's title becomes the image's accessible name (alt).
            {
              image: {
                url: "https://d3syaxnfm3oj0e.cloudfront.net/site-1/logo-1.png",
                maxWidth: "150px",
                alt: "Logo",
              },
            },
            { text: "© Minimal" },
          ],
        },
      ],
    });
  });

  it("writes theme.css with ALL three segments: @theme vars + roles + buttons", async () => {
    const cssPath = join(out, "theme.css");
    expect(existsSync(cssPath)).toBe(true);
    const css = await readFile(cssPath, "utf-8");
    // @theme block (emitThemeCss).
    expect(css).toContain("--color-");
    // Roles utility layer (emitRolesCss) — the fixture declares text styles.
    expect(css).toContain(".txt-role-text0");
    // Button-skin layer (emitButtonsCss) — the fixture declares buttons0.
    expect(css).toContain(".buttons0");
    // A dropped segment or a changed "\n" separator between them fails here:
    // roles must sit AFTER the @theme block, buttons AFTER roles.
    expect(css.indexOf(".txt-role-text0")).toBeGreaterThan(css.indexOf("--color-"));
    expect(css.indexOf(".buttons0")).toBeGreaterThan(css.indexOf(".txt-role-text0"));
  });

  it("entity documents + extension custom types ride the plan", async () => {
    const plan = JSON.parse(await readFile(join(out, "migration-plan.json"), "utf-8"));
    const people = plan.documents.filter((d: { type: string }) => d.type === "person");
    expect(people.length).toBeGreaterThanOrEqual(1);
    expect(people.map((d: { uid: string }) => d.uid)).toContain("jane-doe");
    const ct = plan.customTypes.find((c: { id: string }) => c.id === "person");
    expect(ct).toBeDefined();
  });

  // Task 5 (plan 4d): the OFFLINE render fixture for the starter fidelity-gate
  // route — plan markers resolved into the Prismic-HYDRATED shapes the
  // production SliceZone consumes (richtext → node arrays, asset → url image
  // fields), with entity docs grouped by type for context.collections.
  it("writes render-fixture.json: page docs with array slices, entities grouped, zero markers", async () => {
    const fxPath = join(out, "render-fixture.json");
    expect(existsSync(fxPath)).toBe(true);
    const raw = await readFile(fxPath, "utf-8");
    const fx = JSON.parse(raw) as {
      documents: { type: string; uid: string; data: { slices?: unknown } }[];
      collections: Record<string, { uid: string }[]>;
      missingAssets: string[];
    };
    // Only the page doc lands in documents; the Team feed's person entities are
    // grouped under collections for SliceZone context.collections.
    expect(fx.documents).toHaveLength(1);
    expect(fx.documents[0]).toMatchObject({ type: "page", uid: "home" });
    expect(Array.isArray(fx.documents[0]!.data.slices)).toBe(true);
    expect(fx.collections.person!.map((d) => d.uid)).toContain("jane-doe");
    // Offline-resolution proof: NO unresolved plan markers survive into the
    // fixture the render consumes.
    expect(raw).not.toContain("__richtext_html");
    expect(raw).not.toContain("__asset_id");
  });
});

// Round-2 items 3 + 10b: classify/join diagnostics must land in the WRITTEN
// migration-plan.json (round 1 verified the threading only by probe). The
// fixture carries BOTH failure shapes: items[1] sources the Team feed but
// parseGridBands yields no band at index 1 (the williamsonHomes homepage
// shape — the feed item is never consumed), and band 4's item sources an
// unknown feed.
describe("blux catalog — join diagnostics ride the written plan", () => {
  let plan: {
    diagnostics: { kind: string; where: string; message: string }[];
    documents: { type: string; data: { slices?: { slice_type: string }[] } }[];
  };

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-catalog-diag-"));
    const site = structuredClone(minimalSite) as unknown as {
      content: { pages: { items: unknown[] }[] };
    };
    // Unconsumed feed item: index 1 has NO band in the html below.
    site.content.pages[0]!.items[1] = { sources: ["feed-1"], sourceConfig: {}, styles: {} };
    // Misaligned source: band 4 exists (emptyish) but its feed is unknown.
    site.content.pages[0]!.items[4] = { sources: ["ghost-feed"], sourceConfig: {}, styles: {} };
    await writeFile(join(dir, "site.json"), JSON.stringify(site));
    await writeFile(join(dir, "index.html"), twoBandHtml);
    const out = join(dir, "out");
    const result = await runBluxCommand("catalog", dir, { out });
    expect(result.code).toBe(0);
    plan = JSON.parse(await readFile(join(out, "migration-plan.json"), "utf-8"));
  });

  it("an unconsumed feed item (no band at its index) is diagnosed — collection not emitted", () => {
    const misaligns = plan.diagnostics.filter((d) => d.kind === "feed-band-misalign");
    expect(misaligns).toHaveLength(1);
    expect(misaligns[0]!.where).toBe("home:1");
    expect(misaligns[0]!.message).toContain('feed item at index 1 ("Team") has no matching band');
    expect(misaligns[0]!.message).toContain("collection not emitted");
    // Diagnostic-only: no invented collection slice for the missing band.
    const slices = plan.documents[0]!.data.slices!;
    const collections = slices.filter((s) => s.slice_type === "blux_collection");
    expect(collections).toHaveLength(1); // band 4's only
  });

  it("an unknown feed source is diagnosed in the written plan, addressed by page uid", () => {
    const skips = plan.diagnostics.filter(
      (d) => d.kind === "skipped-feed" && d.message.includes("ghost-feed"),
    );
    expect(skips).toHaveLength(1);
    expect(skips[0]!.where).toBe("home:4");
  });
});

// Task 1 (plan 4d): the catalog action assembles the REAL IR (not the walking
// skeleton's empty asset index), so a media the grid parser captures WITHOUT a
// CDN data-base resolves through the IR asset index — AssetRef.sourceUrl, the
// canonical CDN url collectAssetUrls scrapes out of the page html (site.json's
// media dict carries name/type only, never a url; non-CDN hosts are rejected
// by normalizeCdnUrl, so the fixture url must be CDN-shaped).
describe("blux catalog — IR asset index (sourceUrl fallback)", () => {
  it("resolves no-base media through the IR asset index (sourceUrl fallback)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-catalog-ir-"));
    const site = structuredClone(minimalSite) as unknown as {
      media: Record<string, { name: string; type: string; siteID: string }>;
    };
    site.media["aaaa-bbbb"] = { name: "loose.png", type: "image/png", siteID: "site-1" };
    const html =
      `<div id="page-content"><section class="blocks0" id="page-block-0">` +
      `<div class="block-content"><h2 class="block-title text5">Photo</h2>` +
      `<div class="ib img imgfit camediaload" data-media="aaaa-bbbb" data-ext="png"></div>` +
      `</div></section></div>` +
      // Scrape targets for EVERY media-dict entry (and the feed record's
      // img-2), mimicking a real rendered page — so the whole index resolves
      // and the plan carries zero unresolved-asset diagnostics.
      `<img src="https://d3syaxnfm3oj0e.cloudfront.net/site-1/w:96/from:jpg/img-1.jpg">` +
      `<img src="https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-2.jpg">` +
      `<img src="https://d3syaxnfm3oj0e.cloudfront.net/site-1/aaaa-bbbb.png">`;
    await writeFile(join(dir, "site.json"), JSON.stringify(site));
    await writeFile(join(dir, "index.html"), html);
    const out = join(dir, "out");
    const result = await runBluxCommand("catalog", dir, { out });
    expect(result.code).toBe(0);
    const plan = JSON.parse(await readFile(join(out, "migration-plan.json"), "utf-8")) as {
      assets: { id: string; url: string }[];
      diagnostics: { kind: string; where: string }[];
    };
    const asset = plan.assets.find((a) => a.id === "aaaa-bbbb");
    expect(asset?.url).toBe("https://d3syaxnfm3oj0e.cloudfront.net/site-1/aaaa-bbbb.png");
    expect(plan.diagnostics.filter((d) => d.kind === "unresolved-asset")).toHaveLength(0);

    // Task 5: the render fixture resolves that same media marker into a
    // hydrated image field carrying the scraped CDN url (offline, no Prismic
    // round-trip) — so an image field with a url is present, markers are gone.
    const raw = await readFile(join(out, "render-fixture.json"), "utf-8");
    expect(raw).toContain("https://d3syaxnfm3oj0e.cloudfront.net/site-1/aaaa-bbbb.png");
    expect(raw).toContain('"dimensions"');
    expect(raw).not.toContain("__asset_id");
    expect(raw).not.toContain("__richtext_html");
  });
});

// Task 4 (plan 4d) — quality review I2: the chrome logo resolver's THREE-tier
// order is load-bearing (plan-asset url → IR sourceUrl → CDN reconstruction).
// A media the page grid ALSO uses keeps its parser-captured data-base via the
// plan; a chrome-only media falls to its scraped sourceUrl. The three bases are
// chosen to DIFFER so each tier is provable, not coincidental. (tier 3 —
// reconstruction from feedAssetBase — is already pinned by the fixture-footer
// test above, where the chrome media appears nowhere in the html.)
describe("blux catalog — chrome logo resolver tier order", () => {
  type Cfg = { footer: { columns: { items: { image?: { url: string } }[] }[] } };
  let plan: { assets: { id: string; url: string }[] };
  let cfg: Cfg;

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-catalog-chrome-tier-"));
    const site = structuredClone(minimalSite) as unknown as {
      media: Record<string, { name: string; type: string; siteID: string }>;
      footer: unknown[];
    };
    site.media["tier1-logo"] = { name: "t1.png", type: "image/png", siteID: "site-1" };
    site.media["tier2-logo"] = { name: "t2.png", type: "image/png", siteID: "site-1" };
    // tier1-logo rides a GRID band carrying its own data-base → the plan lists
    // it at that base (planbase). tier2-logo is chrome-only (no band) but is
    // scraped as a bare <img> at a DIFFERENT base (otherbase) → IR sourceUrl.
    const html =
      `<div id="page-content"><section class="blocks0" id="page-block-0">` +
      `<div class="block-content"><h2 class="block-title text5">Photo</h2>` +
      `<div class="ib img imgfit camediaload" data-media="tier1-logo" data-ext="png" ` +
      `data-base="https://d3syaxnfm3oj0e.cloudfront.net/planbase/"></div>` +
      `</div></section></div>` +
      // Scrape targets: tier1-logo at site-1 (so its sourceUrl DIFFERS from the
      // plan's planbase — proving the plan tier wins), tier2-logo at otherbase,
      // plus the fixture's own media so the index resolves cleanly.
      `<img src="https://d3syaxnfm3oj0e.cloudfront.net/site-1/tier1-logo.png">` +
      `<img src="https://d3syaxnfm3oj0e.cloudfront.net/otherbase/tier2-logo.png">` +
      `<img src="https://d3syaxnfm3oj0e.cloudfront.net/site-1/w:96/from:jpg/img-1.jpg">` +
      `<img src="https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-2.jpg">`;
    site.footer = [
      {
        items: [
          {
            text: "Footer Item",
            link: "",
            items: [
              { text: "Sub-Footer Item", link: "", media: { media: "tier1-logo" } },
              { text: "Sub-Footer Item", link: "", media: { media: "tier2-logo" } },
            ],
          },
        ],
      },
    ];
    await writeFile(join(dir, "site.json"), JSON.stringify(site));
    await writeFile(join(dir, "index.html"), html);
    const out = join(dir, "out");
    const result = await runBluxCommand("catalog", dir, { out });
    expect(result.code).toBe(0);
    plan = JSON.parse(await readFile(join(out, "migration-plan.json"), "utf-8"));
    cfg = JSON.parse(await readFile(join(out, "site-config.json"), "utf-8"));
  });

  const footerImg = (n: number): string | undefined =>
    cfg.footer.columns[0]?.items[n]?.image?.url;

  it("tier 1: a grid-shared chrome media carries the exact plan-asset url (not its sourceUrl)", () => {
    const planAsset = plan.assets.find((a) => a.id === "tier1-logo");
    expect(planAsset).toBeDefined();
    expect(planAsset!.url).toContain("/planbase/"); // from the grid's data-base
    const url = footerImg(0);
    expect(url).toBe(planAsset!.url); // site-config carries the plan url verbatim
    expect(url).not.toContain("/site-1/"); // NOT the tier-2 sourceUrl
  });

  it("tier 2: a chrome-only media (absent from plan.assets) falls to its IR sourceUrl", () => {
    expect(plan.assets.find((a) => a.id === "tier2-logo")).toBeUndefined();
    const url = footerImg(1);
    expect(url).toContain("/otherbase/"); // the scraped IR sourceUrl
    expect(url).not.toContain("/planbase/"); // NOT tier-3 reconstruction (feedAssetBase=planbase)
  });
});

describe("blux catalog errors", () => {
  it("fails cleanly when the export dir has no site.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-catalog-empty-"));
    const result = await runBluxCommand("catalog", dir, {});
    expect(result.code).toBe(1);
    expect(result.output).toContain("site.json");
  });
});

// Task 3 (plan 4d): the two-phase migrate-catalog action. Credless, the
// runner's readCreds throws BEFORE any network call (pushCustomTypes and
// runMigration both read creds as their first statement), so this suite
// proves the action wiring — plan read, runner reached, error surfaced —
// entirely offline. Env vars are deleted per-test (saved/restored) so a
// dev machine with real creds can never trigger a live migration here.
describe("blux migrate-catalog gate", () => {
  const saved: Record<string, string | undefined> = {};

  // beforeEach (not per-test) so EVERY test in the suite runs credless —
  // including any future .only run — and can never reach a live migration.
  beforeEach(() => {
    for (const k of ["PRISMIC_REPOSITORY_NAME", "PRISMIC_WRITE_TOKEN"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ["PRISMIC_REPOSITORY_NAME", "PRISMIC_WRITE_TOKEN"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("reads the plan and reports missing creds without throwing", async () => {
    // Reuse the catalog fixture to produce a REAL migration-plan.json.
    const exportDir = await makeExportDir();
    const out = join(exportDir, "out");
    const cataloged = await runBluxCommand("catalog", exportDir, { out });
    expect(cataloged.code).toBe(0);
    const r = await runBluxCommand("migrate-catalog", out, {});
    expect(r.code).not.toBe(0);
    // The creds read is the throw site — proves runMigration's network
    // surface was never reached.
    expect(r.output.toLowerCase()).toMatch(/cred|prismic_repository_name|token/);
  });

  it("fails cleanly when the dir has no migration-plan.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-migrate-catalog-empty-"));
    const r = await runBluxCommand("migrate-catalog", dir, {});
    expect(r.code).toBe(1);
    expect(r.output).toContain("could not read migration-plan.json");
  });
});
