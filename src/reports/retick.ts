import type { WebsiteRow } from "./airtable/websites.js";
import type { ReportRow } from "./airtable/reports.js";
import { autoTickChecklist, type EvidenceRecord } from "./auto-tick.js";

const DRAFT_TIME_ONLY_FIELDS: ReadonlySet<string> = new Set(["Maint: Google Indexed"]);

export type RetickOutcome =
  | {
      status: "reticked";
      changed: string[];
      ticked: string[];
      checklist: Record<string, boolean>;
      autoEvidence: Record<string, EvidenceRecord>;
    }
  | { status: "unchanged" }
  | { status: "locked" };

function sameRecord(a: EvidenceRecord | undefined, b: EvidenceRecord): boolean {
  return (
    a !== undefined && a.result === b.result && a.checkedAt === b.checkedAt && a.note === b.note
  );
}

export function retickEvidence(site: WebsiteRow, report: ReportRow, now: Date): RetickOutcome {
  if (report.sentAt !== null || report.approvedToSend) return { status: "locked" };

  const stored = report.autoEvidence ?? {};
  const fresh = autoTickChecklist(site, report.reportType, now, {
    search: { value: null, softFailed: false, notConfigured: false },
  });

  const autoEvidence: Record<string, EvidenceRecord> = { ...stored };
  const changed: string[] = [];
  for (const [field, record] of fresh) {
    if (DRAFT_TIME_ONLY_FIELDS.has(field)) continue;
    if (sameRecord(stored[field], record)) continue;
    autoEvidence[field] = record;
    changed.push(field);
  }

  const checklist: Record<string, boolean> = { ...report.checklist };
  const ticked: string[] = [];
  for (const field of changed) {
    if (autoEvidence[field]!.result === "pass" && checklist[field] !== true) {
      checklist[field] = true;
      ticked.push(field);
    }
  }

  if (changed.length === 0) return { status: "unchanged" };
  return { status: "reticked", changed, ticked, checklist, autoEvidence };
}
