import type { AuditResult } from "../types.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import { type WebsiteRow, siteSlug, updateAuditFields } from "../reports/airtable/websites.js";
import type {
  A11yCounts,
  DepsCounts,
  SecurityCounts,
  SecurityAdvisory,
  DomainResult,
  BrowserAuditFields,
} from "../reports/airtable/websites.js";
import type { LighthouseScores } from "../reports/types.js";
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

type WriteSummary = {
  siteName: string;
  writes: Array<{
    audit: "lighthouse" | "a11y" | "deps" | "security" | "github-signals" | "domain" | "browser";
    counts: object;
  }>;
};

/** Orchestrates the per-audit Airtable writes for `audit --write-airtable`.
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
export async function writeAuditsToAirtable(args: {
  base: AirtableBase;
  websites: WebsiteRow[];
  slug: string;
  results: AuditResult[];
}): Promise<WriteSummary> {
  const { base, websites, slug, results } = args;

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
  const audits: {
    scores?: LighthouseScores;
    a11y?: A11yCounts;
    deps?: DepsCounts;
    security?: SecurityCounts;
    securityAdvisories?: SecurityAdvisory[];
    domain?: DomainResult;
    browser?: BrowserAuditFields;
  } = {};

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

  // One atomic write of everything that ran. Skip the call only if there is nothing
  // to write at all (no real scores AND no other audit produced values) — an empty
  // update is a wasted request.
  if (Object.keys(audits).length > 0) {
    await updateAuditFields(base, target.id, audits);
  }

  // Lighthouse-miss flag: only when lighthouse WAS requested (in results) but produced no scores —
  // an infra failure worth reding the run, AFTER persisting the other audits. A sweep that never
  // ran lighthouse (e.g. `--only security`) skips this entirely.
  if (lhResult && !lhHasScores) {
    // Enumerate what WAS persisted so the failure (surfaced to the single-site
    // CLI operator via console.error) reads as a partial write, not a total one.
    const persisted = writes.map((w) => w.audit);
    throw Object.assign(
      new Error(
        `Lighthouse audit produced no scores; ${
          persisted.length ? `wrote ${persisted.join("/")} but refused Lighthouse` : "wrote nothing"
        }. Summary: ${lhResult.summary}`,
      ),
      { exitCode: 1 },
    );
  }

  return { siteName: target.name, writes };
}

export type FleetWriteResult = {
  written: WriteSummary[];
  failed: Array<{ slug: string; error: string }>;
};

/** Render the fleet write-back outcome for the CLI/CI. Beyond the human-readable
 *  lines, it emits a single deterministic, machine-parseable line —
 *  `FLEET_WRITE_SUMMARY wrote=N failed=M total=T` — that the nightly workflow
 *  greps to decide pass/fail. Keying CI on this line (not the prose, and not a
 *  "wrote ≥ 1" heuristic) lets the gate tolerate a single known flake while
 *  still reding on a total or mass write-back failure. */
export function formatFleetWriteSummary(result: FleetWriteResult): string {
  const wrote = result.written.length;
  const failed = result.failed.length;
  const total = wrote + failed;
  let out = `→ wrote ${wrote} site(s) to Airtable`;
  if (failed > 0) {
    out += `\n⚠ ${failed} site(s) not written: ${result.failed
      .map((f) => `${f.slug} (${f.error})`)
      .join("; ")}`;
  }
  out += `\nFLEET_WRITE_SUMMARY wrote=${wrote} failed=${failed} total=${total}`;
  return out;
}

/** Write each site's pooled audit results back to its own Websites row,
 *  best-effort. Results are grouped by `result.site` (the slug the fleet
 *  inventory stamped as Site.name). A per-site failure (no scores, no matching
 *  row) is collected — not thrown — so one bad site never aborts the batch. */
export async function writeFleetAuditsToAirtable(args: {
  base: AirtableBase;
  websites: WebsiteRow[];
  results: AuditResult[];
}): Promise<FleetWriteResult> {
  const { base, websites, results } = args;

  const bySlug = new Map<string, AuditResult[]>();
  for (const r of results) {
    const arr = bySlug.get(r.site) ?? [];
    arr.push(r);
    bySlug.set(r.site, arr);
  }

  const written: WriteSummary[] = [];
  const failed: FleetWriteResult["failed"] = [];
  // Serial on purpose: even at one (now atomic) update call per site, Airtable's
  // ~5 req/sec limit means a Promise.all fan-out across the fleet would burst and
  // trip 429s (silently filed as failures). Below a few dozen sites, serial trades
  // wall-clock for safety. (morning-brief 2026-06-09 MEDIUM-3.) Add a bounded pool
  // when the fleet grows.
  for (const [slug, siteResults] of bySlug) {
    try {
      written.push(await writeAuditsToAirtable({ base, websites, slug, results: siteResults }));
    } catch (e) {
      failed.push({ slug, error: (e as Error).message });
    }
  }
  return { written, failed };
}
