import type { Frequency, WebsiteRow } from "./site-row.js";
import { searchConsoleOptedOut } from "./opt-outs.js";

/** What a report draft's Search Console lookup resolved (#943), persisted per site:
 *  - `resolved`: a property was found and the brand query ran against it;
 *  - `no-property`: the API answered and no property matched the site's host;
 *  - `soft-fail`: the API errored, so nothing is known. */
export type SearchConsoleOutcome = "resolved" | "no-property" | "soft-fail";

const OUTCOMES: readonly SearchConsoleOutcome[] = ["resolved", "no-property", "soft-fail"];

/** A stored outcome cell read back. Anything outside the three values reads as
 *  null (no evidence), never as `resolved`. */
export function toSearchConsoleOutcome(v: unknown): SearchConsoleOutcome | null {
  return typeof v === "string" && (OUTCOMES as readonly string[]).includes(v)
    ? (v as SearchConsoleOutcome)
    : null;
}

/** Evidence only arrives when a report drafts, so the window follows the site's
 *  own report cadence: a fixed window shorter than a quarterly cadence would fail
 *  that site by construction. The grace matches `ANALYTICS_SOFT_FAIL_STALE_DAYS`
 *  (45 = a monthly cadence + 14). */
export const SEARCH_CONSOLE_GRACE_DAYS = 14;
const CADENCE_DAYS: Record<Exclude<Frequency, "None">, number> = {
  Monthly: 31,
  Quarterly: 92,
  Yearly: 366,
};
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function searchConsoleFreshDays(row: WebsiteRow): number {
  const cadences = [row.maintenanceFreq, row.testingFreq]
    .filter((f): f is Exclude<Frequency, "None"> => f !== "None")
    .map((f) => CADENCE_DAYS[f]);
  const cadence = cadences.length > 0 ? Math.min(...cadences) : CADENCE_DAYS.Monthly;
  return cadence + SEARCH_CONSOLE_GRACE_DAYS;
}

export type SearchConsoleEvidence =
  | { state: "opted-out" }
  | { state: "verified"; property: string | null; checkedAt: string }
  | { state: "stale"; checkedAt: string; freshDays: number }
  | { state: "no-property"; checkedAt: string }
  | { state: "unknown"; checkedAt: string }
  | { state: "none" };

/** The one reading of the persisted lookup that the setup check and the cockpit
 *  share. Only `opted-out` and `verified` pass. The opt-out is checked first, so it
 *  wins over any stored outcome. A soft-fail is `unknown`, and so is an outcome
 *  whose timestamp is missing or unparseable. */
export function searchConsoleEvidence(row: WebsiteRow, now: Date): SearchConsoleEvidence {
  if (searchConsoleOptedOut(row)) return { state: "opted-out" };
  const outcome = row.searchConsoleOutcome;
  if (outcome === null) return { state: "none" };
  const checkedAt = row.searchConsoleCheckedAt ?? "";
  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at)) return { state: "unknown", checkedAt };
  if (outcome === "soft-fail") return { state: "unknown", checkedAt };
  if (outcome === "no-property") return { state: "no-property", checkedAt };
  const freshDays = searchConsoleFreshDays(row);
  if (now.getTime() - at > freshDays * MS_PER_DAY) return { state: "stale", checkedAt, freshDays };
  return { state: "verified", property: row.searchConsoleResolved, checkedAt };
}

export function searchConsolePasses(e: SearchConsoleEvidence): boolean {
  return e.state === "opted-out" || e.state === "verified";
}
