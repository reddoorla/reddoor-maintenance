import { describe, it, expect } from "vitest";
import { formatWithPrettier, PRETTIER_FLAG_NOTE } from "../../src/recipes/_prettier.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

describe("recipes/_prettier formatWithPrettier", () => {
  it("returns true without spawning when there are no files", async () => {
    let called = false;
    const spawn: SpawnFn = async () => {
      called = true;
      return { code: 0, stdout: "", stderr: "" };
    };
    expect(await formatWithPrettier(spawn, "/x", [])).toBe(true);
    expect(called).toBe(false);
  });

  it("invokes the site's prettier --write on the given files and returns true on exit 0", async () => {
    const calls: Array<{ cmd: string; args: readonly string[]; cwd: string | undefined }> = [];
    const spawn: SpawnFn = async (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts?.cwd });
      return { code: 0, stdout: "", stderr: "" };
    };
    const ok = await formatWithPrettier(spawn, "/site", ["a.ts", "b.ts"]);
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe("pnpm");
    expect(calls[0]?.args).toEqual(["exec", "prettier", "--write", "a.ts", "b.ts"]);
    expect(calls[0]?.cwd).toBe("/site");
  });

  it("returns false when prettier exits non-zero", async () => {
    const spawn: SpawnFn = async () => ({ code: 2, stdout: "", stderr: "err" });
    expect(await formatWithPrettier(spawn, "/site", ["a.ts"])).toBe(false);
  });

  it("returns false (never throws) when spawn itself throws", async () => {
    const spawn: SpawnFn = async () => {
      throw new Error("ENOENT pnpm");
    };
    await expect(formatWithPrettier(spawn, "/site", ["a.ts"])).resolves.toBe(false);
  });

  it("exposes a stable flag note for recipes to surface", () => {
    expect(PRETTIER_FLAG_NOTE).toMatch(/prettier/i);
  });
});
