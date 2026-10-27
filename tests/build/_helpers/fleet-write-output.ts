import { formatFleetWriteSummary } from "../../../src/audits/write-audits.js";

/** The write-back block exactly as `formatFleetWriteSummary` prints it for `wrote` written
 *  sites, `failed` sites whose Turso write threw and `kept` sites that had nothing new to
 *  write (#1698): the summary line and the
 *  `FLEET_WRITE_GATE` verdict every fleet workflow reads (#1605). Built by the real
 *  formatter, so a change to that contract breaks the workflow tests instead of silently
 *  un-arming a gate. */
export function fleetWriteOutput(
  wrote: number,
  failed: number,
  kept: Array<{ slug: string; reason: string }> = [],
): string {
  return formatFleetWriteSummary({
    kept,
    written: Array.from({ length: wrote }, (_, i) => ({ siteName: `site-${i}`, writes: [] })),
    failed: Array.from({ length: failed }, (_, i) => ({
      slug: `flaky-${i}`,
      error: "Turso write failed: HTTP 503",
    })),
  });
}
