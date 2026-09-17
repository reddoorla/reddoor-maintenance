import { mapRow } from "../../../src/reports/airtable/reports.js";
import type { ReportRow } from "../../../src/reports/report-row.js";
import type { ReportMirror } from "../../../src/reports/report-mirror.js";
import type { ReportMirrorPatch } from "../../../src/db/fleet-state.js";

/**
 * An in-memory stand-in for the Turso report writer (`makeReportMirror`), for
 * suites that exercise the drafting/queue/recipe logic rather than the store.
 *
 * Inserted rows are mapped with the Airtable `mapRow`, not a bespoke mapper: the
 * creator hands the writer the same Airtable-column-keyed field set
 * (`draftFields`) that `mapReportRecord` turns into a `reports` row in
 * production, and `mapRow` / `reportRowFromDb` are pinned field-for-field to
 * each other by tests/db/fleet-state.test.ts. So what a test reads back here is
 * the shape production reads back, and assertions stay written in the field
 * vocabulary a reviewer can check against the diff.
 *
 * The real store is exercised end to end against a temp `file:` libSQL database
 * in tests/reports/turso-native-report.e2e.test.ts.
 */
export type FakeReportWriter = ReportMirror & {
  /** Every record handed to `create` (the PRIMARY insert), in order. */
  inserts: Array<{ id: string; fields: Record<string, unknown> }>;
  /** Every record handed to the legacy Airtable-echo `created` mirror. */
  mirroredCreates: Array<{ id: string; fields: Record<string, unknown> }>;
  bodies: Array<{ id: string; html: string }>;
  patches: Array<{ id: string; patch: ReportMirrorPatch }>;
  /** What `forSite` answers with: the seeded rows plus every inserted one. */
  rows: ReportRow[];
};

export function makeFakeReportWriter(seed: ReportRow[] = []): FakeReportWriter {
  const inserts: FakeReportWriter["inserts"] = [];
  const mirroredCreates: FakeReportWriter["mirroredCreates"] = [];
  const bodies: FakeReportWriter["bodies"] = [];
  const patches: FakeReportWriter["patches"] = [];
  const rows: ReportRow[] = [...seed];

  return {
    inserts,
    mirroredCreates,
    bodies,
    patches,
    rows,
    create: async (rec) => {
      inserts.push({ id: rec.id, fields: { ...rec.fields } });
      const row = mapRow(rec);
      rows.push(row);
      return row;
    },
    created: async (rec) => {
      mirroredCreates.push({ id: rec.id, fields: { ...rec.fields } });
      rows.push(mapRow(rec));
    },
    forSite: async (siteId) => rows.filter((r) => r.siteId === siteId),
    body: async (id, html) => {
      bodies.push({ id, html });
    },
    patch: async (id, patch: ReportMirrorPatch) => {
      patches.push({ id, patch });
      // The queue flag is read back by the single-queue rule within the same run.
      const row = rows.find((r) => r.id === id);
      if (row && patch.draft_ready !== undefined) row.draftReady = patch.draft_ready === 1;
    },
  };
}
