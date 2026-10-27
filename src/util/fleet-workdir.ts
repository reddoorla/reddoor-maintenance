import { tmpdir } from "node:os";
import { join } from "node:path";

/** The default clone target for `--fleet` mode. Normally `~/.reddoor-maint/sites`.
 *
 *  When `HOME` is unset or empty (cron, minimal CI containers) the old
 *  `${HOME}/.reddoor-maint/sites` expression collapsed to `/.reddoor-maint/sites`
 *  — a filesystem-root path the process almost never has permission to write,
 *  and a dangerous one if it did. Fall back to a tmpdir-based path instead so a
 *  HOME-less environment clones somewhere writable rather than at `/`.
 *
 *  An explicit `--workdir` always wins; callers pass `opts.workdir ?? fleetWorkdir()`. */
export function fleetWorkdir(): string {
  const home = process.env.HOME?.trim();
  const base = home ? home : tmpdir();
  return join(base, ".reddoor-maint", "sites");
}
