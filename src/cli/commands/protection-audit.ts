import {
  collectProtectionCoverage,
  renovateOutcomeLine,
  renovateOutcomeSummary,
  type ProtectionCoverageDeps,
} from "../../audits/protection-coverage.js";
import { makeGitHub } from "../../github/gh.js";

/** Exit 1 on ANY gap: unlike the fleet write sweeps (majority-rule), a single
 *  unprotected public repo is a real hole, not a flake to tolerate. */
export function protectionAuditExitCode(gaps: number): number {
  return gaps > 0 ? 1 : 0;
}

/** `protection-audit --org <org>`: verify every public repo in the org carries
 *  a sound branch ruleset, live secret scanning + push protection, and a
 *  renovate workflow that actually runs (see collectProtectionCoverage for the
 *  verdicts). Emits one line per repo + a machine-readable PROTECTION_AUDIT
 *  summary the nightly workflow gates its tracking issue on. A missing fleet
 *  token is a clean skip (local runs), matching github-signals. */
export async function runProtectionAuditCommand(
  opts: { org?: string | undefined },
  // Injected in tests; defaults to the real gh-CLI-backed factory.
  depsOverride?: ProtectionCoverageDeps,
): Promise<{ output: string; code: number }> {
  const org = opts.org?.trim();
  if (!org) {
    return { output: "protection-audit requires --org <org>", code: 2 };
  }
  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!depsOverride && !token) {
    return {
      output: "protection-audit skipped: no RENOVATE_TOKEN/GH_TOKEN (fleet read) configured.",
      code: 0,
    };
  }
  const deps = depsOverride ?? makeGitHub({ token: token! });

  const rows = await collectProtectionCoverage(org, deps);
  const gaps = rows.filter((r) => r.status === "gap");
  const covered = rows.filter((r) => r.status === "covered");
  const skipped = rows.filter((r) => r.status === "skipped");

  const lines = rows.map((r) => `${r.status.toUpperCase().padEnd(7)} ${r.repo} — ${r.detail}`);

  // The outcome metric rides in its OWN line prefixes and its OWN summary line.
  // The nightly workflow greps `^GAP` for the issue body, `^COVERED` for the
  // close list, and `PROTECTION_AUDIT gaps=0 ` to decide a clean sweep — none
  // of which these lines match, so the tracking-issue plumbing is untouched by
  // construction rather than by promise.
  const measured = rows.map((r) => r.renovateOutcome).filter((o) => o !== undefined);
  for (const r of rows) {
    const line = r.renovateOutcome && renovateOutcomeLine(r.renovateOutcome);
    if (line) lines.push(`WARN    ${r.repo} — ${line}`);
  }
  lines.push(renovateOutcomeSummary(measured));
  lines.push(
    `PROTECTION_AUDIT gaps=${gaps.length} covered=${covered.length} skipped=${skipped.length} total=${rows.length}`,
  );
  return { output: lines.join("\n"), code: protectionAuditExitCode(gaps.length) };
}
