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

  it("rejects a repoUrl that would be interpreted as a git flag", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    const spawn: SpawnFn = async () => {
      throw new Error("should NOT have reached spawn — argv-injection attempt");
    };
    await expect(
      cloneIfNeeded(
        { path: "/missing", name: "ok", repoUrl: "--upload-pack=evil" },
        { workdir, spawn },
      ),
    ).rejects.toThrow(/unsafe repoUrl/i);
  });

  it("rejects a repoUrl with no scheme or scp-style host", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    const spawn: SpawnFn = async () => {
      throw new Error("should not spawn");
    };
    await expect(
      cloneIfNeeded({ path: "/missing", name: "ok", repoUrl: "just-a-string" }, { workdir, spawn }),
    ).rejects.toThrow(/unsafe repoUrl/i);
  });

  it("passes `--` separator to git clone (defense in depth)", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    let cloneArgs: readonly string[] | null = null;
    const spawn: SpawnFn = async (_cmd, args) => {
      cloneArgs = args;
      const target = args[args.length - 1] as string;
      await mkdir(target, { recursive: true });
      return { code: 0, stdout: "", stderr: "" };
    };
    await cloneIfNeeded(
      { path: "/missing", name: "site-a", repoUrl: "https://example.com/a.git" },
      { workdir, spawn },
    );
    expect(cloneArgs).not.toBeNull();
    expect(cloneArgs!.includes("--")).toBe(true);
    // `--` must appear before the repoUrl positional.
    const dashDashIdx = cloneArgs!.indexOf("--");
    const repoIdx = cloneArgs!.indexOf("https://example.com/a.git");
    expect(dashDashIdx).toBeLessThan(repoIdx);
  });

  it("accepts standard scheme URLs and scp-style shorthand", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    const spawn: SpawnFn = async (_cmd, args) => {
      const target = args[args.length - 1] as string;
      await mkdir(target, { recursive: true });
      return { code: 0, stdout: "", stderr: "" };
    };
    const accepted = [
      "https://github.com/org/repo.git",
      "http://example.com/repo.git",
      "ssh://git@example.com/repo.git",
      "git://example.com/repo.git",
      "file:///tmp/repo.git",
      "git@github.com:org/repo.git",
    ];
    for (const repoUrl of accepted) {
      await expect(
        cloneIfNeeded(
          { path: "/not-exist-" + repoUrl, name: "x" + accepted.indexOf(repoUrl), repoUrl },
          { workdir, spawn },
        ),
      ).resolves.toBeDefined();
    }
  });

  it("derives the clone URL from gitRepo (owner/repo) when repoUrl is absent", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    let clonedUrl: string | null = null;
    const spawn: SpawnFn = async (_cmd, args) => {
      // git clone -- <url> <target>: the url is the positional right after `--`.
      clonedUrl = args[args.indexOf("--") + 1] as string;
      const target = args[args.length - 1] as string;
      await mkdir(target, { recursive: true });
      return { code: 0, stdout: "", stderr: "" };
    };
    const site = { path: "/not-exist", name: "caltex", gitRepo: "reddoorla/caltex" };
    const result = await cloneIfNeeded(site, { workdir, spawn });
    expect(clonedUrl).toBe("https://github.com/reddoorla/caltex.git");
    expect(result.path).toBe(join(workdir, "caltex"));
  });

  it("prefers an explicit repoUrl over gitRepo when both are set", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    let clonedUrl: string | null = null;
    const spawn: SpawnFn = async (_cmd, args) => {
      clonedUrl = args[args.indexOf("--") + 1] as string;
      const target = args[args.length - 1] as string;
      await mkdir(target, { recursive: true });
      return { code: 0, stdout: "", stderr: "" };
    };
    const site = {
      path: "/not-exist",
      name: "x",
      repoUrl: "git@example.com:a.git",
      gitRepo: "owner/repo",
    };
    await cloneIfNeeded(site, { workdir, spawn });
    expect(clonedUrl).toBe("git@example.com:a.git");
  });

  it("derives the site name from the gitRepo URL when name is absent", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    const spawn: SpawnFn = async (_cmd, args) => {
      const target = args[args.length - 1] as string;
      await mkdir(target, { recursive: true });
      return { code: 0, stdout: "", stderr: "" };
    };
    const result = await cloneIfNeeded(
      { path: "/not-exist", gitRepo: "owner/cool-repo" },
      { workdir, spawn },
    );
    expect(result.path).toBe(join(workdir, "cool-repo"));
  });

  it("mentions gitRepo in the error when neither repoUrl nor gitRepo is set", async () => {
    const spawn: SpawnFn = async () => {
      throw new Error("should not spawn");
    };
    await expect(cloneIfNeeded({ path: "/not-exist" }, { workdir: "/wd", spawn })).rejects.toThrow(
      /gitRepo/,
    );
  });

  it("rejects a gitRepo that isn't a clean owner/repo (no host, extra path, or argv smuggling)", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    const spawn: SpawnFn = async () => {
      throw new Error("should NOT have reached spawn — bad gitRepo");
    };
    const bad = [
      "noslash",
      "owner/repo/extra",
      "https://evil.com/x",
      "owner repo",
      "owner/",
      "git@github.com:owner/repo",
      "--upload-pack=evil/x",
    ];
    for (const gitRepo of bad) {
      await expect(
        cloneIfNeeded({ path: "/missing", name: "ok", gitRepo }, { workdir, spawn }),
      ).rejects.toThrow(/unsafe gitRepo|owner\/repo/i);
    }
  });
});
