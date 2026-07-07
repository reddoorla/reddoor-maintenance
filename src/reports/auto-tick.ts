import type { ReportType } from "./types.js";
import type { WebsiteRow } from "./airtable/websites.js";
import type { SearchPresence } from "./search/client.js";
import { checklistFor, gatingFields } from "./checklist.js";
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
export type EvidenceResult = "pass" | "fail" | "unknown" | "n/a";
export type EvidenceRecord = { result: EvidenceResult; checkedAt: string | null; note: string };

/**
 * Inline signals fetched during the draft. Phase 1 carries Search Console only; Phase 2/3 read
 * the remaining signals (security, domain, browser) off the Websites row passed as `site`.
 */
export type AutoTickSignals = {
  search: { value: SearchPresence | null; softFailed: boolean };
};

/**
 * Decide, per checklist item for this report type, an evidence record. PURE. The fail-safe
 * invariant lives here: a box is only tickable when `result === "pass"`. Google Indexed is an
 * inline signal (fetched at draft), so its evidence is inherently fresh (`checkedAt = now`).
 *
 * The semantic inversion: every GATING item for this report type gets a status even with no
 * signal — a never-measured gating item resolves to `unknown` (which blocks the send gate), not
 * an omission the caller could read as "manual/OK". Only non-gating (advisory) items keep the old
 * omit-when-absent behavior, so an unconfigured advisory check stays silently manual.
 */
export function autoTickChecklist(
  site: WebsiteRow,
  reportType: ReportType,
  now: Date,
  signals: AutoTickSignals,
): Map<string, EvidenceRecord> {
  const out = new Map<string, EvidenceRecord>();
  const gating = new Set(gatingFields(reportType));

  for (const item of checklistFor(reportType)) {
    let ev: EvidenceRecord | null;
    switch (item.field) {
      case "Maint: Google Indexed":
        ev = googleEvidence(now, signals.search);
        break;
      case "Maint: Deploy & Function Health":
        ev = deployEvidence(site, now);
        break;
      case "Maint: CMS Checked":
        ev = cmsEvidence(site, now);
        break;
      case "Maint: Domain, DNS & SSL":
        ev = domainEvidence(site, now);
        break;
      case "Maint: Security Updates":
        ev = securityEvidence(site, now);
        break;
      case "Maint: Uptime Checked":
        ev = uptimeEvidence(site, now);
        break;
      case "Test: Desktop Browsers":
        ev = browserEvidence(
          site.crossbrowserOk,
          site,
          now,
          "Desktop renders cleanly",
          "render errors",
        );
        break;
      case "Test: Mobile Browsers":
        ev = browserEvidence(site.mobileOk, site, now, "Mobile renders cleanly", "overflow/errors");
        break;
      case "Test: Page Titles & Meta":
        ev = titlesEvidence(site, now);
        break;
      case "Test: Links & Navigation": {
        const broken = site.brokenLinks;
        const failNote = broken && broken > 0 ? `${broken} broken link(s)` : "broken links / nav";
        ev = browserEvidence(site.linksOk, site, now, "All internal links resolve", failNote);
        break;
      }
      case "Test: Form Functionality":
        ev = formsEvidence(site, now);
        break;
      case "Test: Interactions & Animations":
        ev = interactionsEvidence(site, now);
        break;
      case "Test: Verified After Updates":
        ev = updatesEvidence(site, now);
        break;
      default:
        ev = null;
    }
    // The semantic inversion: a GATING item with no fresh signal must still carry a status —
    // `unknown` (blocks) — so an unwired/absent signal can never leave the gate silently
    // passable. Advisory items (e.g. Google Indexed on a Maintenance report) keep the old
    // omit-when-absent behavior.
    if (ev === null && gating.has(item.field)) {
      ev = { result: "unknown", checkedAt: null, note: "Not yet measured" };
    }
    if (ev !== null) out.set(item.field, ev);
  }

  return out;
}

/** One browser-audit verdict (Desktop/Mobile/Links) → evidence, gated on `Browser checked at`
 *  freshness. null verdict (never run) → omit (manual); stale → unknown; true → pass; false →
 *  fail (with the failure note). The verdict itself was computed by the audit (summarizeBrowser). */
function browserEvidence(
  ok: boolean | null,
  site: WebsiteRow,
  now: Date,
  passNote: string,
  failNote: string,
): EvidenceRecord | null {
  if (ok === null || !site.browserCheckedAt) return null;
  const at = site.browserCheckedAt;
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "Browser check is stale (>3d)" };
  }
  return ok
    ? { result: "pass", checkedAt: at, note: passNote }
    : { result: "fail", checkedAt: at, note: failNote };
}

/**
 * Security Updates evidence from the persisted `security` audit. Omits (→ manual) when the audit
 * never ran (counts null / no timestamp); stale → unknown; 0 critical AND 0 high → pass; any
 * critical/high → fail (with the count). Honest scope: "no known critical/high advisories in the
 * declared dependencies as of the last audit" — moderate/low are advisory, not gating, and this
 * does not prove the fix is deployed.
 */
function securityEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  const crit = site.securityVulnsCritical;
  const high = site.securityVulnsHigh;
  if (crit === null || high === null || !site.lastSecurityAuditAt) return null;
  const at = site.lastSecurityAuditAt;
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "Security audit is stale (>3d)" };
  }
  if (crit === 0 && high === 0) {
    return { result: "pass", checkedAt: at, note: "No known critical/high vulnerabilities" };
  }
  return { result: "fail", checkedAt: at, note: `${crit} critical / ${high} high vuln(s)` };
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

/**
 * Deploy & Function Health: the Netlify build is `ready` AND the deployed function responds
 * healthy. Two freshness stamps must both be fresh (deploy check + function-health check). Never
 * measured → null (omit → the gating dispatch coerces to unknown); either stale → unknown; both
 * fresh + ready + fn pass → pass; otherwise fail.
 *
 * Exported (not module-private) so it can be exercised directly in unit tests ahead of the
 * `autoTickChecklist` dispatch wiring landing in a follow-up task.
 */
export function deployEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (!site.deployCheckedAt && !site.functionHealthCheckedAt) return null;
  if (!isFresh(site.deployCheckedAt, now) || !isFresh(site.functionHealthCheckedAt, now)) {
    return {
      result: "unknown",
      checkedAt: site.functionHealthCheckedAt ?? site.deployCheckedAt,
      note: "Deploy/function-health check is stale (>3d)",
    };
  }
  const ready = site.deployStatus === "ready";
  const fnOk = site.functionHealth === "pass";
  if (ready && fnOk) {
    return {
      result: "pass",
      checkedAt: site.functionHealthCheckedAt,
      note: "Netlify build ready + functions respond",
    };
  }
  const why =
    !ready && !fnOk
      ? "build not ready + functions unhealthy"
      : !ready
        ? "build not ready"
        : "functions unhealthy";
  return {
    result: "fail",
    checkedAt: site.functionHealthCheckedAt,
    note: `Deploy/function-health failing — ${why}`,
  };
}

/**
 * CMS Checked: the server-side `/health` Prismic probe reported reachable. Freshness rides the
 * function-health check stamp (one `/health` fetch feeds both Deploy and CMS). Never measured →
 * null; stale → unknown; pass/fail mirror the stored verdict; a fresh stamp with no verdict →
 * unknown.
 */
export function cmsEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (!site.functionHealthCheckedAt) return null;
  const at = site.functionHealthCheckedAt;
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "CMS check is stale (>3d)" };
  }
  if (site.cmsReachable === "pass") {
    return { result: "pass", checkedAt: at, note: "Prismic reachable (server-side)" };
  }
  if (site.cmsReachable === "fail") {
    return { result: "fail", checkedAt: at, note: "Prismic unreachable (server-side)" };
  }
  return { result: "unknown", checkedAt: at, note: "CMS reachability not reported" };
}

/**
 * Uptime Checked: every sampled route returned 2xx/3xx on the browser audit (point-in-time).
 * Freshness rides the shared `browserCheckedAt`. Never ran → null; stale → unknown.
 */
export function uptimeEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (site.reachableOk === null || !site.browserCheckedAt) return null;
  const at = site.browserCheckedAt;
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "Uptime check is stale (>3d)" };
  }
  return site.reachableOk === "pass"
    ? { result: "pass", checkedAt: at, note: "All sampled routes reachable (point-in-time)" }
    : { result: "fail", checkedAt: at, note: "One or more sampled routes did not respond 2xx/3xx" };
}

/**
 * Page Titles & Meta: every sampled route had a non-empty title + meta description with no
 * duplicate titles (browser audit, chromium). Freshness rides `browserCheckedAt`.
 */
export function titlesEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (site.titleMetaOk === null || !site.browserCheckedAt) return null;
  const at = site.browserCheckedAt;
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "Titles/meta check is stale (>3d)" };
  }
  return site.titleMetaOk === "pass"
    ? { result: "pass", checkedAt: at, note: "Titles + meta present" }
    : {
        result: "fail",
        checkedAt: at,
        note: "Missing/duplicate title or missing meta description",
      };
}

/**
 * Form Functionality: a synthetic prod submission succeeded (form-e2e audit). `n/a` when the audit
 * ran (checked-at stamp set) but the site has no contact form (verdict cleared to null). Never ran
 * (no stamp) → null; stale → unknown.
 */
export function formsEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (!site.formE2eCheckedAt) return null;
  const at = site.formE2eCheckedAt;
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "Form E2E check is stale (>3d)" };
  }
  if (site.formE2eOk === "pass") {
    return { result: "pass", checkedAt: at, note: "Synthetic submission succeeded" };
  }
  if (site.formE2eOk === "fail") {
    return { result: "fail", checkedAt: at, note: "Synthetic submission failed" };
  }
  return { result: "n/a", checkedAt: at, note: "No contact form on this site" };
}

/**
 * Interactions & Animations: the per-site smoke suite is green. Freshness rides `lastSmokeAt`.
 * Never ran → null; stale → unknown.
 */
export function interactionsEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (site.smokeOk === null || !site.lastSmokeAt) return null;
  const at = site.lastSmokeAt;
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "Smoke suite is stale (>3d)" };
  }
  return site.smokeOk === "pass"
    ? { result: "pass", checkedAt: at, note: "Smoke suite green" }
    : { result: "fail", checkedAt: at, note: "Smoke suite red" };
}

/**
 * Tested After Updates: default-branch CI is green on the latest commit (github-signals). A repo
 * with no CI (`defaultBranchCi === "none"`) is `n/a`. Never swept (null / no stamp) → null; stale
 * → unknown; passing → pass; failing → fail; pending → unknown.
 */
export function updatesEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (site.defaultBranchCi === null || !site.githubSignalsAt) return null;
  const at = site.githubSignalsAt;
  if (site.defaultBranchCi === "none") {
    return { result: "n/a", checkedAt: at, note: "Repository has no CI" };
  }
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "CI signal is stale (>3d)" };
  }
  if (site.defaultBranchCi === "passing") {
    return { result: "pass", checkedAt: at, note: "Default-branch CI green on latest commit" };
  }
  if (site.defaultBranchCi === "failing") {
    return { result: "fail", checkedAt: at, note: "Default-branch CI is failing" };
  }
  return { result: "unknown", checkedAt: at, note: "Default-branch CI is pending" };
}
