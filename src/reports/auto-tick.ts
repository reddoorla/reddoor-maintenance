import type { ReportType } from "./types.js";
import type { WebsiteRow } from "./airtable/websites.js";
import type { SearchPresence } from "./search/client.js";
import { checklistFor } from "./checklist.js";
import { isNetlifyAppUrl } from "../util/url.js";

/** A persisted audit signal is only trusted within this window — a stale "pass" degrades to
 *  "unknown" (no tick). Matches the github-signals staleness convention (~3 days). */
const STALE_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True when `checkedAt` is a valid timestamp within STALE_DAYS of `now`. */
function isFresh(checkedAt: string | null, now: Date): boolean {
  if (!checkedAt) return false;
  const t = new Date(checkedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t <= STALE_DAYS * MS_PER_DAY;
}

/** Cert-expiry buffer: a cert must have MORE than this many days left to pass (renew window).
 *  Exactly 14 days does NOT pass — matches the spec's strict ">14 days" and the domain audit's
 *  own `> 14` pass status, so the two thresholds can't drift. */
const CERT_MIN_DAYS = 14;

/** A single auto-check outcome. `pass` + fresh ⇒ the caller ticks the box. */
export type EvidenceResult = "pass" | "fail" | "unknown";
export type EvidenceRecord = { result: EvidenceResult; checkedAt: string | null; note: string };

/**
 * Inline signals fetched during the draft. Phase 1 carries Search Console only; Phase 2/3 read
 * the remaining signals (security, domain, browser) off the Websites row passed as `site`.
 */
export type AutoTickSignals = {
  search: { value: SearchPresence | null; softFailed: boolean };
};

/**
 * Decide, per checklist item for this report type, an evidence record — ONLY for items that
 * currently have a signal. Items with no signal are omitted, so the caller leaves them manual.
 * PURE. The fail-safe invariant lives here: a box is only tickable when `result === "pass"`.
 * Google Indexed is an inline signal (fetched at draft), so its evidence is inherently fresh
 * (`checkedAt = now`).
 */
export function autoTickChecklist(
  site: WebsiteRow,
  reportType: ReportType,
  now: Date,
  signals: AutoTickSignals,
): Map<string, EvidenceRecord> {
  const out = new Map<string, EvidenceRecord>();
  const fields = new Set(checklistFor(reportType).map((i) => i.field));

  // Google Indexed — Search Console (inline, always fresh).
  if (fields.has("Maint: Google Indexed")) {
    const g = googleEvidence(now, signals.search);
    if (g) out.set("Maint: Google Indexed", g);
  }

  // Domain, DNS & SSL — the nightly `domain` audit's persisted cert/resolve signal.
  if (fields.has("Maint: Domain, DNS & SSL")) {
    const d = domainEvidence(site, now);
    if (d) out.set("Maint: Domain, DNS & SSL", d);
  }

  return out;
}

/** Search Console → Google Indexed evidence. `null` (not configured) emits nothing so the box
 *  stays manual; a soft-fail is `unknown`; page-1 is `pass` (with the position in the note). */
function googleEvidence(now: Date, search: AutoTickSignals["search"]): EvidenceRecord | null {
  const at = now.toISOString();
  if (search.softFailed) {
    return { result: "unknown", checkedAt: at, note: "Search Console unavailable this run" };
  }
  if (search.value === null) return null;
  if (search.value.foundOnPage1) {
    const pos = search.value.position;
    return {
      result: "pass",
      checkedAt: at,
      note: `Page 1 on Google${pos !== null ? ` (#${pos})` : ""}`,
    };
  }
  const pos = search.value.position;
  return {
    result: "fail",
    checkedAt: at,
    note: `Not on page 1${pos !== null ? ` (avg #${pos})` : ""}`,
  };
}

/**
 * Domain/DNS/SSL evidence from the persisted `domain` audit. Omits (→ manual) when there's no
 * custom domain to verify (`*.netlify.app`) or the audit never ran. A `pass` requires a fresh
 * check that resolved with a cert comfortably before expiry; stale → unknown; resolved-but-no-cert
 * or near/past expiry → fail. The honest scope is resolve + valid cert — NOT registrar expiry,
 * www↔apex redirect, or MX.
 */
function domainEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  // No custom domain to verify — the no-domain watch signal covers `*.netlify.app` elsewhere.
  if (!site.url || isNetlifyAppUrl(site.url)) return null;
  if (!site.domainCheckedAt) return null; // never probed → leave manual
  const at = site.domainCheckedAt;
  if (!isFresh(site.domainCheckedAt, now)) {
    return { result: "unknown", checkedAt: at, note: "Domain check is stale (>3d)" };
  }
  const days = site.certDaysRemaining;
  if (days === null) {
    return { result: "fail", checkedAt: at, note: "Did not resolve, or no valid TLS cert" };
  }
  if (days <= CERT_MIN_DAYS) {
    return { result: "fail", checkedAt: at, note: `TLS cert expires in ${days}d` };
  }
  return { result: "pass", checkedAt: at, note: `Custom domain, valid cert (${days}d left)` };
}
