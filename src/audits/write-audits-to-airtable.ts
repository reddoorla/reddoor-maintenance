import type { AuditResult } from "../types.js";
import type { HealthMirror } from "./health-mirror.js";
import { TURSO_IS_AUTHORITATIVE } from "../db/freeze.js";
import {
  type AuditFieldInputs,
  type WebsiteRow,
  auditFields,
  siteSlug,
  type FieldSet,
} from "../reports/airtable/websites.js";
import { hasRealScores, lighthouseScoresFromResult } from "./lighthouse-airtable.js";
import { hasA11yCounts, a11yCountsFromResult } from "./a11y-airtable.js";
import { hasDepsCounts, depsCountsFromResult } from "./deps-airtable.js";
import {
  hasSecurityCounts,
  securityCountsFromResult,
  advisoriesFromResult,
} from "./security-airtable.js";
import { hasDomainResult, domainResultFromAudit } from "./domain-airtable.js";
import { hasBrowserResult, browserFieldsFromAudit } from "./browser-airtable.js";
import { hasNetlifyDeployResult, netlifyDeployResultFromAudit } from "./netlify-deploy-airtable.js";
import {
  hasFunctionHealthResult,
  functionHealthResultFromAudit,
} from "./function-health-airtable.js";
import { hasSmokeResult, smokeResultFromAudit } from "./smoke-airtable.js";
import { hasFormE2eResult, formE2eResultFromAudit } from "./form-e2e-airtable.js";
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
  /** The Websites rec id + the merged FieldSet actually written — what the
   *  Phase 3 Turso mirror consumes, so mirror and Airtable write share ONE
   *  payload. Populated by writeAuditsToAirtable; other WriteSummary
   *  producers (prismic-models, github-signals) don't carry them. */
  siteId?: string;
  fields?: FieldSet;
};

/** Orchestrates the per-audit Airtable writes for `audit --write-back`.
 *  Extracted from the CLI command so it can be unit-tested with a fake base
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
};

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
  // SINGLE atomic Airtable update (was: up to four sequential updates on the same
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
  if (sec && hasSecurityCounts(sec)) {
    const counts = securityCountsFromResult(sec);
    audits.security = counts;
    // Persist the advisory list alongside the counts so the dashboard can show which packages
    // are vulnerable. An empty array (clean run) clears any stale list.
    audits.securityAdvisories = advisoriesFromResult(sec);
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

  return {
    summary: { siteName: target.name, writes, events, siteId: target.id, fields },
    lighthouseMiss,
  };
}

export async function writeBackOneSite(args: {
  websites: WebsiteRow[];
  slug: string;
  results: AuditResult[];
  mirrorHealth: (siteId: string, fields: FieldSet) => Promise<unknown>;
}): Promise<WriteSummary> {
  const plan = planAuditWrite(args);
  const { siteId, fields } = plan.summary;
  if (siteId && fields) await args.mirrorHealth(siteId, fields);
  if (plan.lighthouseMiss) throw plan.lighthouseMiss;
  return plan.summary;
}

export type FleetWriteResult = {
  written: WriteSummary[];
  failed: Array<{ slug: string; error: string }>;
  /** Turso write-through counts (#539 Phase 3 dual-write). Present ONLY when a
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
};

/** Render the fleet write-back outcome for the CLI/CI. Beyond the human-readable
 *  lines, it emits a single deterministic, machine-parseable line —
 *  `FLEET_WRITE_SUMMARY wrote=N failed=M total=T` — that the nightly workflow
 *  greps to decide pass/fail. Keying CI on this line (not the prose, and not a
 *  "wrote ≥ 1" heuristic) lets the gate tolerate a single known flake while
 *  still reding on a total or mass write-back failure. */
/** Did this sweep fail, for exit-code purposes (#612)?
 *
 *  Turso is the only store, so a mirror failure, a missed row and an ABSENT
 *  mirror are all fatal under `strict` — the absent one is the easiest to
 *  misread as success: no counters at all means no libSQL creds, which means
 *  the sweep wrote nothing.
 *
 *  `writeFleetAuditsToAirtable` still catches per-site failures rather than
 *  throwing. One bad site must not abort a 44-site sweep. This gates the RUN,
 *  not the loop. */
export function fleetWriteFailed(
  result: FleetWriteResult,
  strict: boolean = TURSO_IS_AUTHORITATIVE,
): boolean {
  if (result.failed.length > 0) return true;
  return tursoWriteFailed(result, strict);
}

export function tursoWriteFailed(
  result: FleetWriteResult,
  strict: boolean = TURSO_IS_AUTHORITATIVE,
): boolean {
  if (!strict) return false;
  if (result.mirrored === undefined) return true; // no mirror was wired at all
  return (result.mirrorFailed ?? 0) > 0 || (result.mirrorMissed ?? 0) > 0;
}

export function formatFleetWriteSummary(result: FleetWriteResult): string {
  const wrote = result.written.length;
  const failed = result.failed.length;
  const total = wrote + failed;
  let out = `→ wrote ${wrote} site(s)`;
  if (failed > 0) {
    out += `\n⚠ ${failed} site(s) not written: ${result.failed
      .map((f) => `${f.slug} (${f.error})`)
      .join("; ")}`;
  }
  out += `\nFLEET_WRITE_SUMMARY wrote=${wrote} failed=${failed} total=${total}`;
  // Mirror counts APPEND so the fleet workflows' `grep -oE "FLEET_WRITE_SUMMARY
  // wrote=... total=[0-9]+"` extraction still matches its prefix untouched.
  if (result.mirrored !== undefined) {
    out += ` mirrored=${result.mirrored} mirror_failed=${result.mirrorFailed ?? 0}`;
    out += ` mirror_missed=${result.mirrorMissed ?? 0}`;
  }
  return out;
}

/** Write each site's pooled audit results to its Turso `site_health` row,
 *  best-effort. Results are grouped by `result.site` (the slug the fleet
 *  inventory stamped as Site.name). A per-site failure (no scores, no matching
 *  row, a Turso write that threw or matched nothing, no store at all) is
 *  collected — not thrown — so one bad site never aborts the batch. A site is
 *  `written` only when its FieldSet landed in Turso, so the nightly gates'
 *  `wrote=0` catches a total store outage. */
export async function writeFleetAuditsToAirtable(args: {
  websites: WebsiteRow[];
  results: AuditResult[];
  /** The Turso write (#539 Phase 3). A failure is counted and files the site
   *  under `failed`, never thrown. Absent → every site with a FieldSet fails. */
  mirror?: HealthMirror;
}): Promise<FleetWriteResult> {
  const { websites, results, mirror } = args;

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
  for (const [slug, siteResults] of bySlug) {
    let plan: AuditWritePlan;
    try {
      plan = planAuditWrite({ websites, slug, results: siteResults });
    } catch (e) {
      failed.push({ slug, error: (e as Error).message });
      continue;
    }
    const { summary } = plan;
    if (summary.siteId && summary.fields && Object.keys(summary.fields).length > 0) {
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
  return { written, failed, events, ...(mirror ? { mirrored, mirrorFailed, mirrorMissed } : {}) };
}
