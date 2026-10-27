import { mapRow as mapWebsiteRecord, type WebsiteRow } from "../../src/fleet/site-fields.js";
import { mapRow as mapReportRecord, type ReportRow } from "../../src/reports/report-fields.js";

export type RawRow = { id: string; fields: Record<string, unknown> };

export function websiteRowsFrom(records: RawRow[]): WebsiteRow[] {
  return records.map(mapWebsiteRecord);
}

export function reportRowsFrom(records: RawRow[]): ReportRow[] {
  return records.map(mapReportRecord);
}
