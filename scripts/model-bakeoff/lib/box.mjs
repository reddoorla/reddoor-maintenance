import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A box for code the scorer must run but cannot trust (#1501; Linux only, the operator,
// 2026-10-26). `unshare` gives it its own user, mount, network and pid namespaces; this file,
// run inside them, hides each path (an empty read-only tmpfs over a directory, /dev/null over a
// file), keeps each writable directory writable, gives /dev/shm a fresh tmpfs, remounts every
// other mount read-only, and then starts the command through `setpriv` with no capabilities, so
// the command cannot undo a mount. No shell is involved: every path is an argument.
const RUNNER = fileURLToPath(import.meta.url);
const UNSHARE = [
  "--user",
  "--map-root-user",
  "--mount",
  "--net",
  "--pid",
  "--fork",
  "--kill-child",
];
const NO_CAPS = ["--bounding-set=-all", "--inh-caps=-all", "--no-new-privs", "--"];
// Mounts the kernel or the runtime needs as they are, and that hold nothing of a run's.
const LEAVE = ["/proc", "/sys", "/dev/pts"];

// The command line that runs `cmd args` in a box. A box may not hide a writable directory or one
// of its ancestors, which would hide the very tree the command works in.
export function boxCommand({ hide, writable }, cmd, args) {
  for (const w of writable) {
    for (const h of hide) {
      if (w === h || w.startsWith(`${h}/`))
        throw new Error(`the box would hide ${h}, which holds its writable ${w}`);
    }
  }
  const spec = JSON.stringify({ hide, writable, cmd, args });
  return ["unshare", [...UNSHARE, process.execPath, RUNNER, spec]];
}

// /proc/self/mountinfo's fifth field, with its octal escapes (\040 for a space) decoded.
export function mountPoints(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) =>
      l.split(" ")[4].replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))),
    );
}

function enter({ hide, writable, cmd, args }) {
  const mount = (...a) => execFileSync("mount", a, { stdio: ["ignore", "ignore", "inherit"] });
  for (const p of hide) {
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) mount("-t", "tmpfs", "-o", "ro,size=4k", "tmpfs", p);
    else mount("--bind", "/dev/null", p);
  }
  for (const w of writable) mount("--bind", w, w);
  if (existsSync("/dev/shm")) mount("-t", "tmpfs", "-o", "size=64m", "tmpfs", "/dev/shm");
  const keep = new Set([...writable.map((w) => resolve(w)), "/dev/shm"]);
  for (const pt of mountPoints(readFileSync("/proc/self/mountinfo", "utf8"))) {
    if (keep.has(pt) || LEAVE.some((l) => pt === l || pt.startsWith(`${l}/`))) continue;
    try {
      mount("-o", "remount,bind,ro", pt);
    } catch (e) {
      // The root filesystem must be read-only; a mount the kernel will not remount is left.
      if (pt === "/") throw e;
    }
  }
  const r = spawnSync("setpriv", [...NO_CAPS, cmd, ...args], { stdio: "inherit" });
  if (r.error) throw r.error;
  process.exit(r.status ?? 1);
}

if (process.argv[1] && resolve(process.argv[1]) === RUNNER) enter(JSON.parse(process.argv[2]));
