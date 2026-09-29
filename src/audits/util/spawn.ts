import { execFileSync, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export type SpawnResult = { code: number; stdout: string; stderr: string };

/** Rejection raised when `timeoutMs` elapses before the child exits.
 *
 *  Typed rather than a bare `Error` because callers need to tell "the command ran
 *  and reported a verdict" apart from "we ran out of time and never learned one" —
 *  those mean opposite things to an audit. Conflating them is how a smoke timeout
 *  spent four nights reported as a generic `unexpected error` while the stale
 *  prior verdict stayed in place.
 *
 *  The message is unchanged from the historical string so anything already reading
 *  it keeps working; prefer {@link isSpawnTimeout} over matching the text. */
export class SpawnTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly command: string;
  constructor(command: string, timeoutMs: number) {
    super(`spawn timeout after ${timeoutMs}ms: ${command}`);
    this.name = "SpawnTimeoutError";
    this.command = command;
    this.timeoutMs = timeoutMs;
  }
}

/** True when a rejection is a spawn timeout.
 *
 *  Accepts the legacy message shape as well as the class, so an injected test
 *  double or a subprocess wrapper that re-wraps the error still reads as a
 *  timeout rather than silently degrading to "unexpected error". */
export function isSpawnTimeout(err: unknown): boolean {
  if (err instanceof SpawnTimeoutError) return true;
  return err instanceof Error && /^spawn timeout after \d+ms:/.test(err.message);
}

export type SpawnOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** When true, the child inherits stdout/stderr so the user sees live
   * progress (useful for long-running `pnpm up` / `npm install`). The
   * returned `stdout` and `stderr` will be empty strings in that case. */
  streaming?: boolean;
};

export type SpawnFn = (
  cmd: string,
  args: readonly string[],
  opts?: SpawnOptions,
) => Promise<SpawnResult>;

type KillFn = (pid: number, signal: NodeJS.Signals | number) => void;

/** One row of the process table: the three columns the timeout's reap needs. */
export type ProcessRow = { pid: number; ppid: number; pgid: number };

type ExecFn = (file: string, args: readonly string[]) => string;

const execPs: ExecFn = (file, args) =>
  execFileSync(file, [...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2000,
  });

/** Reads every process on the machine through `ps -A -o pid=,ppid=,pgid=`.
 *  POSIX options, so it answers the same on macOS and Linux procps. The `-A`
 *  matters on macOS: without it `ps` lists only processes with a controlling
 *  terminal, and a detached child (setsid) has none. */
export function readProcessTable(exec: ExecFn = execPs): ProcessRow[] {
  const out = exec("ps", ["-A", "-o", "pid=,ppid=,pgid="]);
  const rows: ProcessRow[] = [];
  for (const line of out.split("\n")) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(ppid) && Number.isInteger(pgid)) {
      rows.push({ pid, ppid, pgid } as ProcessRow);
    }
  }
  return rows;
}

/** The process groups, other than the leader's own, that `root`'s descendants
 *  sit in, plus the descendant pids seen. A descendant that detaches (Playwright's
 *  webServer, chrome-launcher's Chrome) leads a group of its own, out of reach
 *  of `kill(-root)`. Never returns pgid <= 1 (`kill(-1)` is every process we may
 *  signal) or this process's own group; with no row for this process the own
 *  group is unknown, so nothing is returned. Nothing is returned either unless
 *  `root` is still this process's child: once the wrapper is reaped its pid can
 *  be reused, and a walk from a reused pid would reach strangers. */
export function descendantGroups(
  table: readonly ProcessRow[],
  root: number,
  self: number = process.pid,
): { groups: Set<number>; pids: Set<number> } {
  const groups = new Set<number>();
  const pids = new Set<number>();
  const own = table.find((r) => r.pid === self);
  if (own === undefined) return { groups, pids };
  if (!table.some((r) => r.pid === root && r.ppid === self)) return { groups, pids };
  const children = new Map<number, ProcessRow[]>();
  for (const r of table) {
    const list = children.get(r.ppid);
    if (list) list.push(r);
    else children.set(r.ppid, [r]);
  }
  const queue = [root];
  while (queue.length > 0) {
    const parent = queue.shift() as number;
    for (const r of children.get(parent) ?? []) {
      if (r.pid === root || r.pid === self) continue;
      pids.add(r.pid);
      queue.push(r.pid);
      if (r.pgid > 1 && r.pgid !== root && r.pgid !== own.pgid && r.pgid !== self) {
        groups.add(r.pgid);
      }
    }
  }
  return { groups, pids };
}

/** Construction-time knobs, separated from per-call {@link SpawnOptions} mainly
 *  so tests can inject deterministic `spawnImpl`/`killImpl` and a tiny grace. */
export type SpawnInternals = {
  spawnImpl?: typeof spawn;
  killImpl?: KillFn;
  /** Process-table reader for the timeout's descendant-group reap. Tests pass a
   *  fixed table; the default runs `ps`. */
  readProcessTable?: () => ProcessRow[];
  /** Delay after SIGTERM before escalating to SIGKILL on a timeout (default 5s). */
  killGraceMs?: number;
  /** Cap on captured stdout/stderr length so a runaway child can't OOM the CLI. */
  maxOutputBytes?: number;
};

const TRUNCATION_MARKER = "\n…[output truncated]";

export function makeSpawn(internals: SpawnInternals = {}): SpawnFn {
  const spawnImpl = internals.spawnImpl ?? spawn;
  const killImpl: KillFn = internals.killImpl ?? ((pid, sig) => process.kill(pid, sig));
  const readTable = internals.readProcessTable ?? readProcessTable;
  const killGraceMs = internals.killGraceMs ?? 5000;
  const maxOutputBytes = internals.maxOutputBytes ?? 10 * 1024 * 1024;

  return (cmd, args, opts = {}) =>
    new Promise((resolve, reject) => {
      const streaming = opts.streaming === true;
      const child = spawnImpl(cmd, [...args], {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        stdio: streaming ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
        // Detach ONLY when a timeout can fire: the child then leads its own
        // process group, so the timeout reaches every descendant that stays in
        // it (vite under npx/pnpm) via process.kill(-pid), not just the wrapper.
        // Without it, killing the wrapper orphaned the grandchildren — a zombie
        // vite squatting its port. That group does NOT reach a descendant that
        // detaches into a group of its own: Playwright's webServer and its
        // headless shell, and Chrome under lhci's chrome-launcher, all spawn
        // with `detached: true`. Those groups are found from a process-table
        // snapshot at the timeout and signalled alongside (#969).
        // We do NOT detach timeout-less streaming calls (pnpm install/up):
        // detaching gains nothing there (no timeout → no group-kill) and would
        // break terminal Ctrl-C, which only reaches the foreground group — i.e.
        // it would re-orphan the very children this guards. We never unref() the
        // child since we still await it.
        detached: opts.timeoutMs !== undefined,
      });

      // Cap appended output so an unbounded stream can't exhaust memory.
      const cap = (acc: string, chunk: string): string => {
        if (acc.length >= maxOutputBytes) return acc;
        const next = acc + chunk;
        return next.length > maxOutputBytes
          ? next.slice(0, maxOutputBytes) + TRUNCATION_MARKER
          : next;
      };

      let stdout = "";
      let stderr = "";
      // Decode each stream through a StringDecoder so a multibyte UTF-8 char
      // split across two `data` chunks isn't corrupted: the decoder holds the
      // partial trailing bytes until the rest arrives, instead of the old
      // `String(chunk)` which decoded each chunk in isolation (and replaced the
      // split char with U+FFFD). Flushed via `.end()` on close.
      const outDecoder = new StringDecoder("utf-8");
      const errDecoder = new StringDecoder("utf-8");
      if (!streaming) {
        child.stdout?.on(
          "data",
          (chunk: Buffer) => (stdout = cap(stdout, outDecoder.write(chunk))),
        );
        child.stderr?.on(
          "data",
          (chunk: Buffer) => (stderr = cap(stderr, errDecoder.write(chunk))),
        );
      }

      /** Signal the child's whole process group; ignore if it's already gone.
       *  POSIX-only: a negative pid signals the group (the project targets
       *  macOS/Linux; this is only reached when detached, i.e. on a timeout). */
      const killGroup = (sig: NodeJS.Signals): void => {
        if (child.pid === undefined) return;
        try {
          killImpl(-child.pid, sig);
        } catch {
          // ESRCH: the group already exited between the timeout and the kill.
        }
      };

      /** Signal one snapshotted descendant group; ignore if it's already gone. */
      const killOther = (pgid: number, sig: NodeJS.Signals): void => {
        try {
          killImpl(-pgid, sig);
        } catch {
          // ESRCH: the group exited on its own.
        }
      };

      /** Reads the table, swallowing any failure: a missing or failing `ps`
       *  must not throw out of a timer callback, where it would be uncaught. */
      const safeTable = (): ProcessRow[] | undefined => {
        try {
          return readTable();
        } catch {
          return undefined;
        }
      };

      /** SIGTERM the descendant groups found before the leader is signalled
       *  (once the wrapper dies its descendants are reparented and the ancestry
       *  is gone), then SIGKILL, after the grace, each group that still holds a
       *  pid from the snapshot. That escalation outlives the wrapper's `close`:
       *  a detached server that ignores SIGTERM outlives the wrapper too. The
       *  re-check stops a SIGKILL to a group id reused after its group died.
       *  Best-effort like the leader's: the timer is unref'd, so a CLI that
       *  exits inside the grace takes the SIGKILL with it. A wrapper that has
       *  already exited has no ancestry left to walk, so it is skipped. */
      const reapDetachedGroups = (): void => {
        if (child.pid === undefined) return;
        if (typeof child.exitCode === "number" || typeof child.signalCode === "string") return;
        const table = safeTable();
        if (table === undefined) return;
        const { groups, pids } = descendantGroups(table, child.pid);
        if (groups.size === 0) return;
        for (const g of groups) killOther(g, "SIGTERM");
        const escalate = setTimeout(() => {
          const now = safeTable();
          if (now === undefined) return;
          const live = new Set(now.filter((r) => pids.has(r.pid)).map((r) => r.pgid));
          for (const g of groups) if (live.has(g)) killOther(g, "SIGKILL");
        }, killGraceMs);
        escalate.unref();
      };

      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = opts.timeoutMs
        ? setTimeout(() => {
            reapDetachedGroups();
            killGroup("SIGTERM");
            // Escalate if SIGTERM is ignored (a wedged Chrome can swallow it).
            killTimer = setTimeout(() => killGroup("SIGKILL"), killGraceMs);
            // Best-effort cleanup AFTER we've already rejected — it must never
            // hold the CLI open past its real work.
            killTimer.unref();
            reject(new SpawnTimeoutError(cmd, opts.timeoutMs as number));
          }, opts.timeoutMs)
        : undefined;

      const clearTimers = (): void => {
        if (timer) clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
      };

      child.on("error", (err) => {
        clearTimers();
        reject(err);
      });
      child.on("close", (code) => {
        clearTimers();
        if (!streaming) {
          // Flush any bytes the decoder buffered mid-character (e.g. a truncated
          // final UTF-8 sequence). `.end()` returns "" when nothing is pending.
          stdout = cap(stdout, outDecoder.end());
          stderr = cap(stderr, errDecoder.end());
        }
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
}

export const defaultSpawn: SpawnFn = makeSpawn();
