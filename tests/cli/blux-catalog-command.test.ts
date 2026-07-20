import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
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
  };
  site.content.pages[0]!.items[4] = {
    sources: ["feed-1"],
    sourceConfig: { sort: "title" },
    styles: {},
  };
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

  it("entity documents + extension custom types ride the plan", async () => {
    const plan = JSON.parse(await readFile(join(out, "migration-plan.json"), "utf-8"));
    const people = plan.documents.filter((d: { type: string }) => d.type === "person");
    expect(people.length).toBeGreaterThanOrEqual(1);
    expect(people.map((d: { uid: string }) => d.uid)).toContain("jane-doe");
    const ct = plan.customTypes.find((c: { id: string }) => c.id === "person");
    expect(ct).toBeDefined();
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

describe("blux catalog errors", () => {
  it("fails cleanly when the export dir has no site.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-catalog-empty-"));
    const result = await runBluxCommand("catalog", dir, {});
    expect(result.code).toBe(1);
    expect(result.output).toContain("site.json");
  });
});
