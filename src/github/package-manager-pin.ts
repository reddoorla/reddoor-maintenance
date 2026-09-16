import { partitionAcceptedGaps, type AcceptedGap } from "../audits/protection-coverage.js";

/**
 * The pnpm `packageManager` surface of the nightly protection sweep (#690).
 *
 * Three repos sat on a pnpm security bump for two months and nothing said so.
 * The drift itself is fixed — re-measured against live GitHub 2026-09-15, all
 * 25 repos carrying a `packageManager` field are on `pnpm@11.11.0` — but the
 * reason it went
 * unseen is not: NOTHING in `src/` or `.github/workflows/` ever asked the
 * question. This module is that question, wired into the sweep that already
 * walks every repo (see `runProtectionAuditCommand`), because a fleet
 * invariant with no instrument is a fleet invariant that drifts again.
 *
 * Three gaps, each with its own failure history:
 *
 *  - **No `packageManager` field** where a `package.json` exists: CI then
 *    installs whatever pnpm the runner happens to default to, so the version
 *    that resolves the lockfile is decided by GitHub's image, not by the repo.
 *  - **A pin that disagrees with the fleet's**: the original #690 condition.
 *  - **A workflow pinning a pnpm `version:` input while a `packageManager`
 *    field also exists**: `pnpm/action-setup` does not prefer one over the
 *    other, it HARD-ERRORS on a mismatch. As of 2026-09-15 NO repo in the
 *    fleet pins a workflow input — all 75 workflow files were parsed by
 *    `parsePnpmActionSetupPins` and none carries one. `reddoor-md-pdf` used to
 *    be the single exception, safe only because it had no field to disagree
 *    with; it has since gained the field AND dropped the input, which is the
 *    correct shape. This clause is now a pure regression guard, so its failing
 *    arm is injected in the test rather than borrowed from a live repo.
 *
 * Scope is deliberately the SAME population the coverage sweep judges —
 * non-archived PUBLIC repos. Not an oversight, and not because private repos
 * cannot drift: `fleet-security.yml` closes the tracking issue only when every
 * repo the issue named as a `GAP` comes back as `COVERED` in a later run, and
 * the coverage sweep never prints `COVERED` for a repo it skips. A gap raised
 * here on a repo that can only ever print `SKIPPED` would be an issue the
 * machine could never close — the exact orphan-issue failure that had to be
 * cleaned up by hand on 2026-09-14.
 */

/** A repo's raw pnpm-pin facts, as read from its default branch. */
export type PackageManagerFacts = {
  /** `package.json` at the default branch, or `null` when the repo has none —
   *  which is OUT OF SCOPE, never a gap. In the judged population that is
   *  `.github` alone (measured 2026-09-15); `reddoor-prospect-runner` and
   *  `reddoor-rfp-analyses` are also package-less but are PRIVATE, so they are
   *  skipped before this is ever consulted. A check that gapped them would
   *  light repos every night forever and teach the operator to skim past this
   *  surface. */
  packageJson: string | null;
  /** Every `pnpm/action-setup` step that pins a `version:` input, by workflow
   *  file. Empty is the healthy fleet-wide default. */
  workflowPins: Array<{ file: string; version: string }>;
};

/** The reads this sweep needs, injected so the verdicts stay pure and
 *  fixture-testable (same pattern as ProtectionCoverageDeps). */
export type PackageManagerPinDeps = {
  listOrgRepos: (org: string) => Promise<
    Array<{
      name: string;
      visibility: string;
      archived: boolean;
      secretScanning: string;
      pushProtection: string;
    }>
  >;
  /** A text file at the repo's default branch, or `null` when it does not
   *  exist. `null` is an ANSWER (no package.json = not a node repo); any other
   *  failure throws, so an API hiccup can never arrive here as "no pin". */
  repoTextFile: (repo: string, path: string) => Promise<string | null>;
  /** Paths of every file in `.github/workflows`, or `[]` when the directory is
   *  absent. */
  listWorkflowPaths: (repo: string) => Promise<string[]>;
};

/**
 * Operator-accepted gaps, in the shape and under the doctrine of
 * `ACCEPTED_GAPS`: one repo, one surface, a NAMED pending fix, and an expiry
 * past which the gap returns on its own.
 *
 * Currently EMPTY, and that is the healthy state. The two original entries —
 * `claude-skills` and `reddoor-md-pdf`, the two repos the 2026-09-16
 * measurement found carrying no `packageManager` field — were retired
 * 2026-09-15 when the fix they named actually landed: both now carry
 * `pnpm@11.11.0`, and `reddoor-md-pdf`'s `pnpm/action-setup` step no longer
 * takes a `version:` input at all (verified against live GitHub, not inferred).
 *
 * An acceptance outliving its fix is not inert. It is scoped by repo AND
 * surface, so for as long as it stands these two repos are the only two in the
 * fleet whose "no packageManager field" gap CANNOT gate — precisely the repos
 * that just proved they are the ones that lose the field. Had either regressed
 * before 2026-10-01 the nightly would have reported it as accepted-with-expiry
 * and gated nothing. A mute that survives its reason silences exactly the
 * repo it was written about.
 */
export const PACKAGE_MANAGER_ACCEPTED_GAPS: AcceptedGap[] = [];

/** What a repo's `package.json` says about pnpm. The three states are distinct
 *  shapes on purpose: a caller cannot read "I could not parse this" as "no pin"
 *  by forgetting to check a flag. */
export type PackageManagerField =
  | { state: "present"; value: string }
  | { state: "absent" }
  | { state: "unreadable"; reason: string };

/** The `packageManager` field of one `package.json`. */
export function parsePackageManagerField(packageJson: string): PackageManagerField {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJson);
  } catch (e) {
    return {
      state: "unreadable",
      reason: `package.json is not valid JSON (${e instanceof Error ? e.message : String(e)})`,
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { state: "unreadable", reason: "package.json is not a JSON object" };
  }
  const value = (parsed as Record<string, unknown>).packageManager;
  if (value === undefined) return { state: "absent" };
  if (typeof value !== "string") {
    return { state: "unreadable", reason: `packageManager is ${typeof value}, not a string` };
  }
  return { state: "present", value };
}

/**
 * Every pnpm version pinned by a `pnpm/action-setup` step in one workflow file.
 *
 * THE TRAP THIS FUNCTION EXISTS FOR. The first hand-run measurement of this
 * question grepped `version:` anywhere in any file that mentioned
 * `pnpm/action-setup`, and reported ELEVEN healthy workflows as pinning a pnpm
 * version. Every one of those matches was `node-version: 24`, from an
 * `actions/setup-node` step elsewhere in the same file. Posted, it would have
 * sent someone editing eleven workflows that were already correct.
 *
 * So the scan is bounded to the action-setup step's OWN block, with two
 * independent defenses against that exact miss:
 *   1. the key regex is anchored at the start of the key, so `node-version:`
 *      cannot match `version:`; and
 *   2. the scan stops at the end of the step, so a sibling step's `with:`
 *      block is never entered at all.
 * Either alone would have caught it. Both are here because this surface has
 * already produced a confidently wrong number once.
 *
 * Parsed by a targeted scan rather than a YAML dependency, following
 * `readLockedCliVersion`: this needs one input out of one step, and the repo
 * deliberately carries no YAML parser.
 */
export function parsePnpmActionSetupPins(workflow: string): string[] {
  const lines = workflow.split("\n");
  const pins: string[] = [];

  const indentOf = (line: string): number => line.length - line.trimStart().length;
  const isBlank = (line: string): boolean => line.trim().length === 0 || /^\s*#/.test(line);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const uses = /^(\s*)(-\s+)?uses:\s*['"]?pnpm\/action-setup(?=[@'"\s]|$)/.exec(line);
    if (!uses) continue;
    // A step written as `- uses: …` puts the step's other keys at the column
    // AFTER the dash; one written as `uses:` under an earlier `- name:` puts
    // them at its own column.
    const contentIndent = uses[1]!.length + (uses[2] ? uses[2].length : 0);

    for (let j = i + 1; j < lines.length; j++) {
      const body = lines[j]!;
      if (isBlank(body)) continue;
      const indent = indentOf(body);
      // Dedent past the step's keys, or a new `- ` item at the same column:
      // either way this step is over and nothing below belongs to it.
      if (indent < contentIndent) break;
      if (indent === contentIndent && /^\s*-\s/.test(body)) break;
      if (indent !== contentIndent || !/^\s*with:\s*$/.test(body)) continue;

      // Inside this step's `with:` mapping — and only this one.
      for (let k = j + 1; k < lines.length; k++) {
        const input = lines[k]!;
        if (isBlank(input)) continue;
        if (indentOf(input) <= contentIndent) break;
        const m = /^\s*version:\s*['"]?([^'"#\s]+)/.exec(input);
        if (m) pins.push(m[1]!);
      }
      break;
    }
  }
  return pins;
}

/** The fleet's pnpm pin, DERIVED from the fleet rather than hand-typed here.
 *  A constant in this file would be one more copy of the number to drift —
 *  `convert-to-pnpm.ts` still carries `DEFAULT_PNPM_VERSION = "10.33.1"`,
 *  which is exactly what a hand-typed pin does when nothing watches it. */
export type FleetPin =
  | { state: "majority"; pin: string; count: number; total: number }
  | { state: "split"; counts: Array<{ pin: string; count: number }>; total: number }
  | { state: "none" };

/**
 * The pin a strict majority of pinned repos agree on.
 *
 * A STRICT majority, not merely the most common value: with no majority the
 * fleet has no single answer, and picking the modal value would gap every repo
 * on the other side of a genuine split — 24 GAP lines for one unmade decision.
 * `split` reports the condition and gaps nobody on this clause; the missing-
 * field and workflow-collision clauses keep working underneath it.
 */
export function fleetPin(pins: string[]): FleetPin {
  if (pins.length === 0) return { state: "none" };
  const tally = new Map<string, number>();
  for (const p of pins) tally.set(p, (tally.get(p) ?? 0) + 1);
  const counts = [...tally.entries()]
    .map(([pin, count]) => ({ pin, count }))
    .sort((a, b) => b.count - a.count || a.pin.localeCompare(b.pin));
  const top = counts[0]!;
  if (top.count * 2 > pins.length) {
    return { state: "majority", pin: top.pin, count: top.count, total: pins.length };
  }
  return { state: "split", counts, total: pins.length };
}

/** Gap lines for one in-scope repo. Empty = this repo's pnpm pin is sound. */
export function packageManagerGaps(facts: PackageManagerFacts, fleet: FleetPin): string[] {
  if (facts.packageJson === null) return [];
  const field = parsePackageManagerField(facts.packageJson);
  const gaps: string[] = [];
  const pinnedWorkflows = facts.workflowPins
    .map((w) => `${w.file} (version: ${w.version})`)
    .join(", ");

  if (field.state === "unreadable") {
    gaps.push(`packageManager unreadable — ${field.reason} (unverified, not clean)`);
    return gaps;
  }

  if (field.state === "absent") {
    const fleetSays =
      fleet.state === "majority" ? ` (the fleet pin is ${fleet.pin})` : " (fleet pin unsettled)";
    // The remediation DIFFERS when a workflow already pins a version, and
    // getting this wrong breaks the repo it is trying to fix: adding the field
    // next to a surviving `version:` input is precisely the mismatch
    // `pnpm/action-setup` hard-errors on.
    gaps.push(
      facts.workflowPins.length > 0
        ? `no packageManager field in package.json${fleetSays}, and ${pinnedWorkflows} pins pnpm ` +
            `in a pnpm/action-setup step instead. Fix: add the field AND delete the workflow's ` +
            `version input in the SAME change — adding the field alone makes action-setup ` +
            `hard-error on the mismatch.`
        : `no packageManager field in package.json${fleetSays} — CI installs whatever pnpm the ` +
            `runner defaults to, so the version resolving this lockfile is GitHub's choice, not ` +
            `the repo's. Fix: add "packageManager" to package.json.`,
    );
    return gaps;
  }

  if (fleet.state === "majority" && field.value !== fleet.pin) {
    gaps.push(
      `packageManager is ${field.value} but the fleet pin is ${fleet.pin} ` +
        `(${fleet.count}/${fleet.total} repos agree). Fix: bump the field, or say why this repo ` +
        `is deliberately apart.`,
    );
  }

  if (facts.workflowPins.length > 0) {
    const agree = facts.workflowPins.every((w) => `pnpm@${w.version}` === field.value);
    gaps.push(
      `${pinnedWorkflows} pins a pnpm version input while package.json pins ${field.value}` +
        (agree ? " — they agree today, but nothing keeps them in step" : " — THEY DISAGREE") +
        `. pnpm/action-setup does not prefer either side, it hard-errors on a mismatch. ` +
        `Fix: delete the workflow's version input; packageManager is the single source of truth.`,
    );
  }

  return gaps;
}

/** One row per repo the sweep looked at. */
export type PackageManagerRow = {
  repo: string; // owner/repo
  scope: "judged" | "out-of-scope" | "skipped";
  /** Live gaps — these gate. Empty on a sound repo. */
  gaps: string[];
  /** Accepted-for-now gaps: reported every night with reason + expiry, never
   *  gating (see PACKAGE_MANAGER_ACCEPTED_GAPS). */
  accepted: string[];
  detail: string;
};

/**
 * The pnpm-pin sweep over one org.
 *
 * Two passes, and the order matters: the fleet pin is DERIVED from what the
 * repos actually say, so every repo's facts must be read before any repo can
 * be judged against them.
 */
export async function collectPackageManagerPins(
  org: string,
  deps: PackageManagerPinDeps,
  now: Date = new Date(),
  accepted: AcceptedGap[] = PACKAGE_MANAGER_ACCEPTED_GAPS,
): Promise<PackageManagerRow[]> {
  const rows: PackageManagerRow[] = [];
  const facts = new Map<string, PackageManagerFacts>();

  for (const r of await deps.listOrgRepos(org)) {
    const repo = `${org}/${r.name}`;
    if (r.archived || r.visibility !== "public") {
      rows.push({
        repo,
        scope: "skipped",
        gaps: [],
        accepted: [],
        detail: r.archived ? "archived" : `${r.visibility}`,
      });
      continue;
    }
    try {
      const packageJson = await deps.repoTextFile(repo, "package.json");
      if (packageJson === null) {
        // No package.json = no pnpm pin to hold. OUT OF SCOPE, never a gap.
        rows.push({
          repo,
          scope: "out-of-scope",
          gaps: [],
          accepted: [],
          detail: "no package.json",
        });
        continue;
      }
      const workflowPins: PackageManagerFacts["workflowPins"] = [];
      for (const path of await deps.listWorkflowPaths(repo)) {
        const contents = await deps.repoTextFile(repo, path);
        if (contents === null) continue;
        for (const version of parsePnpmActionSetupPins(contents)) {
          workflowPins.push({ file: path.replace(/^\.github\/workflows\//, ""), version });
        }
      }
      facts.set(repo, { packageJson, workflowPins });
      rows.push({ repo, scope: "judged", gaps: [], accepted: [], detail: "" });
    } catch (e) {
      // "Couldn't read it" is a gap, never a pass — the same doctrine the
      // coverage sweep applies to a probe that throws.
      rows.push({
        repo,
        scope: "judged",
        gaps: [`pnpm pin probe failed: ${e instanceof Error ? e.message : String(e)}`],
        accepted: [],
        detail: "probe failed",
      });
    }
  }

  const pinned: string[] = [];
  for (const f of facts.values()) {
    const field = parsePackageManagerField(f.packageJson!);
    if (field.state === "present") pinned.push(field.value);
  }
  const fleet = fleetPin(pinned);

  return rows.map((row) => {
    const f = facts.get(row.repo);
    if (!f) return row;
    const all = packageManagerGaps(f, fleet);
    const split = partitionAcceptedGaps(row.repo, all, now, accepted);
    const field = parsePackageManagerField(f.packageJson!);
    return {
      ...row,
      gaps: split.live,
      accepted: split.accepted,
      detail: field.state === "present" ? field.value : row.detail,
    };
  });
}

/** The machine-readable summary, in the shape of RENOVATE_OUTCOME: its own
 *  prefix, so it can never be mistaken for a `GAP`/`COVERED` line or for the
 *  `PROTECTION_AUDIT gaps=0 ` string the nightly gates its issue on. */
export function packageManagerPinSummary(rows: PackageManagerRow[]): string {
  const judged = rows.filter((r) => r.scope === "judged");
  const pins = judged.map((r) => r.detail).filter((d) => d.startsWith("pnpm@"));
  const fleet = fleetPin(pins);
  const pin =
    fleet.state === "majority"
      ? fleet.pin
      : fleet.state === "split"
        ? `SPLIT(${fleet.counts.map((c) => `${c.pin}x${c.count}`).join(",")})`
        : "none";
  return (
    `PACKAGE_MANAGER_PIN gaps=${judged.filter((r) => r.gaps.length > 0).length} ` +
    `pinned=${pins.length} judged=${judged.length} ` +
    `out-of-scope=${rows.filter((r) => r.scope === "out-of-scope").length} ` +
    `skipped=${rows.filter((r) => r.scope === "skipped").length} fleetPin=${pin}`
  );
}
