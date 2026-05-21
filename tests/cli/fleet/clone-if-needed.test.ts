import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneIfNeeded } from "../../../src/cli/fleet/clone-if-needed.js";
import type { SpawnFn } from "../../../src/audits/util/spawn.js";

async function existingDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-cif-"));
  await writeFile(join(dir, "placeholder.txt"), "x", "utf-8");
  return dir;
}

describe("cli/fleet/cloneIfNeeded", () => {
  it("returns the site unchanged when path is a non-empty directory", async () => {
    const path = await existingDir();
    const site = { path, name: "ok" };
    const cloneSpawn: SpawnFn = async () => {
      throw new Error("should not spawn");
    };
    const result = await cloneIfNeeded(site, { workdir: "/never/used", spawn: cloneSpawn });
    expect(result).toEqual(site);
  });

  it("clones when path does not exist and repoUrl is provided", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    let cloned = false;
    const spawn: SpawnFn = async (cmd, args) => {
      if (cmd === "git" && args[0] === "clone") {
        const target = args[args.length - 1] as string;
        await mkdir(target, { recursive: true });
        await writeFile(join(target, "ok"), "x", "utf-8");
        cloned = true;
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected: ${cmd}`);
    };

    const site = {
      path: join(workdir, "missing"),
      name: "site-a",
      repoUrl: "git@example.com:a.git",
    };
    const result = await cloneIfNeeded(site, { workdir, spawn });

    expect(cloned).toBe(true);
    expect(result.path).toBe(join(workdir, "site-a"));
  });

  it("derives a name from repoUrl when site.name is missing", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    const spawn: SpawnFn = async (_cmd, args) => {
      const target = args[args.length - 1] as string;
      await mkdir(target, { recursive: true });
      return { code: 0, stdout: "", stderr: "" };
    };
    const site = { path: "/not-exist", repoUrl: "git@github.com:owner/repo-name.git" };
    const result = await cloneIfNeeded(site, { workdir, spawn });
    expect(result.path).toBe(join(workdir, "repo-name"));
  });

  it("throws when path is missing and no repoUrl is set", async () => {
    const spawn: SpawnFn = async () => {
      throw new Error("should not spawn");
    };
    await expect(cloneIfNeeded({ path: "/not-exist" }, { workdir: "/wd", spawn })).rejects.toThrow(
      /repoUrl/,
    );
  });

  it("rejects an inventory name with path-traversal segments", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    const spawn: SpawnFn = async () => {
      throw new Error("should NOT have reached spawn");
    };
    await expect(
      cloneIfNeeded(
        { path: "/missing", name: "../escape", repoUrl: "git@example.com:a.git" },
        { workdir, spawn },
      ),
    ).rejects.toThrow(/unsafe|name|traversal/i);
  });

  it("rejects an inventory name containing a path separator", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    const spawn: SpawnFn = async () => {
      throw new Error("should not spawn");
    };
    await expect(
      cloneIfNeeded(
        { path: "/missing", name: "nested/name", repoUrl: "git@example.com:a.git" },
        { workdir, spawn },
      ),
    ).rejects.toThrow(/unsafe|name|separator/i);
  });

  it("rejects an absolute inventory name", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    const spawn: SpawnFn = async () => {
      throw new Error("should not spawn");
    };
    await expect(
      cloneIfNeeded(
        { path: "/missing", name: "/tmp/escape", repoUrl: "git@example.com:a.git" },
        { workdir, spawn },
      ),
    ).rejects.toThrow(/unsafe|name|absolute/i);
  });
});
