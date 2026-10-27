import type { AuditName, AuditResult } from "../types.js";
import type { HealthMirror } from "./health-mirror.js";
import {
  type AuditFieldInputs,
  type WebsiteRow,
  auditFields,
  siteSlug,
  type FieldSet,
} from "../fleet/site-fields.js";
import {
  hasRealScores,
  lighthouseFailingAuditsFromResult,
  lighthouseScoresFromResult,
  missingLighthouseCategories,
  LIGHTHOUSE_CATEGORIES,
} from "./lighthouse-fields.js";
import { hasA11yCounts, a11yCountsFromResult } from "./a11y-fields.js";
import { hasDepsCounts, depsCountsFromResult } from "./deps-fields.js";
import {
  hasSecurityCounts,
  isPartialSecurityResult,
  lockfileAuditFromResult,
  securityCountsFromResult,
  advisoriesFromResult,
} from "./security-fields.js";
import { mergeWithStoredLockfileAudit } from "./security.js";
import { hasDomainResult, domainResultFromAudit } from "./domain-fields.js";
import { hasBrowserResult, browserFieldsFromAudit } from "./browser-fields.js";
import { hasNetlifyDeployResult, netlifyDeployResultFromAudit } from "./netlify-deploy-fields.js";
import {
  hasFunctionHealthResult,
  functionHealthResultFromAudit,
} from "./function-health-fields.js";
import { hasSmokeResult, smokeResultFromAudit } from "./smoke-fields.js";
import { hasFormE2eResult, formE2eResultFromAudit } from "./form-e2e-fields.js";
import { detectAuditEvents } from "./fleet-event-detectors.js";
import type { FleetEvent } from "../db/fleet-events.js";

type WriteSummary = {
  siteName: string;
  writes: Array<{
    audit:
      | "lighthouse"
      | "a11y"
      | "deps"
      | "security"
      | "github-signals"
      | "domain"
      | "browser"
      | "netlify-deploy"
      | "function-health"
      | "smoke"
      | "form-e2e"
      // Not an audit: the nightly Prismic model sweep reuses this result shape so
      // its write-back reports through the same `FLEET_WRITE_SUMMARY` line every
      // other fleet writer emits, rather than inventing a second contract for CI
      // to grep.
      | "prismic-models";
    counts: object;
  }>;
  /** Fleet-activity events detected from this site's prior row vs the fresh audits.
   *  Optional: only the fleet path records them; the single-site path ignores them. */
  events?: FleetEvent[];
  /** The Websites row id + the merged FieldSet actually written — what the
   *  Turso write consumes. Populated by writeBackOneSite; other WriteSummary
   *  producers (prismic-models, github-signals) don't carry them. */
  siteId?: string;
  fields?: FieldSet;
};

/** Orchestrates the per-audit writes for `audit --write-back`.
 *  Extracted from the CLI command so it can be unit-tested
 *  and so adding new audit types is a one-line addition here rather than
 *  growing the CLI handler.
 *
 *  Throws (with .exitCode set) on the failure modes the CLI surfaces today:
 *   - 2: --only ran without lighthouse, or no Websites row matched the slug
 *   - 1: lighthouse ran but produced no real scores (infrastructure failure).
 *        The a11y/deps/security writes still complete FIRST — a Lighthouse
 *        miss flags the site without discarding its other audit data.
 *
 *  Precedence note: the Websites-row lookup (exitCode 2) is checked BEFORE the
 *  no-scores gate (exitCode 1), so the rare no-row + no-scores combo surfaces
 *  as exitCode 2. */
export type AuditWritePlan = {
  summary: WriteSummary;
  lighthouseMiss: Error | null;
  /** Requested audits that store a value but produced none this run and did not say they
   *  were not applicable (#1605): an install that failed, an unreadable lockfile, a runner
   *  that threw. Lighthouse is left out when `lighthouseMiss` already files the site. */
  unmeasured: Array<{ audit: AuditName; summary: string }>;
  /** Lighthouse categories missing from scores that otherwise landed, as
   *  `lighthouse.<category>` (#1609). Their written cells are null; the gate counts them. */
  missingCategories: string[];
  /** Lighthouse ran and its scores landed: the denominator for each category's share. */
  lighthouseScored: boolean;
};

/** The audits whose results land in `site_health`. An audit outside this set (lint) has
 *  nothing to write, so producing nothing is not a miss. */
const PERSISTED_AUDITS: ReadonlySet<AuditName> = new Set<AuditName>([
  "lighthouse",
  "a11y",
  "deps",
  "security",
  "domain",
  "browser",
  "netlify-deploy",
  "function-health",
  "smoke",
  "form-e2e",
]);

export function planAuditWrite(args: {
  websites: WebsiteRow[];
  slug: string;
  results: AuditResult[];
}): AuditWritePlan {
  const { websites, slug, results } = args;

  // Lighthouse is OPTIONAL. The checkout-free `--only lighthouse,domain,browser` nightly includes
  // it, but a standalone `--only security` (checkout-ful) sweep legitimately has none. We write
  // whatever audits produced values; only the lighthouse-MISS flag below is lighthouse-specific
  // (so a real Lighthouse infra failure still reds the run without discarding other audit data).
  const lhResult = results.find((r) => r.audit === "lighthouse");
  const target = websites.find((w) => siteSlug(w.name) === slug);
  if (!target) {
    throw Object.assign(new Error(`No Websites row matched slug "${slug}"`), { exitCode: 2 });
  }

  const writes: WriteSummary["writes"] = [];
  const audits: AuditFieldInputs = {};

  // Collect every audit that produced real values into ONE merged input, then do a
  // SINGLE atomic update (was: up to four sequential updates on the same
  // row — a mid-sequence failure left it half-written yet reported fully failed, at
  // 4× the request volume). Lighthouse is the most timeout-prone audit: a Lighthouse
  // miss must NOT discard the site's valid a11y/deps/security results (morning-brief
  // 2026-06-10 MEDIUM-E). So include Lighthouse scores only when real, include the
  // other audits whenever present, write all of them in one update, then — if
  // Lighthouse missed — throw AFTER that atomic write so the site is still flagged
  // (exitCode 1 / collected in FleetWriteResult.failed) without losing its other data.
  const lhHasScores = lhResult ? hasRealScores(lhResult) : false;
  if (lhResult && lhHasScores) {
    const scores = lighthouseScoresFromResult(lhResult);
    audits.scores = scores;
    const failingAudits = lighthouseFailingAuditsFromResult(lhResult);
    if (failingAudits !== undefined) audits.lighthouseFailingAudits = failingAudits;
    writes.push({ audit: "lighthouse", counts: scores });
  }

  const a11y = results.find((r) => r.audit === "a11y");
  if (a11y && hasA11yCounts(a11y)) {
    const counts = a11yCountsFromResult(a11y);
    audits.a11y = counts;
    writes.push({ audit: "a11y", counts });
  }

  const deps = results.find((r) => r.audit === "deps");
  if (deps && hasDepsCounts(deps)) {
    const counts = depsCountsFromResult(deps);
    audits.deps = counts;
    writes.push({ audit: "deps", counts });
  }

  const sec = results.find((r) => r.audit === "security");
  // A partial night (#1654) becomes the full night it stands for, or nothing.
  const secToWrite = sec && hasSecurityCounts(sec) ? securityResultToWrite(sec, target) : null;
  if (secToWrite) {
    const counts = securityCountsFromResult(secToWrite);
    audits.security = counts;
    // Persist the advisory list alongside the counts so the dashboard can show which packages
    // are vulnerable. An empty array (clean run) clears any stale list.
    audits.securityAdvisories = advisoriesFromResult(secToWrite);
    if (isPartialSecurityResult(secToWrite)) audits.securityPartial = true;
    const lockfileAudit = lockfileAuditFromResult(secToWrite);
    if (lockfileAudit !== undefined) audits.securityLockfileAudit = lockfileAudit;
    writes.push({ audit: "security", counts });
  }

  const dom = results.find((r) => r.audit === "domain");
  if (dom && hasDomainResult(dom)) {
    const result = domainResultFromAudit(dom);
    audits.domain = result;
    writes.push({ audit: "domain", counts: result });
  }

  const browser = results.find((r) => r.audit === "browser");
  if (browser && hasBrowserResult(browser)) {
    const fields = browserFieldsFromAudit(browser);
    audits.browser = fields;
    writes.push({ audit: "browser", counts: fields });
  }

  const netlifyDeploy = results.find((r) => r.audit === "netlify-deploy");
  if (netlifyDeploy && hasNetlifyDeployResult(netlifyDeploy)) {
    const result = netlifyDeployResultFromAudit(netlifyDeploy);
    audits.netlifyDeploy = result;
    writes.push({ audit: "netlify-deploy", counts: result });
  }

  const functionHealth = results.find((r) => r.audit === "function-health");
  if (functionHealth && hasFunctionHealthResult(functionHealth)) {
    const result = functionHealthResultFromAudit(functionHealth);
    audits.functionHealth = result;
    writes.push({ audit: "function-health", counts: result });
  }

  const smoke = results.find((r) => r.audit === "smoke");
  if (smoke && hasSmokeResult(smoke)) {
    const result = smokeResultFromAudit(smoke);
    audits.smoke = result;
    writes.push({ audit: "smoke", counts: result });
  }

  const formE2e = results.find((r) => r.audit === "form-e2e");
  if (formE2e && hasFormE2eResult(formE2e)) {
    const result = formE2eResultFromAudit(formE2e);
    audits.formE2e = result;
    writes.push({ audit: "form-e2e", counts: result });
  }

  // One atomic write of everything that ran. Skip the call only if there is nothing
  // to write at all (no real scores AND no other audit produced values) — an empty
  // update is a wasted request.
  const fields: FieldSet = Object.keys(audits).length > 0 ? auditFields(audits) : {};

  // Detect fleet-activity transitions from the prior row (`target`, loaded before this
  // write) vs the fresh audits. Computed here where both are in hand; recorded by the
  // caller (fleet path) — single-site callers simply ignore `events`.
  const events = detectAuditEvents(
    target,
    {
      ...(audits.security !== undefined ? { security: audits.security } : {}),
      ...(audits.domain !== undefined ? { domain: audits.domain } : {}),
    },
    new Date().toISOString(),
  );

  // Lighthouse-miss flag: only when lighthouse WAS requested (in results) but produced no scores —
  // an infra failure worth reding the run, AFTER persisting the other audits. A sweep that never
  // ran lighthouse (e.g. `--only security`) skips this entirely.
  let lighthouseMiss: Error | null = null;
  if (lhResult && !lhHasScores) {
    // Enumerate what WAS persisted so the failure (surfaced to the single-site
    // CLI operator via console.error) reads as a partial write, not a total one.
    const persisted = writes.map((w) => w.audit);
    lighthouseMiss = Object.assign(
      new Error(
        `Lighthouse audit produced no scores; ${
          persisted.length ? `wrote ${persisted.join("/")} but refused Lighthouse` : "wrote nothing"
        }. Summary: ${lhResult.summary}`,
      ),
      { exitCode: 1 },
    );
  }

  const wroteAudits = new Set(writes.map((w) => w.audit));
  const unmeasured = results
    .filter(
      (r) =>
        PERSISTED_AUDITS.has(r.audit) &&
        !wroteAudits.has(r.audit as WriteSummary["writes"][number]["audit"]) &&
        r.notApplicable !== true &&
        !(r.audit === "lighthouse" && lighthouseMiss),
    )
    .map((r) => ({ audit: r.audit, summary: r.summary }));
  // A partial night is written, but tonight's lockfile audit still measured nothing: the gate
  // keeps seeing it, so a fleet-wide pnpm or registry failure still reds the run (#1654).
  if (secToWrite && isPartialSecurityResult(secToWrite) && sec)
    unmeasured.push({ audit: "security", summary: sec.summary });

  return {
    summary: { siteName: target.name, writes, events, siteId: target.id, fields },
    lighthouseMiss,
    unmeasured,
    missingCategories:
      lhResult && lhHasScores
        ? missingLighthouseCategories(lhResult).map((c) => `lighthouse.${c}`)
        : [],
    lighthouseScored: lhHasScores,
  };
}

/** The security result to write for a site, or null to write none (#1654). A full night is
 *  written as it is. A partial night (the lockfile audit was needed but could not run) is merged
 *  with pnpm's own result from the last full night, by the same mergeAudits that night ran, so
 *  it reads as a full night would on tonight's alerts. With no stored result to merge with it
 *  writes nothing, as before #1654, except on a never-audited row, where there is nothing to
 *  lower and tonight's live alerts are the only known ones. */
function securityResultToWrite(sec: AuditResult, target: WebsiteRow): AuditResult | null {
  if (!isPartialSecurityResult(sec)) return sec;
  const stored = target.securityLockfileAudit;
  if (stored && !stored.truncated) {
    return mergeWithStoredLockfileAudit(sec, {
      counts: stored.counts,
      advisories: stored.advisories.map((a) => ({
        module: a.module,
        severity: a.severity,
        title: a.title,
        ...(a.cves.length > 0 ? { cves: a.cves } : {}),
        ...(a.url ? { url: a.url } : {}),
        ...(a.ghsa ? { ghsa: a.ghsa } : {}),
        ...(a.scope ? { scope: a.scope } : {}),
        ...(a.relationship ? { relationship: a.relationship } : {}),
      })),
    });
  }
  const neverAudited =
    target.securityVulnsCritical === null &&
    target.securityVulnsHigh === null &&
    target.securityVulnsModerate === null &&
    target.securityVulnsLow === null;
  const live = Object.values(securityCountsFromResult(sec)).some((n) => n > 0);
  return neverAudited && live ? sec : null;
}

/** Why a site's write built no field, or null when it built one (or Lighthouse missed,
 *  which throws on its own). One classification for both write-back paths (#1716): the
 *  fleet files these under `kept`, `notApplicable` and `failed`, and the single-site CLI
 *  prints the same three. */
export type EmptyWrite =
  | { kind: "kept"; reason: string }
  | { kind: "not-applicable" }
  | { kind: "nothing-measured"; reason: string };

export function emptyWriteOutcome(plan: AuditWritePlan, results: AuditResult[]): EmptyWrite | null {
  const { fields } = plan.summary;
  if ((!!fields && Object.keys(fields).length > 0) || plan.lighthouseMiss) return null;
  // Nothing to write is not a write (#1605). A site whose audits all said "not applicable"
  // is counted as such; one whose audits measured nothing is a failure, named by what each
  // audit said, and never `written` with its row still serving last month's verdict.
  // An audit that applied, ran and still had nothing to write kept the row's
  // verdicts (#1698); only a site whose every audit said n/a is not applicable.
  const ranEmpty = results.filter((r) => PERSISTED_AUDITS.has(r.audit) && r.notApplicable !== true);
  if (plan.unmeasured.length === 0 && ranEmpty.length > 0) {
    return { kind: "kept", reason: ranEmpty.map((r) => `${r.audit}: ${r.summary}`).join("; ") };
  }
  if (plan.unmeasured.length === 0) return { kind: "not-applicable" };
  return {
    kind: "nothing-measured",
    reason: plan.unmeasured.map((u) => `${u.audit}: ${u.summary}`).join("; "),
  };
}

export async function writeBackOneSite(args: {
  websites: WebsiteRow[];
  slug: string;
  results: AuditResult[];
  mirrorHealth: (siteId: string, fields: FieldSet) => Promise<unknown>;
}): Promise<WriteSummary & { empty?: EmptyWrite }> {
  const plan = planAuditWrite(args);
  const { siteId, fields } = plan.summary;
  if (siteId && fields) await args.mirrorHealth(siteId, fields);
  if (plan.lighthouseMiss) throw plan.lighthouseMiss;
  const empty = emptyWriteOutcome(plan, args.results);
  return empty ? { ...plan.summary, empty } : plan.summary;
}

export type FleetWriteResult = {
  written: WriteSummary[];
  failed: Array<{ slug: string; error: string }>;
  /** Turso write counts (#539 Phase 3). Present ONLY when a
   *  mirror was wired — absent means mirroring was not attempted (no libSQL
   *  creds), which must stay distinguishable from `mirrored=0` (a wired mirror
   *  that landed nothing = the fleet-wide outage alarm). */
  mirrored?: number;
  mirrorFailed?: number;
  /** Mirror UPDATEs that matched no site_health row. Every site creator
   *  inserts that row, so a miss is a defect; the site is also filed under
   *  `failed`. */
  mirrorMissed?: number;
  events?: FleetEvent[];
  /** Sites every one of whose audits said "not applicable here" (#1605): neither written nor
   *  failed, and counted in `total` so a skip by design is visible rather than absent. */
  notApplicable?: string[];
  /** Sites whose audits ran and applied but had nothing new to write, so every verdict
   *  the row holds was kept (#1698: a form-e2e probe refused because the site's /health
   *  could not be read). Neither written, failed nor not applicable; counted in `total`,
   *  named with each audit's reason. A night that wrote nothing is red, and its reason
   *  says how many sites were kept and why. */
  kept?: Array<{ slug: string; reason: string }>;
  /** Sites the run resolved before prep that reached write-back with no result at all:
   *  dropped at prep, or lost between audit and write (#1605). Present only when the caller
   *  passed `expectedSites`. */
  missing?: string[];
  /** Per audit, the sites where it measured nothing and did not say it was not applicable.
   *  A site can be written (lighthouse landed) while its browser audit measured nothing. */
  unmeasuredAudits?: Partial<Record<string, string[]>>;
  /** Per audit, the sites it applied to: requested and not marked not applicable. The
   *  denominator for that audit's share in the gate, so a fleet where most sites have no
   *  `test:smoke` script cannot dilute four blind adopters into a green run. */
  applicableAudits?: Partial<Record<string, string[]>>;
  /** Per audit, the sites whose result said "not applicable here" by design (no deployed
   *  URL, no form, no smoke suite), whether or not the site wrote other values. Printed so
   *  a by-design skip is counted rather than merely absent from the denominators. */
  notApplicableAudits?: Partial<Record<AuditName, string[]>>;
};

/** Did this sweep fail, for exit-code purposes (#612)?
 *
 *  Turso is the only store, so a mirror failure, a missed row and an ABSENT
 *  mirror are all fatal — the absent one is the easiest to misread as success:
 *  no counters at all means no mirror was wired, which means the sweep wrote
 *  nothing.
 *
 *  `writeFleetAudits` still catches per-site failures rather than
 *  throwing. One bad site must not abort a 44-site sweep. This gates the RUN,
 *  not the loop. */
export function fleetWriteFailed(result: FleetWriteResult): boolean {
  if (result.failed.length > 0) return true;
  return tursoWriteFailed(result);
}

export function tursoWriteFailed(result: FleetWriteResult): boolean {
  if (result.mirrored === undefined) return true; // no mirror was wired at all
  return (result.mirrorFailed ?? 0) > 0 || (result.mirrorMissed ?? 0) > 0;
}

/** `total` counts every site the run owed a write: written, failed, not applicable, and
 *  missing from write-back altogether. It used to be `wrote + failed`, the run's own count
 *  of itself, so a roster cut short or eight sites dropped at prep read as complete. */
function fleetWriteTotal(result: FleetWriteResult): number {
  return (
    result.written.length +
    result.failed.length +
    (result.notApplicable?.length ?? 0) +
    (result.kept?.length ?? 0) +
    (result.missing?.length ?? 0)
  );
}

/** A failure that recurs every night until someone changes a row: no `site_health` row, no
 *  site row for the slug, or (the Prismic sweep) several rows for it. The 25% tolerance
 *  exists for flakes, and one of these would otherwise warn forever while the job stays
 *  green (#1605). A per-site miss that only history could call permanent (one site's
 *  lockfile never readable) stays a warning: a single run cannot tell it from a flake. */
const PERMANENT_FAILURE =
  /^(no site_health row matched$|no Websites row matched|\d+ Websites rows match )/i;

function permanentFailures(result: FleetWriteResult): string[] {
  return result.failed.filter((f) => PERMANENT_FAILURE.test(f.error)).map((f) => f.slug);
}

export type FleetWriteGate = { red: boolean; reasons: string[]; warnings: string[] };

/** The kept sites grouped by what their audits said, each reason once with the
 *  sites that gave it (the first five of them), so a red line names its cause
 *  without repeating it for every site of the fleet. */
function keptList(kept: Array<{ slug: string; reason: string }>): string {
  const byReason = new Map<string, string[]>();
  for (const k of kept) byReason.set(k.reason, [...(byReason.get(k.reason) ?? []), k.slug]);
  return [...byReason]
    .map(([reason, slugs]) => {
      const more = slugs.length > 5 ? ` and ${slugs.length - 5} more` : "";
      return `${reason}: ${slugs.slice(0, 5).join(", ")}${more}`;
    })
    .join("; ");
}

/** The write gate's verdict, computed here rather than in five copies of workflow bash.
 *  The CLI's exit code cannot carry it: a site whose audit reports `fail` exits 1 by design,
 *  so every workflow runs the CLI under `|| true` and reads this verdict instead (#1605).
 *
 *  Red when nothing was written, when failed plus missing sites pass a quarter of the sites
 *  that had anything to measure, when any failure is permanent, or when one audit measured
 *  nothing on more than a quarter of the sites it applied to. Not-applicable sites are in
 *  `total` but in neither denominator. Anything below those lines is a warning, never
 *  silence. */
export function fleetWriteGate(result: FleetWriteResult): FleetWriteGate {
  const wrote = result.written.length;
  const failed = result.failed.length;
  const missing = result.missing ?? [];
  const total = fleetWriteTotal(result);
  const reasons: string[] = [];
  const warnings: string[] = [];

  const owed = total - (result.notApplicable?.length ?? 0);
  // A sweep where every site said "not applicable" established nothing either; it is
  // red, under its own name rather than as a write failure.
  const kept = result.kept ?? [];
  if (wrote === 0) {
    reasons.push(
      owed === 0 && total > 0
        ? `every one of ${total} site(s) was not applicable: nothing was measured`
        : kept.length > 0 && kept.length === owed
          ? `every one of ${owed} site(s) had nothing new to write and kept its verdicts — ${keptList(kept)}`
          : kept.length > 0
            ? `wrote 0 of ${total} site(s): ${kept.length} had nothing new to write and kept their verdicts — ${keptList(kept)}`
            : `wrote 0 of ${total} site(s)`,
    );
  }
  const short = failed + missing.length;
  if (short * 4 > owed) {
    reasons.push(`${short} of ${owed} site(s) not written or missing (>25%)`);
  } else {
    if (failed > 0) warnings.push(`${failed} of ${owed} site(s) not written`);
    if (missing.length > 0) {
      warnings.push(
        `${missing.length} of ${owed} site(s) never reached write-back: ${missing.join(", ")}`,
      );
    }
  }
  const permanent = permanentFailures(result);
  if (permanent.length > 0) {
    reasons.push(`${permanent.length} site(s) with no row to write to: ${permanent.join(", ")}`);
  }
  for (const [audit, sites] of Object.entries(result.unmeasuredAudits ?? {})) {
    if (!sites || sites.length === 0) continue;
    const of = result.applicableAudits?.[audit]?.length ?? total;
    // A dotted key is one Lighthouse category on sites whose other scores landed (#1609).
    const what = audit.includes(".") ? "missing on" : "measured nothing on";
    const line = `${audit} ${what} ${sites.length} of ${of} site(s): ${sites.join(", ")}`;
    if (sites.length * 4 > of) reasons.push(`${line} (>25%)`);
    else warnings.push(line);
  }
  return { red: reasons.length > 0, reasons, warnings };
}

/** Render the fleet write-back outcome for the CLI/CI. Beyond the human-readable
 *  lines, it emits a single deterministic, machine-parseable line —
 *  `FLEET_WRITE_SUMMARY wrote=N failed=M total=T` — that the nightly workflow
 *  greps to decide pass/fail. Keying CI on this line (not the prose, and not a
 *  "wrote ≥ 1" heuristic) lets the gate tolerate a single known flake while
 *  still reding on a total or mass write-back failure.
 *
 *  Then the gate's own verdict: `FLEET_WRITE_GATE verdict=red|green`, one
 *  `FLEET_WRITE_GATE_REASON` line per reason it is red and one
 *  `FLEET_WRITE_GATE_WARNING` line per thing short of red. Every fleet workflow
 *  reds on `verdict=red`, and on the line being absent. */
/** `gate: false` leaves out the FLEET_WRITE_GATE lines, for a caller whose
 *  workflow step reads no verdict (github-signals, #1650). */
export function formatFleetWriteSummary(
  result: FleetWriteResult,
  { gate: printGate = true }: { gate?: boolean } = {},
): string {
  const wrote = result.written.length;
  const failed = result.failed.length;
  const na = result.notApplicable ?? [];
  const missing = result.missing ?? [];
  const total = fleetWriteTotal(result);
  let out = `→ wrote ${wrote} site(s)`;
  if (failed > 0) {
    out += `\n⚠ ${failed} site(s) not written: ${result.failed
      .map((f) => `${f.slug} (${f.error})`)
      .join("; ")}`;
  }
  if (na.length > 0) out += `\n· ${na.length} site(s) not applicable: ${na.join(", ")}`;
  const kept = result.kept ?? [];
  if (kept.length > 0) {
    out += `\n· ${kept.length} site(s) kept their verdicts, nothing new to write: ${kept
      .map((k) => `${k.slug} (${k.reason})`)
      .join("; ")}`;
  }
  for (const [audit, sites] of Object.entries(result.notApplicableAudits ?? {})) {
    if (sites && sites.length > 0) {
      out += `\n· ${audit} not applicable by design on ${sites.length} site(s): ${sites.join(", ")}`;
    }
  }
  if (missing.length > 0) {
    out += `\n⚠ ${missing.length} site(s) on the roster never reached write-back: ${missing.join(", ")}`;
  }
  out += `\nFLEET_WRITE_SUMMARY wrote=${wrote} failed=${failed} total=${total}`;
  // Mirror counts APPEND so the fleet workflows' `grep -oE "FLEET_WRITE_SUMMARY
  // wrote=... total=[0-9]+"` extraction still matches its prefix untouched.
  if (result.mirrored !== undefined) {
    out += ` mirrored=${result.mirrored} mirror_failed=${result.mirrorFailed ?? 0}`;
    out += ` mirror_missed=${result.mirrorMissed ?? 0}`;
  }
  out += ` na=${na.length} missing=${missing.length} kept=${kept.length}`;
  if (!printGate) return out;
  const gate = fleetWriteGate(result);
  out += `\nFLEET_WRITE_GATE verdict=${gate.red ? "red" : "green"}`;
  for (const r of gate.reasons) out += `\nFLEET_WRITE_GATE_REASON ${r}`;
  for (const w of gate.warnings) out += `\nFLEET_WRITE_GATE_WARNING ${w}`;
  return out;
}

/** Write each site's pooled audit results to its Turso `site_health` row,
 *  best-effort. Results are grouped by `result.site` (the slug the fleet
 *  inventory stamped as Site.name). A per-site failure (no scores, no matching
 *  row, a Turso write that threw or matched nothing, no store at all) is
 *  collected — not thrown — so one bad site never aborts the batch. A site is
 *  `written` only when its FieldSet landed in Turso, so the nightly gates'
 *  `wrote=0` catches a total store outage. */
export async function writeFleetAudits(args: {
  websites: WebsiteRow[];
  results: AuditResult[];
  /** The Turso write (#539 Phase 3). A failure is counted and files the site
   *  under `failed`, never thrown. Absent → every site with a FieldSet fails. */
  mirror?: HealthMirror;
  /** Every site label the run resolved before prep (#1605). A label with no result here
   *  is filed under `missing`, so `total` is checked against the roster rather than
   *  derived from whatever reached this function. */
  expectedSites?: string[];
}): Promise<FleetWriteResult> {
  const { websites, results, mirror, expectedSites } = args;

  const bySlug = new Map<string, AuditResult[]>();
  for (const r of results) {
    const arr = bySlug.get(r.site) ?? [];
    arr.push(r);
    bySlug.set(r.site, arr);
  }

  const written: WriteSummary[] = [];
  const failed: FleetWriteResult["failed"] = [];
  const events: FleetEvent[] = [];
  let mirrored = 0;
  let mirrorFailed = 0;
  let mirrorMissed = 0;
  const notApplicable: string[] = [];
  const kept: Array<{ slug: string; reason: string }> = [];
  const unmeasuredAudits: Partial<Record<string, string[]>> = {};
  const applicableAudits: Partial<Record<string, string[]>> = {};
  const notApplicableAudits: Partial<Record<AuditName, string[]>> = {};
  const note = (into: Partial<Record<string, string[]>>, audit: string, slug: string) => {
    const list = (into[audit] ??= []);
    // Two roster rows can share a slug and pool into one group; count the slug once.
    if (!list.includes(slug)) list.push(slug);
  };
  for (const [slug, siteResults] of bySlug) {
    let plan: AuditWritePlan;
    try {
      plan = planAuditWrite({ websites, slug, results: siteResults });
    } catch (e) {
      failed.push({ slug, error: (e as Error).message });
      continue;
    }
    const { summary } = plan;
    for (const u of plan.unmeasured) note(unmeasuredAudits, u.audit, slug);
    for (const c of plan.missingCategories) note(unmeasuredAudits, c, slug);
    // A category applies wherever lighthouse scored; an unscored site is a miss. Read
    // off the plan, so a slug pooling two results is judged by the one that was written.
    if (plan.lighthouseScored) {
      for (const c of LIGHTHOUSE_CATEGORIES) {
        note(applicableAudits, `lighthouse.${c}`, slug);
      }
    }
    for (const r of siteResults) {
      if (PERSISTED_AUDITS.has(r.audit) && r.notApplicable !== true) {
        note(applicableAudits, r.audit, slug);
      }
      if (r.notApplicable === true) note(notApplicableAudits, r.audit, slug);
    }
    const hasFields = !!summary.fields && Object.keys(summary.fields).length > 0;
    const empty = emptyWriteOutcome(plan, siteResults);
    if (empty) {
      if (empty.kind === "kept") kept.push({ slug, reason: empty.reason });
      else if (empty.kind === "not-applicable") notApplicable.push(slug);
      else failed.push({ slug, error: `nothing measured: ${empty.reason}` });
      continue;
    }
    if (summary.siteId && summary.fields && hasFields) {
      if (!mirror) {
        failed.push({ slug, error: "no Turso store configured" });
        continue;
      }
      try {
        if (!(await mirror(summary.siteId, summary.fields))) {
          mirrorMissed++;
          failed.push({ slug, error: "no site_health row matched" });
          continue;
        }
        mirrored++;
        events.push(...(summary.events ?? []));
      } catch (e) {
        mirrorFailed++;
        console.error(`[health-mirror] ${slug}: ${(e as Error).message}`);
        failed.push({ slug, error: `Turso write failed: ${(e as Error).message}` });
        continue;
      }
    }
    if (plan.lighthouseMiss) {
      failed.push({ slug, error: plan.lighthouseMiss.message });
      continue;
    }
    written.push(summary);
  }
  const missing =
    expectedSites !== undefined ? [...new Set(expectedSites)].filter((s) => !bySlug.has(s)) : [];
  return {
    written,
    failed,
    events,
    notApplicable,
    kept,
    unmeasuredAudits,
    applicableAudits,
    notApplicableAudits,
    ...(expectedSites !== undefined ? { missing } : {}),
    ...(mirror ? { mirrored, mirrorFailed, mirrorMissed } : {}),
  };
}
