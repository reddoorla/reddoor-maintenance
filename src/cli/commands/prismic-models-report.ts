// The one renderer, deliberately. This string is used VERBATIM as the PR comment
// body (inside a fenced block) and as CLI output, so what CI shows a reviewer is
// character for character what an operator sees locally — two renderers is two
// verdicts that can drift apart, and the whole point of commenting the delta on a
// PR is that the reviewer and the pipeline agree about what is being merged.
//
// PURE. No IO, no clock, no environment. Everything it can say comes from the
// arguments, which is what makes the reconciliation below cheap enough to run on
// every path.
//
// THE RULE THIS FILE IS WRITTEN AGAINST, restated for a renderer: a report that
// OMITS a fact must not look identical to a report where the fact was absent. The
// upstream form ("I could not read X" must never produce the same result as "X
// does not exist") has been found five times in this pipeline. Rendering has its
// own version of it, and `remoteOnly` is the instance that matters: it is the
// never-delete report, and if it renders as nothing then a checkout that has lost
// every slice in the repo reads exactly like a clean run. Every branch below is
// written to be distinguishable from the healthy case.
import {
  describeDiff,
  type ModelDiff,
  type ModelKind,
  type PushReport,
} from "../../prismic/models/index.js";

/** No divergence of any kind between the repo and Prismic. `remoteOnly` counts:
 *  it is either an out-of-band cloud edit or a model the repo has forgotten, and
 *  both are drift the operator needs to see. */
export function isClean(diff: ModelDiff): boolean {
  return diff.toCreate.length === 0 && diff.toUpdate.length === 0 && diff.remoteOnly.length === 0;
}

/** `report` is the whole `PushReport` when a push actually ran, and ABSENT on a
 *  dry run — absent and empty are different facts, so do not default it to an
 *  empty report. `failed` remains for callers that have only the failure list.
 *
 *  Passing BOTH is supported and is the better call when a caller has both: it
 *  is what makes the reconciliation below able to run at all. It is NOT a way to
 *  override the report — a `failed` that disagrees with `report.failed` is
 *  reported as an inconsistency, not silently preferred. */
export type ReportOptions = {
  apply: boolean;
  failed?: PushReport["failed"];
  report?: PushReport;
};

type Identity = { kind: ModelKind; id: string };

/** Identity ACROSS collections, matching `diff.ts`: a custom type and a slice
 *  can share an id, so `kind` is part of the key. Keying on id alone would make
 *  a slice and a custom type of the same name reconcile as one model and hide a
 *  real disagreement. */
const key = (e: Identity): string => `${e.kind}:${e.id}`;
const keysOf = (xs: readonly Identity[]): Set<string> => new Set(xs.map(key));
const minus = (a: Set<string>, b: Set<string>): string[] => [...a].filter((k) => !b.has(k)).sort();
const intersect = (a: Set<string>, b: Set<string>): string[] =>
  [...a].filter((k) => b.has(k)).sort();

/**
 * Reconcile every fact this renderer is handed TWICE.
 *
 * Three pairs, all the same defect shape. `ModelDiff.remoteOnly` vs
 * `PushReport.remoteOnlyReported`; `opts.apply` vs `PushReport.mode`;
 * `opts.failed` vs `PushReport.failed`. Each pair is one fact with two sources,
 * and each pair agrees BY CONSTRUCTION at the current caller — which is exactly
 * the argument that held for `remoteOnly` right up until Task 10 gave it a
 * second source. Agreement by construction is a property of today's caller, not
 * of this function's inputs.
 *
 * A disagreement means something upstream is broken — a diff computed against a
 * different remote read than the push ran against, a report built from a stale
 * diff, or a caller pairing a report with the wrong diff — and every other
 * figure in the report came from those same inputs, so none of them can be
 * trusted either. That is why this reconciles rather than picking a winner, and
 * why the output says "do not act on this" instead of quietly preferring one
 * side. The quiet version is a report that looks authoritative and is not.
 *
 * The fourth check is Task 10's push invariant rather than a duplicated fact:
 * `pushModels` builds its work list from `toCreate` + `toUpdate` and drops every
 * item into exactly one of `sent`/`failed`. The summary line's arithmetic
 * depends on that being true, so it is checked here rather than assumed — a
 * model in NEITHER bucket vanished silently, and a model in BOTH double-counts.
 *
 * Returns the disagreement lines, EMPTY when everything agrees or when there is
 * nothing to reconcile against. A dry run never builds a `PushReport`, so with
 * no report the report-derived checks are SKIPPED, not read as "the report said
 * none" — absent and empty are different facts, the rule this pipeline is built
 * around. (The one check that needs no report still runs: a caller-supplied
 * `failed` naming a model this diff is not pushing is wrong on its own terms.)
 */
function reconcile(diff: ModelDiff, opts: ReportOptions): string[] {
  const out: string[] = [];
  const work = keysOf([...diff.toCreate, ...diff.toUpdate.map((u) => u.local)]);

  // Needs no report: `n - failed.length` in the summary assumes every failure
  // names a model this diff was actually pushing. When it does not, the old
  // arithmetic printed a numerator that was merely wrong — or negative — with no
  // hint of why.
  if (opts.failed !== undefined) {
    for (const k of minus(keysOf(opts.failed), work))
      out.push(`    reported as failed, but not a model this diff is pushing: ${k}`);
  }

  const report = opts.report;
  if (report === undefined) return out;

  // The headline. `mode` is the push run's own record of whether anything went
  // on the wire; `opts.apply` is what the caller believes. A disagreement makes
  // the verdict line a lie in whichever direction is worse: "3/3 model(s)
  // pushed" for a run that sent nothing, or "DRY RUN — nothing was sent" for a
  // run that rewrote three models in a live repository.
  if ((report.mode === "apply") !== opts.apply) {
    out.push(
      `    mode: rendering as ${opts.apply ? "an APPLY" : "a DRY RUN"}, but the push run` +
        ` recorded mode "${report.mode}"`,
    );
  }

  const diffRemote = keysOf(diff.remoteOnly);
  const reportRemote = keysOf(report.remoteOnlyReported);
  for (const k of minus(diffRemote, reportRemote))
    out.push(`    remote-only per the comparison, absent from the push report: ${k}`);
  for (const k of minus(reportRemote, diffRemote))
    out.push(`    remote-only per the push report, absent from the comparison: ${k}`);

  if (opts.failed !== undefined) {
    // Compared by IDENTITY, not by the `error` text. Which models failed is what
    // the summary arithmetic counts and what an operator acts on; the message is
    // prose from an injected sender and two truthful renderings of the same
    // rejection can word it differently.
    const callerFailed = keysOf(opts.failed);
    const reportFailed = keysOf(report.failed);
    for (const k of minus(callerFailed, reportFailed))
      out.push(`    failed per the caller's list, absent from the push report: ${k}`);
    for (const k of minus(reportFailed, callerFailed))
      out.push(`    failed per the push report, absent from the caller's list: ${k}`);
  }

  const sent = keysOf(report.sent);
  const failed = keysOf(report.failed);
  const accounted = new Set([...sent, ...failed]);
  for (const k of minus(work, accounted))
    out.push(`    in this diff's work list, but the push run neither sent nor failed it: ${k}`);
  for (const k of minus(accounted, work))
    out.push(`    sent or failed by the push run, but not in this diff's work list: ${k}`);
  for (const k of intersect(sent, failed))
    out.push(`    recorded BOTH sent and failed by the push run: ${k}`);

  return out;
}

/** A `describeDiff` line whose push would DESTROY something on the live model.
 *
 *  Two forms, both from diff.ts: a `- ` line (a field, variation, or tab present
 *  in Prismic and absent from the repo — pushing removes it) and the `repeatable`
 *  flip, which diff.ts's own header calls "destructive, not cosmetic" and which
 *  touches neither field zone, so it carries no `-`.
 *
 *  This CLASSIFIES ANOTHER MODULE'S OUTPUT FORMAT, which is a coupling worth
 *  naming: if diff.ts ever changes those prefixes, the count here would silently
 *  fall to zero — a warning that disappears is the exact failure this file is
 *  written against. It is pinned instead of trusted: the destructive tests in
 *  tests/cli/prismic-models-report.test.ts drive real model pairs through
 *  `describeDiff` and assert on both the raw line and the warning, so a format
 *  change reddens them rather than going quiet. */
const isDestructive = (line: string): boolean =>
  line.startsWith("- ") || line === "~ (model) repeatable";

/** One site's model delta, plain text. Used verbatim as the PR comment body
 *  (inside a fenced block) and as CLI output.
 *
 *  ORDER IS PART OF THE DESIGN. GitHub collapses a long comment from the top and
 *  a reviewer reads downward, so the head carries, in this order: what
 *  repository this is (a wrong-repo run is otherwise invisible), whether the
 *  report can be trusted at all, the verdict, and whether merging destroys
 *  anything. The itemised detail follows. A reviewer who reads only the first
 *  four lines still learns everything that would stop a merge. */
export function renderModelReport(
  repositoryName: string,
  diff: ModelDiff,
  opts: ReportOptions,
): string {
  const head: string[] = [`Prismic models — repository: ${repositoryName}`];

  // Reconcile FIRST, and render it even on an otherwise-clean diff. A mismatch
  // means the inputs disagree, so "clean" is exactly the verdict that must not
  // be printed unqualified — a report that says "nothing to push" while its own
  // two sources disagree is the most dangerous output this renderer can produce,
  // and the clean early return below is precisely the path that would skip the
  // check.
  const disagreements = reconcile(diff, opts);
  if (disagreements.length > 0) {
    head.push(
      `⚠ INCONSISTENT — the inputs to this report disagree with each other, so every` +
        ` figure in it is unreliable: they all came from the same inputs. Something` +
        ` upstream is broken (a diff and a push report from different runs, a stale` +
        ` diff, or a mismatched pair). Re-run; do not act on this.`,
      ...disagreements,
    );
  }

  if (isClean(diff) && disagreements.length === 0) {
    head.push(`${diff.unchanged.length} model(s) match Prismic — nothing to push.`);
    // Zero on BOTH sides is not a clean run, it is a misconfiguration wearing
    // one. Every in-scope fleet repository holds models in the repo and in
    // Prismic, so this state means a wrong `repositoryName`, a token pointed at
    // the wrong repository, or a slice library path that no longer resolves —
    // and "0 model(s) match Prismic — nothing to push." on its own is worded
    // like a success.
    if (diff.unchanged.length === 0) {
      head.push(
        `⚠ NOTHING WAS FOUND ON EITHER SIDE — the repo declared no models and Prismic` +
          ` holds none. For a live site that is a misconfiguration (a wrong` +
          ` repositoryName, or a slice library path that no longer resolves), not a` +
          ` clean run.`,
      );
    }
    return head.join("\n");
  }

  const body: string[] = [];
  let destructive = 0;

  for (const entry of diff.toCreate) {
    body.push(`NEW  ${entry.kind} ${entry.id}  (${entry.path})`);
  }
  for (const { local, remote } of diff.toUpdate) {
    body.push(`CHANGED  ${local.kind} ${local.id}  (${local.path})`);
    for (const l of describeDiff(local.model, remote.model)) {
      if (isDestructive(l)) destructive += 1;
      body.push(`    ${l}`);
    }
  }

  // The alamo-anatomy shape, and the one this whole file's header is about. A
  // slice-library path that stops resolving answers zero local models ON PURPOSE
  // (`subdirs` in local.ts, for a proven-ENOENT library), so EVERY model Prismic
  // holds sorts into `remoteOnly` and no other bucket is populated. The
  // REMOTE-ONLY block alone renders that as a routine "you have some cloud-only
  // models" note — which is how a checkout that has lost the entire repo's model
  // set comes to read as ordinary drift. It is not ordinary, so it goes in the
  // HEAD next to the verdict rather than underneath a heading further down: the
  // verdict on this run ("0 model(s) would be pushed; 0 already match") is the
  // one that most needs the qualification.
  const matchedNothing =
    diff.remoteOnly.length > 0 &&
    diff.toCreate.length + diff.toUpdate.length + diff.unchanged.length === 0;

  if (diff.remoteOnly.length > 0) {
    if (body.length > 0) body.push("");
    body.push(
      `REMOTE-ONLY — present in Prismic, absent from this repo. These are reported and` +
        ` never deleted by CI; pull them down with \`reddoor-maint prismic-models --pull\`` +
        ` or delete them in the Prismic dashboard.`,
    );
    for (const entry of diff.remoteOnly) body.push(`    ${entry.kind} ${entry.id}`);
  }

  // Precedence is moot rather than authoritative: when both are supplied and
  // they disagree, `reconcile` above has already said so at the top of the
  // report, so which one is rendered here cannot quietly decide anything.
  const failures = opts.failed ?? opts.report?.failed ?? [];
  if (failures.length > 0) {
    if (body.length > 0) body.push("");
    for (const f of failures) body.push(`FAILED  ${f.kind} ${f.id}: ${f.error}`);
    // The whole reason `PushReport.failed` carries `status`: a 401/403 is a dead
    // or wrong write token (fix the secret) and a 422 is a rejected model (fix
    // the model). Those are different jobs for different people, and a dead
    // token produces N identical FAILED lines — noisy, honest, and impossible to
    // triage from the message text alone. Prismic's token expiry is
    // undocumented, so this is not a rare branch.
    const auth = failures.filter((f) => f.status === 401 || f.status === 403).length;
    if (auth > 0) {
      body.push(
        `⚠ ${auth} failure(s) came back 401/403 — that is the WRITE TOKEN, not the` +
          ` models. Fix the secret and re-run; a model Prismic actually rejected` +
          ` would be a 422.`,
      );
    }
  }

  const n = diff.toCreate.length + diff.toUpdate.length;
  // MEASURED, not derived, wherever the measurement exists. `n - failures.length`
  // assumes Task 10's invariant (every worked model lands in exactly one of
  // `sent`/`failed`) instead of reading the answer that is right there — and the
  // two differ precisely when the invariant broke: a model that vanished from
  // both buckets is COUNTED AS PUSHED by the arithmetic and is not by
  // `sent.length`. Claiming a model reached Prismic when nothing was sent for it
  // is the one direction this number must never be wrong in. `reconcile` above
  // reports the underlying breakage; this keeps the headline honest meanwhile.
  // The fallback is the arithmetic, for callers that supply no report — the same
  // assumption, made visibly and only where there is nothing better.
  const pushed =
    opts.report !== undefined && opts.report.mode === "apply"
      ? opts.report.sent.length
      : n - failures.length;
  const verdict = opts.apply
    ? `${pushed}/${n} model(s) pushed. ${diff.unchanged.length} already matched.`
    : `DRY RUN — nothing was sent. ${n} model(s) would be pushed; ${diff.unchanged.length} already match.`;

  // Both qualify the verdict, so both sit immediately under it. "This checkout
  // matched nothing" goes first: it says the run itself is not to be believed,
  // which outranks anything about what the run would do.
  const warnings: string[] = [];
  if (matchedNothing) {
    warnings.push(
      `⚠ THIS CHECKOUT MATCHED NOTHING — every model below is remote-only and the repo` +
        ` declared none at all. That is what a broken slice-library path looks like (a` +
        ` renamed directory, a typo in \`libraries\`, a partial checkout), not a repo` +
        ` that legitimately has no models.`,
    );
  }
  if (destructive > 0) {
    warnings.push(
      `⚠ DESTRUCTIVE — ${destructive} line(s) below remove a field, variation, or tab` +
        ` from a live model, or flip \`repeatable\`. Prismic drops the document data` +
        ` for a field the model no longer declares, with HTTP 200 and no warning.` +
        ` Read every \`-\` line before merging.`,
    );
  }

  return [...head, verdict, ...warnings, ...(body.length > 0 ? ["", ...body] : [])].join("\n");
}
