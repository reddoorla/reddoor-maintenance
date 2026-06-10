import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromJsonFile } from "../../src/inventory/json.js";

async function withJsonFile(payload: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-inv-"));
  const path = join(dir, "inventory.json");
  await writeFile(path, JSON.stringify(payload), "utf-8");
  return path;
}

describe("inventory/fromJsonFile", () => {
  it("returns parsed sites", async () => {
    const path = await withJsonFile([
      { name: "a", path: "/abs/a" },
      { name: "b", path: "/abs/b", repoUrl: "git@github.com:o/b.git", meta: { tier: "1" } },
    ]);
    const sites = await fromJsonFile(path)();
    expect(sites).toHaveLength(2);
    expect(sites[0]?.name).toBe("a");
    expect(sites[1]?.repoUrl).toBe("git@github.com:o/b.git");
  });

  it("rejects with a clear message when the file isn't an array", async () => {
    const path = await withJsonFile({ name: "a", path: "/x" });
    await expect(fromJsonFile(path)()).rejects.toThrow(/array/i);
  });

  it("rejects with a clear message when a site is missing path", async () => {
    const path = await withJsonFile([{ name: "a" }]);
    await expect(fromJsonFile(path)()).rejects.toThrow(/path/i);
  });

  it("rejects entries with a relative path so cwd at invocation can't change meaning", async () => {
    const path = await withJsonFile([{ name: "a", path: "./relative/site" }]);
    await expect(fromJsonFile(path)()).rejects.toThrow(/absolute/i);
  });

  it("carries gitRepo and deployedUrl through so fleet recipes can clone/audit from them", async () => {
    const path = await withJsonFile([
      {
        name: "caltex",
        path: "/abs/caltex",
        gitRepo: "reddoorla/caltex",
        deployedUrl: "https://caltex.example.com",
      },
    ]);
    const sites = await fromJsonFile(path)();
    expect(sites[0]?.gitRepo).toBe("reddoorla/caltex");
    expect(sites[0]?.deployedUrl).toBe("https://caltex.example.com");
  });
});
