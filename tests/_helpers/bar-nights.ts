import { expectedNight } from "../../cockpit/src/lib/overview/view.js";
import { runNightOf } from "../../cockpit/src/lib/overview/cycle.js";

/** One fleet_daily night the bar's seed writes: its merged count, and whether its
 *  nightly backup ran. */
export type SeededNight = { night: string; merged: number; backupRan: boolean };

/** The nights the browser seed and the bar's SSR tests share, at `now`: the night before
 *  the expected one (600 merged), the expected one (612), and, when the bar's own run night
 *  is one later than the expected one (10pm to 6am Pacific), that run night (624, so the
 *  changes-shipped tile still reads 12 over the night before). The run night's backup did
 *  not run, so the bar renders a `none` step; when the run night is the expected one, that
 *  night carries it. */
export function seededNights(now: Date): SeededNight[] {
  const newest = expectedNight(now);
  const run = runNightOf(now);
  const before = new Date(Date.parse(`${newest}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (run === newest) {
    return [
      { night: before, merged: 600, backupRan: true },
      { night: newest, merged: 612, backupRan: false },
    ];
  }
  return [
    { night: before, merged: 600, backupRan: true },
    { night: newest, merged: 612, backupRan: true },
    { night: run, merged: 624, backupRan: false },
  ];
}
