import type { SubmissionRow } from "../reports/submission-row.js";
import { SUBMISSION_STATUSES, type SubmissionStatus } from "../reports/submission-row.js";
import { SUBMISSION_FORM_TYPES, type FormType } from "../forms/types.js";
import { siteSlug } from "../reports/airtable/websites.js";
import type { SubmissionFilter } from "../db/submissions.js";

export const PAGE_SIZE = 50;

export type RawFilter = {
  site: string;
  type: string;
  status: string;
  q: string;
  from: string;
  to: string;
};
export type ParsedQuery = {
  filter: SubmissionFilter;
  rawFilter: RawFilter;
  siteSlug: string;
  page: number;
};
export type SubmissionView = SubmissionRow & { siteName: string; slug: string };
export type SubmissionsPageModel = {
  rows: SubmissionView[];
  sites: Array<{ slug: string; name: string }>;
  filter: RawFilter; // active values, for repopulating the form
  page: number;
  pageSize: number;
  total: number;
};

function asFormType(v: string): FormType | undefined {
  return (SUBMISSION_FORM_TYPES as readonly string[]).includes(v) ? (v as FormType) : undefined;
}
function asStatus(v: string): SubmissionStatus | undefined {
  return (SUBMISSION_STATUSES as readonly string[]).includes(v)
    ? (v as SubmissionStatus)
    : undefined;
}

export function parseSubmissionsQuery(params: URLSearchParams): ParsedQuery {
  const site = params.get("site")?.trim() ?? "";
  const type = params.get("type")?.trim() ?? "";
  const status = params.get("status")?.trim() ?? "";
  const q = params.get("q")?.trim() ?? "";
  const from = params.get("from")?.trim() ?? "";
  const to = params.get("to")?.trim() ?? "";
  const pageRaw = Number.parseInt(params.get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const filter: SubmissionFilter = {};
  const ft = asFormType(type);
  if (ft !== undefined) filter.formType = ft;
  const st = asStatus(status);
  if (st !== undefined) filter.status = st;
  if (q) filter.search = q;
  if (from) filter.from = from;
  if (to) filter.to = `${to}T23:59:59.999Z`; // widen to end-of-day, inclusive

  return { filter, rawFilter: { site, type, status, q, from, to }, siteSlug: site, page };
}

export function buildSubmissionsPageModel(input: {
  rows: SubmissionRow[];
  total: number;
  sites: Array<{ id: string; name: string }>;
  filter: SubmissionFilter;
  rawFilter: RawFilter;
  page: number;
}): SubmissionsPageModel {
  const byId = new Map(input.sites.map((s) => [s.id, s] as const));
  const rows: SubmissionView[] = input.rows.map((r) => {
    const site = byId.get(r.siteId);
    return {
      ...r,
      siteName: site?.name ?? r.siteId,
      slug: site !== undefined ? siteSlug(site.name) : "",
    };
  });
  const sites = [...input.sites]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ slug: siteSlug(s.name), name: s.name }));
  return {
    rows,
    sites,
    filter: input.rawFilter,
    page: input.page,
    pageSize: PAGE_SIZE,
    total: input.total,
  };
}
