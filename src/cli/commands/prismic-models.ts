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
// arrays, and there are four places it bites:
//
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
// that lets the comparison proceed on a guess. `clean` is `null` on all four, so
// nothing downstream can read a failed check as a verdict either.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  diffModels,
  localModels,
  prismicTokenEnvName,
  pushModels,
  readPrismicConfig,
  remoteModels as remoteModelsImpl,
  resolvePrismicToken,
  sendModel as sendModelImpl,
  type LocalEntry,
  type PrismicConfig,
  type PrismicModel,
  type RemoteEntry,
} from "../../prismic/models/index.js";
import { isClean, renderModelReport } from "./prismic-models-report.js";

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
};

export const defaultDeps = (): PrismicModelsDeps => ({
  remoteModels: (repo, token) => remoteModelsImpl(repo, token),
  sendModel: (repo, token, entry, action) => sendModelImpl(repo, token, entry, action),
  env: process.env,
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

/** The outcome of checking one site.
 *
 *  `clean` is the machine-readable verdict the fleet sweep writes to Airtable and
 *  the cockpit alarms on, and it is deliberately three-valued: `true` in sync,
 *  `false` diverged, `null` NOT KNOWN — the check itself failed. A boolean here
 *  would have to make "we could not find out" wear one of the other two faces. */
export type SiteCheck = {
  output: string;
  code: number;
  clean: boolean | null;
  repositoryName?: string;
};

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
  let cfg: PrismicConfig | null;
  try {
    cfg = await readPrismicConfig(repoRoot);
  } catch (e) {
    // `readPrismicConfig` returns null for "no Prismic here" and THROWS for a
    // config that is present and unusable. Those two must not land on the same
    // line: the skip below is a green exit, and a live site whose config broke
    // would then leave CI green while nothing was compared at all.
    return {
      output:
        `Prismic config present but unusable: ${describeThrown(e)}. Nothing was compared` +
        ` and nothing was pushed — this is NOT "no Prismic in this repo".`,
      code: 1,
      clean: null,
    };
  }
  if (!cfg) {
    return { output: "not a Prismic site (no repositoryName) — skipped", code: 0, clean: null };
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
    return {
      output: `cannot work out which secret holds this repository's token: ${describeThrown(e)}`,
      code: 1,
      clean: null,
      repositoryName: cfg.repositoryName,
    };
  }

  const resolved = resolvePrismicToken(cfg.repositoryName, deps.env, {
    allowGeneric: opts.allowGenericToken,
  });
  if (!resolved) {
    const names = [canonicalEnv];
    if (opts.allowGenericToken) names.push("PRISMIC_WRITE_TOKEN");
    return {
      output: `no write token for Prismic repository "${cfg.repositoryName}" — set ${names.join(" or ")}`,
      code: 1,
      clean: null,
      repositoryName: cfg.repositoryName,
    };
  }

  // Local first: it is free, and a repo that cannot be read has nothing to say
  // to Prismic. `localModels` throws on a model file that is present and
  // unreadable, and on a duplicate model id — both are "this checkout cannot be
  // trusted", and with `--apply` treating either as "the repo declares fewer
  // models" is a push computed from a half-read repository.
  let local: LocalEntry[];
  try {
    local = await localModels(repoRoot, cfg.libraries);
  } catch (e) {
    return {
      output:
        `could not read this repo's own models: ${describeThrown(e)}. Nothing was compared` +
        ` and nothing was pushed.`,
      code: 1,
      clean: null,
      repositoryName: cfg.repositoryName,
    };
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
    return {
      output: `could not read Prismic models: ${describeThrown(e)}`,
      code: 1,
      clean: null,
      repositoryName: cfg.repositoryName,
    };
  }

  const diff = diffModels(local, remote);
  const report = await pushModels(diff, {
    apply: opts.apply,
    send: (entry: LocalEntry, _remote: PrismicModel | undefined, action) =>
      deps.sendModel(cfg.repositoryName, resolved.token, entry, action),
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

  return {
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
    output: renderModelReport(cfg.repositoryName, diff, { apply: opts.apply, report }),
    // A dry run NEVER fails on drift: a model PR is supposed to differ from the
    // remote, and the comment is the review artifact, not a gate. Only a real
    // push failure — or one of the "we could not find out" returns above — is an
    // error.
    code: report.failed.length > 0 ? 1 : 0,
    clean: isClean(diff) && !foundNothingAnywhere,
    repositoryName: cfg.repositoryName,
  };
}

export async function runPrismicModelsCommand(
  site: string | undefined,
  opts: PrismicModelsCommandOptions,
  deps: PrismicModelsDeps = defaultDeps(),
): Promise<{ output: string; code: number }> {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const repoRoot = site ? resolve(cwd, site) : cwd;

  const result = await checkOneSite(repoRoot, deps, {
    // `=== true` rather than truthiness, so the ONE place that decides whether
    // anything goes on the wire cannot be flipped by a stray string from a flag
    // parser. Dry is the default and the only default.
    apply: opts.apply === true,
    // TRUE here, and false in fleet mode — the modes are opposites and this is
    // the right side of it. An in-repo CI run has exactly one Prismic repository
    // in scope and the site's own Actions secret is the generic
    // `PRISMIC_WRITE_TOKEN`, the name every site's code already reads. A fleet
    // run iterates every repository against one environment, where a generic
    // token would attach the wrong credential to every site after the first.
    allowGenericToken: true,
  });

  let { output, code } = result;
  if (opts.commentFile) {
    const path = resolve(cwd, opts.commentFile);
    try {
      await writeFile(path, forComment(output), "utf-8");
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
 * `limit` is a parameter because the CALLER knows the real budget: whatever wraps
 * this in a comment (a heading, a fenced block) spends characters of its own out
 * of the same 65,536, so a workflow that wraps must pass a smaller number. A
 * limit smaller than the notice itself returns the notice alone and exceeds the
 * budget — losing the warning would be worse than overrunning a budget nobody
 * could have met.
 */
const GITHUB_COMMENT_LIMIT = 65_536;

export function forComment(body: string, limit = GITHUB_COMMENT_LIMIT): string {
  if (body.length <= limit) return body;
  const notice =
    `\n\n⚠ TRUNCATED — this report is ${body.length} characters and GitHub caps a` +
    ` comment at ${limit}. Everything below the cut is missing, including any` +
    ` further destructive lines. Run \`reddoor-maint prismic-models --dry\` locally` +
    ` for the whole report before approving.\n`;
  let head = body.slice(0, Math.max(0, limit - notice.length));
  // The cut is by code unit, so it can land between the halves of an astral
  // character and leave a lone surrogate in the file the workflow posts. Drop the
  // orphan rather than emit invalid text.
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return head + notice;
}
