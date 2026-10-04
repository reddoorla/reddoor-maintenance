#!/usr/bin/env node
// Land PRs one at a time, each merge pinned to the head SHA its checks passed on.
//
//   node scripts/land-prs.mjs <pr> [<pr> …] [--repo owner/repo] [--base branch] [--dry-run]
//                             [--cleanup] [--checks-timeout-min N]
//
// `main` is strict and platform auto-merge is off, so landing a PR is a manual loop: if
// it is BEHIND, update the branch, wait for the checks on the NEW head, then merge pinned
// to that head so nothing that arrived after the checks can ride in. In the
// week of 2026-09-14 that loop was run by hand about eight times. This script is that
// loop, run strictly serially — landing one PR makes the next one BEHIND, so running
// them in parallel only multiplies the update-branch rounds.
//
// Every GitHub call is REST, through `gh api repos/<owner>/<repo>/…`. The script used to
// drive `gh pr view|checks|update-branch|merge` and `gh repo view`, which are all GraphQL,
// and the GitHub proxy in Claude Code on the web refuses GraphQL outright (HTTP 403), so
// it could not run there at all. REST works in both places.
//
// Per PR, in order:
//   1. view (`GET pulls/N`). MERGED → skip and continue. UNKNOWN → re-view (≤ 3 × 10 s)
//      before deciding: the first view of a PR taken right after the previous one merged
//      is UNKNOWN while GitHub recomputes, and acting on it skipped the BEHIND step in the
//      first live run. CLOSED, draft, base ≠ main (or --base), or a release PR (title
//      `chore(release)…` or head `changeset-release/*`, which AUTONOMY.md §"Merge
//      authority" keeps human) → stop. DIRTY → stop (a conflict gets no CI). Then pick
//      the merge method (see `chooseMergeMethod`); none allowed → stop.
//   2. BEHIND → `PUT pulls/N/update-branch` with expected_head_sha set to the head just
//      viewed, sleep 25 s, poll until head.sha moves (≤ 3 min).
//   3. poll the head's check runs and commit statuses every 10 s (≤ --checks-timeout-min),
//      bucketed the way `gh pr checks` buckets them. The first failure stops the run,
//      naming the failing checks. It passes only when nothing is pending or failed AND at
//      least one check passed: no checks at all, or only neutral/skipped/cancelled ones, is
//      "not reported yet" and waits under the no-checks budget. Netlify posts its neutral
//      runs about 2 s before Actions registers `build` (#953's head: 05:48:56Z vs
//      05:48:58Z), and a poll in that window used to pass a head nothing had built.
//   4. re-view. The head moved during the wait → back to 3. BEHIND (main moved during the
//      wait) → back to 2. Both count against the same 3 rounds. The step-1 refusals run
//      again on this view, so a PR retargeted, retitled as a release or made a draft while
//      the checks ran is refused, not merged. Otherwise the merge state
//      must be CLEAN (UNKNOWN/BLOCKED get a short settle first, because GitHub recomputes
//      it lazily after the last check completes); any other state stops.
//   5. `PUT pulls/N/merge` with merge_method=<the picked method> and sha=<the gated head>,
//      then verify
//      MERGED from a fresh view: the view is the verdict, not the exit code. Then delete
//      the head branch (`DELETE git/refs/heads/…`) unless it lives on a fork. The cloud
//      proxy refuses that DELETE, and a repo with "automatically delete head branches"
//      has usually removed it already, so a refused delete is only a note, and none at
//      all once the branch is gone.
//   6. --cleanup: a local worktree on the PR's head branch with a clean `git status` is
//      removed (never forced), and its branch deleted if its tip is an ancestor of the
//      merged head (fetched first: update-branch puts a merge commit on top on GitHub).
//
// The merge method is squash wherever the base branch allows it, which is everywhere this
// script ran before 2026-10-04. That day reddoor-website#240 could not land on that repo's
// `main`: the merge answered 405 "Squash merges are not allowed on this repository" while
// the repo's `allow_squash_merge` was true, because the `main: reviewed changes only`
// ruleset's pull_request rule sets `allowed_merge_methods: ["merge"]`. A ruleset narrows
// the methods per branch, and the repo flags cannot show it, so step 1 reads both
// `GET repos/…` (the `allow_*_merge` flags) and `GET repos/…/rules/branches/<base>` (every
// rule in force on the base, from every ruleset) and keeps squash, then merge, then rebase,
// whichever is allowed by all of them. A `required_linear_history` rule rules out a merge
// commit. Classic branch protection is not read (its endpoint needs admin); there the
// 405 still stops the run, with GitHub's reason.
//
// The first stop ends the run (`LAND #N stopped reason=…`, exit 1); later PRs are not
// touched. --dry-run only views, and prints what it would do.
//
// A READ that fails in transport — the connection reset, EOF, a timeout, or a 502/503/504
// with no JSON body — is tried again, up to `readAttempts` times in all, 2 s then 4 s
// apart (see `isTransientReadFailure`). Landing #957 from a cloud session stopped on one
// `read: connection reset by peer` from the egress proxy on a check-runs GET, and an
// immediate re-run landed it cleanly. Any answer GitHub actually gave (a 4xx, or a JSON
// body) is final, and a WRITE — merge, update-branch, branch delete — is never repeated
// automatically, whatever it failed with: only a call `isReadOnlyApiCall` recognises
// as a plain GET is ever re-issued.
//
// The gh/git runner, the sleep and the clock are injected (see `landPrs`), which is how
// tests/scripts/land-prs.test.ts drives every branch of this without a network.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_TIMING = {
  afterUpdateSleepMs: 25_000,
  headPollIntervalMs: 10_000,
  headPollMaxMs: 180_000,
  maxCheckRounds: 3,
  checksPollIntervalMs: 10_000,
  noChecksRetries: 3,
  noChecksIntervalMs: 20_000,
  // A head pushed moments ago has not had time to register a check run. On
  // .github#35 the commit landed at 04:47:14Z and Actions did not register
  // `validate` until 04:50:48Z — a 3.5 minute lag against a 3 × 20s budget, so
  // the script concluded there were no checks and stopped. Stopping is the
  // safe answer and the wrong one: the checks were coming.
  //
  // The longer budget is spent ONLY on a head that is actually recent. An old
  // head with no checks really has none, and waiting five minutes to say so
  // helps nobody.
  freshHeadMaxAgeMs: 10 * 60_000,
  noChecksFreshRetries: 15,
  settleRetries: 3,
  settleIntervalMs: 10_000,
  mergeVerifyRetries: 3,
  mergeVerifyIntervalMs: 5_000,
  branchGoneRetries: 3,
  branchGoneIntervalMs: 5_000,
  // A read that failed in transport is issued at most this many times in all, the n-th
  // retry after readRetryMs × 2^(n-1): 2 s, then 4 s.
  readAttempts: 3,
  readRetryMs: 2_000,
};

const GH_TIMEOUT_MS = 60_000;
const GIT_TIMEOUT_MS = 15_000;
const GIT_FETCH_TIMEOUT_MS = 60_000;
// States GitHub reports while it is still recomputing mergeability after checks finish.
const SETTLING = new Set(["UNKNOWN", "BLOCKED"]);

const USAGE =
  "usage: node scripts/land-prs.mjs <pr> [<pr> …] [--repo owner/repo] [--base branch] [--dry-run] [--cleanup] [--checks-timeout-min N]";

class Stop extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

// ── arguments ────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const o = {
    prs: [],
    repo: undefined,
    dryRun: false,
    cleanup: false,
    checksTimeoutMin: 20,
    base: "main",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--cleanup") o.cleanup = true;
    else if (a === "--repo") {
      const v = argv[++i];
      if (!v || !/^[\w.-]+\/[\w.-]+$/.test(v)) throw new Error(`--repo needs owner/repo`);
      o.repo = v;
    } else if (a === "--base") {
      const v = argv[++i];
      if (!v || !/^[\w][\w./-]*$/.test(v)) throw new Error(`--base needs a branch name`);
      o.base = v;
    } else if (a === "--checks-timeout-min") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v <= 0) throw new Error(`--checks-timeout-min needs a number > 0`);
      o.checksTimeoutMin = v;
    } else if (/^#?\d+$/.test(a)) {
      o.prs.push(Number(a.replace("#", "")));
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (o.prs.length === 0) throw new Error("no PR numbers given");
  return o;
}

// ── the real runner ──────────────────────────────────────────────────────────────────

/** Run a command, capture its output. Never throws for a non-zero exit; a spawn failure
 *  (command not found) resolves with code 127. */
export function realRunner(cmd, args, { cwd, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, timeoutMs);
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + e.message, timedOut });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

export const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── helpers ──────────────────────────────────────────────────────────────────────────

export const MERGE_METHODS = ["squash", "merge", "rebase"];
const REPO_FLAG = {
  squash: "allow_squash_merge",
  merge: "allow_merge_commit",
  rebase: "allow_rebase_merge",
};

/** The method to merge with, given `GET repos/{o}/{r}` and the rules in force on the base
 *  (`GET repos/{o}/{r}/rules/branches/{base}`). `{ method }`, or `{ error }` naming what
 *  each source allowed. A repo flag that is absent from the answer is not read as false:
 *  GitHub's default is true, and a wrong guess only gets the merge call's own 405. */
export function chooseMergeMethod(repo, rules) {
  const repoAllows = MERGE_METHODS.filter((m) => repo?.[REPO_FLAG[m]] !== false);
  let allowed = repoAllows;
  const said = [`repo allows ${repoAllows.join("/") || "nothing"}`];
  for (const rule of Array.isArray(rules) ? rules : []) {
    const from = rule.ruleset_id === undefined ? "a ruleset" : `ruleset ${rule.ruleset_id}`;
    if (rule.type === "pull_request" && Array.isArray(rule.parameters?.allowed_merge_methods)) {
      const methods = rule.parameters.allowed_merge_methods;
      allowed = allowed.filter((m) => methods.includes(m));
      said.push(`${from} allows ${methods.join("/") || "nothing"}`);
    } else if (rule.type === "required_linear_history") {
      allowed = allowed.filter((m) => m !== "merge");
      said.push(`${from} requires linear history`);
    }
  }
  return allowed.length > 0
    ? { method: allowed[0] }
    : { error: `no merge method is allowed: ${said.join("; ")}` };
}

const short = (sha) => (typeof sha === "string" ? sha.slice(0, 7) : String(sha));
const firstLine = (s) =>
  String(s ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "";

export function isReleasePr(pr) {
  return (
    /^chore\(release\)/.test(pr.title ?? "") ||
    (pr.headRefName ?? "").startsWith("changeset-release/")
  );
}

/** `git worktree list --porcelain` → [{ path, head, branch, detached, bare }]. The first
 *  entry is always the main worktree. */
export function parseWorktreeList(porcelain) {
  const out = [];
  let cur;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice(9), head: "", branch: "", detached: false, bare: false };
      out.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (line.startsWith("branch ")) cur.branch = line.slice(7);
    else if (line === "detached") cur.detached = true;
    else if (line === "bare") cur.bare = true;
  }
  return out;
}

function realOrSelf(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function isWithin(parent, child) {
  const rel = relative(realOrSelf(parent), realOrSelf(child));
  return !rel.startsWith("..") && !isAbsolute(rel);
}

// ── GitHub, over REST ────────────────────────────────────────────────────────────────

/** Whether the flags after a `gh api` path leave it a plain GET — the only kind of call that
 *  is ever re-issued. An allowlist, not a denylist: nothing but `--jq <expr>` is accepted,
 *  so `--method` of any kind, and `-f`/`-F`/`--input` (which switch gh's default method
 *  from GET to POST), all make it a write — as does any flag nobody has thought about yet. */
export function isReadOnlyApiCall(args) {
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] !== "--jq" || i + 1 >= args.length) return false;
  }
  return true;
}

const TRANSIENT_HTTP = new Set([502, 503, 504]);
// Go's net/http transport errors, as gh prints them: `Get "<url>": <cause>`. The reset is
// the line the proxy gave on #957 (`read tcp …: read: connection reset by peer`); it, `EOF`
// and `net/http: TLS handshake timeout` were also read from gh 2.101.0 itself, pointed at a
// local server made to fail each way. `unexpected EOF` and `i/o timeout` are Go's spellings
// of a body cut short and a read deadline, not yet seen from gh. gh sets no client timeout,
// so a server that never answers hangs it until the runner's kill (`timedOut`, below).
const TRANSPORT_CAUSE =
  /connection reset by peer|(?:^|: )(?:unexpected )?EOF$|TLS handshake timeout|i\/o timeout/;

/** Whether a failed `gh api` GET was a failure to hear GitHub, not an answer from it.
 *
 *  Transient, and so worth another attempt:
 *  - the runner killed gh at its timeout (gh has no response timeout of its own, so a
 *    silent server just hangs it);
 *  - stderr is a transport error, `Get "<url>": …`, ending in a reset, EOF, or a timeout;
 *  - HTTP 502, 503 or 504 whose body is not a JSON object (gh prints `gh: HTTP 502` for
 *    those): the API answers in JSON, so an HTML, text or empty body is almost certainly
 *    something between us and it — the egress proxy or a load balancer.
 *  Everything else is final. Any 4xx is GitHub's decision about the request, and asking
 *  again gets the same one. A 5xx WITH a JSON body (`gh: Server Error (HTTP 502)`) came from
 *  GitHub's API itself, which is not the flake this is for. `connection refused` means
 *  nothing is listening at all, and a few seconds do not usually change that. */
export function isTransientReadFailure(r) {
  if (r.code === 0) return false;
  if (r.timedOut) return true;
  const stderr = String(r.stderr ?? "");
  const status = /\bHTTP (\d{3})\b/.exec(stderr);
  if (status) {
    const body = parseJson(r.stdout ?? "");
    return TRANSIENT_HTTP.has(Number(status[1])) && (body === null || typeof body !== "object");
  }
  return stderr
    .split("\n")
    .some((l) => /^Get "[^"]*": /.test(l.trim()) && TRANSPORT_CAUSE.test(l.trim()));
}

/** Run `call` again while it fails transiently, up to `t.readAttempts` times in all. The
 *  result carries `attempts` so a stop can say how many it took. `call` must be a read. */
async function withReadRetries(call, sleep, t, onRetry = () => {}) {
  for (let attempt = 1; ; attempt++) {
    const r = await call();
    // `!(a < b)`, not `a >= b`: a budget that is not a number ends the loop, never extends it.
    if (!(attempt < t.readAttempts) || !isTransientReadFailure(r)) {
      return { ...r, attempts: attempt };
    }
    const wait = t.readRetryMs * 2 ** (attempt - 1);
    onRetry(r, attempt, wait);
    await sleep(wait);
  }
}

/** " after N attempts" when a read was retried, so a stop says the retries were spent. */
const afterAttempts = (r) => (r.attempts > 1 ? ` after ${r.attempts} attempts` : "");

function api(ctx, path, args = [], timeoutMs = GH_TIMEOUT_MS) {
  const call = () =>
    ctx.run("gh", ["api", path ? `repos/${ctx.repo}/${path}` : `repos/${ctx.repo}`, ...args], {
      cwd: ctx.cwd,
      timeoutMs,
    });
  // A write is issued exactly once, whatever it failed with: a merge PUT whose response
  // was lost may well have merged, and the view afterwards — not a second PUT — says so.
  if (!isReadOnlyApiCall(args)) return call();
  return withReadRetries(call, ctx.sleep, ctx.t, (r, attempt, wait) =>
    ctx.log(
      `LAND note: gh api ${path || `repos/${ctx.repo}`} failed in transport (attempt ${attempt} of ${ctx.t.readAttempts}), retrying in ${wait / 1000} s: ${ghFailureDetail(r)}`,
    ),
  );
}

/** Why a `gh` call failed, in a form that is never empty.
 *
 *  A run on reddoor-starter#154 stopped with `gh pr view failed:` and nothing
 *  after the colon: the machine had slept about an hour mid-run, gh died with
 *  no output at all, and `firstLine("")` is `""`. A stop reason with no reason
 *  in it costs exactly the time it takes to reproduce a transient. */
export function ghFailureDetail(r) {
  const said = firstLine(r.stderr || r.stdout);
  if (said) return said;
  if (r.timedOut) return "timed out with no output";
  return `exit ${r.code} with no output`;
}

const httpStatus = (r) => Number(/\(HTTP (\d{3})\)/.exec(r.stderr ?? "")?.[1] ?? NaN);

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function apiJson(ctx, path) {
  return jsonOf(ctx, path, await api(ctx, path));
}

function jsonOf(ctx, path, r) {
  const named = path || `repos/${ctx.repo}`;
  if (r.code !== 0) {
    throw new Stop(`gh api ${named} failed${afterAttempts(r)}: ${ghFailureDetail(r)}`);
  }
  const body = parseJson(r.stdout);
  if (body === null || typeof body !== "object") {
    throw new Stop(`gh api ${named} returned no JSON: ${firstLine(r.stdout) || "an empty body"}`);
  }
  return body;
}

async function allPages(ctx, path, key) {
  const items = [];
  for (let page = 1; ; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const body = await apiJson(ctx, `${path}${sep}per_page=100&page=${page}`);
    const got = Array.isArray(body[key]) ? body[key] : [];
    items.push(...got);
    if (got.length === 0 || items.length >= Number(body.total_count ?? 0)) return items;
  }
}

/** `GET pulls/N` → the fields the gates read, in the GraphQL spelling they were written
 *  against (`state` MERGED/OPEN/CLOSED, `mergeStateStatus` upper-case). */
export function prFromRest(p) {
  const merged = p.merged === true || Boolean(p.merged_at);
  const headRepo = p.head?.repo?.full_name;
  const baseRepo = p.base?.repo?.full_name;
  return {
    number: p.number,
    title: p.title,
    state: merged ? "MERGED" : String(p.state ?? "").toUpperCase(),
    isDraft: p.draft === true,
    baseRefName: p.base?.ref,
    headRefName: p.head?.ref,
    headRefOid: p.head?.sha,
    mergeStateStatus: String(p.mergeable_state ?? "unknown").toUpperCase(),
    mergeCommit: merged && p.merge_commit_sha ? { oid: p.merge_commit_sha } : null,
    sameRepo:
      typeof headRepo === "string" &&
      typeof baseRepo === "string" &&
      headRepo.toLowerCase() === baseRepo.toLowerCase(),
  };
}

/** The bucket `gh pr checks` puts a check in. Cancelled is its own bucket and, as in gh,
 *  does not fail the wait. Anything unrecognised — `waiting`, `requested`, `stale`,
 *  `expected`, a value GitHub adds tomorrow — is pending, never pass: the default is the
 *  fail-safe one, because an unknown state that passed would open the gate. */
export function checkBucket(state) {
  switch (String(state ?? "").toUpperCase()) {
    case "SUCCESS":
      return "pass";
    case "SKIPPED":
    case "NEUTRAL":
      return "skipping";
    case "ERROR":
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "fail";
    case "CANCELLED":
      return "cancel";
    default:
      return "pending";
  }
}

export function checksFromRest(checkRuns, statuses) {
  return [
    ...checkRuns.map((c) => ({
      name: c.name,
      bucket: checkBucket(c.status === "completed" ? c.conclusion : c.status),
    })),
    ...statuses.map((s) => ({ name: s.context, bucket: checkBucket(s.state) })),
  ];
}

async function readChecks(ctx, sha) {
  const runs = await allPages(ctx, `commits/${sha}/check-runs?filter=latest`, "check_runs");
  const statuses = await allPages(ctx, `commits/${sha}/status`, "statuses");
  return checksFromRest(runs, statuses);
}

const MAX_RULES_PAGES = 10;

/** Every rule in force on `branch`. A 403 or 404 on the first page is read as "no
 *  rulesets here" (a plan without rulesets on a private repo may refuse the endpoint
 *  outright), noted, and left to the merge call's own 405 to contradict. */
async function rulesFor(ctx, n, branch) {
  const rules = [];
  for (let page = 1; page <= MAX_RULES_PAGES; page++) {
    const path = `rules/branches/${refPath(branch)}?per_page=100&page=${page}`;
    const r = await api(ctx, path);
    if (page === 1 && r.code !== 0 && [403, 404].includes(httpStatus(r))) {
      ctx.log(
        `LAND #${n} note: no rules read for ${branch}, choosing from the repo flags alone: ${ghFailureDetail(r)}`,
      );
      return [];
    }
    const body = jsonOf(ctx, path, r);
    const got = Array.isArray(body) ? body : [];
    rules.push(...got);
    if (got.length < 100) return rules;
  }
  throw new Stop(`gh api rules/branches/${branch} still had rules after ${MAX_RULES_PAGES} pages`);
}

async function mergeMethodFor(ctx, n, branch) {
  const picked = chooseMergeMethod(await apiJson(ctx, ""), await rulesFor(ctx, n, branch));
  if (picked.error) throw new Stop(`${picked.error} (base ${branch})`);
  return picked.method;
}

async function viewPr(ctx, n) {
  return prFromRest(await apiJson(ctx, `pulls/${n}`));
}

export function refusal(pr, allowedBase = "main") {
  if (pr.state !== "OPEN") return `state=${pr.state}`;
  if (pr.isDraft) return "draft";
  // Promotion is the operator's under #623 and is refused whatever --base
  // says. Checked BEFORE the base comparison so `--base main` cannot reach it.
  if (pr.baseRefName === "main" && pr.headRefName === "staging") {
    return "promotion staging → main is the operator's (#623)";
  }
  if (pr.baseRefName !== allowedBase) {
    return allowedBase === "main"
      ? `base is ${pr.baseRefName}, not main (pass --base ${pr.baseRefName} to allow it)`
      : `base is ${pr.baseRefName}, not ${allowedBase}`;
  }
  if (isReleasePr(pr)) {
    return `release PR (title "${pr.title}", head ${pr.headRefName}) — always human, AUTONOMY.md §Merge authority`;
  }
  // Name the actual base. With --base in play this used to say "conflicts with
  // main" about a PR that has nothing to do with main.
  if (pr.mergeStateStatus === "DIRTY") {
    return `mergeStateStatus=DIRTY (conflicts with ${pr.baseRefName})`;
  }
  return "";
}

async function updateBranch(ctx, n, pr) {
  ctx.log(`LAND #${n} BEHIND — update-branch from ${short(pr.headRefOid)}`);
  const r = await api(ctx, `pulls/${n}/update-branch`, [
    "--method",
    "PUT",
    "-f",
    `expected_head_sha=${pr.headRefOid}`,
  ]);
  if (r.code !== 0) throw new Stop(`update-branch failed: ${ghFailureDetail(r)}`);
  let waited = 0;
  let wait = ctx.t.afterUpdateSleepMs;
  for (;;) {
    await ctx.sleep(wait);
    waited += wait;
    const now = await viewPr(ctx, n);
    if (now.headRefOid !== pr.headRefOid) {
      ctx.log(`LAND #${n} head moved ${short(pr.headRefOid)} -> ${short(now.headRefOid)}`);
      return now;
    }
    if (waited >= ctx.t.headPollMaxMs) {
      throw new Stop(
        `update-branch did not move the head off ${short(pr.headRefOid)} within ${Math.round(waited / 1000)} s`,
      );
    }
    wait = ctx.t.headPollIntervalMs;
  }
}

/** How many "no checks reported" rounds to tolerate, from the head commit's age.
 *
 *  A head pushed in the last few minutes gets the long budget; anything older,
 *  or a head whose age cannot be read at all, gets the short one. "I could not
 *  tell" resolves to the SHORT budget deliberately: the long one only ever
 *  delays a stop, and a stop is the safe outcome, so there is nothing to buy
 *  by guessing generously. */
export function noChecksRetriesFor(committedAtMs, nowMs, t) {
  if (!Number.isFinite(committedAtMs)) return t.noChecksRetries;
  const age = nowMs - committedAtMs;
  if (age < 0 || age > t.freshHeadMaxAgeMs) return t.noChecksRetries;
  return t.noChecksFreshRetries;
}

async function noChecksBudget(ctx, n, sha) {
  const r = await api(ctx, `commits/${sha}`);
  const committedAt =
    r.code === 0 ? Date.parse(parseJson(r.stdout)?.commit?.committer?.date ?? "") : NaN;
  const budget = noChecksRetriesFor(committedAt, ctx.now(), ctx.t);
  if (budget > ctx.t.noChecksRetries) {
    ctx.log(`LAND #${n} head is fresh — waiting up to ${budget} rounds for a first check`);
  }
  return budget;
}

async function waitForChecks(ctx, n, sha) {
  const deadline = ctx.now() + ctx.checksTimeoutMin * 60_000;
  ctx.log(`LAND #${n} checks watching ${short(sha)} (timeout ${ctx.checksTimeoutMin} min)`);
  // Resolved lazily, and only if "no checks reported" actually happens — it
  // costs one extra call and most runs never reach that branch.
  let budget = null;
  let empty = 0;
  for (;;) {
    const checks = await readChecks(ctx, sha);
    const named = (...buckets) =>
      checks.filter((c) => buckets.includes(c.bucket)).map((c) => c.name);
    if (named("fail").length > 0) {
      throw new Stop(`checks failed on ${short(sha)}: ${named("fail", "cancel").join(", ")}`);
    }
    const pending = named("pending");
    // Right after a push the new head can have no check runs registered yet — or only
    // Netlify's neutral ones, which arrive about 2 s before Actions registers `build`.
    // Neither is a verdict: nothing has passed, so keep waiting under the same budget.
    if (pending.length === 0 && named("pass").length === 0) {
      if (budget === null) budget = await noChecksBudget(ctx, n, sha);
      if (empty < budget) {
        empty++;
        await ctx.sleep(ctx.t.noChecksIntervalMs);
        continue;
      }
      const waited = Math.round((budget * ctx.t.noChecksIntervalMs) / 1000);
      throw new Stop(
        checks.length === 0
          ? `no checks reported on ${short(sha)} after ${waited}s`
          : `no check passed on ${short(sha)} after ${waited}s, only ${checks.map((c) => `${c.name} (${c.bucket})`).join(", ")}`,
      );
    }
    if (pending.length === 0) {
      ctx.log(`LAND #${n} checks passed on ${short(sha)}`);
      return;
    }
    if (ctx.now() >= deadline) {
      throw new Stop(
        `checks still running after ${ctx.checksTimeoutMin} min on ${short(sha)}: ${pending.join(", ")}`,
      );
    }
    await ctx.sleep(ctx.t.checksPollIntervalMs);
  }
}

/** Re-view while the merge state is UNKNOWN, before the first decision on a PR. */
async function settledFirstView(ctx, n) {
  let pr = await viewPr(ctx, n);
  for (
    let i = 0;
    i < ctx.t.settleRetries && pr.state === "OPEN" && pr.mergeStateStatus === "UNKNOWN";
    i++
  ) {
    await ctx.sleep(ctx.t.settleIntervalMs);
    pr = await viewPr(ctx, n);
  }
  return pr;
}

async function gateView(ctx, n, began) {
  let pr = await viewPr(ctx, n);
  for (
    let i = 0;
    i < ctx.t.settleRetries &&
    pr.state === "OPEN" &&
    pr.headRefOid === began &&
    SETTLING.has(pr.mergeStateStatus);
    i++
  ) {
    await ctx.sleep(ctx.t.settleIntervalMs);
    pr = await viewPr(ctx, n);
  }
  return pr;
}

async function merge(ctx, n, pr, method) {
  const sha = pr.headRefOid;
  const r = await api(
    ctx,
    `pulls/${n}/merge`,
    ["--method", "PUT", "-f", `merge_method=${method}`, "-f", `sha=${sha}`],
    120_000,
  );
  const tries = r.code === 0 ? ctx.t.mergeVerifyRetries : 1;
  let v;
  for (let i = 0; i < tries; i++) {
    if (i > 0) await ctx.sleep(ctx.t.mergeVerifyIntervalMs);
    v = await viewPr(ctx, n);
    if (v.state === "MERGED") break;
  }
  if (!v || v.state !== "MERGED") {
    // A merge call that exited 0 has only its JSON body to show, `"merged":true` included,
    // which reads as a contradiction in a "did not land" line; say what happened instead.
    const said = r.code === 0 ? "the merge call succeeded" : ghFailureDetail(r);
    throw new Stop(`merge did not land (state=${v?.state}): ${said}`);
  }
  if (r.code !== 0) {
    ctx.log(`LAND #${n} note: the merge call failed but the PR is MERGED: ${ghFailureDetail(r)}`);
  }
  if (pr.sameRepo) await deleteBranch(ctx, n, pr.headRefName);
  return v.mergeCommit?.oid ?? "(unknown merge commit)";
}

/** A branch name as a REST path. Only `%`, `#`, `?` and space are encoded: `#` would
 *  otherwise start a fragment and `%` an escape (`?` and space cannot be in a ref at all).
 *  Everything else stays literal, because the cloud proxy answers ANY percent-encoded path
 *  with 400 "could not be canonicalized" — and `encodeURIComponent` turned every
 *  dependabot `…/@types/…` branch into `%40types`. */
export function refPath(branch) {
  return branch.replace(/[%#? ]/g, (c) => encodeURIComponent(c));
}

async function deleteBranch(ctx, n, branch) {
  const path = refPath(branch);
  const del = await api(ctx, `git/refs/heads/${path}`, ["--method", "DELETE"]);
  if (del.code === 0 || httpStatus(del) === 422) return;
  let seen;
  for (let i = 0; i < ctx.t.branchGoneRetries; i++) {
    if (i > 0) await ctx.sleep(ctx.t.branchGoneIntervalMs);
    seen = await api(ctx, `git/ref/heads/${path}`);
    if (httpStatus(seen) === 404) return;
  }
  const why = `delete failed: ${ghFailureDetail(del)}`;
  ctx.log(
    seen?.code === 0
      ? `LAND #${n} note: branch ${branch} is still on GitHub: ${why}`
      : `LAND #${n} note: branch ${branch} may still be on GitHub: ${why}${seen ? `; checking for it failed: ${ghFailureDetail(seen)}` : ""}`,
  );
}

// ── cleanup ──────────────────────────────────────────────────────────────────────────

async function cleanupWorktree(ctx, n, branch, mergedSha) {
  const git = (args, cwd = ctx.cwd) => ctx.run("git", args, { cwd, timeoutMs: GIT_TIMEOUT_MS });
  const list = await git(["worktree", "list", "--porcelain"]);
  if (list.code !== 0) {
    ctx.log(`LAND #${n} cleanup skipped: git worktree list failed: ${firstLine(list.stderr)}`);
    return;
  }
  const ref = `refs/heads/${branch}`;
  const all = parseWorktreeList(list.stdout);
  const onBranch = all.filter((w) => w.branch === ref);
  if (onBranch.length === 0) {
    ctx.log(`LAND #${n} cleanup: no local worktree on ${branch}`);
    return;
  }
  for (const w of onBranch) {
    const verb = ctx.dryRun ? "would leave" : "left";
    if (w === all[0]) {
      ctx.log(`LAND #${n} cleanup ${verb} ${w.path}: it is the main checkout`);
      continue;
    }
    if (isWithin(w.path, ctx.cwd)) {
      ctx.log(`LAND #${n} cleanup ${verb} ${w.path}: it is the current directory`);
      continue;
    }
    const status = await git(["-C", w.path, "status", "--porcelain"]);
    if (status.code !== 0) {
      ctx.log(
        `LAND #${n} cleanup ${verb} ${w.path}: git status failed: ${firstLine(status.stderr)}`,
      );
      continue;
    }
    const changed = status.stdout.split("\n").filter((l) => l.trim().length > 0);
    if (changed.length > 0) {
      ctx.log(
        `LAND #${n} cleanup ${verb} ${w.path}: ${changed.length} uncommitted change${changed.length === 1 ? "" : "s"}`,
      );
      continue;
    }
    if (ctx.dryRun) {
      ctx.log(`LAND #${n} cleanup would remove ${w.path} (clean, on ${branch})`);
      continue;
    }
    const removed = await git(["worktree", "remove", w.path]);
    if (removed.code !== 0) {
      ctx.log(
        `LAND #${n} cleanup left ${w.path}: git worktree remove failed: ${firstLine(removed.stderr)}`,
      );
      continue;
    }
    ctx.log(`LAND #${n} cleanup removed ${w.path}`);
    // A squash or rebase merge leaves the branch's commits unreachable from main, so
    // `branch -d` refuses; a merge commit keeps them reachable, but only from a main this
    // checkout has not fetched yet, so `-d` cannot be trusted there either. The test is the
    // same for every method: force-delete only when the local tip is an ANCESTOR of the
    // head GitHub merged — then every local commit is in what landed — and keep it otherwise.
    // Equality is not enough: `update-branch` adds a merge commit on GitHub that the local
    // branch never sees, so the first live run kept a fully-landed branch. That merged
    // head is usually not in the local object store, so fetch it (the PR ref survives
    // --delete-branch; the bare SHA is the fallback) without touching FETCH_HEAD.
    const tipR = await git(["rev-parse", "--verify", "-q", ref]);
    const tip = tipR.stdout.trim();
    if (tipR.code !== 0 || !tip) {
      ctx.log(`LAND #${n} cleanup kept branch ${branch}: cannot resolve its local tip`);
      continue;
    }
    if (tip !== mergedSha) {
      const fetch = (what) =>
        ctx.run("git", ["fetch", "--no-tags", "--no-write-fetch-head", "origin", what], {
          cwd: ctx.cwd,
          timeoutMs: GIT_FETCH_TIMEOUT_MS,
        });
      if ((await fetch(`refs/pull/${n}/head`)).code !== 0) await fetch(mergedSha);
    }
    const anc = await git(["merge-base", "--is-ancestor", tip, mergedSha]);
    if (anc.code === 1) {
      ctx.log(
        `LAND #${n} cleanup kept branch ${branch}: local tip ${short(tip)} is not an ancestor of the merged head ${short(mergedSha)} (it has commits that did not land)`,
      );
      continue;
    }
    if (anc.code !== 0) {
      ctx.log(
        `LAND #${n} cleanup kept branch ${branch}: cannot compare local tip ${short(tip)} with the merged head ${short(mergedSha)}: ${firstLine(anc.stderr) || `exit ${anc.code}`}`,
      );
      continue;
    }
    const del = await git(["branch", "-D", branch]);
    ctx.log(
      del.code === 0
        ? `LAND #${n} cleanup deleted branch ${branch}`
        : `LAND #${n} cleanup kept branch ${branch}: ${firstLine(del.stderr)}`,
    );
  }
}

// ── one PR ───────────────────────────────────────────────────────────────────────────

async function landOne(ctx, n) {
  let pr = await settledFirstView(ctx, n);
  if (pr.state === "MERGED") {
    ctx.log(`LAND #${n} skipped reason=already merged`);
    return { status: "skipped" };
  }
  const refused = refusal(pr, ctx.base);
  if (refused) throw new Stop(refused);
  const method = await mergeMethodFor(ctx, n, pr.baseRefName);
  ctx.log(
    `LAND #${n} open head=${short(pr.headRefOid)} merge=${pr.mergeStateStatus} method=${method} "${pr.title}"`,
  );

  if (ctx.dryRun) {
    const steps = [];
    if (pr.mergeStateStatus === "BEHIND") steps.push("update-branch and wait for the new head");
    steps.push(`wait for checks (≤ ${ctx.checksTimeoutMin} min)`, "require CLEAN");
    steps.push(
      `merge --${method} pinned to sha=${pr.mergeStateStatus === "BEHIND" ? "<the new head>" : pr.headRefOid}`,
    );
    if (pr.sameRepo) steps.push(`delete branch ${pr.headRefName}`);
    ctx.log(`LAND #${n} dry-run would: ${steps.join("; ")}`);
    if (ctx.cleanup) await cleanupWorktree(ctx, n, pr.headRefName, pr.headRefOid);
    return { status: "dry-run" };
  }

  if (pr.mergeStateStatus === "BEHIND") pr = await updateBranch(ctx, n, pr);

  for (let round = 1; ; round++) {
    const began = pr.headRefOid;
    await waitForChecks(ctx, n, began);
    pr = await gateView(ctx, n, began);
    if (pr.state === "MERGED") {
      ctx.log(`LAND #${n} skipped reason=merged elsewhere during the checks wait`);
      return { status: "skipped" };
    }
    if (pr.state !== "OPEN") throw new Stop(`state=${pr.state} after the checks wait`);
    // The first view's refusals, again: the base, the title and draft can all change while
    // the checks run, and this view — not the first one — is what the merge acts on.
    const refusedNow = refusal(pr, ctx.base);
    if (refusedNow) throw new Stop(`${refusedNow}; seen after the checks wait on ${short(began)}`);
    if (pr.headRefOid !== began) {
      if (round >= ctx.t.maxCheckRounds) {
        throw new Stop(`head kept moving: ${round} check rounds, now ${short(pr.headRefOid)}`);
      }
      ctx.log(
        `LAND #${n} head moved during checks ${short(began)} -> ${short(pr.headRefOid)}; re-gating`,
      );
      continue;
    }
    // main moved while the checks ran (typically: the previous PR in this run, or another
    // session, merged). The checks just watched are on a head that can no longer merge
    // under strict protection, so update again and re-check — within the same round cap.
    if (pr.mergeStateStatus === "BEHIND") {
      if (round >= ctx.t.maxCheckRounds) {
        throw new Stop(
          `still BEHIND after ${round} check rounds on ${short(began)}: main kept moving`,
        );
      }
      ctx.log(`LAND #${n} BEHIND at the gate on ${short(began)}; updating again`);
      pr = await updateBranch(ctx, n, pr);
      continue;
    }
    if (pr.mergeStateStatus !== "CLEAN") {
      throw new Stop(`mergeStateStatus=${pr.mergeStateStatus} on ${short(began)}`);
    }
    break;
  }

  const sha = pr.headRefOid;
  const mergeCommit = await merge(ctx, n, pr, method);
  ctx.log(`LAND #${n} merged ${mergeCommit} head=${sha} method=${method}`);
  if (ctx.cleanup) await cleanupWorktree(ctx, n, pr.headRefName, sha);
  return { status: "merged", mergeCommit, head: sha, method };
}

// ── the run ──────────────────────────────────────────────────────────────────────────

/**
 * Land `prs` in order. Returns `{ code, results }`: code 0 when every PR merged or was
 * skipped, 1 at the first stop (later PRs are not touched).
 */
export async function landPrs({
  prs,
  repo,
  dryRun = false,
  cleanup = false,
  checksTimeoutMin = 20,
  base = "main",
  run = realRunner,
  sleep = realSleep,
  now = () => Date.now(),
  log = (line) => console.log(line),
  cwd = process.cwd(),
  timing = {},
}) {
  const ctx = {
    repo,
    dryRun,
    cleanup,
    checksTimeoutMin,
    base,
    run,
    sleep,
    now,
    log,
    cwd,
    t: { ...DEFAULT_TIMING, ...timing },
  };
  const results = [];
  for (const n of prs) {
    try {
      results.push({ pr: n, ...(await landOne(ctx, n)) });
    } catch (e) {
      const reason = e instanceof Stop ? e.reason : `error: ${e?.message ?? e}`;
      log(`LAND #${n} stopped reason=${reason}`);
      results.push({ pr: n, status: "stopped", reason });
      return { code: 1, results };
    }
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  log(
    dryRun
      ? `LAND dry-run done: nothing was changed (${results.length} PR${results.length === 1 ? "" : "s"} viewed)`
      : `LAND done merged=${count("merged")} skipped=${count("skipped")}`,
  );
  return { code: 0, results };
}

/** `owner/repo` from a git remote URL (https, ssh or scp-style). Empty when it names none. */
export function repoFromRemoteUrl(url) {
  const m = String(url ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .match(/[/:]([\w.-]+)\/([\w.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : "";
}

/** The repo `origin` points at, as GitHub names it (`gh api repos/…` follows a rename). */
export async function resolveRepo({
  run = realRunner,
  cwd = process.cwd(),
  sleep = realSleep,
} = {}) {
  const remote = await run("git", ["remote", "get-url", "origin"], {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if (remote.code !== 0) {
    return { error: `git remote get-url origin failed: ${ghFailureDetail(remote)}` };
  }
  const guess = repoFromRemoteUrl(remote.stdout);
  if (!guess) return { error: `origin ${firstLine(remote.stdout)} does not name owner/repo` };
  const r = await withReadRetries(
    () =>
      run("gh", ["api", `repos/${guess}`, "--jq", ".full_name"], { cwd, timeoutMs: GH_TIMEOUT_MS }),
    sleep,
    DEFAULT_TIMING,
  );
  const repo = r.stdout.trim();
  if (r.code !== 0 || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return { error: `gh api repos/${guess} failed${afterAttempts(r)}: ${ghFailureDetail(r)}` };
  }
  return { repo };
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`land-prs: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  if (!o.repo) {
    const { repo, error } = await resolveRepo();
    if (!repo) {
      process.stderr.write(`land-prs: cannot tell the repo (pass --repo): ${error}\n`);
      process.exitCode = 2;
      return;
    }
    o.repo = repo;
  }
  const { code } = await landPrs(o);
  process.exitCode = code;
}

if (process.argv[1] && realOrSelf(process.argv[1]) === realOrSelf(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    process.stderr.write(`land-prs: ${e?.stack ?? e}\n`);
    process.exitCode = 1;
  });
}
