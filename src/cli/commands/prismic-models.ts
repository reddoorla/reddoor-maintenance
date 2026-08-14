// The CLI face of the model pipeline: one site, one Prismic repository, one
// comparison — and, with `--apply`, the one call in this repository that writes
// to a live client's Prismic content model.
//
// EVERY EXIT FROM THIS FILE IS A VERDICT SOMEBODY ACTS ON. In CI the dry run's
// output is posted verbatim as the PR comment a reviewer approves from, and the
// apply run's exit code is what says the merge landed. So the two failure shapes
// this module must never produce are (a) a report that looks complete and is
// not, and (b) a green exit for a run that learned nothing.
//
// THE RULE THIS FILE IS WRITTEN AGAINST — the same one as every module under it:
// "I could not read X" must never produce the same result as "X does not exist."
// Here it takes the form of exit codes and returned prose rather than empty
// arrays, and there are six places it bites:
//
//   - checkout unreadable        -> exit 1, naming the path. A repoRoot that does
//                                   not exist would otherwise reach the skip
//                                   below (every config read is ENOENT), so a
//                                   typo'd path or a failed clone reported "not a
//                                   Prismic site" and exited 0 — under `--apply`
//                                   too.
//   - checkout has no working    -> exit 1, naming the path. A directory holding
//     tree                         `.git` and nothing else is what a KILLED clone
//                                   leaves behind, and every config read in it is
//                                   ENOENT — so it read as "not a Prismic site"
//                                   too, and a fleet workdir reuses it forever.
//   - no config file at all      -> exit 0, "not a Prismic site" (a genuine skip:
//                                   the reusable workflow runs on repos that have
//                                   no Prismic at all)
//   - config THERE and broken    -> exit 1, naming the file. NOT the skip above.
//   - local models unreadable    -> exit 1, naming the file. NOT "the repo
//                                   declares no models", which with `--apply`
//                                   would push a repo's model set from a
//                                   half-read checkout.
//   - remote unreadable          -> exit 1, quoting the API error. NEVER an empty
//                                   remote, which sorts every local model into
//                                   `toCreate` and pushes the lot.
//
// Each of those is a `catch` that returns a NAMED error result — never a default
// that lets the comparison proceed on a guess. `clean` is `null` on every one of
// them, so nothing downstream can read a failed check as a verdict either, and
// `status` says whether it was a skip or a failure so a sweep cannot conflate
// the two.
//
// They live in ONE function, `readSiteInputs`, and every mode of this command
// goes through it — the comparison, `--apply` and `--pull`. `--pull` needs them
// MORE, not less: it is the mode that writes into a live client's working tree,
// so a checkout it never read or a model set it half-read would put Prismic's
// copy of a model on top of a repo nobody managed to look at.
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { makeSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";
import { siteLabel } from "../../util/site.js";
import type { Site } from "../../types.js";
import {
  diffModels,
  localModels,
  prismicTokenEnvName,
  pushModels,
  readPrismicConfig,
  remoteModels as remoteModelsImpl,
  resolvePrismicToken,
  sendModel as sendModelImpl,
  writeModelFile,
  type FormatModelFile,
  type LocalEntry,
  type PrismicConfig,
  type PrismicModel,
  type RemoteEntry,
} from "../../prismic/models/index.js";
import { formatWithPrettier, PRETTIER_FLAG_NOTE } from "../../recipes/_prettier.js";
import {
  isClean,
  reconcileReport,
  renderModelReport,
  type ReportOptions,
} from "./prismic-models-report.js";

export type PrismicModelsCommandOptions = {
  apply?: boolean;
  pull?: boolean;
  tokens?: boolean;
  fleet?: string;
  workdir?: string;
  writeAirtable?: boolean;
  commentFile?: string;
  cwd?: string;
};

/** Injected IO, so the command is testable without a network or a real token. */
export type PrismicModelsDeps = {
  remoteModels: (repo: string, token: string) => Promise<RemoteEntry[]>;
  sendModel: (
    repo: string,
    token: string,
    entry: LocalEntry,
    action: "insert" | "update",
  ) => Promise<void>;
  env: Record<string, string | undefined>;
  /**
   * Used by `--pull` alone, and never handed to a module.
   *
   * This is an arbitrary-argv primitive: whoever holds it can run `rm -rf` over
   * a model, `git rm` it, or `curl -X DELETE` at the Types API. Task 12's red
   * team pushed `run("rm", ["-rf", model])` through this exact injection point
   * and it passed every assertion, which is why `writeModelFile` now takes a
   * {@link FormatModelFile} — "format these paths in this repo" — instead. The
   * argv is built at the one binding below, where a reviewer can see it.
   */
  spawn: SpawnFn;
};

export const defaultDeps = (): PrismicModelsDeps => ({
  remoteModels: (repo, token) => remoteModelsImpl(repo, token),
  sendModel: (repo, token, entry, action) => sendModelImpl(repo, token, entry, action),
  env: process.env,
  spawn: makeSpawn(),
});

/**
 * A thrown value rendered for a report line, for ANY thrown value.
 *
 * `(e as Error).message` is the obvious version and it is wrong here for the
 * same reason it was wrong in `push.ts` (see `messageOf` there, which enumerates
 * the shapes and cites the verification): `remoteModels` and `sendModel` are
 * INJECTED, so this module can promise nothing about what they throw. A thrown
 * string renders as `undefined` through the cast — an unreadable remote reported
 * with a blank reason, which is precisely the "could not read" fact this file
 * exists to keep legible. `String(e)` is not safe either: `Object.create(null)`
 * has no `toString`, and an Error can carry a `message` getter that throws.
 *
 * Both `catch`es below SWALLOW rather than rethrow. Both run only on a path that
 * is already reporting a failure, so the worst either can do is degrade a
 * message; neither can influence what is reported for a SUCCESSFUL run.
 */
const describeThrown = (e: unknown): string => {
  try {
    if (e instanceof Error && typeof e.message === "string") return e.message;
  } catch {
    // A throwing `message` getter tells us nothing — fall through.
  }
  try {
    return String(e);
  } catch {
    return `<a thrown ${typeof e} that cannot be converted to a string>`;
  }
};

/**
 * Which of the three outcomes a check reached, as DATA rather than as a shape a
 * consumer has to infer.
 *
 *   - `checked` — the comparison ran. `clean` is a boolean verdict.
 *   - `skipped` — a readable repo with no Prismic config. Not a Prismic site;
 *                 nothing to alarm about. The reusable workflow runs on repos
 *                 that have no Prismic at all, so this is a routine outcome.
 *   - `failed`  — we could not find out. Unreadable checkout, broken config,
 *                 missing token, unreadable local models, unreadable remote.
 *
 * `clean: null` alone cannot separate the last two, and they are OPPOSITE
 * operational facts: one is "nothing to do here", the other is this pipeline's
 * governing failure ("I could not read X" wearing the face of "X does not
 * exist"). Task 17's majority-failure exit rule and Task 19's Airtable write
 * both need the distinction, and the only signal available to them without this
 * field is `repositoryName !== null` — which is WRONG for exactly the case that
 * matters: a config that is present and broken never yields a repositoryName,
 * so it is indistinguishable from a genuine skip. Count `status`, not the
 * absence of a name.
 */
export type SiteCheckStatus = "checked" | "skipped" | "failed";

/** The outcome of checking one site.
 *
 *  `clean` is the machine-readable verdict the fleet sweep writes to Airtable and
 *  the cockpit alarms on, and it is deliberately three-valued: `true` in sync,
 *  `false` diverged, `null` NOT KNOWN — the check itself failed. A boolean here
 *  would have to make "we could not find out" wear one of the other two faces.
 *
 *  `clean` and `status` answer different questions and neither implies the
 *  other: `status: "checked"` with `clean: false` is a site that was read
 *  perfectly and disagrees with Prismic (a finding to write down), while
 *  `status: "failed"` with `clean: null` is a site nobody managed to read (an
 *  outage). A sweep that counted only `clean` would report those identically. */
export type SiteCheck = {
  output: string;
  code: number;
  clean: boolean | null;
  status: SiteCheckStatus;
  repositoryName?: string;
};

/** Everything a mode needs about one site — or the NAMED failure that stopped
 *  it, already shaped as a {@link SiteCheck} so no caller has to invent a verdict
 *  for a read that did not happen. */
type SiteInputs =
  | { ok: true; cfg: PrismicConfig; token: string; local: LocalEntry[]; remote: RemoteEntry[] }
  | { ok: false; failure: SiteCheck };

const inputFailure = (
  output: string,
  status: SiteCheckStatus,
  code: number,
  repositoryName?: string,
): SiteInputs => ({
  ok: false,
  failure: {
    output,
    code,
    // `null` on EVERY one of these, so nothing downstream can read a failed read
    // as a verdict about the site.
    clean: null,
    status,
    ...(repositoryName !== undefined ? { repositoryName } : {}),
  },
});

/** Directory entries that are NOT evidence of a checked-out working tree. A
 *  directory containing only these is git metadata (or Finder litter) with no
 *  repository checked out into it — see {@link noWorkingTreeFailure}. */
const NOT_A_WORKING_TREE: ReadonlySet<string> = new Set([".git", ".DS_Store"]);

/**
 * POSITIVE EVIDENCE OF A CHECKOUT, or the named reason there is none.
 *
 * A `readdir` that succeeds proves the DIRECTORY is readable. It does not prove
 * anything was checked out into it, and every verdict below is drawn from what is
 * NOT in that directory — so without this, "I could not establish a checkout"
 * comes out as "this repo has no Prismic in it".
 *
 * The gap that makes it severe is durability. `cloneIfNeeded` accepts ANY
 * non-empty directory at the site's path as that site's checkout
 * (clone-if-needed.ts:138), and `git clone` creates `.git` FIRST and fills the
 * working tree afterwards — so a clone killed in between (its own 5-minute
 * timeout, a cancelled job, a reboot, a full disk) leaves `<workdir>/<slug>/`
 * holding `.git` alone, with `origin` already pointing at the right repo. That
 * directory is non-empty, so no clone is ever attempted again; every config read
 * inside it is ENOENT, so `readPrismicConfig` returns null; and the site then
 * reports "not a Prismic site — skipped", exit 0, ON EVERY RUN AFTER THE FIRST.
 * One interrupted clone silently retires that site's drift alarm, and a fleet of
 * them is a green sweep.
 *
 * THE REAL CAUSE IS ONE LAYER DOWN and is deliberately not fixed here:
 * `cloneIfNeeded`'s "non-empty directory ⇒ this is the checkout" rule, and its
 * identity guard, which RETURNS SILENTLY when it cannot verify
 * (clone-if-needed.ts:100 — a directory with no git origin is treated as
 * verified). Both are shared by nine fleet commands, so changing them from this
 * command would be an unreviewed fleet-wide behaviour change; that deserves its
 * own task. This guard makes the Prismic command honest meanwhile — the answer it
 * refuses to give is the DANGEROUS one ("no Prismic here"), never the safe one.
 *
 * `.DS_Store` sits alongside `.git` because a fleet workdir on darwin acquires one
 * from Finder, and it is no more a working tree than `.git` is.
 */
function noWorkingTreeFailure(
  repoRoot: string,
  entries: readonly string[],
  noEffect: string,
): string | null {
  if (!entries.every((e) => NOT_A_WORKING_TREE.has(e))) return null;
  return (
    `this checkout has no working tree: ${repoRoot} holds` +
    ` ${entries.length === 0 ? "nothing at all" : `only ${entries.join(", ")}`}.` +
    ` ${noEffect} — this is NOT "no Prismic in this repo"; nothing at all was established` +
    ` about this repo. A git clone killed part-way leaves exactly this (a .git and no files),` +
    ` and a fleet workdir REUSES any non-empty directory as that site's checkout, so it will` +
    ` never re-clone by itself. Delete ${repoRoot} and re-run.`
  );
}

/**
 * Every read this command opens with, and the refusals listed at the top of this
 * file that keep them honest — in ONE place, because a mode that repeats them by
 * hand is a mode that can omit one.
 *
 * That is not hypothetical: the first draft of `--pull` made all of these reads
 * with no guard on any of them, which turned a missing checkout into "not a
 * Prismic site — skipped", exit 0, for a mode that WRITES INTO A LIVE CLIENT
 * REPO — and would have let an unreadable local model set sort every remote
 * model into `remoteOnly` and pull the lot over the top of the repo.
 *
 * `noEffect` is the one thing that legitimately differs: the modes undo nothing,
 * but they do different things, and "Nothing was compared and nothing was
 * pushed" is the wrong sentence to print for a pull-down. It is a phrase and not
 * a mode enum on purpose — the guards must not be able to branch on which mode
 * called them.
 */
async function readSiteInputs(
  repoRoot: string,
  deps: PrismicModelsDeps,
  opts: { allowGenericToken: boolean; noEffect: string },
): Promise<SiteInputs> {
  // THE DIRECTORY ITSELF, before anything inside it. `readPrismicConfig` reads
  // `<repoRoot>/slicemachine.config.json`, and for a repoRoot that does not
  // exist that read is ENOENT — which it correctly interprets as "this repo does
  // not have this file" and, having exhausted the candidates, returns null for.
  // That null then lands on the skip below: "not a Prismic site — skipped",
  // exit 0. So a typo'd path, a bad `working-directory:` in a workflow, or a
  // clone that silently failed all produce a GREEN CI RUN WITH A REASSURING
  // MESSAGE — including under `--apply`, the mode that writes to a live client's
  // Prismic repository.
  //
  // This is the governing rule of the pipeline at the command layer: "I could
  // not read X" must never produce the same result as "X does not exist". A
  // missing directory is not a repo without Prismic; it is a repo we never
  // looked at. `readdir` is the cheapest call that distinguishes all three
  // failures at once — ENOENT (not there), ENOTDIR (a file, not a checkout) and
  // EACCES (there and unreadable) — and it is exactly the readability the skip
  // verdict below claims to have established.
  let entries: string[];
  try {
    entries = await readdir(repoRoot);
  } catch (e) {
    return inputFailure(
      `cannot read this checkout at ${repoRoot}: ${describeThrown(e)}. ${opts.noEffect}` +
        ` — this is NOT "no Prismic in this repo".` +
        ` Check the path (a typo, a wrong working-directory, or a clone that failed).`,
      "failed",
      1,
    );
  }

  // A readable directory is not a checkout. The skip below is an assertion about
  // a repo we READ, and it is drawn from what is NOT in this directory — see
  // {@link noWorkingTreeFailure} for the clone that leaves a `.git` and nothing
  // else, and why that answer would then repeat forever.
  const noTree = noWorkingTreeFailure(repoRoot, entries, opts.noEffect);
  if (noTree) return inputFailure(noTree, "failed", 1);

  let cfg: PrismicConfig | null;
  try {
    cfg = await readPrismicConfig(repoRoot);
  } catch (e) {
    // `readPrismicConfig` returns null for "no Prismic here" and THROWS for a
    // config that is present and unusable. Those two must not land on the same
    // line: the skip below is a green exit, and a live site whose config broke
    // would then leave CI green while nothing was compared at all.
    return inputFailure(
      `Prismic config present but unusable: ${describeThrown(e)}. ${opts.noEffect}` +
        ` — this is NOT "no Prismic in this repo".`,
      "failed",
      1,
    );
  }
  if (!cfg) {
    return inputFailure("not a Prismic site (no repositoryName) — skipped", "skipped", 0);
  }

  // Derived BEFORE the lookup, because the name is what the operator needs in
  // the failure message and `prismicTokenEnvName` can itself throw (a
  // repositoryName with no alphanumeric characters would collapse every such
  // repo onto the bare `PRISMIC_TOKEN_` prefix, so it refuses). Uncaught, that
  // throw would take out the whole run — including the comment file — for a
  // config typo.
  let canonicalEnv: string;
  try {
    canonicalEnv = prismicTokenEnvName(cfg.repositoryName);
  } catch (e) {
    return inputFailure(
      `cannot work out which secret holds this repository's token: ${describeThrown(e)}`,
      "failed",
      1,
      cfg.repositoryName,
    );
  }

  const resolved = resolvePrismicToken(cfg.repositoryName, deps.env, {
    allowGeneric: opts.allowGenericToken,
  });
  if (!resolved) {
    const names = [canonicalEnv];
    if (opts.allowGenericToken) names.push("PRISMIC_WRITE_TOKEN");
    return inputFailure(
      `no write token for Prismic repository "${cfg.repositoryName}" — set ${names.join(" or ")}`,
      "failed",
      1,
      cfg.repositoryName,
    );
  }

  // Local first: it is free, and a repo that cannot be read has nothing to say
  // to Prismic. `localModels` throws on a model file that is present and
  // unreadable, and on a duplicate model id — both are "this checkout cannot be
  // trusted", and with `--apply` treating either as "the repo declares fewer
  // models" is a push computed from a half-read repository.
  //
  // The pull-down reads it for the mirror-image reason: models it cannot see
  // locally sort into `remoteOnly`, and a pull-down of a model the repo already
  // has overwrites the local file with Prismic's copy — losing exactly the edits
  // that were waiting to be pushed.
  let local: LocalEntry[];
  try {
    local = await localModels(repoRoot, cfg.libraries);
  } catch (e) {
    return inputFailure(
      `could not read this repo's own models: ${describeThrown(e)}. ${opts.noEffect}.`,
      "failed",
      1,
      cfg.repositoryName,
    );
  }

  let remote: RemoteEntry[];
  try {
    remote = await deps.remoteModels(cfg.repositoryName, resolved.token);
  } catch (e) {
    // The single most destructive default available in this pipeline is `[]`
    // here: an empty remote sorts every local model into `toCreate` and, under
    // `--apply`, pushes a whole model set at a repository that may already hold
    // perfectly good models. An expired token is the likely trigger and Prismic's
    // token expiry is undocumented, so this is not a rare branch.
    return inputFailure(
      `could not read Prismic models: ${describeThrown(e)}`,
      "failed",
      1,
      cfg.repositoryName,
    );
  }

  return { ok: true, cfg, token: resolved.token, local, remote };
}

/** One site, one Prismic repository, one comparison. Shared by in-repo and fleet
 *  modes so a nightly verdict and a CI verdict can never disagree by construction.
 *
 *  Every failure RETURNS rather than throws. In-repo that keeps the report and
 *  the comment file — a throw would lose both and leave a reviewer with a stack
 *  trace instead of a reason. In fleet mode it is stronger than that: one repo
 *  with a broken config or a duplicate model id must not abort the sweep of the
 *  other fourteen. */
export async function checkOneSite(
  repoRoot: string,
  deps: PrismicModelsDeps,
  opts: { apply: boolean; allowGenericToken: boolean },
): Promise<SiteCheck> {
  const inputs = await readSiteInputs(repoRoot, deps, {
    allowGenericToken: opts.allowGenericToken,
    noEffect: "Nothing was compared and nothing was pushed",
  });
  if (!inputs.ok) return inputs.failure;
  const { cfg, token, local, remote } = inputs;

  const diff = diffModels(local, remote);
  const report = await pushModels(diff, {
    apply: opts.apply,
    send: (entry: LocalEntry, _remote: PrismicModel | undefined, action) =>
      deps.sendModel(cfg.repositoryName, token, entry, action),
  });

  // Zero models on BOTH sides passes `isClean`, and the renderer prints a warning
  // saying in words that it is a misconfiguration rather than a clean run. This
  // is the same verdict in the field the cockpit reads: reporting `clean: true`
  // for the state the report itself calls broken is how a wrong repositoryName,
  // a dead slice-library path, or a partial checkout becomes a green row in
  // Airtable. `false` (diverged — a human should look) rather than `null`,
  // because the check itself did not fail; it succeeded and found nothing, which
  // is a finding.
  const foundNothingAnywhere = isClean(diff) && diff.unchanged.length === 0;

  // ONE options object, built here and handed to BOTH the reconciliation and the
  // renderer. Two objects would be two questions, and the verdict could then
  // disagree with the prose printed directly above it.
  //
  // Pass the WHOLE report, not `failed: report.failed`.
  //
  // This is the only place in the pipeline that constructs `ReportOptions`, so
  // destructuring one field here is what decides whether the renderer's
  // reconciliation ever runs at all. With only `failed` supplied, `opts.report`
  // is undefined at every call site and every cross-check that needs a report —
  // remoteOnly, apply-vs-mode, and the sent/failed bucket invariant — silently
  // does nothing, and the safeguard ships dark.
  //
  // `report` INSTEAD OF `failed`, not in addition: with one source for the
  // failure list there is nothing to reconcile and that one check correctly
  // skips, while the rest light up. Pinned by
  // tests/cli/prismic-models-wiring.test.ts, which feeds in a push report that
  // disagrees with the diff and asserts the report says so.
  const reportOptions: ReportOptions = { apply: opts.apply, report };

  // The renderer's head says, in prose, "⚠ INCONSISTENT — ... do not act on
  // this." A machine-readable verdict of `clean: true` under that sentence is
  // the report contradicting itself, and it is the field — not the prose — that
  // reaches Airtable and the cockpit. So the same fact drives both, read as
  // DATA. It is deliberately NOT recovered by grepping the rendered string: that
  // would make the exact wording of a warning load-bearing, and rewording it
  // would silently turn every inconsistent site green.
  const inconsistencies = reconcileReport(diff, reportOptions);

  return {
    output: renderModelReport(cfg.repositoryName, diff, reportOptions),
    // A dry run NEVER fails on drift: a model PR is supposed to differ from the
    // remote, and the comment is the review artifact, not a gate. Only a real
    // push failure — or one of the "we could not find out" returns above — is an
    // error.
    //
    // An inconsistency IS such an error, on both modes. Drift is a fact about
    // the site; an inconsistency is a fact about the report, which says every
    // figure in it is unreliable. Letting that pass green is a reviewer
    // approving a merge from numbers the report itself disowns.
    code: report.failed.length > 0 || inconsistencies.length > 0 ? 1 : 0,
    // `false`, not `null`, and for the same reason as `foundNothingAnywhere`
    // above: the check ran to completion and produced a finding — its inputs
    // disagree — so a human needs to look. `null` means "we never found out".
    //
    // An earlier version of this comment justified that by saying `null` would
    // count toward Task 17's majority-failure rule; Task 17 falsified it. That
    // rule counts `status`, and this row is `status: "checked"` on either value,
    // so the sweep's exit code would not move — which is the point. `clean` is
    // the PER-SITE verdict: the field the sweep carries for each row and the one
    // Task 19 writes to Airtable and the cockpit alarms on. `null` there writes
    // no verdict at all for a check that ran to completion and found something,
    // so the loudest failure this renderer can report would be the one row the
    // fleet never hears about.
    clean: inconsistencies.length > 0 ? false : isClean(diff) && !foundNothingAnywhere,
    status: "checked",
    repositoryName: cfg.repositoryName,
  };
}

/**
 * One site's token situation — the row `--tokens` prints, as DATA.
 *
 * `present` and `reads` are separate on purpose: Prismic write-token expiry is
 * undocumented and was never proven either way, and "present but no longer
 * reads" is exactly the shape an expiry would take. Collapsing them into one
 * boolean would report an expired token as a missing one and send the operator
 * to mint a duplicate.
 *
 * `reads` is THREE-valued for the same family of reason, one step further out.
 * This doctor makes no Prismic call at all, so for every probe it builds today
 * `reads` is `null` — NOBODY CHECKED — and the renderer says so in those words.
 * A two-valued `reads` would have to spell "I did not look" as either "it works"
 * or "it is broken", and the first of those is this pipeline's governing failure
 * pointed at its own output.
 *
 * NOTE WHAT IS NOT HERE: a token value. There is no field for one, so no
 * renderer, no formatter and no future edit to this row can print a live write
 * credential into a CI log or an operator's scrollback. The check that decides
 * `present` reads the environment variable's emptiness and keeps nothing.
 */
export type TokenProbe = {
  /** The checkout this row is about — the repo directory name, which is what the
   *  operator has in front of them. Printed alongside `repositoryName` because
   *  the two routinely differ (beachfront-dentistry's Prismic repository is
   *  `48bb12d1`, which is otherwise unattributable to any site). */
  site: string;
  /**
   * Which of the three outcomes this probe reached — and the field the renderer
   * keys on, for exactly the reason {@link SiteCheckStatus} exists one screen up.
   *
   * A config that is THERE and broken yields no `repositoryName`, precisely like
   * a repo that has no Prismic at all. A renderer keyed on `repositoryName ===
   * null` therefore reports a live client's site whose config just broke as "no
   * Prismic config — this site needs no token", and the operator mints nothing
   * for it. Count `status`, not the absence of a name.
   */
  status: SiteCheckStatus;
  repositoryName: string | null;
  expectedEnv: string | null;
  present: boolean;
  /** `true` a read succeeded, `false` it failed, `null` NOBODY CHECKED. */
  reads: boolean | null;
  /** Why this site could not be read (`status: "failed"`), or why a present
   *  token did not read. Never a token value. */
  error?: string;
};

const SITE_COL = 28;
const REPO_COL = 26;
/** Wide enough for the longest name the rule can derive in this fleet
 *  (`PRISMIC_TOKEN_MEDICAL_SOLUTIONS_OF_TEXAS`, 40 characters). Names are never
 *  shortened to fit — a truncated secret name is a secret nobody can mint. */
const ENV_COL = 40;
const NO_VALUE = "—";

/** Prose above the table. Deliberately contains neither "OK" nor "MISSING":
 *  those two words are verdicts in the rows below, and a test that asserts a
 *  verdict is ABSENT would be satisfied by nothing if the header said it. */
const DOCTOR_HEADER: readonly string[] = [
  "Prismic write-token doctor — which secret each site needs, and whether it is set.",
  "",
  "The naming rule is PRISMIC_TOKEN_<REPOSITORY NAME>, upper-snaked from the PRISMIC",
  "repository name, which is routinely not the repo directory name: reddoor-website's",
  "repository is reddoor-la, data-dynamiq's is reddoor-wireframer, and",
  "beachfront-dentistry's is 48bb12d1. Prefix-first is deliberate — it guarantees a",
  "leading letter, and 48BB12D1_PRISMIC is rejected both by shell sourcing and by this",
  "repo's own credentials parser.",
  "",
  "The generic PRISMIC_WRITE_TOKEN is NOT consulted here. It is the in-repo CI fallback",
  "for whichever single repository a workflow is checked out against; this table is the",
  "per-repository checklist, and a fallback cannot tick a repository's own box.",
  "",
  "Nothing below was verified against Prismic and no token value is ever printed — this",
  "reads the environment for emptiness only. A secret that is set is reported as",
  "PRESENT (not verified); run `reddoor-maint prismic-models` in the site to find out",
  "whether it actually works.",
  "",
  `${"repo".padEnd(SITE_COL)} ${"Prismic repository".padEnd(REPO_COL)} ${"secret".padEnd(ENV_COL)} verdict`,
];

/** The operator's rename checklist. Prints the env var NAME that was looked for,
 *  never a token value — see {@link TokenProbe}, which holds no value to print. */
export function renderTokenDoctor(probes: readonly TokenProbe[]): string {
  const lines: string[] = [...DOCTOR_HEADER];
  let ok = 0;
  let missing = 0;
  let failing = 0;
  let unverified = 0;
  let unreadable = 0;
  let skipped = 0;
  for (const p of probes) {
    const cols =
      `${p.site.padEnd(SITE_COL)} ${(p.repositoryName ?? NO_VALUE).padEnd(REPO_COL)}` +
      ` ${(p.expectedEnv ?? NO_VALUE).padEnd(ENV_COL)}`;
    let verdict: string;
    if (p.status === "failed") {
      unreadable++;
      // NOT the skip below, and the wording carries the distinction rather than
      // leaving it to a column: this site may well need a secret, and nobody
      // found out which one.
      verdict =
        `CANNOT TELL — ${p.error ?? "this site could not be read"}.` +
        ` Nothing was established about this site's secret.`;
    } else if (p.status === "skipped") {
      skipped++;
      verdict = "no Prismic config (skipped) — this site needs no token";
    } else if (!p.present) {
      missing++;
      verdict = "MISSING — mint this secret";
    } else if (p.reads === false) {
      failing++;
      verdict = `PRESENT BUT 403/FAILED — ${p.error ?? "read failed"}`;
    } else if (p.reads === true) {
      ok++;
      verdict = "OK";
    } else {
      unverified++;
      verdict = "PRESENT (not verified)";
    }
    lines.push(`${cols} ${verdict}`);
  }
  lines.push("");
  if (unreadable > 0) {
    lines.push(
      `⚠ ${unreadable} site(s) could not be read at all. Those are NOT sites without` +
        ` Prismic — nothing was established about their secrets, so do not read this table` +
        ` as a complete checklist.`,
    );
  }
  // Every probe lands in exactly one of these, so a site can never fall out of
  // the total: a summary that counted only the three outcomes an operator likes
  // is how unreadable sites disappear from a checklist.
  lines.push(
    `${ok} ok, ${missing} missing, ${failing} failing, ${unverified} unverified,` +
      ` ${unreadable} unreadable, ${skipped} skipped.`,
  );
  return lines.join("\n");
}

/**
 * Work out which secret ONE checkout needs, and whether it is set.
 *
 * The guards are the same three the in-repo check opens with, in the same order
 * and for the same reason — a missing checkout and a broken config both read as
 * "no Prismic config here" if you only ask `readPrismicConfig`, and this command
 * is the one an operator uses to decide which secrets to mint. Reporting "needs
 * no token" for a site nobody could read is how a live client's site quietly
 * drops off the checklist.
 *
 * `resolvePrismicToken` is deliberately NOT used: it RETURNS THE TOKEN, and this
 * function must never hold one. It asks the same question of the environment —
 * a value that is missing or whitespace-only is absent — so the doctor's verdict
 * and the pipeline's own resolution cannot disagree.
 */
async function probeSiteToken(
  repoRoot: string,
  env: Record<string, string | undefined>,
): Promise<TokenProbe> {
  const site = basename(repoRoot) || repoRoot;
  const blank = {
    site,
    repositoryName: null,
    expectedEnv: null,
    present: false,
    reads: null,
  } as const;

  let entries: string[];
  try {
    entries = await readdir(repoRoot);
  } catch (e) {
    return {
      ...blank,
      status: "failed",
      error: `cannot read this checkout at ${repoRoot}: ${describeThrown(e)}`,
    };
  }

  // The doctor's `skipped` row says "this repo needs no secret", which is the
  // same dangerous answer the sweep's skip is, reached the same way — see
  // {@link noWorkingTreeFailure}. Sharing the check rather than repeating it,
  // because two copies of a guard are two chances to fix only one of them.
  const noTree = noWorkingTreeFailure(
    repoRoot,
    entries,
    "Nothing was established about this repo's token",
  );
  if (noTree) return { ...blank, status: "failed", error: noTree };

  let cfg: PrismicConfig | null;
  try {
    cfg = await readPrismicConfig(repoRoot);
  } catch (e) {
    return {
      ...blank,
      status: "failed",
      error: `Prismic config present but unusable: ${describeThrown(e)}`,
    };
  }
  if (!cfg) return { ...blank, status: "skipped" };

  let expectedEnv: string;
  try {
    expectedEnv = prismicTokenEnvName(cfg.repositoryName);
  } catch (e) {
    return {
      ...blank,
      status: "failed",
      repositoryName: cfg.repositoryName,
      error: `cannot work out which secret holds this repository's token: ${describeThrown(e)}`,
    };
  }

  return {
    site,
    status: "checked",
    repositoryName: cfg.repositoryName,
    expectedEnv,
    // The one read of the environment, and only its emptiness survives this
    // expression. `.trim()` matches `resolvePrismicToken` exactly: a
    // whitespace-only secret is one the pipeline itself refuses, so a doctor
    // that called it present would tick a box the push would then fail on.
    present: (env[expectedEnv] ?? "").trim() !== "",
    reads: null,
  };
}

/** `--tokens`: the doctor. Non-zero when there is something for the operator to
 *  do — a secret to mint, or a site nobody could read. */
async function runTokenDoctor(
  repoRoot: string,
  deps: PrismicModelsDeps,
): Promise<{ output: string; code: number }> {
  const probes = [await probeSiteToken(repoRoot, deps.env)];
  const actionable = probes.some(
    (p) => p.status === "failed" || (p.status === "checked" && (!p.present || p.reads === false)),
  );
  return { output: renderTokenDoctor(probes), code: actionable ? 1 : 0 };
}

/**
 * `--pull`: bring models that exist ONLY in Prismic into the repo, as files.
 *
 * This is the safe answer to `remoteOnly`. CI reports those models and can never
 * delete them, which leaves exactly two resolutions: adopt the model into the
 * repo (here) or delete it in the Prismic dashboard (a human, in a browser).
 * Without this the nightly drift alarm has no non-manual way to clear.
 *
 * Operator-invoked only — never in CI. It mutates a working tree, and the
 * resulting files are meant to land as a reviewed PR.
 */
async function pullRemoteOnly(
  repoRoot: string,
  deps: PrismicModelsDeps,
): Promise<{ output: string; code: number }> {
  // The same guards the comparison runs, and for a WRITE mode they matter more,
  // not less: a missing checkout reported as "not a Prismic site" or a half-read
  // local model set both end with Prismic's copy of a model written over a repo
  // nobody managed to read.
  const inputs = await readSiteInputs(repoRoot, deps, {
    // TRUE, for the same reason the in-repo check sets it: one checkout, one
    // Prismic repository, and `--pull` is refused outright in fleet mode — where
    // a single generic token would attach the wrong credential to every site
    // after the first.
    allowGenericToken: true,
    noEffect: "Nothing was pulled and nothing was written",
  });
  if (!inputs.ok) return { output: inputs.failure.output, code: inputs.failure.code };
  const { cfg, local, remote } = inputs;

  const diff = diffModels(local, remote);
  if (diff.remoteOnly.length === 0) {
    return { output: `nothing to pull — no remote-only models in ${cfg.repositoryName}`, code: 0 };
  }

  // NOT `cfg.libraries[0] ?? "./src/lib/slices"`. That default re-collapses a
  // distinction `config.ts` deliberately makes: an ABSENT `libraries` key gets
  // the fleet default THERE, but `libraries: []` is a STATEMENT — "this site has
  // no slice libraries" — and config.ts documents it as such. Fabricating the
  // fleet default here writes a slice model into a directory the site does not
  // use and reports it as a successful pull.
  //
  // The blank is passed STRAIGHT THROUGH to `modelFilePath`, which refuses it
  // per model, rather than being turned into a whole-run refusal: a custom type
  // needs no slice library, and a site with `libraries: []` must still be able
  // to adopt one. Refusing the run would make the fleet's own config statement
  // into a hard stop on a mode that has nothing to do with slices.
  //
  // `[0]` is an unstated rule when several libraries exist. The fleet is uniform
  // at one today, so this is not yet a live ambiguity — but the report SAYS
  // which one was chosen rather than letting index 0 decide in silence.
  const library = cfg.libraries[0] ?? "";

  // `writeModelFile` takes a FORMAT capability, not a process spawner — see
  // `deps.spawn`. The argv is built here, at the single injection site, which is
  // the one place a reviewer can see it. Passing `deps.spawn` straight through
  // is a tsc error, deliberately.
  const format: FormatModelFile = (root, paths, fmtOpts) =>
    formatWithPrettier(deps.spawn, root, paths, fmtOpts);

  const lines: string[] = [`Prismic pull-down — repository: ${cfg.repositoryName}`];
  if (cfg.libraries.length === 0) {
    lines.push(
      `slice library: NONE — this site's Prismic config declares no slice library, so no` +
        ` slice can be placed. Custom types are unaffected.`,
    );
  } else {
    lines.push(
      `slice library: ${library}` +
        (cfg.libraries.length > 1
          ? ` (the first of ${cfg.libraries.length} declared; the others are not written to)`
          : ""),
    );
  }
  lines.push("");

  // FAILURE IS PER-MODEL, exactly as in `pushModels`. The guards in
  // `writeModelFile` make refusals genuinely reachable — a directory already
  // occupied by a DIFFERENT model id is the live case, because slice directory
  // names are derived from the id and the fleet copies slices between sites —
  // and a loop that threw on the first refusal would leave the models it had
  // already written on disk with no record of which. That is the same "report
  // that silently omits models" `push.ts` refuses to produce.
  let unformatted = 0;
  let refused = 0;
  for (const entry of diff.remoteOnly) {
    try {
      const res = await writeModelFile(format, repoRoot, entry, library);
      if (!res.formatted) unformatted++;
      lines.push(
        `pulled   ${entry.kind} ${entry.id}  -> ${res.path}${res.formatted ? "" : "  (unformatted)"}`,
      );
    } catch (e) {
      refused++;
      lines.push(`REFUSED  ${entry.kind} ${entry.id}  — ${describeThrown(e)}`);
    }
  }
  if (unformatted > 0) lines.push(`⚠ ${PRETTIER_FLAG_NOTE}`);
  lines.push("");
  lines.push(
    `${diff.remoteOnly.length - refused} of ${diff.remoteOnly.length} model(s) pulled` +
      (refused > 0 ? `, ${refused} refused` : "") +
      `.`,
  );
  if (refused < diff.remoteOnly.length) lines.push("Review, commit, and open a PR.");
  if (refused > 0) {
    lines.push(
      `A refusal leaves that model ONLY in Prismic — nothing was deleted there and nothing` +
        ` was overwritten here. Act on each REFUSED line above.`,
    );
  }
  // A refusal is a real finding the operator must act on, so it must not exit 0.
  return { output: lines.join("\n"), code: refused > 0 ? 1 : 0 };
}

/** Exit code for a fleet sweep. Non-zero when failures are the MAJORITY of the
 *  fleet, matching `githubSignalsExitCode` — a run where 11/12 repos could not be
 *  read is an outage, not a flake. DRIFT is never a failure: a readable site that
 *  diverges is a finding written to Airtable, and reddening the nightly for it
 *  would make the alarm meaningless the first time someone edits a model.
 *
 *  An exact tie is NOT a majority, deliberately and in agreement with
 *  `githubSignalsExitCode`: 6 read and 6 unreadable is bad, but it is the
 *  Airtable rows for the 6 that were read — not this exit code — that say so, and
 *  a rule that reddened on a tie would fire the first time half a small fleet was
 *  legitimately mid-migration. */
export function prismicSweepExitCode(checked: number, failed: number): number {
  return failed > checked ? 1 : 0;
}

/**
 * WHICH COMMIT the comparison was actually made against.
 *
 * Two-valued and never a bare string, for the reason `clean` is three-valued: a
 * row that could not name its commit must not be indistinguishable from one that
 * did. `resolved` is a sha read out of the checkout's own refs; `unresolved`
 * carries the REASON, which is printed rather than swallowed.
 */
export type CheckoutCommit = { resolved: string } | { unresolved: string };

/** One row per site from a fleet sweep, ready for the Airtable writer. */
export type SweepRow = {
  site: string;
  repositoryName: string | null;
  /** The commit this site's verdict describes, or `null` when no checkout was
   *  established at all (a prep failure — there is nothing on disk to name).
   *  Present because the sweep REUSES checkouts and never refreshes them; see
   *  {@link resolveCheckoutCommit}. */
  commit: CheckoutCommit | null;
  /** Did the check RUN — separate from what it found. `skipped` means this repo
   *  has no Prismic config; `failed` means we could not find out. Those were
   *  once both `clean: null`, which made a broken config score as a routine skip
   *  and disappear from the outage count. Carried through from `checkOneSite`,
   *  never re-derived. */
  status: SiteCheckStatus;
  /** Does the repo match Prismic. Only meaningful when `status === "checked"`. */
  clean: boolean | null;
  detail: string;
};

/**
 * Sites that claim the same Prismic repository as another site.
 *
 * The fleet-level twin of `assertNoDuplicateIds`: there, two files inside one
 * repo claiming one model id; here, two repos claiming one Prismic repository.
 * It is possible today — `the-tower` and `the-tower-burbank` both declare
 * `repositoryName: "the-tower-burbank"`, benign only because `the-tower` is
 * archived and so is not in the fleet inventory.
 *
 * Why this DETECTS instead of throwing, unlike `assertNoDuplicateIds`: that one
 * aborts the read of a single broken repo, which is proportionate. Aborting here
 * would take the drift alarm offline for every site in the fleet because two
 * repos have a config problem — and the sweep is read-only, so nothing is being
 * corrupted at the moment of detection. The real damage happens later and
 * elsewhere: each repo's own CI pushes to the shared Prismic repository on
 * merge, and each overwrites the other. Neither repo can ever see it, because
 * each one's local-vs-remote comparison is internally consistent; the conflict
 * exists only BETWEEN them.
 *
 * That makes the fleet sweep the only vantage point in the whole system from
 * which this is visible — so it must report it loudly and go non-zero, and it
 * must name both sites, because only a human can say which repo is the owner.
 *
 * Sites with no Prismic config (`null`) never collide with each other.
 *
 * A site whose check FAILED is a different matter, and an earlier version of
 * this docblock got it backwards: it claimed a failed site has no
 * repositoryName. Most of them DO. `inputFailure` carries `cfg.repositoryName`
 * through on the token-missing, local-models-unreadable and remote-unreadable
 * paths, so those rows reach this detector with a name — and that is right, not
 * a leak: a repo that DECLARES a Prismic repository claims it whether or not we
 * managed to read its models, and its own CI will push to it on merge either
 * way. Only the failures that never got as far as a usable config (an unreadable
 * or working-tree-less checkout, a present-but-broken config, a repositoryName
 * that derives no env var) carry `null`, and those genuinely cannot collide with
 * anything — nobody knows what they claim.
 */
export type RepositoryCollision = { repositoryName: string; sites: string[] };

/**
 * One row per SITE IDENTITY, first wins.
 *
 * Both detectors below group by name, and a name group with more than one member
 * is their alarm — so an inventory that lists ONE site twice makes that site look
 * like two sites fighting over a repository. The remediation text then sends the
 * operator to fix a `slicemachine.config.json` that is not wrong, in a live
 * client repo, for a conflict that does not exist. False positives in a safety
 * alarm are how the alarm gets ignored, and this one has to survive being right
 * rarely.
 *
 * Identity is the row's site label — `siteLabel`, i.e. the inventory `name` or
 * the path — because that is the only identity this layer has. The duplication
 * itself is not thrown away: {@link findDuplicateSiteRows} reports it as what it
 * is, an inventory wart.
 */
function uniqueBySite<T extends { site: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.site) ? false : (seen.add(r.site), true)));
}

export function findRepositoryCollisions(
  rows: ReadonlyArray<{ site: string; repositoryName: string | null }>,
): RepositoryCollision[] {
  const byRepository = new Map<string, string[]>();
  // DEDUPED INSIDE the detector, not at the call site: a caller that forgets is
  // a caller that ships the false alarm.
  for (const r of uniqueBySite(rows)) {
    if (r.repositoryName === null) continue;
    const list = byRepository.get(r.repositoryName) ?? [];
    list.push(r.site);
    byRepository.set(r.repositoryName, list);
  }
  return (
    [...byRepository.entries()]
      .filter(([, sites]) => sites.length > 1)
      .map(([repositoryName, sites]) => ({ repositoryName, sites: [...sites].sort() }))
      // Sorted so the block an operator diffs run to run does not reorder itself
      // when the inventory does.
      .sort((a, b) => a.repositoryName.localeCompare(b.repositoryName))
  );
}

/**
 * Two DIFFERENT Prismic repositories whose token env vars collapse onto one name.
 *
 * The second axis of the same conflict, and the more dangerous one, because
 * nothing else in the system can see it. `findRepositoryCollisions` groups by
 * `repositoryName`; the CREDENTIAL is keyed by `prismicTokenEnvName`, which
 * upper-snakes the name and collapses every run of non-alphanumerics to one `_`.
 * So `the-pointe`, `the.pointe`, `the_pointe` and `The Pointe` are four distinct
 * Prismic repositories that all derive `PRISMIC_TOKEN_THE_POINTE` — no
 * repositoryName collision, one secret.
 *
 * What follows from that is the worst outcome fleet mode can produce: the sweep
 * sends ONE client's write token to ANOTHER client's repository. Read-only today
 * that is mostly a 401 the operator reads as an expired token — and the natural
 * fix, re-minting `PRISMIC_TOKEN_THE_POINTE` from the other repository, just
 * moves the breakage to the site that was working. It is exactly the
 * cross-wiring `allowGeneric: false` exists to prevent, reintroduced through the
 * naming rule instead of through the environment.
 *
 * Reported SEPARATELY from a repositoryName collision because the operator's fix
 * is different: that one is "rename a repository in one repo's
 * slicemachine.config.json"; this one cannot be fixed in either repo, because
 * both configs are correct — the derivation rule is what collapses them.
 *
 * Verified 2026-08-13 across the 15 in-scope repos, each read from its own
 * `origin/HEAD` via `git ls-tree` + `git show` (never a working tree): 15 distinct
 * repositoryNames, 15 distinct derived env vars, no collision on either axis. So
 * this ships dark — which is the only state in which a safety alarm can be
 * trusted when it does fire.
 */
export type TokenEnvCollision = {
  envName: string;
  entries: { site: string; repositoryName: string }[];
};

export function findTokenEnvCollisions(
  rows: ReadonlyArray<{ site: string; repositoryName: string | null }>,
): TokenEnvCollision[] {
  const byEnv = new Map<string, { site: string; repositoryName: string }[]>();
  for (const r of uniqueBySite(rows)) {
    if (r.repositoryName === null) continue;
    let envName: string;
    try {
      envName = prismicTokenEnvName(r.repositoryName);
    } catch {
      // A repositoryName with no alphanumeric characters derives NO env var, so
      // it cannot collide with anything — and it is already a `failed` row that
      // names itself (see `readSiteInputs`). Swallowing the throw here is not a
      // silent skip: the site is reported, just not by this detector.
      continue;
    }
    const list = byEnv.get(envName) ?? [];
    list.push({ site: r.site, repositoryName: r.repositoryName });
    byEnv.set(envName, list);
  }
  return (
    [...byEnv.entries()]
      // MORE THAN ONE REPOSITORY, not more than one row. Two sites declaring the
      // SAME repositoryName derive the same env var by definition and are the
      // other detector's finding; reporting them here too would print two alarms
      // with two different fixes for one problem.
      .filter(([, entries]) => new Set(entries.map((e) => e.repositoryName)).size > 1)
      .map(([envName, entries]) => ({
        envName,
        entries: [...entries].sort((a, b) => a.site.localeCompare(b.site)),
      }))
      .sort((a, b) => a.envName.localeCompare(b.envName))
  );
}

/** The report block for a derived-env-var collision. Separate from
 *  {@link describeCollisions} because the fix is different — see
 *  {@link TokenEnvCollision}. */
export function describeTokenEnvCollisions(collisions: readonly TokenEnvCollision[]): string {
  if (collisions.length === 0) return "";
  return [
    "## ⛔ One token secret derived by more than one Prismic repository",
    "",
    ...collisions.map(
      (c) =>
        `- **${c.envName}** is derived by ${c.entries
          .map((e) => `${e.site} (${e.repositoryName})`)
          .join(" and ")}. These are DIFFERENT Prismic repositories reading ONE secret, so ` +
        `whichever token is set is sent to both — one client's credential at another ` +
        `client's repository. Neither repo's config is wrong, so do not "fix" one of them: ` +
        `the env var NAME is derived from the repository name and collapses them. Rename one ` +
        `Prismic repository, or give the derivation a disambiguator. Until then, treat both ` +
        `sites' verdicts as unproven.`,
    ),
  ].join("\n");
}

/** A site listed more than once in the inventory. */
export type DuplicateSiteRow = { site: string; count: number; repositoryNames: string[] };

/**
 * Sites the inventory named more than once.
 *
 * A NOTE, not an alarm, and deliberately not an exit code: every one of those
 * rows was actually swept, nothing was mis-compared, and no client repo needs
 * changing — the inventory does. Making it non-zero would redden a nightly for a
 * duplicated Airtable row, which is how an operator learns to ignore the red.
 *
 * It still has to be SAID, because the detectors above now drop the duplicates
 * (see {@link uniqueBySite}) and a fact nobody prints is a fact nobody fixes. The
 * distinct repositoryNames are listed because a repeated label carrying two
 * DIFFERENT names is a sharper problem than a repeated row: one of the two rows
 * is being reported under a label that does not describe it.
 */
export function findDuplicateSiteRows(
  rows: ReadonlyArray<{ site: string; repositoryName: string | null }>,
): DuplicateSiteRow[] {
  const bySite = new Map<string, (string | null)[]>();
  for (const r of rows) {
    const list = bySite.get(r.site) ?? [];
    list.push(r.repositoryName);
    bySite.set(r.site, list);
  }
  return [...bySite.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([site, names]) => ({
      site,
      count: names.length,
      repositoryNames: [...new Set(names.filter((n): n is string => n !== null))].sort(),
    }))
    .sort((a, b) => a.site.localeCompare(b.site));
}

export function describeDuplicateSiteRows(duplicates: readonly DuplicateSiteRow[]): string {
  if (duplicates.length === 0) return "";
  return [
    "## ⚠ A site is listed more than once in the inventory",
    "",
    ...duplicates.map((d) => {
      const names =
        d.repositoryNames.length === 0
          ? "no repositoryName was established for it"
          : `repositoryName ${d.repositoryNames.join(" and ")}`;
      return (
        `- **${d.site}** appears ${d.count}× (${names}). It was swept ${d.count}×, so the ` +
        `counts below are inflated by ${d.count - 1}. This is an INVENTORY problem, not a ` +
        `conflict between two sites — do not change a slicemachine.config.json for it.`
      );
    }),
  ].join("\n");
}

/** The report block for a collision. Deliberately shouty, and deliberately at
 *  the TOP of the sweep output: this is the one finding in the sweep that no
 *  per-repo CI run can ever surface. */
export function describeCollisions(collisions: readonly RepositoryCollision[]): string {
  if (collisions.length === 0) return "";
  return [
    "## ⛔ Prismic repository claimed by more than one site",
    "",
    ...collisions.map(
      (c) =>
        `- **${c.repositoryName}** is claimed by ${c.sites.join(" and ")}. ` +
        `Each repo's CI pushes to it on merge, so they overwrite each other — ` +
        `and neither repo can detect this on its own. Fix the ` +
        `slicemachine.config.json in whichever repo is not the owner.`,
    ),
  ].join("\n");
}

/**
 * The three buckets, counted ONCE.
 *
 * The line an operator reads and the exit code that wakes them up are derived
 * from this one function on purpose. Counted separately they are two questions,
 * and a later edit to one of them produces a report that says "2 failed" above an
 * exit 0 — the same self-contradiction `checkOneSite` refuses when it drives its
 * verdict and its prose from one fact.
 *
 * Every row lands in exactly one bucket, so a site can never fall out of the
 * total — the same rule `renderTokenDoctor`'s summary follows, and for the same
 * reason: a summary that counted only the outcomes an operator likes is how
 * unreadable sites disappear from a checklist.
 */
export function countSweep(rows: readonly SweepRow[]): {
  checked: number;
  failed: number;
  skipped: number;
} {
  return {
    checked: rows.filter((r) => r.status === "checked").length,
    failed: rows.filter((r) => r.status === "failed").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
  };
}

/**
 * The count line, and the warning that keeps it honest.
 *
 * `failed` and `skipped` are adjacent here, which is precisely why the line
 * spells out in words that they are opposite facts.
 */
export function summariseSweep(rows: readonly SweepRow[]): string {
  const { checked, failed, skipped } = countSweep(rows);
  const lines: string[] = [];
  if (failed > 0) {
    lines.push(
      `⚠ ${failed} site(s) could not be read at all. Those are NOT sites without Prismic —` +
        ` nothing was established about their models, so do not read this sweep as a complete` +
        ` picture of the fleet.`,
    );
  }
  lines.push(
    `${checked} checked, ${failed} failed, ${skipped} skipped (no Prismic config),` +
      ` of ${rows.length} site(s).`,
  );
  // WHAT WAS COMPARED, in the same breath as how many. The sweep reuses whatever
  // checkout is already in the workdir and refreshes nothing (see
  // {@link resolveCheckoutCommit}), so "espada matches Prismic" is a statement
  // about a commit, not about that repo's default branch. Printed unconditionally
  // rather than only when something looks stale: a caveat that appears only when
  // the tool notices a problem is a caveat nobody has read by the time it matters.
  lines.push(
    `Each site was compared AS ITS CHECKOUT STANDS ON DISK. This sweep never fetches,` +
      ` pulls or resets a checkout, so the commit marked "@" beside each site above — not` +
      ` that repo's default branch — is what its verdict describes.`,
  );
  return lines.join("\n");
}

/**
 * The refusal for a sweep in which NOT ONE site was actually checked.
 *
 * Same reasoning as the zero-sites refusal, one step later in the pipeline: a run
 * that compared no repository against Prismic learned nothing, and
 * `prismicSweepExitCode` cannot express it, because 0 checked / 0 failed is
 * indistinguishable from a fleet that legitimately holds no Prismic sites.
 *
 * An all-skipped fleet is precisely the shape a systemic checkout problem takes.
 * "Skipped" is derived from the ABSENCE of a config file, so anything that empties
 * the working trees — a workdir wiped mid-run, a workdir of interrupted clones, a
 * clone target that landed one directory deeper than the inventory says — turns
 * every site in the fleet into a confident "not a Prismic site", exit 0, night
 * after night. The `.git`-only guard in `readSiteInputs` catches the shape we know
 * about; this catches the shape of the ones we do not.
 */
export function describeNothingChecked(rows: readonly SweepRow[]): string {
  // The zero-sites refusal in `runFleetSweep` already covers an empty inventory
  // with a message that names the actual cause; two refusals for one fact would
  // print a contradiction.
  if (rows.length === 0) return "";
  if (countSweep(rows).checked > 0) return "";
  return (
    `⛔ NOT ONE SITE WAS CHECKED. All ${rows.length} site(s) in this inventory came back` +
    ` skipped or unreadable, so nothing was compared against Prismic and this run learned` +
    ` nothing about the fleet's models. That is not a clean fleet: a skip is inferred from a` +
    ` MISSING config file, so anything that empties the checkouts makes every site in the` +
    ` fleet look like a repo that simply has no Prismic in it, and exit 0.` +
    ` Do NOT read this exit as a result.`
  );
}

/** One fleet site, with the same failure isolation `runRecipeOverSites` gives a
 *  recipe: a throw from anywhere in the comparison becomes a NAMED failed row for
 *  THAT site instead of ending the sweep of the other fourteen.
 *
 *  `checkOneSite` returns rather than throws for every failure it anticipates, so
 *  this catch is defence in depth — it covers whatever the pure comparison and
 *  the renderer might throw on a model shape nobody has seen yet, and the
 *  INJECTED `remoteModels`, which this module can promise nothing about. It does
 *  not collapse anything: the row says `failed`, which counts toward the outage
 *  rule and writes nothing to Airtable. */
/**
 * The commit a checkout currently stands at, read out of the checkout itself.
 *
 * WHY THE SWEEP REPORTS THE COMMIT INSTEAD OF REFRESHING THE CHECKOUT.
 * `cloneIfNeeded` clones only into an EMPTY directory; for one that already
 * exists it returns the site untouched, and nothing anywhere pulls. So a sweep
 * can report "espada matches Prismic" from a working tree that was cloned days
 * ago while that repo's main has moved — and the nightly's entire purpose is
 * comparing the CURRENT repo against Prismic.
 *
 * Refreshing was the other option and it is the wrong one here, for three
 * reasons that compound:
 *
 *   - The fleet workdir is SHARED. `bump-deps`, `sync-configs`, `upgrade` and the
 *     other recipe commands work in the same checkouts and leave branches and
 *     uncommitted edits in them. A read-only nightly that fetched-and-reset would
 *     silently destroy another command's work; a fetch-without-reset would change
 *     nothing about what is compared, since the comparison reads the working tree.
 *   - `prepareFleetSites` is shared by nine commands, so a refresh there is a
 *     fleet-wide behaviour change that belongs in its own reviewed task — the same
 *     boundary that keeps this file out of `cloneIfNeeded`.
 *   - The sweep must never spawn a process (it is read-only BY CONSTRUCTION, and
 *     that is asserted). A pull is a network write path with its own failure
 *     modes — merge conflicts, detached heads, credentials — in the one command
 *     whose job is to raise an alarm, not to need one.
 *
 * So the verdict is made legible instead of made fresh: every row names the commit
 * it describes, and `summariseSweep` says in words that no checkout was refreshed.
 * A stale answer stays possible, but it stops being invisible — and an operator
 * who wants a fresh one deletes the workdir, which is the cheap, obvious lever.
 *
 * Filesystem only: `.git/HEAD` plus the ref it names, then `packed-refs`. Every
 * failure returns a REASON rather than nothing, because "this checkout is at no
 * commit" and "we could not read which commit" are the two facts this file exists
 * to keep apart.
 */
export async function resolveCheckoutCommit(repoRoot: string): Promise<CheckoutCommit> {
  const isSha = (s: string): boolean => /^[0-9a-f]{7,64}$/i.test(s);
  try {
    const dotGit = join(repoRoot, ".git");
    // A `.git` FILE (a worktree or a submodule) points at the real git dir.
    const s = await stat(dotGit);
    let gitDir = dotGit;
    if (!s.isDirectory()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(await readFile(dotGit, "utf-8"))?.[1]?.trim();
      if (!pointer) return { unresolved: `.git is a file that names no gitdir` };
      gitDir = resolve(repoRoot, pointer);
    }
    const head = (await readFile(join(gitDir, "HEAD"), "utf-8")).trim();
    if (isSha(head)) return { resolved: head }; // detached HEAD
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1]?.trim();
    if (!ref) return { unresolved: `HEAD is neither a commit id nor a ref (${head.slice(0, 60)})` };
    try {
      const loose = (await readFile(join(gitDir, ref), "utf-8")).trim();
      return isSha(loose) ? { resolved: loose } : { unresolved: `${ref} holds no commit id` };
    } catch {
      // No loose ref file: the sha is in `packed-refs` (which is where a fresh
      // clone puts it, so this is the COMMON path, not the exotic one).
      const packed = await readFile(join(gitDir, "packed-refs"), "utf-8");
      for (const line of packed.split("\n")) {
        const [sha, name] = line.trim().split(/\s+/);
        if (name === ref && sha !== undefined && isSha(sha)) return { resolved: sha };
      }
      return { unresolved: `${ref} is in neither this checkout's loose refs nor packed-refs` };
    }
  } catch (e) {
    return { unresolved: describeThrown(e) };
  }
}

/** The `@ …` marker printed beside a site in the sweep body. Empty for a site
 *  with no checkout at all, which its row already says in words. */
export function describeCheckoutCommit(commit: CheckoutCommit | null): string {
  if (commit === null) return "";
  return "resolved" in commit
    ? ` @ ${commit.resolved.slice(0, 12)}`
    : ` @ COMMIT NOT RESOLVED (${commit.unresolved})`;
}

async function sweepOneSite(s: Site, deps: PrismicModelsDeps): Promise<SweepRow> {
  const label = siteLabel(s);
  // BEFORE the comparison and outside the try: this says which tree was read, so
  // it has to be attached to a failed row as firmly as to a clean one. It never
  // throws — every failure comes back as a named `unresolved`.
  const commit = await resolveCheckoutCommit(s.path);
  try {
    const r = await checkOneSite(s.path, deps, {
      apply: false,
      // Fleet mode forbids the generic token: one PRISMIC_WRITE_TOKEN in the
      // environment while iterating every fleet repository would attach the wrong
      // credential to every site after the first. In-repo mode is the opposite,
      // and that asymmetry is the whole point of the flag.
      allowGenericToken: false,
    });
    return {
      site: label,
      repositoryName: r.repositoryName ?? null,
      commit,
      // Carry `status` THROUGH — never re-derive a verdict here.
      status: r.status,
      clean: r.clean,
      detail: r.output,
    };
  } catch (e) {
    return {
      site: label,
      repositoryName: null,
      commit,
      status: "failed",
      clean: null,
      detail:
        `unexpected error while checking this site: ${describeThrown(e)}.` +
        ` Nothing was compared for it — this is NOT "no Prismic in this repo".`,
    };
  }
}

/** Fleet mode: prepare every site, compare each against its Prismic repository,
 *  never push. Read-only by construction — `apply` is not plumbed through here,
 *  because a fleet-wide model push outside CI is 🔴 under AUTONOMY.md. A caller
 *  asking for `--apply` is refused by {@link modeConflict} rather than quietly
 *  given a read-only sweep.
 *
 *  `resolveSites` is allowed to THROW (a positional site alongside `--fleet`,
 *  an unsupported inventory extension, an Airtable read that failed). Those are
 *  "the fleet itself could not be established", which has no per-site row to
 *  live in and must not be reported as a sweep of zero sites; `bin.ts` prints the
 *  message and exits with the error's own `exitCode`. */
export async function sweepFleet(
  site: string | undefined,
  opts: PrismicModelsCommandOptions,
  deps: PrismicModelsDeps,
  cwd: string,
): Promise<{ rows: SweepRow[]; skipped: SkippedSite[]; resolved: number }> {
  const sites = await resolveSites({
    // Passed through so `resolveSites` can refuse `prismic-models espada --fleet
    // inv.json` (exit 2). Dropping it would silently sweep the whole fleet for
    // an operator who named one site.
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
    cwd,
  });
  const workdir = opts.workdir ?? fleetWorkdir();
  const prep = await prepareFleetSites(sites, { workdir });

  // SEQUENTIAL. Each site is one repository's worth of Types API reads, and the
  // report is read top to bottom by a human — a parallel sweep would interleave
  // nothing (the rows are collected, not streamed) but would multiply the load
  // on Prismic by the size of the fleet for no gain.
  const rows: SweepRow[] = [];
  for (const s of prep.prepared) rows.push(await sweepOneSite(s, deps));

  // A SITE THAT COULD NOT BE PREPARED IS A SITE NOBODY READ, and it gets a row.
  //
  // `prepareFleetSites` isolates a clone failure into `skipped` so one bad
  // inventory row cannot abort the fleet — that isolation is right, and it is
  // also exactly how a site disappears: a sweep that walked `prepared` alone
  // counted 0 checked and 0 failed when NOTHING could be cloned, and
  // `prismicSweepExitCode(0, 0)` is 0. A fleet-wide clone outage — an expired
  // App token, GitHub down, a full disk — then reported a clean night, with the
  // real reason sitting in a warning line nothing gates on.
  //
  // The word "skipped" in `formatSkippedNotice` is about PREPARATION and is the
  // opposite of `status: "skipped"`, which is a readable repo with no Prismic in
  // it. The notice stays; the row is what makes the site countable.
  //
  // An earlier version of this comment said the nightly greps that notice's token
  // to raise a `::warning::`. It does not, because there is no Prismic nightly:
  // measured 2026-08-13, `.github/workflows/` holds no workflow that mentions
  // prismic at all — Task 23 builds it. What is true today is that FOUR other
  // fleet nightlies grep this exact token (fleet-lighthouse, fleet-smoke,
  // fleet-security, fleet-form-e2e), which is why the wording is worth keeping
  // stable and why Task 23 gets the grep for free. Until then the notice is for a
  // human reading the output, and the COUNT is the only thing any machine reads.
  for (const s of prep.skipped) {
    rows.push({
      site: s.site,
      repositoryName: null,
      // No checkout was established, so there is no commit to name. `null` here
      // is "there is no tree", NOT "we could not read one" — that is the
      // `unresolved` case, and they must not render alike.
      commit: null,
      status: "failed",
      clean: null,
      detail:
        `could not prepare this checkout: ${s.reason}.` +
        ` Nothing was compared for it — this is NOT "no Prismic in this repo".`,
    });
  }

  return { rows, skipped: prep.skipped, resolved: sites.length };
}

/** `--fleet`: the read-only nightly sweep, and the exit-code rule that decides
 *  whether it wakes anybody up. */
async function runFleetSweep(
  site: string | undefined,
  opts: PrismicModelsCommandOptions,
  deps: PrismicModelsDeps,
  cwd: string,
): Promise<{ output: string; code: number }> {
  const { rows, skipped, resolved } = await sweepFleet(site, opts, deps, cwd);

  // NOTHING RESOLVED IS NOT A CLEAN FLEET. The inventory was read and named no
  // sites, so nothing was compared and this run learned nothing — and the
  // Airtable inventory is view-filtered, so one filter change empties it with no
  // error anywhere. Exiting 0 here is a green tick that silently retires the
  // whole drift alarm; `prismicSweepExitCode(0, 0)` cannot express it, because
  // for a fleet that legitimately has no Prismic sites 0/0 is correct.
  if (resolved === 0) {
    return {
      output:
        `the inventory resolved NO SITES, so no sites were swept and nothing was compared.` +
        ` This is not a clean fleet — check the inventory (an Airtable view filter, an empty` +
        ` JSON file, a dynamic inventory returning []). Do NOT read this exit as a result.`,
      code: 1,
    };
  }

  // Count on `status`, NOT on `clean === null && repositoryName !== null`.
  //
  // That derivation was wrong in exactly the case the sweep exists to catch: a
  // config that is PRESENT AND BROKEN never yields a `repositoryName`, so it
  // scored identically to a genuine "not a Prismic site" skip and vanished from
  // the failure count. The absent-vs-unreadable collapse, reappearing inside the
  // rule meant to detect outages.
  //
  // `checkOneSite` returns an explicit `status`, so the fleet layer reads a fact
  // instead of inferring one from two nulls. Never reconstruct this from
  // `clean`: `clean` answers "does this site match Prismic", which is only
  // meaningful once `status === "checked"`.
  //
  // THE SAME COUNT the summary below prints — see {@link countSweep}.
  const { checked, failed } = countSweep(rows);
  const body = rows
    .map((r) => `[${r.site}]${describeCheckoutCommit(r.commit)} ${r.detail}`)
    .join("\n\n");

  // A collision forces non-zero regardless of the majority rule. It is not a
  // "site failed to read" — every site read fine — so `failed` cannot express
  // it, and a fleet where two repos overwrite each other's models must not
  // report success just because 15 of 15 sites were individually readable.
  //
  // TWO AXES, reported separately and BOTH fatal: two sites claiming one Prismic
  // repository, and two DIFFERENT repositories deriving one token secret. They
  // are one conflict seen from the repo side and from the credential side, they
  // have different fixes, and the fleet sweep is the only vantage point in the
  // system from which either is visible.
  const collisions = findRepositoryCollisions(rows);
  const envCollisions = findTokenEnvCollisions(rows);
  // A NOTE and not part of the exit code — see {@link findDuplicateSiteRows}.
  const duplicates = findDuplicateSiteRows(rows);
  // Derived from the SAME string that gets printed, so the refusal and the
  // reason can never disagree.
  const nothingChecked = describeNothingChecked(rows);
  const output = appendSkipNotice(
    [
      describeCollisions(collisions),
      describeTokenEnvCollisions(envCollisions),
      describeDuplicateSiteRows(duplicates),
      body,
      summariseSweep(rows),
      nothingChecked,
    ]
      .filter((s) => s !== "")
      .join("\n\n"),
    skipped,
  );
  const alarms = collisions.length + envCollisions.length;
  return {
    output,
    code: alarms > 0 || nothingChecked !== "" ? 1 : prismicSweepExitCode(checked, failed),
  };
}

/**
 * Modes the flags advertise and this command does not do yet.
 *
 * Task 18 registers `--pull`, `--tokens`, `--fleet` and `--write-airtable` on
 * the CLI; Tasks 15, 16, 17 and 20 implement them. Between those two points the
 * options are accepted, IGNORED, and the in-repo check of the cwd runs instead —
 * so `--fleet inventory.json` reports a successful sweep of one repo that was
 * never in the inventory, and exits 0. "Silently does something other than what
 * you asked, and calls it success" is the exact failure class this pipeline
 * exists to eliminate; it does not get an exemption for being ours.
 *
 * Each implementing task deletes its own line from this list — a one-line diff,
 * against a guard that costs nothing to carry.
 */
const UNIMPLEMENTED_MODES = [
  ["--write-airtable", "writeAirtable"],
] as const satisfies ReadonlyArray<readonly [string, keyof PrismicModelsCommandOptions]>;

/** Was a mode flag actually asked for? `undefined` is absent and `false` is what
 *  a boolean flag parser leaves behind for a flag nobody typed; anything else —
 *  `true`, a string, an empty string — is a request. */
const requested = (v: unknown): boolean => v !== undefined && v !== false;

/**
 * Flag combinations that contradict each other, refused BEFORE any work.
 *
 * The alternative is not "pick a sensible order" — it is a silent no-op, which
 * is the same class of failure as the unimplemented-mode guard below and the
 * reason that guard exists. `--tokens --apply` runs a read-only doctor, prints a
 * table and exits 0, and the operator who typed `--apply` reads that exit as
 * "the models were pushed". `--tokens --comment-file ci.txt` leaves a workflow
 * waiting on a file that is never written.
 *
 * Exit 2, not 1: this is a malformed invocation, not a finding about a site. A
 * caller that treats 1 as "drift" and 2 as "you asked for something impossible"
 * can then tell them apart.
 */
function modeConflict(opts: PrismicModelsCommandOptions): string | null {
  if (requested(opts.pull) && requested(opts.tokens)) {
    return (
      "cannot combine --pull with --tokens. They are two different modes: one writes" +
      " remote-only models into this working tree, the other prints which secret each" +
      " site needs. Nothing was pulled, written or read — ask for one of them."
    );
  }
  if (requested(opts.pull)) {
    if (opts.apply === true) {
      return (
        "cannot combine --pull with --apply — pull, review, then push. Running both in one" +
        " invocation would push this repo's models and adopt Prismic's in the same breath," +
        " with no review in between. Nothing was pulled, written or pushed."
      );
    }
    if (requested(opts.fleet)) {
      return (
        "cannot combine --pull with --fleet: --pull is single-repo only, because it WRITES" +
        " INTO A WORKING TREE and the result is meant to land as one reviewed PR." +
        " Nothing was pulled or written."
      );
    }
    if (opts.commentFile !== undefined) {
      return (
        "cannot combine --pull with --comment-file. The comment file is the in-repo model" +
        " check's review artifact; a pull-down's review artifact is the diff it leaves in" +
        " the working tree. Nothing was pulled or written."
      );
    }
  }
  if (requested(opts.tokens)) {
    if (opts.apply === true) {
      return (
        "cannot combine --tokens with --apply. --tokens is a read-only checklist of which" +
        " secret each site needs; it pushes nothing. Nothing was compared, pushed or" +
        " written — drop one of the two flags."
      );
    }
    if (opts.commentFile !== undefined) {
      return (
        "cannot combine --tokens with --comment-file. The comment file is the in-repo" +
        " model check's review artifact; the token doctor writes no report for a PR." +
        " Nothing was written — redirect the output instead."
      );
    }
  }
  if (requested(opts.fleet)) {
    if (opts.apply === true) {
      return (
        "cannot combine --fleet with --apply. The fleet sweep is READ-ONLY BY CONSTRUCTION —" +
        " `apply` is not plumbed through it at all, because a fleet-wide model push outside" +
        " CI is 🔴 under AUTONOMY.md. Accepting the flag and sweeping read-only anyway would" +
        " exit 0 having pushed nothing, which reads as a successful push. Nothing was" +
        " compared, pushed or written — push per repo, through that repo's own CI."
      );
    }
    if (opts.commentFile !== undefined) {
      return (
        "cannot combine --fleet with --comment-file. The comment file is ONE repo's review" +
        " artifact, posted on ONE pull request; a fleet sweep has no pull request to post to." +
        " Accepting it and writing nothing would leave a workflow waiting on a file that" +
        " never appears. Nothing was swept or written — redirect the output instead."
      );
    }
  }
  return null;
}

/**
 * Flag combinations this build cannot honour YET — a gap, not a contradiction.
 *
 * Kept apart from {@link modeConflict} because they are different facts and
 * deserve different exit codes: a contradiction exits 2 ("you asked for
 * something impossible") and will never work, while these exit 1 alongside the
 * unimplemented-mode guard below, and a later task deletes the case. What they
 * share is the refusal itself — the alternative is a run that does something
 * OTHER than what was asked and calls it success.
 */
function unbuiltCombination(opts: PrismicModelsCommandOptions): string | null {
  if (requested(opts.tokens) && requested(opts.fleet)) {
    return (
      "--tokens --fleet — NOT IMPLEMENTED YET. The token doctor is single-repo today, so a" +
      " fleet-wide checklist would print ONE row — this directory's — under a heading that" +
      " claims to cover the fleet, and an operator would mint one secret believing they had" +
      " covered fifteen sites. Nothing was read. Run `reddoor-maint prismic-models <site>" +
      " --tokens` per checkout until the fleet-wide doctor exists."
    );
  }
  return null;
}

/**
 * Write the comment file so a reader can never see a half-written or a stale one.
 *
 * Temp file + rename, because `rename(2)` on the same filesystem is atomic: the
 * workflow's `cat prismic-models.txt` either sees the whole report or no file at
 * all, never the first half of one that a crash interrupted. The temp file is a
 * SIBLING of the target so the rename cannot cross a filesystem and fall back to
 * a copy; a failed attempt takes its temp file with it rather than leaving
 * litter next to the artifact.
 */
async function writeCommentFileAtomically(path: string, body: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(tmp, body, "utf-8");
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/**
 * WHOSE run wrote this file.
 *
 * A comment file with no identity cannot be told apart from last run's. The
 * command writes one on its skip and error paths too — deliberately, so a failed
 * run still posts a reason instead of leaving the previous run's output in place
 * to be posted as this one's — but "leaving it in place" is precisely what
 * happens if the CLI dies before it writes at all, and on a re-used workspace
 * the stale file then reads as a fresh, passing report.
 *
 * So the file says which run made it. In CI that is the run id, the attempt (a
 * re-run of the same job keeps the id and increments this) and the commit;
 * locally it is the pid. The timestamp is the part a human actually checks.
 */
const runStamp = (
  env: Record<string, string | undefined>,
  repositoryName: string | undefined,
): string => {
  const bits = ["reddoor-maint prismic-models", repositoryName ?? "no Prismic repository resolved"];
  if (env.GITHUB_RUN_ID) bits.push(`run ${env.GITHUB_RUN_ID}`);
  if (env.GITHUB_RUN_ATTEMPT) bits.push(`attempt ${env.GITHUB_RUN_ATTEMPT}`);
  if (env.GITHUB_SHA) bits.push(`commit ${env.GITHUB_SHA}`);
  if (!env.GITHUB_RUN_ID) bits.push(`local pid ${process.pid}`);
  bits.push(new Date().toISOString());
  return bits.join(" · ");
};

export async function runPrismicModelsCommand(
  site: string | undefined,
  opts: PrismicModelsCommandOptions,
  deps: PrismicModelsDeps = defaultDeps(),
): Promise<{ output: string; code: number }> {
  // FIRST, before the unimplemented-mode guard: a contradiction is a
  // contradiction whether or not the other half of it happens to be built yet,
  // and it must read as "these two cannot be asked for together" rather than as
  // "come back when that mode ships".
  const conflict = modeConflict(opts);
  if (conflict) return { output: conflict, code: 2 };

  // A gap, not a contradiction — exit 1 with the unimplemented modes below,
  // rather than 2. Checked before the table because the table keys on ONE flag
  // and this is a combination: `--tokens --fleet` trips neither entry.
  const unbuilt = unbuiltCombination(opts);
  if (unbuilt) return { output: unbuilt, code: 1 };

  const asked = UNIMPLEMENTED_MODES.filter(([, key]) => requested(opts[key]));
  if (asked.length > 0) {
    const flags = asked.map(([flag]) => flag).join(", ");
    return {
      output:
        `${flags} — NOT IMPLEMENTED YET. Nothing was compared, nothing was pushed and` +
        ` nothing was written. This command currently does the in-repo comparison only:` +
        ` \`reddoor-maint prismic-models [site]\` (dry by default), \`--apply\` to push,` +
        ` \`--comment-file <path>\` to save the report. Do NOT read this exit as a result.`,
      code: 1,
    };
  }

  // Validated BEFORE any work, and by TYPE as well as by value.
  //
  // `--comment-file ""` — what an unset workflow variable expands to — is falsy,
  // so the old `if (opts.commentFile)` skipped the write in silence and exited 0:
  // a green check on a model PR with no review comment on it at all. And a flag
  // parser hands back `true` for `--comment-file` with no value, which
  // `resolve()` throws on; that throw sat outside the try below and took the
  // whole command down, losing the report with it.
  const commentFile: unknown = opts.commentFile;
  if (commentFile !== undefined && (typeof commentFile !== "string" || !commentFile.trim())) {
    return {
      output:
        `--comment-file was given ${typeof commentFile === "string" ? "an empty value" : `a ${typeof commentFile}`},` +
        ` which is not a path. Nothing was compared and nothing was pushed. An unset` +
        ` workflow variable expands to an empty string — pass a real path, or drop the` +
        ` flag. Do NOT read this exit as a result.`,
      code: 1,
    };
  }

  // Validated by TYPE as well as by value, exactly like `--comment-file` above
  // and for the same reason, one layer more dangerous.
  //
  // `--fleet ""` is what an unset workflow variable expands to, and EVERY
  // truthiness test in the chain lets it through as "no fleet": `resolveSites`
  // reads an empty `fleet` as absent and returns the current directory, so the
  // nightly would sweep the maintenance repo, find no Prismic config there,
  // report "not a Prismic site — skipped" and exit 0. The fleet-wide drift
  // alarm, silently retired, with a green tick every night.
  const fleetInventory: unknown = opts.fleet;
  if (requested(fleetInventory) && (typeof fleetInventory !== "string" || !fleetInventory.trim())) {
    return {
      output:
        `--fleet was given ${typeof fleetInventory === "string" ? "an empty value" : `a ${typeof fleetInventory}`},` +
        ` which is not an inventory. Nothing was swept and nothing was compared. An unset` +
        ` workflow variable expands to an empty string, and an empty --fleet reads as "no` +
        ` fleet" — one directory swept and reported as the whole fleet. Pass an inventory` +
        ` path or "airtable". Do NOT read this exit as a result.`,
      code: 2,
    };
  }

  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const repoRoot = site ? resolve(cwd, site) : cwd;

  // MODES, not modifiers: each reads what it needs and returns its own report.
  // Everything below this line is the in-repo model comparison.
  if (requested(opts.tokens)) return runTokenDoctor(repoRoot, deps);
  if (requested(opts.pull)) return pullRemoteOnly(repoRoot, deps);
  // Fleet mode takes `site` rather than `repoRoot`: a positional site alongside
  // `--fleet` is a contradiction `resolveSites` already refuses, and resolving it
  // to a path here would hide that from it.
  if (requested(opts.fleet)) return runFleetSweep(site, opts, deps, cwd);

  const result = await checkOneSite(repoRoot, deps, {
    // `=== true` rather than truthiness, so the ONE place that decides whether
    // anything goes on the wire cannot be flipped by a stray string from a flag
    // parser. Dry is the default and the only default.
    apply: opts.apply === true,
    // TRUE here, and false in fleet mode — the modes are opposites and this is
    // the right side of it. An in-repo CI run has exactly one Prismic repository
    // in scope, and `PRISMIC_WRITE_TOKEN` is the name the reusable workflow puts
    // that repository's own Actions secret into (Task 24), rolled out per repo by
    // Task 26. It is NOT a name sites already read: measured 2026-08-13 across
    // the 15 in-scope repos from each one's origin/HEAD (`git grep`, never a
    // working tree), 10 never mention it at all and the 5 that do only in
    // one-shot migration scripts and docs — none in application code. A fleet run
    // iterates every repository against one environment, where a generic token
    // would attach the wrong credential to every site after the first.
    allowGenericToken: true,
  });

  let { output, code } = result;
  if (commentFile !== undefined) {
    // Inside the try along with everything else: `resolve` throws on a path
    // containing a NUL byte, and the report is the thing worth keeping.
    let path = commentFile;
    try {
      path = resolve(cwd, commentFile);
      const stamped = `${runStamp(deps.env, result.repositoryName)}\n\n${output}`;
      await writeCommentFileAtomically(path, forComment(stamped));
    } catch (e) {
      // The comment IS the review artifact. A dry run that failed to write it
      // and still exited 0 would leave a green check on a model PR whose delta
      // nobody ever saw — the same "approved something they never read" failure
      // as a silently shortened comment, reached from the other end. The report
      // is kept alongside the warning rather than replaced by it.
      output =
        `${output}\n\n⚠ COULD NOT WRITE THE COMMENT FILE (${path}): ${describeThrown(e)}.` +
        ` No comment will be posted, so do not read a passing check as "reviewed".`;
      code = code === 0 ? 1 : code;
    }
  }
  return { output, code };
}

/**
 * GitHub rejects an issue comment body over 65,536 characters, so whatever posts
 * this has to shorten it — and a report that was shortened without saying so is
 * this pipeline's governing failure in its purest form: the reviewer sees a
 * complete-looking comment and approves a model change whose destructive lines
 * were the ones cut.
 *
 * A first-ever push is the realistic trigger, not an edge case. The fleet holds
 * 68 custom types and 132 slices across 15 repos (measured 2026-08-12 from each
 * repo's origin/HEAD via `git ls-tree`, never a working tree), and an empty
 * Prismic repository sorts EVERY local model into `toCreate` with a field-level
 * line each.
 *
 * So truncate deliberately, keep the HEAD (the renderer puts the repository name,
 * the INCONSISTENT notice, the verdict and the DESTRUCTIVE warning there
 * precisely so they survive), and make the cut itself loud enough that nobody
 * mistakes the remainder for the whole.
 *
 * `limit` is this body's budget, and it is NOT the GitHub cap. 65,536 is the cap
 * on the ENTIRE comment, and what posts this wraps it — Task 24's workflow puts
 * a heading and a fenced block around it, and the file itself carries a run
 * stamp. Every one of those characters is spent out of the same 65,536, so a
 * body truncated to exactly the cap OVERFLOWS once wrapped, GitHub answers 422,
 * and NO COMMENT IS POSTED AT ALL. That is worse than a shortened review gate:
 * it is no review gate, on a PR that changes models on a live client's site, and
 * it fails in the direction where the CI step can still go green. So the default
 * is the cap MINUS headroom, and a caller who wraps more heavily passes less.
 */
const GITHUB_COMMENT_LIMIT = 65_536;

/**
 * Characters held back from the cap for whatever wraps this body.
 *
 * Task 24's wrapper — `### Prismic model delta`, a blank line, and a fenced
 * block — is 34 characters. 2 KiB is sixty times that: room for a workflow to
 * add a `<details>` block, a heading naming the site, or a footer, without
 * anyone having to remember that the number here and the wrapper there are one
 * budget. It costs 3% of the report and buys the failure mode that produces no
 * comment at all.
 */
const COMMENT_WRAPPER_HEADROOM = 2_048;

export const DEFAULT_COMMENT_LIMIT = GITHUB_COMMENT_LIMIT - COMMENT_WRAPPER_HEADROOM;

export function forComment(body: string, limit = DEFAULT_COMMENT_LIMIT): string {
  // At the HEAD as well as the tail. Everything else in this report was ordered
  // so the facts that stop a merge survive GitHub collapsing a long comment from
  // the top — and the tail notice, the one line that says "you are not reading
  // the whole thing", sat in the least-read position of the longest possible
  // comment. Terse, because it is paid for out of the report's own budget.
  const headMarker = `⚠ TRUNCATED — this is not the whole report; the cut is explained at the end.\n\n`;
  const notice =
    `\n\n⚠ TRUNCATED — this report is ${body.length} characters and the budget for this` +
    ` comment body is ${limit} (GitHub caps the whole comment, wrapper included, at` +
    ` ${GITHUB_COMMENT_LIMIT}). Everything below the cut is missing, including any` +
    ` further destructive lines. Run \`reddoor-maint prismic-models\` locally — dry is` +
    ` the default — for the whole report before approving.\n`;

  // A HARD ERROR, and checked before the early return so a caller finds out on
  // the first run rather than on the first long report — which is the run that
  // can least afford a surprise. Silently emitting notice-plus-nothing would
  // overrun the very budget the caller asked to be kept, and there is no honest
  // shortening at this size: the only fix is a bigger budget.
  if (limit < headMarker.length + notice.length) {
    throw new Error(
      `forComment: limit ${limit} is smaller than the truncation warning itself` +
        ` (${headMarker.length + notice.length} characters), so a shortened report could not` +
        ` say that it was shortened. Raise the limit; do not drop the warning.`,
    );
  }
  if (body.length <= limit) return body;

  let head = body.slice(0, Math.max(0, limit - notice.length - headMarker.length));
  // The cut is by code unit, so it can land between the halves of an astral
  // character and leave a lone surrogate in the file the workflow posts. Drop the
  // orphan rather than emit invalid text.
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return headMarker + head + notice;
}
