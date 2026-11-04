import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSites, nameFromRepoWhenNameless } from "../../../src/cli/fleet/resolve-sites.js";

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

describe("#1650: a nameless inventory site is named from its repo at load", () => {
  it("B1: a nameless JSON site takes its gitRepo's name, or its repoUrl's", async () => {
    const fleet = await tmpJson([
      { path: "/x", gitRepo: "reddoorla/foo" },
      { path: "/y", repoUrl: "https://github.com/reddoorla/bar.git" },
    ]);
    const sites = await resolveSites({ fleet, cwd: "/cwd" });
    expect(sites.map((s) => s.name)).toEqual(["foo", "bar"]);
  });

  it("B2: a named site keeps its name; a nameless site with no repo stays nameless", async () => {
    const fleet = await tmpJson([
      { name: "keep", path: "/k", gitRepo: "reddoorla/other" },
      { path: "/plain" },
    ]);
    const sites = await resolveSites({ fleet, cwd: "/cwd" });
    expect(sites[0]?.name).toBe("keep");
    expect(sites[1]?.name).toBeUndefined();
    expect(nameFromRepoWhenNameless([{ path: "/plain", name: "" }])).toEqual([
      { path: "/plain", name: "" },
    ]);
  });

  it("B3: a nameless site with an unsafe gitRepo loads without throwing, and stays nameless", async () => {
    const fleet = await tmpJson([{ path: "/u", gitRepo: "owner/.." }]);
    const sites = await resolveSites({ fleet, cwd: "/cwd" });
    expect(sites).toHaveLength(1);
    expect(sites[0]?.name).toBeUndefined();
  });

  it("B5: a .mjs inventory's nameless site is named from its gitRepo", async () => {
    const fleet = await tmpJs(
      `export default async () => [{ path: "/from-mjs", gitRepo: "reddoorla/mjs-site" }];`,
    );
    const sites = await resolveSites({ fleet, cwd: "/cwd" });
    expect(sites[0]?.name).toBe("mjs-site");
  });
});
