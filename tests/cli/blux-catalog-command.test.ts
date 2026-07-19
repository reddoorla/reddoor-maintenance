import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { runBluxCommand } from "../../src/cli/commands/blux.js";
import { minimalSite } from "../blux/fixtures/minimal-site.js";

// A single heading-only band: the breadth router classifies it TitleBand →
// BluxSection, so one band proves the plan-only (no sidecar) write path.
const oneBandHtml =
  `<div id="page-content"><section class="blocks0" id="page-block-0">` +
  `<div class="block-content"><h1 class="block-title text5">Hi</h1></div></section></div>`;

/** Write a minimal Blux export dir (real-shape site.json + a one-band index.html). */
async function makeExportDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "blux-catalog-"));
  await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
  await writeFile(join(dir, "index.html"), oneBandHtml);
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
});

describe("blux catalog errors", () => {
  it("fails cleanly when the export dir has no site.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-catalog-empty-"));
    const result = await runBluxCommand("catalog", dir, {});
    expect(result.code).toBe(1);
    expect(result.output).toContain("site.json");
  });
});
