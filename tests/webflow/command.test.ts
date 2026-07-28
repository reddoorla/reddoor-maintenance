/** `webflow docs` converts a saved IR into docs + assets json, offline;
 *  `webflow capture` (live network) is exercised by hand, not here. */
import { mkdtempSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runWebflowCommand } from "../../src/cli/commands/webflow.js";

it("webflow docs converts a saved IR into docs + assets json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-"));
  const ir = {
    baseUrl: "https://x",
    capturedAt: "t",
    reviews: [],
    serviceCategories: [],
    team: [{ slug: "a", name: "A", bioHtml: "<p>b</p>" }],
    services: [],
    questions: [],
  };
  const irPath = join(dir, "ir.json");
  await writeFile(irPath, JSON.stringify(ir));
  const res = await runWebflowCommand("docs", irPath, { out: dir });
  expect(res.code).toBe(0);
  expect(res.output).toContain("1 docs");
  const docs = JSON.parse(readFileSync(join(dir, "docs.json"), "utf-8"));
  expect(docs).toHaveLength(1);
  const assets = JSON.parse(readFileSync(join(dir, "assets.json"), "utf-8"));
  expect(assets).toEqual([]);
});

it("unknown action and missing args fail with code 1", async () => {
  expect((await runWebflowCommand("bogus", undefined)).code).toBe(1);
  expect((await runWebflowCommand("capture", undefined)).code).toBe(1);
  expect((await runWebflowCommand("docs", undefined)).code).toBe(1);
});

it("webflow docs fails cleanly on a nonexistent ir.json path", async () => {
  const res = await runWebflowCommand(
    "docs",
    join(mkdtempSync(join(tmpdir(), "wf-")), "nope.json"),
  );
  expect(res.code).toBe(1);
  expect(res.output).toContain("could not read");
});

it("webflow docs rejects valid JSON that is not a webflow IR", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-"));
  const path = join(dir, "not-ir.json");
  await writeFile(path, JSON.stringify({ documents: [], assets: [] }));
  const res = await runWebflowCommand("docs", path);
  expect(res.code).toBe(1);
  expect(res.output).toContain("not a webflow IR");
});
