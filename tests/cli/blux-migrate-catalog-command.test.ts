import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("../../src/blux/emit/run-migration.js", () => ({
  pushCustomTypes: vi.fn(),
  runMigration: vi.fn(),
}));
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pushCustomTypes, runMigration } from "../../src/blux/emit/run-migration.js";
import type { MigrationResult } from "../../src/blux/emit/run-migration.js";
import { runBluxCommand } from "../../src/cli/commands/blux.js";

// Task 3 follow-up (plan 4d quality round): the two-phase orchestration is the
// action's core logic and must be testable OFFLINE. The runner module is
// mocked wholesale — vi.mock intercepts the action's lazy import too — so no
// creds are read and no network is reachable anywhere in this file. The
// credless gate tests (real runner) live in blux-catalog-command.test.ts.
const CDN = "https://d3syaxnfm3oj0e.cloudfront.net/site-1/aaaa-bbbb.png";
const PRISMIC = "https://images.prismic.io/test-repo/aaaa-bbbb.png";
const STRAY = "https://d3syaxnfm3oj0e.cloudfront.net/site-1/stray-cafe.jpg";

const migrationResult = (over: Partial<MigrationResult> = {}): MigrationResult => ({
  assetsUploaded: 1,
  assetsReused: 0,
  docsCreated: 1,
  docsUpdated: 0,
  missingAssets: [],
  assetUrlByCdn: new Map([[CDN, PRISMIC]]),
  ...over,
});

/** Write a migration-plan.json whose page doc embeds `url` in a serialized
 * widget surface (one resolveDocData never touches — rewriteDocUrls' beat). */
async function writePlan(url: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "blux-migrate-catalog-orch-"));
  const plan = {
    customTypes: [{ id: "person", label: "Person", repeatable: true, json: {} }],
    documents: [
      { type: "page", uid: "home", data: { slices: [], widget_html: `<img src="${url}">` } },
    ],
    assets: [{ id: "aaaa-bbbb", url: CDN, alt: "" }],
  };
  await writeFile(join(dir, "migration-plan.json"), JSON.stringify(plan));
  return dir;
}

describe("blux migrate-catalog orchestration (mocked runner)", () => {
  beforeEach(() => {
    vi.mocked(pushCustomTypes).mockReset();
    vi.mocked(runMigration).mockReset();
    vi.mocked(pushCustomTypes).mockResolvedValue(["person"]);
  });

  it("phase 1 is assets-only; phase 2 posts the REWRITTEN documents", async () => {
    vi.mocked(runMigration)
      .mockResolvedValueOnce(migrationResult())
      .mockResolvedValueOnce(migrationResult({ assetsUploaded: 0, assetsReused: 1 }));
    const dir = await writePlan(CDN);
    const r = await runBluxCommand("migrate-catalog", dir, {});
    expect(r.code).toBe(0);
    const calls = vi.mocked(runMigration).mock.calls;
    expect(calls).toHaveLength(2);
    // (a) phase 1 runs with NO documents — asset upload only.
    expect(calls[0]![0].documents).toEqual([]);
    // (b) phase 2 posts the rewritten documents: CDN url → uploaded Prismic url.
    const phase2 = JSON.stringify(calls[1]![0].documents);
    expect(phase2).toContain(PRISMIC);
    expect(phase2).not.toContain(CDN);
    expect(vi.mocked(pushCustomTypes)).toHaveBeenCalledTimes(1);
    expect(r.output).toContain("custom types pushed: person");
    expect(r.output).toContain("urls rewritten 1 (0 unmatched)");
    expect(r.output).toContain("publish the migration release");
  });

  it("success output carries the summary, not the streamed progress log", async () => {
    vi.mocked(runMigration).mockImplementation(async (_plan, log) => {
      log?.("asset 1/1 aaaa-bbbb.png");
      return migrationResult();
    });
    const dir = await writePlan(CDN);
    const r = await runBluxCommand("migrate-catalog", dir, {});
    expect(r.code).toBe(0);
    // A 500-doc run must not replay thousands of progress lines on success.
    expect(r.output).not.toContain("asset 1/1");
  });

  it("an unmatched CDN url exits 1 with a WARNING — phase 2 still runs", async () => {
    vi.mocked(runMigration)
      .mockResolvedValueOnce(migrationResult()) // map lacks STRAY
      .mockResolvedValueOnce(migrationResult({ assetsUploaded: 0, assetsReused: 1 }));
    const dir = await writePlan(STRAY);
    const r = await runBluxCommand("migrate-catalog", dir, {});
    expect(r.code).toBe(1);
    // Docs still posted — they sit behind the unpublished-release gate, so the
    // non-zero exit reaches the operator before anything goes live.
    expect(vi.mocked(runMigration).mock.calls).toHaveLength(2);
    expect(r.output).toContain("WARNING");
    expect(r.output).toContain(STRAY);
  });

  it("missing assets from the docs pass exit 1 with the migrate-style WARNING", async () => {
    vi.mocked(runMigration)
      .mockResolvedValueOnce(migrationResult())
      .mockResolvedValueOnce(migrationResult({ missingAssets: ["cccc-dddd"] }));
    const dir = await writePlan(CDN);
    const r = await runBluxCommand("migrate-catalog", dir, {});
    expect(r.code).toBe(1);
    expect(r.output).toContain("WARNING missing assets: cccc-dddd");
  });

  it("a runner failure surfaces the streamed progress plus the error, exit 1", async () => {
    vi.mocked(runMigration).mockImplementation(async (_plan, log) => {
      log?.("asset 1/2 aaaa-bbbb.png");
      throw new Error("upload asset boom: 500");
    });
    const dir = await writePlan(CDN);
    const r = await runBluxCommand("migrate-catalog", dir, {});
    expect(r.code).toBe(1);
    // The failure path DOES replay the progress log — it is the diagnostic.
    expect(r.output).toContain("asset 1/2 aaaa-bbbb.png");
    expect(r.output).toContain("migrate-catalog failed: upload asset boom: 500");
  });
});
