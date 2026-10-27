import { siteSlug, type WebsiteRow } from "../../fleet/site-row.js";
import {
  blockingLines,
  formatLaunchCheck,
  launchCheck,
  type LaunchCheckDeps,
} from "../../recipes/launch-check.js";

export type LaunchCheckCommandDeps = {
  roster: () => Promise<WebsiteRow[]>;
  check: LaunchCheckDeps;
};

/**
 * `launch-check <site>` — the launch readiness check on its own, so the PM
 * pass and the cockpit can ask it without starting a launch. Reads only:
 * Turso, the live site, and Google's read APIs. Exit 0 when every step is
 * `ok`, 1 otherwise.
 */
export async function runLaunchCheckCommand(
  site: string,
  deps?: Partial<LaunchCheckCommandDeps>,
): Promise<{ output: string; code: number }> {
  const roster =
    deps?.roster ??
    (async () => {
      const { readFleetRoster } = await import("../../fleet/roster.js");
      return readFleetRoster();
    });
  const rows = await roster();
  const row = rows.find((w) => siteSlug(w.name) === siteSlug(site));
  if (!row) return { output: `No site row matched "${site}".`, code: 1 };
  const check =
    deps?.check ??
    (await (await import("../../recipes/launch-check-io.js")).defaultLaunchCheckDeps());
  const lines = await launchCheck(row, check);
  return {
    output: formatLaunchCheck(siteSlug(row.name), lines),
    code: blockingLines(lines, new Set()).length === 0 ? 0 : 1,
  };
}
