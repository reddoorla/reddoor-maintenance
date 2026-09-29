import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  makeSpawn,
  defaultSpawn,
  SpawnTimeoutError,
  isSpawnTimeout,
  type ProcessRow,
} from "../../../src/audits/util/spawn.js";
import { findFreePort } from "../../../src/util/free-port.js";
import { killLeftover, reapedWithin, waitForPid } from "./orphan-probe.js";

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

// The descendant-group reap (#969) against a fixed process table. The fake
// child is pid 4242; OWN is this process's group. Nothing here reads the real
// table: 4242 can be a live pid in a container that runs as root.
describe("defaultSpawn detached descendant groups (mocked table)", () => {
  const OWN = 7777;
  const self: ProcessRow = { pid: process.pid, ppid: 1, pgid: OWN };
  const leader: ProcessRow = { pid: 4242, ppid: process.pid, pgid: 4242 };

  function start(tables: Array<ProcessRow[] | Error>) {
    let reads = 0;
    const readProcessTable = (): ProcessRow[] => {
      const t = tables[Math.min(reads++, tables.length - 1)] as ProcessRow[] | Error;
      if (t instanceof Error) throw t;
      return t;
    };
    const s = makeSpawn({ spawnImpl, killImpl, readProcessTable, killGraceMs: 1000 });
    const p = s("slow", [], { timeoutMs: 500 });
    const seen = p.catch((e: unknown) => e);
    return { seen, reads: () => reads };
  }

  it("SIGTERMs a detached group two levels down, alongside the leader's group", async () => {
    vi.useFakeTimers();
    const table = [
      self,
      leader,
      { pid: 5001, ppid: 4242, pgid: 4242 },
      { pid: 5002, ppid: 5001, pgid: 5002 },
      { pid: 5003, ppid: 5002, pgid: 5002 },
      { pid: 6000, ppid: 1, pgid: 6000 },
    ];
    const { seen } = start([table]);
    vi.advanceTimersByTime(500);
    expect(kills).toContainEqual({ pid: -4242, sig: "SIGTERM" });
    expect(kills).toContainEqual({ pid: -5002, sig: "SIGTERM" });
    expect(kills).not.toContainEqual({ pid: -6000, sig: "SIGTERM" });
    vi.useRealTimers();
    expect(await seen).toBeInstanceOf(SpawnTimeoutError);
  });

  it("still SIGTERMs the leader's group and rejects when the table reader throws", async () => {
    vi.useFakeTimers();
    const { seen, reads } = start([new Error("spawnSync ps ENOENT")]);
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(kills).toEqual([{ pid: -4242, sig: "SIGTERM" }]);
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(kills).toContainEqual({ pid: -4242, sig: "SIGKILL" });
    expect(reads()).toBeGreaterThan(0);
    vi.useRealTimers();
    expect(await seen).toBeInstanceOf(SpawnTimeoutError);
  });

  it("never signals pgid 0 or 1, this process's own group, or this process's pid as a group", async () => {
    vi.useFakeTimers();
    const table = [
      self,
      leader,
      { pid: 5010, ppid: 4242, pgid: 1 },
      { pid: 5011, ppid: 4242, pgid: 0 },
      { pid: 5012, ppid: 4242, pgid: OWN },
      { pid: 5013, ppid: 4242, pgid: process.pid },
      { pid: 5014, ppid: 4242, pgid: 5014 },
    ];
    const { seen } = start([table]);
    vi.advanceTimersByTime(1500);
    const targets = kills.map((k) => k.pid);
    for (const bad of [-1, 0, -0, 1, -OWN, -process.pid]) expect(targets).not.toContain(bad);
    expect(kills).toContainEqual({ pid: -5014, sig: "SIGTERM" });
    expect(kills).toContainEqual({ pid: -5014, sig: "SIGKILL" });
    vi.useRealTimers();
    expect(await seen).toBeInstanceOf(SpawnTimeoutError);
  });

  it("signals no descendant group when this process is missing from the table", async () => {
    vi.useFakeTimers();
    const { seen } = start([[leader, { pid: 5020, ppid: 4242, pgid: 5020 }]]);
    vi.advanceTimersByTime(1500);
    expect(kills.map((k) => k.pid)).not.toContain(-5020);
    vi.useRealTimers();
    expect(await seen).toBeInstanceOf(SpawnTimeoutError);
  });

  it("SIGKILLs a snapshotted group after the wrapper has closed, while it still holds a snapshot pid", async () => {
    vi.useFakeTimers();
    const before = [self, leader, { pid: 5030, ppid: 4242, pgid: 5030 }];
    const after = [self, { pid: 5030, ppid: 1, pgid: 5030 }];
    const { seen } = start([before, after]);
    vi.advanceTimersByTime(500);
    child.emit("close", 143);
    vi.advanceTimersByTime(1000);
    expect(kills).toContainEqual({ pid: -5030, sig: "SIGKILL" });
    expect(kills).not.toContainEqual({ pid: -4242, sig: "SIGKILL" });
    vi.useRealTimers();
    expect(await seen).toBeInstanceOf(SpawnTimeoutError);
  });

  it("does not SIGKILL a group id that now holds only pids the snapshot never saw", async () => {
    vi.useFakeTimers();
    const before = [self, leader, { pid: 5040, ppid: 4242, pgid: 5040 }];
    const reused = [self, leader, { pid: 9999, ppid: 1, pgid: 5040 }];
    const { seen } = start([before, reused]);
    vi.advanceTimersByTime(500);
    expect(kills).toContainEqual({ pid: -5040, sig: "SIGTERM" });
    vi.advanceTimersByTime(1000);
    expect(kills).not.toContainEqual({ pid: -5040, sig: "SIGKILL" });
    expect(kills).toContainEqual({ pid: -4242, sig: "SIGKILL" });
    vi.useRealTimers();
    expect(await seen).toBeInstanceOf(SpawnTimeoutError);
  });

  it("skips the escalation quietly when the re-read throws", async () => {
    vi.useFakeTimers();
    const before = [self, leader, { pid: 5050, ppid: 4242, pgid: 5050 }];
    const { seen } = start([before, new Error("ps exited 1")]);
    vi.advanceTimersByTime(500);
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(kills).not.toContainEqual({ pid: -5050, sig: "SIGKILL" });
    expect(kills).toContainEqual({ pid: -4242, sig: "SIGKILL" });
    vi.useRealTimers();
    expect(await seen).toBeInstanceOf(SpawnTimeoutError);
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

    // Poll for the reap against a deadline, and always probe AFTER the last wait:
    // the killed sleep lingers as a zombie until PID 1 reaps it (up to ~2 s in a
    // cloud container), so a reap landing in the final wait must count as reaped.
    // The deadline stays under defaultSpawn's 5 s SIGKILL grace, so only the
    // SIGTERM group kill can pass this, never the escalation.
    const isAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0); // signal 0 = liveness probe
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH") return false; // reaped
        throw e;
      }
    };
    const deadline = Date.now() + 4000;
    let alive = isAlive(grandPid);
    while (alive && Date.now() < deadline) {
      await delay(50);
      alive = isAlive(grandPid);
    }
    if (alive) {
      try {
        process.kill(grandPid, "SIGKILL"); // cleanup if the fix regressed
      } catch {
        // ESRCH: reaped after the final probe. Cleanup must never be the failure.
      }
    }
    expect(alive).toBe(false);
  });
});

// A descendant that detaches into a process group of its own is out of reach of
// process.kill(-child.pid). Playwright's webServer and chrome-launcher's Chrome
// both do this (#969). The server here sits two levels below the group leader:
// `sh` (kept from exec'ing node by the trailing `; :`) → middle node → server,
// spawned detached exactly as Playwright's launchProcess does.
describe("defaultSpawn reap of detached descendant groups (integration)", () => {
  const SERVER = `
import http from "node:http";
import { writeFileSync } from "node:fs";
if (process.env.IGNORE_TERM === "1") process.on("SIGTERM", () => {});
const [port, pidFile] = process.argv.slice(2);
http.createServer((_q, r) => r.end("ok")).listen(Number(port), "127.0.0.1", () =>
  writeFileSync(pidFile, String(process.pid)),
);
`;
  const MIDDLE = `
import { spawn } from "node:child_process";
const [server, port, pidFile] = process.argv.slice(2);
spawn(process.execPath, [server, port, pidFile], { detached: true, stdio: "ignore", env: process.env });
setInterval(() => {}, 1 << 30);
`;

  async function runDetachedServer(opts: {
    spawnFn: typeof defaultSpawn;
    timeoutMs: number;
    env?: NodeJS.ProcessEnv;
  }): Promise<{ port: number; serverPid: number | undefined; err: unknown; dir: string }> {
    const dir = await mkdtemp(join(tmpdir(), "reddoor-spawn-detached-"));
    const server = join(dir, "server.mjs");
    const middle = join(dir, "middle.mjs");
    const pidFile = join(dir, "server.pid");
    await writeFile(server, SERVER);
    await writeFile(middle, MIDDLE);
    const port = await findFreePort();
    const q = JSON.stringify;
    const script = `${q(process.execPath)} ${q(middle)} ${q(server)} ${port} ${q(pidFile)}; :`;
    let settled = false;
    const outcome = opts
      .spawnFn("sh", ["-c", script], {
        timeoutMs: opts.timeoutMs,
        ...(opts.env ? { env: opts.env } : {}),
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    void outcome.finally(() => (settled = true));
    const serverPid = await waitForPid(pidFile, () => settled);
    const err = await outcome;
    return { port, serverPid, err, dir };
  }

  it("kills a detached grandchild's group with the SIGTERM, inside the grace window", async () => {
    const r = await runDetachedServer({ spawnFn: defaultSpawn, timeoutMs: 4000 });
    try {
      expect(r.serverPid, "fixture broken: the server was not up before the timeout").toBeDefined();
      expect(r.err).toBeInstanceOf(SpawnTimeoutError);
      expect(await reapedWithin(r.port, r.serverPid as number, 4000)).toBe(true);
    } finally {
      killLeftover(r.serverPid);
      await rm(r.dir, { recursive: true, force: true });
    }
  });

  it("SIGKILLs a detached group that ignores SIGTERM, after the wrapper has already exited", async () => {
    const r = await runDetachedServer({
      spawnFn: makeSpawn({ killGraceMs: 300 }),
      timeoutMs: 4000,
      env: { ...process.env, IGNORE_TERM: "1" },
    });
    try {
      expect(r.serverPid, "fixture broken: the server was not up before the timeout").toBeDefined();
      expect(r.err).toBeInstanceOf(SpawnTimeoutError);
      expect(await reapedWithin(r.port, r.serverPid as number, 3000)).toBe(true);
    } finally {
      killLeftover(r.serverPid);
      await rm(r.dir, { recursive: true, force: true });
    }
  });
});

describe("spawn timeout identification", () => {
  it("rejects a timeout with a typed SpawnTimeoutError carrying command + budget", async () => {
    vi.useFakeTimers();
    const s = makeSpawn({ spawnImpl, killImpl, killGraceMs: 1000 });
    const p = s("pnpm", ["test:smoke"], { timeoutMs: 500 });
    const seen = p.catch((e: unknown) => e);
    vi.advanceTimersByTime(500);
    vi.useRealTimers();
    const err = await seen;
    expect(err).toBeInstanceOf(SpawnTimeoutError);
    expect((err as SpawnTimeoutError).command).toBe("pnpm");
    expect((err as SpawnTimeoutError).timeoutMs).toBe(500);
    // The historical message shape is preserved so anything already reading it
    // keeps working — this class is additive, not a rename.
    expect((err as Error).message).toBe("spawn timeout after 500ms: pnpm");
    expect(isSpawnTimeout(err)).toBe(true);
  });

  it("identifies a timeout re-thrown as a plain Error (injected doubles, wrappers)", () => {
    expect(isSpawnTimeout(new Error("spawn timeout after 60000ms: prettier"))).toBe(true);
  });

  it("does NOT mistake other failures for a timeout", () => {
    // The whole point of the class is telling "no verdict" apart from "a verdict".
    // A false positive here would silence a real failing suite as "never measured".
    expect(isSpawnTimeout(new Error("ENOENT: pnpm not found"))).toBe(false);
    expect(isSpawnTimeout(new Error("spawn timeout"))).toBe(false); // no budget → not the shape
    expect(isSpawnTimeout("spawn timeout after 500ms: pnpm")).toBe(false); // not an Error
    expect(isSpawnTimeout(undefined)).toBe(false);
    expect(isSpawnTimeout(null)).toBe(false);
  });
});
