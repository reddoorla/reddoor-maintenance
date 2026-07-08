import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  it("reports content coverage of a render against the export answer key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeFile(
      join(dir, "index.html"),
      "<body><h1>The Pointe</h1><p>The Space</p><p>Burbank</p></body>",
    );
    const renderedPath = join(dir, "rendered.html");
    await writeFile(renderedPath, "<main>The Pointe The Space</main>");
    const r = await runBluxCommand("validate", dir, { against: renderedPath });
    expect(r.output).toContain("content coverage: 2/3");
    // the run the render never produced is named so the gap is actionable
    expect(r.output).toContain("burbank");
  });

  it("needs an --against target", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeFile(join(dir, "index.html"), "<body>x</body>");
    const r = await runBluxCommand("validate", dir, {});
    expect(r.code).toBe(1);
    expect(r.output).toContain("--against");
  });

  it("fails cleanly when the --against file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeFile(join(dir, "index.html"), "<body>The Pointe</body>");
    const r = await runBluxCommand("validate", dir, {
      against: join(dir, "does-not-exist.html"),
    });
    expect(r.code).toBe(1);
    expect(r.output).toContain("against");
  });

  it("fails cleanly when the --against URL returns a non-OK status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeFile(join(dir, "index.html"), "<body>The Pointe</body>");
    const fetchImpl = (async () =>
      new Response("<h1>Not Found</h1>", { status: 404 })) as unknown as typeof fetch;
    const r = await runBluxCommand("validate", dir, {
      against: "https://example.com/typo",
      fetchImpl,
    });
    // a 404 error page must not be coverage-checked as if it were the render
    expect(r.code).toBe(1);
    expect(r.output).toContain("404");
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
});
