import type { WebsiteRow } from "../reports/airtable/websites.js";
import { parseNotifyRouting } from "../reports/airtable/websites.js";
import { CANONICAL_STATUSES, toAirtableStatus } from "../reports/airtable/site-status.js";
import type { AirtableCellValue } from "../reports/airtable/websites.js";
import { isHttpUrl } from "../util/url.js";

/**
 * Status options the editor offers, expressed as the values Airtable actually
 * STORES — this dropdown writes straight into the "Status" single-select, so its
 * options must be options that column accepts.
 *
 * Since stage 3 (the retired option names deleted from the field, the alias map
 * deleted from the code) these ARE the canonical names, and `toAirtableStatus`
 * is the identity — so this list is exactly the six options the column holds.
 *
 * `render.ts` still preselects against `site.statusRaw` rather than
 * `site.status`. Those two now coincide for every value the single-select can
 * hold, so the distinction is dormant rather than load-bearing; it is kept
 * because the placeholder behaviour it produces — an unrecognized cell shows the
 * disabled "— select —" instead of being silently re-labelled — is what should
 * happen if a stale value ever reappears.
 */
export const SITE_STATUS_OPTIONS: readonly string[] = CANONICAL_STATUSES.map(toAirtableStatus);
export const FREQ_OPTIONS = ["None", "Monthly", "Quarterly", "Yearly"] as const;

/**
 * The options the live `Accepted Watch Conditions` multi-select carries, read
 * off the base schema on 2026-08-25.
 *
 * Spelled out rather than derived, because the API CANNOT add an option to a
 * select — a PATCH with new choices returns 422, proven during the status
 * migration — so offering a value this field does not have would produce a write
 * Airtable rejects. The records API would create one as a `typecast` side
 * effect; that is the silent-option-creation hazard this codebase refuses
 * everywhere, and it is why an unknown condition is rejected rather than sent.
 *
 * KNOWN GAP, operator-owned: `fleet-cockpit.ts` also supports a
 * `turnstile-unverified` accept key, and this field has no option for it — so
 * that one condition cannot be accepted from the console. Adding the option is a
 * UI action in Airtable; nothing here can do it.
 */
export const WATCH_CONDITION_OPTIONS: readonly string[] = [
  "Performance",
  "Accessibility",
  "Best Practices",
  "SEO",
  "stale repo",
  "no custom domain",
] as const;

type FieldKind =
  | "text"
  | "email"
  | "emails"
  | "enum"
  | "gitrepo"
  | "url"
  | "date"
  | "notifyRouting"
  | "bool"
  | "multiselect"
  | "secret";
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
  // The site's own address, and the target EVERY deployed audit drives: the
  // inventory exposes it as `Site.deployedUrl` (src/inventory/airtable.ts), so
  // function-health, lighthouse, browser, domain and form-e2e all resolve
  // against it. It was writable only at creation (`ensure-site`), and the #643
  // freeze retired Airtable hand-editing — which left a site that MOVED with no
  // way to be corrected anywhere. Found on vida-legacy-foundation, whose row
  // still pointed at a hostname that 404s, so every audit that ran against it
  // was measuring nothing. `kind: "url"` applies the same scheme allowlist the
  // audit target itself uses.
  url: { column: "url", kind: "url" },
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
  // #539 Phase 4 — the fields the design lists as "the eight nothing renders
  // today". Kinds follow the LIVE Airtable column types, read off the base
  // schema rather than inferred from the reader: `maintenance day`/`testing day`
  // are `date`, `Notify Routing` is `multilineText` holding JSON, the rest are
  // `singleLineText`. All seven are string-valued, which is why they need no
  // change to `updateSiteField`. `Require Turnstile` (checkbox) and `Accepted
  // Watch Conditions` (multipleSelects) are NOT here — they cannot be written as
  // strings and need a typed writer first.
  //
  // `Mailchimp API Key` is deliberately absent too: it is a live credential, and
  // every field in this map is rendered back into the page carrying its stored
  // value (see `inputRow` in render.ts). It needs a write-only kind first.
  netlifyId: { column: "Netlify ID", kind: "text", maxLen: 200 },
  searchConsoleProperty: { column: "Search Console property", kind: "text", maxLen: 500 },
  mailchimpAudienceId: { column: "Mailchimp Audience ID", kind: "text", maxLen: 200 },
  newsletterWebhook: { column: "Newsletter Webhook", kind: "url" },
  maintenanceDay: { column: "maintenance day", kind: "date" },
  testingDay: { column: "testing day", kind: "date" },
  notifyRouting: { column: "Notify Routing", kind: "notifyRouting" },
  // The two non-text columns. They write a boolean and a string[] respectively,
  // which is why `updateSiteField` and `mirrorSiteField` take AirtableCellValue.
  requireTurnstile: { column: "Require Turnstile", kind: "bool" },
  acceptedWatchConditions: {
    column: "Accepted Watch Conditions",
    kind: "multiselect",
    options: WATCH_CONDITION_OPTIONS,
  },
  // A live credential. `secret` is what makes it safe to list here at all: the
  // renderer emits no value for it, and an empty submission leaves the stored
  // key alone instead of clearing it.
  mailchimpApiKey: { column: "Mailchimp API Key", kind: "secret", maxLen: 200 },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar day in `YYYY-MM-DD`, not merely a parseable one.
 *
 * `new Date("2026-02-31")` does not throw — it rolls over to 2 March. These
 * columns feed the next-due schedule, so accepting a rolled-over day would
 * silently reschedule a site to a date the operator never chose. The round-trip
 * comparison below is what rejects it: a day that rolled is not the day that
 * went in.
 */
function isCalendarDate(v: string): boolean {
  if (!ISO_DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
/** `owner/repo` shape. Exported for other dashboard surfaces that consume the
 *  legacy free-text `Git repo` cell (e.g. trigger-renovate). */
export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/**
 * Validate/normalize a raw value for a field kind. Returns the string to write, or
 * `null` when invalid. Empty (after trim) is allowed — it clears the cell — for
 * every kind EXCEPT `enum`, which must be one of its options.
 */
export function normalizeFieldValue(f: EditableField, raw: string): AirtableCellValue | null {
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
    case "url":
      // The SAME scheme allowlist the deployed-audit target uses. This value is
      // fetched server-side by the newsletter forwarder, so a `file://` or
      // `javascript:` cell is a local-file read or an injection sink, not a typo.
      return v === "" ? "" : isHttpUrl(v) ? v : null;
    case "date":
      return v === "" ? "" : isCalendarDate(v) ? v : null;
    case "notifyRouting":
      // Validated by the PRODUCTION reader, not by a second parser written to
      // agree with it. `parseNotifyRouting` returns null for anything it would
      // drop, so the editor cannot store a value that reads back as "no
      // routing" — which would look like a saved change while every form
      // notification kept going to the previous target.
      return v === "" ? "" : parseNotifyRouting(v) !== null ? v : null;
    case "bool":
      // A checkbox has no empty state, so "" is a malformed request rather than
      // a clear. Exactly two accepted spellings — anything else is refused
      // instead of guessed at, since guessing wrong here silently turns a site's
      // spam protection off.
      return v === "true" ? true : v === "false" ? false : null;
    case "multiselect": {
      if (v === "") return [];
      const parts = v
        .split(/[,\n]/)
        .map((x) => x.trim())
        .filter(Boolean);
      return parts.every((p) => f.options!.includes(p)) ? parts : null;
    }
    case "secret":
      // NOTE the caller contract: `""` here means "leave unchanged", and
      // `setSiteDetail` turns it into a no-op rather than a write. Every other
      // kind clears on empty; this one must not, because the field renders blank
      // on every page load (its value is never sent to the browser), so
      // clear-on-empty would let any unrelated save destroy a working key.
      return v.length <= (f.maxLen ?? 500) ? v : null;
    case "text":
      return v.length <= (f.maxLen ?? 500) ? v : null;
  }
}

/** Injected IO — the `.mts` binds these to a live Airtable base; tests bind fakes. */
export type SiteDetailDeps = {
  getSite: (slug: string) => Promise<WebsiteRow | null>;
  updateField: (recordId: string, column: string, value: AirtableCellValue) => Promise<void>;
};

/** Typed into a `secret` field to ERASE it. A sentinel rather than a new
 *  control, because the secret input already fires its save listener on any
 *  keystroke — so clearing needs no change to the inline dashboard script, the
 *  one part of this page no test has ever executed (#591 shipped broken there).
 *
 *  Underscore-wrapped and lowercase so it cannot collide with a real key: every
 *  credential this field holds is a provider-issued token. */
export const CLEAR_SECRET = "__clear__";

export type SiteDetailResult =
  | { status: "updated"; slug: string; field: string }
  /** A `secret` field explicitly erased via the CLEAR_SECRET sentinel. Distinct
   *  from `updated` so the console can say "cleared" rather than implying a new
   *  value was stored. */
  | { status: "cleared"; slug: string; field: string }
  /** A `secret` field submitted empty: nothing was written, deliberately. */
  | { status: "unchanged"; slug: string; field: string }
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
  // A blank secret is "I did not change this", not "erase it" — the input is
  // rendered without a value, so it is blank on every load. Returning before the
  // read means an accidental save cannot even touch the record.
  if (f.kind === "secret" && value === "") return { status: "unchanged", slug, field };
  // ...which left NO way to clear one from the console. Airtable was the escape
  // hatch, and the freeze removes it (#612), so clearing needs its own explicit
  // gesture. A typed sentinel rather than a new control: the secret input is the
  // one field whose blur listener already fires on any keystroke (it renders
  // with no value, so anything typed differs from its default), so this needs no
  // change to the inline dashboard script — which no test executes.
  if (f.kind === "secret" && value === CLEAR_SECRET) {
    const target = await deps.getSite(slug);
    if (!target) return { status: "not-found", slug };
    await deps.updateField(target.id, f.column, "");
    return { status: "cleared", slug, field };
  }
  const site = await deps.getSite(slug);
  if (!site) return { status: "not-found", slug };
  await deps.updateField(site.id, f.column, value);
  return { status: "updated", slug, field };
}
