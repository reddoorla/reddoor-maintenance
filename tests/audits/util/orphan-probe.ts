import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";

/** Liveness probes for the detached-descendant reap tests (#969). A killed
 *  server whose parent already died lingers as a zombie until PID 1 reaps it,
 *  and a zombie holds no socket, so the port is the primary check and a `Z`
 *  in `ps` counts as reaped. */

export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function portAccepting(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net
      .connect(port, "127.0.0.1")
      .on("connect", () => {
        s.destroy();
        resolve(true);
      })
      .on("error", () => resolve(false));
  });
}

export function pidState(pid: number): "gone" | "zombie" | "alive" {
  let stat: string;
  try {
    stat = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "gone";
  }
  if (stat === "") return "gone";
  return stat.startsWith("Z") ? "zombie" : "alive";
}

/** Polls `pidFile` until it holds a pid, or returns undefined once `settled()`
 *  says the spawn already ended: a server that was not up before the timeout
 *  is a broken fixture, not a pass. */
export async function waitForPid(
  pidFile: string,
  settled: () => boolean,
): Promise<number | undefined> {
  for (;;) {
    const pid = Number((await readFile(pidFile, "utf-8").catch(() => "")).trim());
    if (pid > 0) return pid;
    if (settled()) return undefined;
    await delay(25);
  }
}

/** True once the port refuses and the pid is gone or a zombie, polled against
 *  `withinMs` and probed once more after the last wait. */
export async function reapedWithin(port: number, pid: number, withinMs: number): Promise<boolean> {
  const reaped = async () => !(await portAccepting(port)) && pidState(pid) !== "alive";
  const deadline = Date.now() + withinMs;
  let ok = await reaped();
  while (!ok && Date.now() < deadline) {
    await delay(50);
    ok = await reaped();
  }
  return ok;
}

/** Kills the server's group if a red run left it alive. Never the failure. */
export function killLeftover(pid: number | undefined): void {
  if (pid === undefined || pidState(pid) !== "alive") return;
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      // ESRCH: already gone.
    }
  }
}
