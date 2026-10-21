import {
  collectProtectionCoverage,
  RENOVATE_DROUGHT_WARN_DAYS,
  renovateOutcomeLine,
  renovateOutcomeSummary,
  rulesetBypassSummary,
  type ProtectionCoverageDeps,
  type RenovateOutcome,
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
 *  workflow that actually runs, a required status check on every non-default
 *  branch Renovate merges into (see collectProtectionCoverage for the
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
  // A row the sweep judged but whose probe threw before the merge window was
  // read carries no outcome. It is UNMEASURED, never left out (#1606): left
  // out, a repo whose probe fails keeps its drought off the fleet line, and an
  // empty line reads as "every repo delivers". SKIPPED rows without an outcome
  // (private, archived) are outside the sweep and stay out.
  const outcomeOf = (r: (typeof rows)[number]): RenovateOutcome | undefined =>
    r.renovateOutcome ??
    (r.status === "skipped"
      ? undefined
      : {
          state: "unmeasured",
          reason:
            "the sweep could not read this repo, so its Renovate merges were not read (see its GAP line)",
        });
  const outcomes = rows.map((r) => ({ repo: r.repo, outcome: outcomeOf(r) }));
  const measured = outcomes.map((o) => o.outcome).filter((o) => o !== undefined);
  for (const { repo, outcome } of outcomes) {
    const line = outcome && renovateOutcomeLine(outcome);
    if (line) lines.push(`WARN    ${repo} — ${line}`);
  }
  // A delivering repo gets its own line too (#1606). fleet-security closes the
  // Renovate drought issue only when every repo the issue named prints one: a
  // repo that left the sweep tonight (private, archived) prints neither WARN
  // nor DELIVER, and "not seen" must not read as "fixed".
  for (const { repo, outcome: o } of outcomes) {
    if (o?.state !== "delivering") continue;
    lines.push(
      `DELIVER ${repo} — a feature update landed ${o.days}d ago ` +
        `(${o.lastBranch} merged ${o.lastMergedAt.slice(0, 10)}; warns past ${RENOVATE_DROUGHT_WARN_DAYS}d)`,
    );
  }
  // Accepted pnpm-pin gaps print every night with their reason and expiry, on
  // the same non-gating WARN prefix: visible, never silent, never an alarm.
  for (const p of pinRows) {
    for (const note of p.accepted) lines.push(`WARN    ${p.repo} — ${note}`);
  }
  lines.push(renovateOutcomeSummary(measured));
  lines.push(rulesetBypassSummary(rows));
  lines.push(packageManagerPinSummary(pinRows));
  // A sweep that judged no repo verified nothing (#1612: an org listing that
  // returned `200 []` printed `gaps=0 … total=0` and exited 0). That is
  // unmeasured, never clean, so it prints no `PROTECTION_AUDIT gaps=0 ` line,
  // the one fleet-security's close step reads as a verified clean sweep.
  if (gaps.length + covered.length === 0) {
    lines.push(
      `PROTECTION_AUDIT_UNMEASURED covered=0 gaps=0 skipped=${skipped.length} total=${rows.length} — ` +
        `the org listing gave no public, unarchived repo to verify, so nothing was checked`,
    );
    return { output: lines.join("\n"), code: 1 };
  }
  lines.push(
    `PROTECTION_AUDIT gaps=${gaps.length} covered=${covered.length} skipped=${skipped.length} total=${rows.length}`,
  );
  return { output: lines.join("\n"), code: protectionAuditExitCode(gaps.length) };
}
