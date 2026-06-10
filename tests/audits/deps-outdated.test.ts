import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanOutdated } from "../../src/audits/deps-outdated.js";
import type { SpawnFn, SpawnResult } from "../../src/audits/util/spawn.js";

async function siteDir(withLock: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-outdated-"));
  await writeFile(join(dir, "package.json"), "{}", "utf-8");
  if (withLock) await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");
  return dir;
}

function spawnStub(handlers: { install?: SpawnResult; outdated?: SpawnResult }): {
  spawn: SpawnFn;
  calls: string[][];
} {
  const calls: string[][] = [];
  const spawn: SpawnFn = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === "install") return handlers.install ?? { code: 0, stdout: "", stderr: "" };
    if (args[0] === "outdated") return handlers.outdated ?? { code: 0, stdout: "{}", stderr: "" };
    throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
  };
  return { spawn, calls };
}

describe("scanOutdated", () => {
  it("returns null (and runs no pnpm) when there is no pnpm-lock.yaml", async () => {
    const dir = await siteDir(false);
    const { spawn, calls } = spawnStub({});
    expect(await scanOutdated(dir, spawn)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("returns null when the frozen-lockfile install fails (stale lockfile), without running outdated", async () => {
    const dir = await siteDir(true);
    const { spawn, calls } = spawnStub({
      install: { code: 1, stdout: "", stderr: "ERR_PNPM_OUTDATED_LOCKFILE" },
    });
    expect(await scanOutdated(dir, spawn)).toBeNull();
    expect(calls.some((c) => c.includes("--frozen-lockfile"))).toBe(true);
    expect(calls.some((c) => c.includes("outdated"))).toBe(false);
  });

  it("counts outdated packages and major-behind from pnpm outdated --json", async () => {
    const dir = await siteDir(true);
    const outdatedJson = JSON.stringify({
      svelte: { current: "5.0.0", latest: "5.55.10" }, // minor behind
      vite: { current: "5.4.0", latest: "6.0.1" }, // major behind
      eslint: { current: "9.0.0", latest: "9.0.1" }, // patch behind
    });
    // pnpm outdated exits non-zero when there ARE outdated deps — not an error.
    const { spawn } = spawnStub({ outdated: { code: 1, stdout: outdatedJson, stderr: "" } });
    expect(await scanOutdated(dir, spawn)).toEqual({ outdated: 3, major: 1 });
  });

  it("returns zero counts when pnpm outdated reports nothing", async () => {
    const dir = await siteDir(true);
    const { spawn } = spawnStub({ outdated: { code: 0, stdout: "{}", stderr: "" } });
    expect(await scanOutdated(dir, spawn)).toEqual({ outdated: 0, major: 0 });
  });

  it("returns null when pnpm outdated output isn't parseable JSON", async () => {
    const dir = await siteDir(true);
    const { spawn } = spawnStub({ outdated: { code: 1, stdout: "not json", stderr: "" } });
    expect(await scanOutdated(dir, spawn)).toBeNull();
  });

  it("returns null (degrades, does not throw) when a pnpm spawn rejects — timeout / missing binary", async () => {
    const dir = await siteDir(true);
    const spawn: SpawnFn = async () => {
      throw new Error("spawn ETIMEDOUT");
    };
    await expect(scanOutdated(dir, spawn)).resolves.toBeNull();
  });

  it("skips the cold install when node_modules already exists", async () => {
    const dir = await siteDir(true);
    await mkdir(join(dir, "node_modules"), { recursive: true });
    const { spawn, calls } = spawnStub({ outdated: { code: 0, stdout: "{}", stderr: "" } });
    await scanOutdated(dir, spawn);
    expect(calls.some((c) => c.includes("install"))).toBe(false);
    expect(calls.some((c) => c.includes("outdated"))).toBe(true);
  });
});
