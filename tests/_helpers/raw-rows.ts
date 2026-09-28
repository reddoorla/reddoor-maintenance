import {
  mapRow as mapWebsiteRecord,
  type WebsiteRow,
} from "../../src/reports/airtable/websites.js";
import { mapRow as mapReportRecord, type ReportRow } from "../../src/reports/airtable/reports.js";

export type RawRow = { id: string; fields: Record<string, unknown> };

export function websiteRowsFrom(records: RawRow[]): WebsiteRow[] {
  return records.map(mapWebsiteRecord);
}

export function reportRowsFrom(records: RawRow[]): ReportRow[] {
  return records.map(mapReportRecord);
}
