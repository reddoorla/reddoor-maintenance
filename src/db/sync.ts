/** Phase 2 backbone of the Airtable → Turso migration (#539): the hourly sync.
 *
 *  In Phase 2 readers move to Turso while writers still write Airtable, so
 *  Turso is only as fresh as the last import. One sync pass = import (with
 *  reportHtml "when-missing", so hourly runs don't re-download every report
 *  attachment) followed by the parity check, so every pass both refreshes the
 *  copy and PROVES it converged — the same instrument the whole cutover trusts.
 *
 *  The retry exists for a specific race, not for flakiness: the importer and
 *  the parity check each read Airtable separately, so a write landing between
 *  those two reads makes parity flag rows the import genuinely never saw. One
 *  re-import + re-check converges unless Airtable is being written continuously
 *  — a persistent mismatch after the retry is real drift and must red the run.
 */
import type { Db } from "./client.js";
import {
  importFleetState,
  formatReapSummary,
  type ImportIo,
  type ImportSummary,
} from "./import-airtable.js";
import { checkFleetParity, formatParityResult, type ParityResult } from "./parity.js";

export type SyncResult = {
  importSummary: ImportSummary;
  parity: ParityResult;
  /** True when the first parity check mismatched and the pass re-imported. */
  retried: boolean;
};

export async function syncFleetState(db: Db, io: ImportIo): Promise<SyncResult> {
  let importSummary = await importFleetState(db, io, { reportHtml: "when-missing" });
  let parity = await checkFleetParity(db, io);
  let retried = false;
  if (parity.mismatches.length > 0) {
    retried = true;
    importSummary = await importFleetState(db, io, { reportHtml: "when-missing" });
    parity = await checkFleetParity(db, io);
  }
  return { importSummary, parity, retried };
}

/** Human lines plus the machine gate line, emitted on EVERY run (count=0
 *  included) — an absent FLEET_SYNC line means the sync crashed, never that it
 *  was clean. */
export function formatSyncResult(r: SyncResult): string {
  const lines: string[] = [];
  if (r.importSummary.renderedHtmlMisses.length > 0) {
    lines.push(
      `⚠ ${r.importSummary.renderedHtmlMisses.length} report(s) imported WITHOUT Rendered HTML ` +
        `(fetch failed / URL expired): ${r.importSummary.renderedHtmlMisses.join(", ")}`,
    );
  }
  // The reap is the only destructive step, so every removal is NAMED and every
  // refusal is quoted in full. FLEET_REAP rides its own line rather than as new
  // keys on FLEET_SYNC: the workflow gate greps `^FLEET_SYNC .* mismatches=0$`,
  // anchored at the end, so extending that line is a contract change waiting to
  // be got wrong. A separate always-emitted line costs nothing and, like
  // FLEET_PARITY, means an absent line reads as "never ran", not as "clean".
  lines.push(...formatReapSummary(r.importSummary.reaped));
  if (r.parity.mismatches.length > 0) {
    lines.push(formatParityResult(r.parity));
  }
  lines.push(
    `FLEET_SYNC sites=${r.importSummary.sites} reports=${r.importSummary.reports} ` +
      `html_fetched=${r.importSummary.renderedHtmlFetched} ` +
      `html_skipped=${r.importSummary.renderedHtmlSkipped} ` +
      `retried=${r.retried ? 1 : 0} mismatches=${r.parity.mismatches.length}`,
  );
  return lines.join("\n");
}
