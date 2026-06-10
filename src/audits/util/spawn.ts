import { spawn } from "node:child_process";

export type SpawnResult = { code: number; stdout: string; stderr: string };

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

/** Construction-time knobs, separated from per-call {@link SpawnOptions} mainly
 *  so tests can inject deterministic `spawnImpl`/`killImpl` and a tiny grace. */
export type SpawnInternals = {
  spawnImpl?: typeof spawn;
  killImpl?: KillFn;
  /** Delay after SIGTERM before escalating to SIGKILL on a timeout (default 5s). */
  killGraceMs?: number;
  /** Cap on captured stdout/stderr length so a runaway child can't OOM the CLI. */
  maxOutputBytes?: number;
};

const TRUNCATION_MARKER = "\n…[output truncated]";

export function makeSpawn(internals: SpawnInternals = {}): SpawnFn {
  const spawnImpl = internals.spawnImpl ?? spawn;
  const killImpl: KillFn = internals.killImpl ?? ((pid, sig) => process.kill(pid, sig));
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
        // process group, so the timeout can kill the WHOLE tree (vite, and
        // Chromium under lhci/playwright) via process.kill(-pid), not just the
        // npx/pnpm wrapper. Without it, killing the wrapper orphaned the
        // grandchildren — a zombie vite squatting its port, Chrome left running.
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
      if (!streaming) {
        child.stdout?.on("data", (chunk) => (stdout = cap(stdout, String(chunk))));
        child.stderr?.on("data", (chunk) => (stderr = cap(stderr, String(chunk))));
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

      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = opts.timeoutMs
        ? setTimeout(() => {
            killGroup("SIGTERM");
            // Escalate if SIGTERM is ignored (a wedged Chrome can swallow it).
            killTimer = setTimeout(() => killGroup("SIGKILL"), killGraceMs);
            // Best-effort cleanup AFTER we've already rejected — it must never
            // hold the CLI open past its real work.
            killTimer.unref();
            reject(new Error(`spawn timeout after ${opts.timeoutMs}ms: ${cmd}`));
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
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
}

export const defaultSpawn: SpawnFn = makeSpawn();
