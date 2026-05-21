import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSites } from "../../../src/cli/fleet/resolve-sites.js";

async function tmpJson(payload: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-rs-"));
  const path = join(dir, "inv.json");
  await writeFile(path, JSON.stringify(payload), "utf-8");
  return path;
}

async function tmpJs(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-rs-"));
  const path = join(dir, "inv.mjs");
  await writeFile(path, body, "utf-8");
  return path;
}

describe("cli/fleet/resolveSites", () => {
  it("returns localPath site when only [site] is given", async () => {
    const sites = await resolveSites({ site: "/abs/foo", cwd: "/cwd" });
    expect(sites).toHaveLength(1);
    expect(sites[0]?.path).toBe("/abs/foo");
  });

  it("falls back to cwd when neither site nor fleet is given", async () => {
    const sites = await resolveSites({ cwd: "/cwd" });
    expect(sites[0]?.path).toBe("/cwd");
  });

  it("loads JSON inventory when --fleet points at a .json file", async () => {
    const fleet = await tmpJson([
      { name: "a", path: "/a" },
      { name: "b", path: "/b" },
    ]);
    const sites = await resolveSites({ fleet, cwd: "/cwd" });
    expect(sites.map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("loads JS inventory when --fleet points at a .mjs file (default export)", async () => {
    const fleet = await tmpJs(
      `export default async () => [{ name: "from-js", path: "/from-js" }];`,
    );
    const sites = await resolveSites({ fleet, cwd: "/cwd" });
    expect(sites).toEqual([{ name: "from-js", path: "/from-js" }]);
  });

  it("rejects when both [site] and --fleet are provided", async () => {
    await expect(resolveSites({ site: "/abs", fleet: "/inv.json", cwd: "/cwd" })).rejects.toThrow(
      /cannot combine/i,
    );
  });
});
