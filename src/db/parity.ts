import type { Db } from "./client.js";
import { mapWebsiteRecord, mapReportRecord, type RawRecord } from "./import-airtable.js";

/**
 * Phase 1.4 of #539: the instrument the cutover depends on. Reads BOTH stores
 * and diffs field-by-field, using the importer's own mapping functions — so
 * "what parity expects" is definitionally "what the importer writes", and the
 * two cannot drift apart.
 *
 * Per the repo's standing rule, this harness must be shown to PASS GREEN on the
 * pre-cutover state (immediately after an import, when the stores genuinely
 * agree) before any mismatch it reports is treated as a finding. A harness that
 * has only ever failed is not evidence.
 *
 * Deliberately NOT compared:
 * - `site_schedule.computed_at` — an import stamp, different by construction.
 * - `sites.header_image*` — Airtable stopped being the source (design D5).
 * - `reports.rendered_html` — comparing it would re-download every attachment
 *   on every run against URLs that expire; presence is checked at import time
 *   and the body never changes after a send.
 */

export type ParityMismatch = {
  table: "sites" | "site_health" | "site_schedule" | "reports";
  id: string;
  column: string;
  airtable: string;
  turso: string;
};

export type ParityResult = {
  compared: Record<"sites" | "site_health" | "site_schedule" | "reports", number>;
  mismatches: ParityMismatch[];
};

const SKIP_COLUMNS: ReadonlySet<string> = new Set([
  "computed_at",
  "header_image",
  "header_image_filename",
  "header_image_type",
  "header_image_generated_at",
  "rendered_html",
]);

const show = (v: unknown): string => {
  if (v === null || v === undefined) return "∅";
  const str = typeof v === "string" ? v : JSON.stringify(v);
  return str.length > 80 ? `${str.slice(0, 77)}…` : str;
};

function diffRows(
  table: ParityMismatch["table"],
  id: string,
  expected: Record<string, unknown>,
  actual: Record<string, unknown> | undefined,
  out: ParityMismatch[],
): void {
  if (!actual) {
    out.push({ table, id, column: "(row)", airtable: "present", turso: "ABSENT" });
    return;
  }
  for (const [col, want] of Object.entries(expected)) {
    if (SKIP_COLUMNS.has(col)) continue;
    const got = actual[col] ?? null;
    const wantNorm = want ?? null;
    if (String(wantNorm ?? "") !== String(got ?? "") && !(wantNorm === null && got === null)) {
      out.push({ table, id, column: col, airtable: show(wantNorm), turso: show(got) });
    }
  }
}

export type ParityIo = {
  listWebsiteRecords: () => Promise<RawRecord[]>;
  listReportRecords: () => Promise<RawRecord[]>;
  now: () => Date;
};

export async function checkFleetParity(db: Db, io: ParityIo): Promise<ParityResult> {
  const computedAt = io.now().toISOString();
  const mismatches: ParityMismatch[] = [];

  const websites = await io.listWebsiteRecords();
  const mapped = websites.map((r) => mapWebsiteRecord(r, computedAt));

  const [sites, health, schedule] = await Promise.all([
    db.selectFrom("sites").selectAll().execute(),
    db.selectFrom("site_health").selectAll().execute(),
    db.selectFrom("site_schedule").selectAll().execute(),
  ]);
  const byId = <T extends { [k: string]: unknown }>(rows: T[], key: string): Map<string, T> =>
    new Map(rows.map((r) => [String(r[key]), r]));
  const sitesById = byId(sites as Array<Record<string, unknown>>, "id");
  const healthById = byId(health as Array<Record<string, unknown>>, "site_id");
  const scheduleById = byId(schedule as Array<Record<string, unknown>>, "site_id");

  for (const m of mapped) {
    diffRows(
      "sites",
      m.site.id,
      m.site as unknown as Record<string, unknown>,
      sitesById.get(m.site.id),
      mismatches,
    );
    diffRows(
      "site_health",
      m.health.site_id,
      m.health as unknown as Record<string, unknown>,
      healthById.get(m.health.site_id),
      mismatches,
    );
    diffRows(
      "site_schedule",
      m.schedule.site_id,
      m.schedule as unknown as Record<string, unknown>,
      scheduleById.get(m.schedule.site_id),
      mismatches,
    );
  }
  // A Turso site Airtable no longer has is as much a divergence as a missing one.
  const airtableIds = new Set(mapped.map((m) => m.site.id));
  for (const row of sitesById.keys()) {
    if (!airtableIds.has(row)) {
      mismatches.push({
        table: "sites",
        id: row,
        column: "(row)",
        airtable: "ABSENT",
        turso: "present",
      });
    }
  }

  const reports = await io.listReportRecords();
  const reportRows = byId(
    (await db.selectFrom("reports").selectAll().execute()) as Array<Record<string, unknown>>,
    "id",
  );
  for (const rec of reports) {
    const expected = mapReportRecord(rec, null) as unknown as Record<string, unknown>;
    diffRows("reports", rec.id, expected, reportRows.get(rec.id), mismatches);
  }
  const reportIds = new Set(reports.map((r) => r.id));
  for (const row of reportRows.keys()) {
    if (!reportIds.has(row)) {
      mismatches.push({
        table: "reports",
        id: row,
        column: "(row)",
        airtable: "ABSENT",
        turso: "present",
      });
    }
  }

  return {
    compared: {
      sites: mapped.length,
      site_health: mapped.length,
      site_schedule: mapped.length,
      reports: reports.length,
    },
    mismatches,
  };
}

/** Render for CLI/CI. Emits the machine-parseable `FLEET_PARITY` line on every
 *  run, count=0 included — an absent line must mean "the harness never ran",
 *  never "it ran clean" (same contract as FLEET_SMOKE_UNMEASURED, same reason). */
export function formatParityResult(r: ParityResult): string {
  const lines: string[] = [];
  for (const m of r.mismatches) {
    lines.push(`✗ ${m.table} ${m.id} ${m.column}: airtable=${m.airtable} turso=${m.turso}`);
  }
  lines.push(
    `FLEET_PARITY sites=${r.compared.sites} health=${r.compared.site_health} ` +
      `schedule=${r.compared.site_schedule} reports=${r.compared.reports} ` +
      `mismatches=${r.mismatches.length}`,
  );
  return lines.join("\n");
}
