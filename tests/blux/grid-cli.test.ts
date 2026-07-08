import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBluxCommand } from "../../src/cli/commands/blux.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "blux-grid-"));
  await writeFile(
    join(dir, "index.html"),
    `<html><body><div id="page-content"><section class="blocks0" id="page-block-0"><div class="block-content"><h1 class="block-title text5">Hi</h1></div></section></div></body></html>`,
  );
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("blux grid", () => {
  it("writes a grid-tree.json of the parsed bands", async () => {
    const res = await runBluxCommand("grid", dir, { cwd: dir });
    expect(res.code).toBe(0);
    const tree = JSON.parse(await readFile(join(dir, "blux-out", "grid-tree.json"), "utf-8"));
    expect(tree).toHaveLength(1);
    expect(tree[0].root).toEqual({
      kind: "heading",
      role: "text5",
      level: 1,
      html: "Hi",
    });
  });
});
