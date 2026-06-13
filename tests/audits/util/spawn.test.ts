import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSpawn, defaultSpawn } from "../../../src/audits/util/spawn.js";

/** Minimal stand-in for a ChildProcess: an EventEmitter with a pid and
 *  stdout/stderr emitters. Kills are recorded via the injected killImpl, not
 *  child.kill, since the fix kills the process GROUP (negative pid). */
class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

let lastSpawnOpts: Record<string, unknown> | null;
let child: FakeChild;
let kills: Array<{ pid: number; sig: NodeJS.Signals | number }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const spawnImpl: any = (_cmd: string, _args: readonly string[], opts: Record<string, unknown>) => {
  lastSpawnOpts = opts;
  child = new FakeChild();
  return child;
};
const killImpl = (pid: number, sig: NodeJS.Signals | number) => kills.push({ pid, sig });

beforeEach(() => {
  lastSpawnOpts = null;
  kills = [];
});

afterEach(() => {
  // Guard against a failing fake-timer test leaking into the real-timer
  // integration test below.
  vi.useRealTimers();
});

describe("defaultSpawn process-group kill", () => {
  it("spawns the child detached (its own process group) when a timeout is set", async () => {
    const s = makeSpawn({ spawnImpl, killImpl });
    const p = s("cmd", ["a"], { timeoutMs: 5000 });
    expect(lastSpawnOpts?.detached).toBe(true);
    child.emit("close", 0);
    await expect(p).resolves.toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("does NOT detach when no timeout is set, so terminal Ctrl-C still reaches streaming children", async () => {
    const s = makeSpawn({ spawnImpl, killImpl });
    const p = s("pnpm", ["install"], { streaming: true }); // no timeoutMs
    expect(lastSpawnOpts?.detached).toBe(false);
    child.emit("close", 0);
    await expect(p).resolves.toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("attempts no kill when the child failed to spawn (pid undefined)", async () => {
    vi.useFakeTimers();
    const s = makeSpawn({ spawnImpl, killImpl, killGraceMs: 1000 });
    const p = s("nope", [], { timeoutMs: 500 });
    p.catch(() => {});
    child.pid = undefined;
    vi.advanceTimersByTime(2000); // timeout + grace both elapse
    expect(kills).toHaveLength(0);
    vi.useRealTimers();
    await expect(p).rejects.toThrow(/timeout/);
  });

  it("kills the whole process group with SIGTERM on timeout (negative pid)", async () => {
    vi.useFakeTimers();
    const s = makeSpawn({ spawnImpl, killImpl, killGraceMs: 1000 });
    const p = s("slow", [], { timeoutMs: 500 });
    p.catch(() => {});
    vi.advanceTimersByTime(500);
    expect(kills).toContainEqual({ pid: -4242, sig: "SIGTERM" });
    vi.useRealTimers();
    await expect(p).rejects.toThrow(/timeout/);
  });

  it("escalates to SIGKILL when the child ignores SIGTERM past the grace window", async () => {
    vi.useFakeTimers();
    const s = makeSpawn({ spawnImpl, killImpl, killGraceMs: 1000 });
    const p = s("stubborn", [], { timeoutMs: 500 });
    p.catch(() => {});
    vi.advanceTimersByTime(500);
    expect(kills).toContainEqual({ pid: -4242, sig: "SIGTERM" });
    expect(kills).not.toContainEqual({ pid: -4242, sig: "SIGKILL" });
    vi.advanceTimersByTime(1000);
    expect(kills).toContainEqual({ pid: -4242, sig: "SIGKILL" });
    vi.useRealTimers();
    await expect(p).rejects.toThrow(/timeout/);
  });

  it("does not escalate to SIGKILL if the child exits in response to SIGTERM", async () => {
    vi.useFakeTimers();
    const s = makeSpawn({ spawnImpl, killImpl, killGraceMs: 1000 });
    const p = s("dies-on-term", [], { timeoutMs: 500 });
    p.catch(() => {});
    vi.advanceTimersByTime(500);
    child.emit("close", 143); // exits after SIGTERM, before the grace window
    vi.advanceTimersByTime(2000);
    expect(kills).not.toContainEqual({ pid: -4242, sig: "SIGKILL" });
    vi.useRealTimers();
    await expect(p).rejects.toThrow(/timeout/);
  });

  it("swallows a kill error when the process group is already gone (ESRCH race)", async () => {
    vi.useFakeTimers();
    const throwingKill = () => {
      throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    };
    const s = makeSpawn({ spawnImpl, killImpl: throwingKill, killGraceMs: 1000 });
    const p = s("race", [], { timeoutMs: 500 });
    p.catch(() => {});
    expect(() => vi.advanceTimersByTime(1500)).not.toThrow();
    vi.useRealTimers();
    await expect(p).rejects.toThrow(/timeout/);
  });

  it("kills nothing when the child exits before the timeout, and clears the timers", async () => {
    vi.useFakeTimers();
    const s = makeSpawn({ spawnImpl, killImpl, killGraceMs: 1000 });
    const p = s("fast", [], { timeoutMs: 5000 });
    child.stdout.emit("data", Buffer.from("hi"));
    child.emit("close", 0);
    vi.advanceTimersByTime(10000); // nothing pending should fire a kill
    expect(kills).toHaveLength(0);
    vi.useRealTimers();
    await expect(p).resolves.toEqual({ code: 0, stdout: "hi", stderr: "" });
  });
});

describe("defaultSpawn output handling", () => {
  it("captures stdout and stderr and returns the exit code", async () => {
    const s = makeSpawn({ spawnImpl, killImpl });
    const p = s("cmd", []);
    child.stdout.emit("data", Buffer.from("out1"));
    child.stderr.emit("data", Buffer.from("err1"));
    child.stdout.emit("data", Buffer.from("out2"));
    child.emit("close", 2);
    await expect(p).resolves.toEqual({ code: 2, stdout: "out1out2", stderr: "err1" });
  });

  it("caps captured output so a runaway child can't exhaust memory", async () => {
    const s = makeSpawn({ spawnImpl, killImpl, maxOutputBytes: 10 });
    const p = s("chatty", []);
    child.stdout.emit("data", Buffer.from("0123456789ABCDEFGHIJ"));
    child.emit("close", 0);
    const r = await p;
    expect(r.stdout).toContain("0123456789");
    expect(r.stdout).toMatch(/truncated/i);
    expect(r.stdout).not.toContain("ABCDEFGHIJ");
  });

  it("does not truncate output that lands exactly on the cap boundary", async () => {
    const s = makeSpawn({ spawnImpl, killImpl, maxOutputBytes: 10 });
    const p = s("exact", []);
    child.stdout.emit("data", Buffer.from("0123456789")); // length === cap
    child.emit("close", 0);
    const r = await p;
    expect(r.stdout).toBe("0123456789");
    expect(r.stdout).not.toMatch(/truncated/i);
  });

  it("appends the truncation marker once and ignores chunks once capped", async () => {
    const s = makeSpawn({ spawnImpl, killImpl, maxOutputBytes: 10 });
    const p = s("flood", []);
    child.stdout.emit("data", Buffer.from("0123456789ABCDEF")); // truncates
    const afterFirst = "0123456789".length; // marker appended once
    child.stdout.emit("data", Buffer.from("MOREMOREMORE")); // must be ignored
    child.emit("close", 0);
    const r = await p;
    expect(r.stdout.startsWith("0123456789")).toBe(true);
    expect(r.stdout).not.toContain("MORE");
    expect(r.stdout.match(/truncated/gi)).toHaveLength(1);
    expect(r.stdout.length).toBeGreaterThan(afterFirst); // marker present, but only once
  });

  it("inherits stdio (no capture) when streaming", async () => {
    const s = makeSpawn({ spawnImpl, killImpl });
    const p = s("cmd", [], { streaming: true });
    expect(lastSpawnOpts?.stdio).toEqual(["ignore", "inherit", "inherit"]);
    child.emit("close", 0);
    await expect(p).resolves.toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("decodes a multibyte UTF-8 char split across two chunks without corruption", async () => {
    // "café — π" → UTF-8 bytes where the é (0xC3 0xA9), the em-dash (0xE2 0x80
    // 0x94) and π (0xCF 0x80) are multibyte. Split the buffer at byte 4, which
    // lands INSIDE the é's 2-byte sequence — the old `String(chunk)` path would
    // emit U+FFFD for the dangling half of each split char.
    const full = Buffer.from("café — π", "utf-8");
    const splitAt = 4; // mid-é (é starts at byte 3: "caf" = 3 bytes)
    const s = makeSpawn({ spawnImpl, killImpl });
    const p = s("unicode", []);
    child.stdout.emit("data", full.subarray(0, splitAt));
    child.stdout.emit("data", full.subarray(splitAt));
    child.emit("close", 0);
    const r = await p;
    expect(r.stdout).toBe("café — π");
    expect(r.stdout).not.toContain("�");
  });

  it("flushes a final truncated multibyte sequence on close rather than dropping it", async () => {
    // Emit only the FIRST byte of é (0xC3) and then close. The decoder buffers
    // it; `.end()` flushes the now-incomplete sequence as the replacement char
    // (correct, lossless-until-flush behaviour) instead of silently losing it.
    const eAcute = Buffer.from("é", "utf-8");
    const s = makeSpawn({ spawnImpl, killImpl });
    const p = s("partial", []);
    child.stdout.emit("data", Buffer.from("ab"));
    child.stdout.emit("data", eAcute.subarray(0, 1)); // dangling first byte
    child.emit("close", 0);
    const r = await p;
    // "ab" survives intact; the dangling byte is flushed as U+FFFD, not dropped.
    expect(r.stdout.startsWith("ab")).toBe(true);
    expect(r.stdout).toBe("ab�");
  });
});

// Real subprocesses (no spawnImpl/killImpl injection): proves the actual reap
// the mocked tests structurally can't — detached:true + process.kill(-pid)
// tearing down a grandchild that SHARES the timed-out child's process group
// (the vite/Chromium-under-lhci case). A regression dropping `detached` fails
// this loudly instead of silently. POSIX-only; the project targets macOS/Linux.
describe("defaultSpawn real process-group reap (integration)", () => {
  it("kills a non-detached grandchild in the timed-out child's group", async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const dir = await mkdtemp(join(tmpdir(), "reddoor-spawn-int-"));
    const pidFile = join(dir, "gc.pid");
    // Child = `sh` (detached by defaultSpawn because timeoutMs is set, so it
    // leads its own group). It backgrounds a grandchild `sleep` that SHARES
    // that group, records the sleep's pid, then `wait`s. Killing the group on
    // timeout must reap the sleep. We use sh+sleep (not node) deliberately: both
    // start near-instantly and load-insensitively, so the cold start can't race
    // the timeout under heavy parallel-suite load (the node version did).
    const script = `sleep 100 & echo $! > ${JSON.stringify(pidFile)}; wait`;

    await expect(defaultSpawn("sh", ["-c", script], { timeoutMs: 1500 })).rejects.toThrow(
      /timeout/,
    );

    const grandPid = Number((await readFile(pidFile, "utf-8")).trim());
    expect(grandPid).toBeGreaterThan(0);

    // Poll for the reap rather than guessing a fixed propagation delay.
    let alive = true;
    for (let i = 0; i < 40 && alive; i++) {
      try {
        process.kill(grandPid, 0); // signal 0 = liveness probe
        await delay(50);
      } catch {
        alive = false; // ESRCH → the grandchild was reaped
      }
    }
    if (alive) process.kill(grandPid, "SIGKILL"); // cleanup if the fix regressed
    expect(alive).toBe(false);
  });
});
