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

  // `pnpm exec` picks the binary by resolution. That is right for a recipe that
  // has just installed the site, and wrong for a caller working in a bare clone:
  // measured 2026-08-13, `pnpm exec prettier` there both ran an unrequested
  // `pnpm install` inside the target repo and, in a repo with no prettier
  // dependency, fell through to the CALLING repo's prettier and exited 0. A
  // caller that has already resolved the target's own binary passes it here so
  // that nothing about which binary runs is left to resolution.
  it("runs an explicitly given binary instead of going through pnpm exec", async () => {
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const spawn: SpawnFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return { code: 0, stdout: "", stderr: "" };
    };
    const ok = await formatWithPrettier(spawn, "/site", ["a.ts"], {
      bin: "/site/node_modules/.bin/prettier",
    });
    expect(ok).toBe(true);
    expect(calls).toEqual([{ cmd: "/site/node_modules/.bin/prettier", args: ["--write", "a.ts"] }]);
  });

  // A stalled format wedges a human-invoked CLI with nothing printed. The
  // timeout is also what makes the default spawn detach the child, so the kill
  // reaches prettier rather than only its wrapper.
  it("passes a timeout through when given one", async () => {
    let seen: number | undefined = -1;
    const spawn: SpawnFn = async (_cmd, _args, opts) => {
      seen = opts?.timeoutMs;
      return { code: 0, stdout: "", stderr: "" };
    };
    await formatWithPrettier(spawn, "/site", ["a.ts"], { timeoutMs: 60_000 });
    expect(seen).toBe(60_000);
  });

  // The two recipe callers pass no options, and must keep spawning exactly as
  // they did — including with NO `timeoutMs` key at all, which is what the
  // default spawn reads to decide whether to detach.
  it("omits timeoutMs entirely when no timeout is given", async () => {
    let opts: Record<string, unknown> | undefined;
    const spawn: SpawnFn = async (_cmd, _args, o) => {
      opts = o as Record<string, unknown> | undefined;
      return { code: 0, stdout: "", stderr: "" };
    };
    await formatWithPrettier(spawn, "/site", ["a.ts"]);
    expect(opts).toEqual({ cwd: "/site" });
    expect("timeoutMs" in (opts ?? {})).toBe(false);
  });

  it("returns false when a timed-out spawn rejects", async () => {
    const spawn: SpawnFn = async () => {
      throw new Error("spawn timeout after 60000ms: prettier");
    };
    await expect(
      formatWithPrettier(spawn, "/site", ["a.ts"], { bin: "/b", timeoutMs: 60_000 }),
    ).resolves.toBe(false);
  });
});
