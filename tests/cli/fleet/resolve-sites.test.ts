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

describe("review round 1: two sites never share one derived label", () => {
  it("C1: two nameless sites deriving `web`, beside an explicit `web`: both stay nameless", async () => {
    const fleet = await tmpJson([
      { path: "/srv/a", gitRepo: "orgA/web" },
      { path: "/srv/b", gitRepo: "orgB/web" },
      { path: "/srv/c", name: "web" },
    ]);
    const sites = await resolveSites({ fleet, cwd: "/cwd" });
    expect(sites[0]?.name).toBeUndefined();
    expect(sites[1]?.name).toBeUndefined();
    expect(sites[2]?.name).toBe("web");
  });

  it("C2: two nameless sites deriving `web` with no explicit `web`: both stay nameless", () => {
    const sites = nameFromRepoWhenNameless([
      { path: "/srv/a", gitRepo: "orgA/web" },
      { path: "/srv/b", gitRepo: "orgB/web" },
    ]);
    expect(sites.map((s) => s.name)).toEqual([undefined, undefined]);
  });

  it("C3: one nameless site deriving `web` beside an explicit `other` still takes `web`", () => {
    const sites = nameFromRepoWhenNameless([
      { path: "/srv/a", gitRepo: "orgA/web" },
      { path: "/srv/b", name: "other" },
    ]);
    expect(sites.map((s) => s.name)).toEqual(["web", "other"]);
  });
});

describe("#2006: two explicit names that differ only in case are refused at load", () => {
  it("known-good: distinct names, a repeated exact name and nameless sites all load", async () => {
    const fleet = await tmpJson([
      { name: "baz", path: "/a" },
      { name: "qux", path: "/b" },
      { name: "qux", path: "/c" },
      { path: "/d" },
      { path: "/e" },
    ]);
    const sites = await resolveSites({ fleet, cwd: "/cwd" });
    expect(sites.map((s) => s.name)).toEqual(["baz", "qux", "qux", undefined, undefined]);
  });

  it("a JSON inventory naming Baz and baz is refused, naming both", async () => {
    const fleet = await tmpJson([
      { name: "Baz", path: "/a" },
      { name: "other", path: "/o" },
      { name: "baz", path: "/b" },
    ]);
    const err = await resolveSites({ fleet, cwd: "/cwd" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(
      'inventory names "Baz" and "baz" differ only in case; on a case-insensitive filesystem they share one checkout. Rename one.',
    );
    expect((err as { exitCode?: number }).exitCode).toBe(2);
  });

  it("a module inventory naming Baz and BAZ is refused", async () => {
    const fleet = await tmpJs(
      `export default async () => [{ name: "Baz", path: "/a" }, { name: "BAZ", path: "/b" }];`,
    );
    await expect(resolveSites({ fleet, cwd: "/cwd" })).rejects.toThrow(
      /"Baz" and "BAZ" differ only in case/,
    );
  });

  it("known-good: with the check in place, a nameless site still takes its derived name", async () => {
    const fleet = await tmpJson([
      { name: "keep", path: "/k" },
      { path: "/x", gitRepo: "reddoorla/foo" },
    ]);
    const sites = await resolveSites({ fleet, cwd: "/cwd" });
    expect(sites.map((s) => s.name)).toEqual(["keep", "foo"]);
  });
});
