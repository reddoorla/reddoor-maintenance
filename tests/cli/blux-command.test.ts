import { mkdtemp, writeFile, readFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { runBluxCommand } from "../../src/cli/commands/blux.js";
import { minimalSite, minimalHtml } from "../blux/fixtures/minimal-site.js";

/** Write a fake Blux export dir (site.json + rendered index.html). */
async function makeExportDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "blux-export-"));
  await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
  await writeFile(join(dir, "index.html"), minimalHtml);
  return dir;
}

describe("blux emit", () => {
  let exportDir: string;
  let out: string;
  let result: { output: string; code: number };

  beforeAll(async () => {
    exportDir = await makeExportDir();
    out = join(exportDir, "out");
    result = await runBluxCommand("emit", exportDir, { out });
  });

  it("exits 0 and summarizes pages, documents, and assets", () => {
    expect(result.code).toBe(0);
    expect(result.output).toContain("pages: 1");
    expect(result.output).toContain("documents: 3"); // 1 page + 2 team records
    expect(result.output).toContain("custom types: 1");
  });

  it("writes the migration plan with page + collection documents", async () => {
    const plan = JSON.parse(await readFile(join(out, "migration-plan.json"), "utf-8"));
    expect(plan.documents).toHaveLength(3);
    expect(plan.documents[0]).toMatchObject({ type: "page", uid: "home" });
    expect(plan.customTypes).toHaveLength(1);
    expect(plan.assets.length).toBeGreaterThan(0);
  });

  it("writes one customtypes/<id>.json per collection", async () => {
    const ct = JSON.parse(await readFile(join(out, "customtypes", "team.json"), "utf-8"));
    expect(ct.id).toBe("team");
    expect(ct.repeatable).toBe(true);
  });

  it("writes the theme stylesheet with the export's real text roles", async () => {
    const css = await readFile(join(out, "theme.css"), "utf-8");
    expect(css).toContain("@theme {");
    expect(css).toContain("--color-c1: #111111;");
    expect(css).toContain("/* text5 — Grid Titles */");
    expect(css).toContain("--text-text5--letter-spacing: 1.5px;");
  });

  it("appends the .txt-role utilities so a site consumes theme.css directly", async () => {
    const css = await readFile(join(out, "theme.css"), "utf-8");
    // the @theme tokens come first, then the utilities that reference them
    expect(css).toContain(".txt-role-text5 :is(h1, h2, h3, h4, h5, h6, p) {");
    expect(css).toContain("font-size: var(--text-text5);");
    expect(css.indexOf("@theme {")).toBeLessThan(css.indexOf(".txt-role-text5"));
  });

  it("writes the styles manifest beside the plan", async () => {
    const manifest = JSON.parse(await readFile(join(out, "styles-manifest.json"), "utf-8"));
    expect(manifest[0].pageUid).toBe("home");
    expect(manifest[0].slices[0]).toMatchObject({ index: 0, sliceType: "hero" });
    expect(manifest[0].slices[0].presentation.headingStyle).toEqual({
      color: "#ffffff",
      "font-size": "44px",
    });
  });

  it("writes a review manifest pairing pages with Blux originals", async () => {
    const manifest = JSON.parse(await readFile(join(out, "review-manifest.json"), "utf-8"));
    expect(manifest.pairs).toHaveLength(1);
    expect(manifest.pairs[0].original).toContain("www.testsite.com");
  });

  it("writes the assembled IR for inspection", () => {
    expect(existsSync(join(out, "ir.json"))).toBe(true);
  });

  it("is deterministic across runs", async () => {
    const first = await readFile(join(out, "migration-plan.json"), "utf-8");
    await runBluxCommand("emit", exportDir, { out });
    const second = await readFile(join(out, "migration-plan.json"), "utf-8");
    expect(second).toBe(first);
  });
});

describe("blux emit --probe", () => {
  it("resolves used assets via the injected prober when the HTML scrape misses", async () => {
    const dir = await makeExportDir();
    // strip the rendered HTML so the scrape finds nothing
    await writeFile(join(dir, "index.html"), "<html><body>shell</body></html>");
    const out = join(dir, "probed-out");
    const fetchImpl = (async (url: string) =>
      ({
        ok: url.includes("img-1") || url.includes("img-2"),
      }) as Response) as unknown as typeof fetch;
    const result = await runBluxCommand("emit", dir, { out, probe: true, fetchImpl });
    expect(result.code).toBe(0);
    expect(result.output).toContain("probe resolved 2/2");
    const plan = JSON.parse(await readFile(join(out, "migration-plan.json"), "utf-8"));
    expect(plan.assets.map((a: { id: string }) => a.id).sort()).toEqual(["img-1", "img-2"]);
    // probe-resolved assets are no longer unresolved diagnostics
    expect(result.output).not.toContain("unresolved-asset");
  });
});

describe("blux emit errors", () => {
  it("fails cleanly when the export dir has no site.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-empty-"));
    const result = await runBluxCommand("emit", dir, {});
    expect(result.code).toBe(1);
    expect(result.output).toContain("site.json");
  });

  it("rejects an unknown action", async () => {
    const result = await runBluxCommand("nope", undefined, {});
    expect(result.code).toBe(1);
    expect(result.output).toContain("unknown blux action");
  });
});

describe("blux validate", () => {
  const writeMinimalExport = async (dir: string) => {
    await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
    await writeFile(join(dir, "index.html"), minimalHtml);
  };
  const writePointeExport = async (dir: string) => {
    await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
    await copyFile(
      fileURLToPath(new URL("../blux/fixtures/the-pointe-page-content.html", import.meta.url)),
      join(dir, "index.html"),
    );
  };
  // An export whose one media genuinely can't resolve: a bare camediaload image
  // with NO data-base (no offline CDN url) and an assetId absent from site.json
  // (no IR sourceUrl). Exercises the gate's core "media dropped" signal without
  // depending on any real asset.
  const writeUnresolvableExport = async (dir: string) => {
    await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
    await writeFile(
      join(dir, "index.html"),
      `<div id="page-content"><section class="blocks0" id="page-block-0"><div class="block-content"><div class="ib img imgfit camediaload" data-media="ghost-unresolvable" data-ext="jpg"></div></div></section></div>`,
    );
  };

  it("exits 0 on a vacuously-faithful export (no bands, no --against)", async () => {
    // minimalHtml has no grid bands → 0 specs → vacuously faithful. Proves the
    // faithful exit-0 path + that the gate runs offline with no --against.
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeMinimalExport(dir);
    const r = await runBluxCommand("validate", dir, {});
    expect(r.code).toBe(0);
    expect(r.output).toContain("layout fidelity: FAITHFUL");
  });

  it("exits 0 on the-pointe — all media (images + the video) resolve offline", async () => {
    // The-pointe's images carry data-base and its <video> carries its CDN url on
    // `src` (captured as `base`), so the whole page resolves offline from the
    // markup alone — no site.json asset list needed. This is the real page's
    // faithful path through the CLI gate.
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writePointeExport(dir);
    const r = await runBluxCommand("validate", dir, {});
    expect(r.code).toBe(0);
    expect(r.output).toContain("layout fidelity: FAITHFUL");
  });

  it("exits 1 and names the band when a media cannot resolve", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeUnresolvableExport(dir);
    const r = await runBluxCommand("validate", dir, {});
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/finding\(s\)/);
    expect(r.output).toContain("band 0");
  });

  it("layers content coverage as informational text — a coverage gap does not gate", async () => {
    // A band-less but text-bearing export → layout is vacuously faithful (0
    // bands), while content coverage has a REAL gap ("absent sentence here" is
    // in the export but not the render). Proves coverage is informational only:
    // a missing run coexists with exit 0; layout fidelity alone gates.
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
    await writeFile(
      join(dir, "index.html"),
      "<html><body><h1>Present Headline</h1><p>Absent sentence here.</p></body></html>",
    );
    const renderedPath = join(dir, "rendered.html");
    await writeFile(renderedPath, "<html><body><h1>Present Headline</h1></body></html>");
    const r = await runBluxCommand("validate", dir, { against: renderedPath });
    expect(r.code).toBe(0); // layout faithful → exit 0 despite the coverage gap
    expect(r.output).toContain("layout fidelity: FAITHFUL");
    expect(r.output).toContain("content coverage");
    expect(r.output).toContain("missing runs");
  });

  it("fails cleanly when index.html is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    const r = await runBluxCommand("validate", dir, {});
    expect(r.code).toBe(1);
    expect(r.output).toContain("index.html");
  });

  it("fails cleanly when the --against file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeMinimalExport(dir);
    const r = await runBluxCommand("validate", dir, { against: join(dir, "does-not-exist.html") });
    expect(r.code).toBe(1);
    expect(r.output).toContain("against");
  });

  it("fails cleanly when the --against URL returns a non-OK status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeMinimalExport(dir);
    const r = await runBluxCommand("validate", dir, {
      against: "https://example.com/typo",
      fetchImpl: (async () => new Response("nope", { status: 404 })) as typeof fetch,
    });
    expect(r.code).toBe(1);
    expect(r.output).toContain("against");
    expect(r.output).toContain("404"); // the HTTP status is surfaced in the message
  });
});

describe("blux grid map config", () => {
  it("writes map-config.json when the export's index.html carries an initMap script", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-grid-map-"));
    const band = await readFile(
      fileURLToPath(new URL("../blux/fixtures/the-pointe-map-band.html", import.meta.url)),
      "utf-8",
    );
    // The band fixture leaves custom-element0 unclosed (EOF-closed when it
    // stood alone), so the wrapper adds the balancing </div>.
    await writeFile(
      join(dir, "index.html"),
      `<html><body><div id="page-content"><section class="blocks0" id="page-block-0"><div class="block-content">${band}</div></div></section></div></body></html>`,
    );
    const res = await runBluxCommand("grid", dir, {});
    expect(res.code).toBe(0);
    expect(res.output).toContain("map config extracted");
    const cfg = JSON.parse(await readFile(join(dir, "blux-out", "map-config.json"), "utf-8"));
    expect(cfg.mountId).toBe("burbank_map");
    expect(cfg.layers).toHaveLength(8);
  });

  it("writes no map-config.json for an export without initMap (and still succeeds)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-grid-nomap-"));
    await writeFile(
      join(dir, "index.html"),
      `<html><body><div id="page-content"><section class="blocks0" id="page-block-0"><div class="block-content"><h1 class="block-title text5">Hi</h1></div></section></div></body></html>`,
    );
    const res = await runBluxCommand("grid", dir, {});
    expect(res.code).toBe(0);
    expect(res.output).not.toContain("map config extracted");
    expect(existsSync(join(dir, "blux-out", "map-config.json"))).toBe(false);
    expect(existsSync(join(dir, "blux-out", "grid-tree.json"))).toBe(true);
  });
});

describe("blux convert", () => {
  it("writes blux-presentation.json + migration-plan.json offline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-convert-"));
    await writeFile(
      join(dir, "index.html"),
      `<div id="page-content"><section class="blocks0" id="page-block-0"><div class="block-content"><h1 class="block-title text5">Hi</h1></div></section></div>`,
    );
    // site.json must use the REAL Blux shape parseBluxSite expects.
    await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
    const res = await runBluxCommand("convert", dir, { cwd: dir });
    expect(res.code).toBe(0);
    const manifest = JSON.parse(
      await readFile(join(dir, "blux-out", "blux-presentation.json"), "utf-8"),
    );
    expect(manifest.bands["0"]).toBeDefined();
    const plan = JSON.parse(await readFile(join(dir, "blux-out", "migration-plan.json"), "utf-8"));
    expect(plan.documents[0].data.slices[0].slice_type).toBe("title_band");
  });

  it("converts the-pointe with a FAITHFUL fidelity report + writes layout-report.json", async () => {
    // The-pointe resolves fully offline (images via data-base, the <video> via
    // its src-derived base), so convert reports zero findings. Proves convert
    // appends the summary and writes the report on the real 16-band page.
    const dir = await mkdtemp(join(tmpdir(), "blux-convert-"));
    await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
    await copyFile(
      fileURLToPath(new URL("../blux/fixtures/the-pointe-page-content.html", import.meta.url)),
      join(dir, "index.html"),
    );
    const res = await runBluxCommand("convert", dir, { cwd: dir });
    expect(res.code).toBe(0);
    expect(res.output).toContain("layout fidelity: FAITHFUL");
    const report = JSON.parse(await readFile(join(dir, "blux-out", "layout-report.json"), "utf-8"));
    expect(report.bands).toBe(16);
    expect(report.faithful).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("reports findings but still exits 0 — a generator never gates (Decision #6)", async () => {
    // A synthetic export with one unresolvable media (no data-base, absent from
    // site.json) → the report carries a finding, yet convert exits 0.
    const dir = await mkdtemp(join(tmpdir(), "blux-convert-"));
    await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
    await writeFile(
      join(dir, "index.html"),
      `<div id="page-content"><section class="blocks0" id="page-block-0"><div class="block-content"><div class="ib img imgfit camediaload" data-media="ghost-unresolvable" data-ext="jpg"></div></div></section></div>`,
    );
    const res = await runBluxCommand("convert", dir, { cwd: dir });
    expect(res.code).toBe(0); // convert reports but never gates
    expect(res.output).toContain("layout fidelity:");
    const report = JSON.parse(await readFile(join(dir, "blux-out", "layout-report.json"), "utf-8"));
    expect(report.faithful).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);
  });
});

describe("blux convert favicon", () => {
  // Real export shape: settings.favicon names a media uuid absent from the
  // media dict; the index.html <link rel="icon"> (with a transform segment)
  // is the only place its CDN url appears.
  const withFavicon = {
    ...minimalSite,
    settings: { ...minimalSite.settings, favicon: { media: "img-fav" } },
  };
  const makeFaviconExport = async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-convert-fav-"));
    await writeFile(join(dir, "site.json"), JSON.stringify(withFavicon));
    await writeFile(
      join(dir, "index.html"),
      `<link rel="icon" href="https://d3syaxnfm3oj0e.cloudfront.net/site-1/w:96/from:jpg/img-fav.png">` +
        `<div id="page-content"><section class="blocks0" id="page-block-0"><div class="block-content"><h1 class="block-title text5">Hi</h1></div></section></div>`,
    );
    return dir;
  };

  it("downloads favicon.png beside the plan via the injected fetch", async () => {
    const dir = await makeFaviconExport();
    const bytes = new Uint8Array([137, 80, 78, 71]); // PNG magic
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return { ok: true, arrayBuffer: async () => bytes.buffer } as unknown as Response;
    }) as unknown as typeof fetch;
    const res = await runBluxCommand("convert", dir, { fetchImpl });
    expect(res.code).toBe(0);
    expect(res.output).toContain("favicon → ");
    // fetched by CANONICAL url (transform segments stripped), exactly once
    expect(seen).toEqual(["https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-fav.png"]);
    const written = await readFile(join(dir, "blux-out", "favicon.png"));
    expect(new Uint8Array(written)).toEqual(bytes);
  });

  it("preserves {assetId, url} as favicon.json when the fetch fails — convert still exits 0", async () => {
    const dir = await makeFaviconExport();
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const res = await runBluxCommand("convert", dir, { fetchImpl });
    expect(res.code).toBe(0); // a network blip never fails an otherwise-offline convert
    expect(res.output).toContain("favicon fetch failed");
    expect(existsSync(join(dir, "blux-out", "favicon.png"))).toBe(false);
    const fallback = JSON.parse(await readFile(join(dir, "blux-out", "favicon.json"), "utf-8"));
    expect(fallback).toEqual({
      assetId: "img-fav",
      url: "https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-fav.png",
    });
  });

  it("touches no network and writes no favicon files when the export declares none", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-convert-nofav-"));
    await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
    await writeFile(
      join(dir, "index.html"),
      `<div id="page-content"><section class="blocks0" id="page-block-0"><div class="block-content"><h1 class="block-title text5">Hi</h1></div></section></div>`,
    );
    const fetchImpl = (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    const res = await runBluxCommand("convert", dir, { fetchImpl });
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, "blux-out", "favicon.png"))).toBe(false);
    expect(existsSync(join(dir, "blux-out", "favicon.json"))).toBe(false);
  });
});

describe("blux migrate gate", () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of ["PRISMIC_REPOSITORY_NAME", "PRISMIC_WRITE_TOKEN"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("refuses to run without Prismic credentials", async () => {
    for (const k of ["PRISMIC_REPOSITORY_NAME", "PRISMIC_WRITE_TOKEN"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    const dir = await mkdtemp(join(tmpdir(), "blux-plan-"));
    await mkdir(join(dir, "out"), { recursive: true });
    await writeFile(
      join(dir, "out", "migration-plan.json"),
      JSON.stringify({ customTypes: [], documents: [], assets: [] }),
    );
    const result = await runBluxCommand("migrate", join(dir, "out"), {});
    expect(result.code).toBe(1);
    expect(result.output).toContain("PRISMIC_REPOSITORY_NAME");
  });

  it("leaves the presentation manifest untouched when creds are absent (rewrite is inside the creds-gated branch)", async () => {
    for (const k of ["PRISMIC_REPOSITORY_NAME", "PRISMIC_WRITE_TOKEN"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    const dir = await mkdtemp(join(tmpdir(), "blux-plan-"));
    await mkdir(join(dir, "out"), { recursive: true });
    await writeFile(
      join(dir, "out", "migration-plan.json"),
      JSON.stringify({ customTypes: [], documents: [], assets: [] }),
    );
    const manifestPath = join(dir, "out", "blux-presentation.json");
    const original =
      JSON.stringify(
        { bands: { "0": { background: { kind: "image", url: "https://cdn/f/a.png" } } } },
        null,
        2,
      ) + "\n";
    await writeFile(manifestPath, original);

    const result = await runBluxCommand("migrate", join(dir, "out"), {});
    expect(result.code).toBe(1);
    // offline gate must return BEFORE any manifest I/O — CDN urls stay put
    expect(await readFile(manifestPath, "utf-8")).toBe(original);
  });
});
