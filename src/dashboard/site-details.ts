import type { WebsiteRow } from "../reports/airtable/websites.js";

/** Status options the editor offers (the code Status union; rare Airtable values
 *  like "legacy" are set directly in Airtable, not from the dashboard). */
export const SITE_STATUS_OPTIONS = [
  "in development",
  "launch period",
  "maintenance",
  "hosting",
  "probably not our problem",
  "deprecated",
] as const;
export const FREQ_OPTIONS = ["None", "Monthly", "Quarterly", "Yearly"] as const;

type FieldKind = "text" | "email" | "emails" | "enum" | "gitrepo";
export type EditableField = {
  column: string;
  kind: FieldKind;
  options?: readonly string[];
  maxLen?: number;
};

/**
 * The ONLY columns the dashboard editor may write. `column` is the EXACT Airtable
 * field name (note the lowercase / em-dash / misspelled ones), kept in lockstep
 * with `mapRow` in src/reports/airtable/websites.ts.
 */
export const EDITABLE_SITE_FIELDS: Record<string, EditableField> = {
  pointOfContact: { column: "point of contact", kind: "email" },
  reportRecipientsTo: { column: "Report recipients (To)", kind: "emails" },
  reportRecipientsCc: { column: "Report recipients (CC)", kind: "emails" },
  copyIntro: { column: "Copy — Intro", kind: "text", maxLen: 2000 },
  copyContact: { column: "Copy — Contact", kind: "text", maxLen: 2000 },
  copyFooter: { column: "Copy — Footer", kind: "text", maxLen: 2000 },
  searchQuery: { column: "Search query", kind: "text", maxLen: 500 },
  ga4PropertyId: { column: "GA4 property ID", kind: "text", maxLen: 500 },
  gitRepo: { column: "Git repo", kind: "gitrepo" },
  status: { column: "Status", kind: "enum", options: SITE_STATUS_OPTIONS },
  maintenanceFreq: { column: "maintenence freq", kind: "enum", options: FREQ_OPTIONS },
  testingFreq: { column: "testing freq", kind: "enum", options: FREQ_OPTIONS },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** `owner/repo` shape. Exported for other dashboard surfaces that consume the
 *  legacy free-text `Git repo` cell (e.g. trigger-renovate). */
export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/**
 * Validate/normalize a raw value for a field kind. Returns the string to write, or
 * `null` when invalid. Empty (after trim) is allowed — it clears the cell — for
 * every kind EXCEPT `enum`, which must be one of its options.
 */
export function normalizeFieldValue(f: EditableField, raw: string): string | null {
  const v = raw.trim();
  // Hard upper bound across every kind (text additionally enforces its own
  // tighter maxLen below) — a single absurdly long value can't reach Airtable.
  if (v.length > 2000) return null;
  switch (f.kind) {
    case "enum":
      return f.options!.includes(v) ? v : null;
    case "email":
      return v === "" ? "" : EMAIL_RE.test(v) ? v : null;
    case "emails": {
      if (v === "") return "";
      const parts = v
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return parts.every((p) => EMAIL_RE.test(p)) ? parts.join(", ") : null;
    }
    case "gitrepo":
      return v === "" ? "" : REPO_RE.test(v) ? v : null;
    case "text":
      return v.length <= (f.maxLen ?? 500) ? v : null;
  }
}

/** Injected IO — the `.mts` binds these to a live Airtable base; tests bind fakes. */
export type SiteDetailDeps = {
  getSite: (slug: string) => Promise<WebsiteRow | null>;
  updateField: (recordId: string, column: string, value: string) => Promise<void>;
};

export type SiteDetailResult =
  | { status: "updated"; slug: string; field: string }
  | { status: "bad-field"; slug: string; field: string }
  | { status: "invalid"; slug: string; field: string }
  | { status: "not-found"; slug: string };

/**
 * Write one allowlisted site-detail field from the dashboard editor.
 *
 * SAFETY: an unknown `field` is rejected BEFORE any read (a hand-crafted authed
 * POST can never write an arbitrary Airtable column), and the value is
 * validated/normalized per kind before the write — invalid input never reaches
 * Airtable.
 */
export async function setSiteDetail(
  deps: SiteDetailDeps,
  slug: string,
  field: string,
  rawValue: string,
): Promise<SiteDetailResult> {
  const f = EDITABLE_SITE_FIELDS[field];
  if (!f) return { status: "bad-field", slug, field };
  const value = normalizeFieldValue(f, rawValue);
  if (value === null) return { status: "invalid", slug, field };
  const site = await deps.getSite(slug);
  if (!site) return { status: "not-found", slug };
  await deps.updateField(site.id, f.column, value);
  return { status: "updated", slug, field };
}
