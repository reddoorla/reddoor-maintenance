import {
  collectProtectionCoverage,
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
  lines.push(
    `PROTECTION_AUDIT gaps=${gaps.length} covered=${covered.length} skipped=${skipped.length} total=${rows.length}`,
  );
  return { output: lines.join("\n"), code: protectionAuditExitCode(gaps.length) };
}
