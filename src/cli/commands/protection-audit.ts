import {
  collectProtectionCoverage,
  renovateOutcomeLine,
  renovateOutcomeSummary,
  type ProtectionCoverageDeps,
} from "../../audits/protection-coverage.js";
import {
  collectPackageManagerPins,
  packageManagerPinSummary,
  type PackageManagerPinDeps,
} from "../../github/package-manager-pin.js";
import { makeGitHub } from "../../github/gh.js";

/** Everything the audit reads. The pnpm-pin sweep's reads are REQUIRED, not
 *  optional: an optional dep that tests forget to supply is a check that
 *  silently measures nothing, which is the failure this guard was built to
 *  end. Widening the type makes the compiler name every call site instead. */
export type ProtectionAuditDeps = ProtectionCoverageDeps & PackageManagerPinDeps;

/** Exit 1 on ANY gap: unlike the fleet write sweeps (majority-rule), a single
 *  unprotected public repo is a real hole, not a flake to tolerate. */
export function protectionAuditExitCode(gaps: number): number {
  return gaps > 0 ? 1 : 0;
}

/** `protection-audit --org <org>`: verify every public repo in the org carries
 *  a sound branch ruleset, live secret scanning + push protection, a renovate
 *  workflow that actually runs (see collectProtectionCoverage for the
 *  verdicts), and a pnpm `packageManager` pin that matches the fleet's (see
 *  collectPackageManagerPins). Emits one line per repo + a machine-readable
 *  PROTECTION_AUDIT summary the nightly workflow gates its tracking issue on.
 *  A missing fleet token is a clean skip (local runs), matching github-signals. */
export async function runProtectionAuditCommand(
  opts: { org?: string | undefined },
  // Injected in tests; defaults to the real gh-CLI-backed factory.
  depsOverride?: ProtectionAuditDeps,
): Promise<{ output: string; code: number }> {
  const org = opts.org?.trim();
  if (!org) {
    return { output: "protection-audit requires --org <org>", code: 2 };
  }
  const token = process.env.GH_TOKEN?.trim();
  if (!depsOverride && !token) {
    return {
      output: "protection-audit skipped: no GH_TOKEN (fleet read) configured.",
      code: 0,
    };
  }
  const deps = depsOverride ?? makeGitHub({ token: token! });

  const coverage = await collectProtectionCoverage(org, deps);
  const pinRows = await collectPackageManagerPins(org, deps);
  const pinByRepo = new Map(pinRows.map((p) => [p.repo, p]));

  // MERGED INTO THE REPO'S OWN ROW, never appended as extra GAP lines of their
  // own. `fleet-security.yml` closes the tracking issue only when every repo
  // the issue named as a GAP comes back COVERED, so a repo printing GAP and
  // COVERED in the same sweep would let it close on its own gap.
  const rows = coverage.map((row) => {
    const pin = pinByRepo.get(row.repo);
    if (!pin || pin.gaps.length === 0) return row;
    return {
      ...row,
      status: "gap" as const,
      detail: [row.detail, ...pin.gaps].filter((d) => d.length > 0).join(" | "),
    };
  });

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
  // Accepted pnpm-pin gaps print every night with their reason and expiry, on
  // the same non-gating WARN prefix: visible, never silent, never an alarm.
  for (const p of pinRows) {
    for (const note of p.accepted) lines.push(`WARN    ${p.repo} — ${note}`);
  }
  lines.push(renovateOutcomeSummary(measured));
  lines.push(packageManagerPinSummary(pinRows));
  lines.push(
    `PROTECTION_AUDIT gaps=${gaps.length} covered=${covered.length} skipped=${skipped.length} total=${rows.length}`,
  );
  return { output: lines.join("\n"), code: protectionAuditExitCode(gaps.length) };
}
