#!/usr/bin/env node
// Land PRs one at a time, each merge pinned to the head SHA its checks passed on.
//
//   node scripts/land-prs.mjs <pr> [<pr> …] [--repo owner/repo] [--dry-run] [--cleanup]
//                             [--checks-timeout-min N]
//
// `main` is strict and platform auto-merge is off, so landing a PR is a manual loop: if
// it is BEHIND, update the branch, wait for the checks on the NEW head, then squash-merge
// with `--match-head-commit` so nothing that arrived after the checks can ride in. In the
// week of 2026-09-14 that loop was run by hand about eight times. This script is that
// loop, run strictly serially — landing one PR makes the next one BEHIND, so running
// them in parallel only multiplies the update-branch rounds.
//
// Per PR, in order:
//   1. view. MERGED → skip and continue. UNKNOWN → re-view (≤ 3 × 10 s) before deciding:
//      the first view of a PR taken right after the previous one merged is UNKNOWN while
//      GitHub recomputes, and acting on it skipped the BEHIND step in the first live run.
//      CLOSED, draft, base ≠ main, or a release PR (title `chore(release)…` or head
//      `changeset-release/*`, which AUTONOMY.md §"Merge authority" keeps human) → stop.
//      DIRTY → stop (a conflict gets no CI).
//   2. BEHIND → `gh pr update-branch`, sleep 25 s, poll until headRefOid moves (≤ 3 min).
//   3. `gh pr checks --watch --fail-fast` (≤ --checks-timeout-min). Non-zero → stop,
//      naming the failing checks.
//   4. re-view. The head moved during the wait → back to 3. BEHIND (main moved during the
//      wait) → back to 2. Both count against the same 3 rounds. Otherwise the merge state
//      must be CLEAN (UNKNOWN/BLOCKED get a short settle first, because GitHub recomputes
//      it lazily after the last check completes); any other state stops.
//   5. `gh pr merge --squash --delete-branch --match-head-commit <sha>`, then verify
//      MERGED. Run from a worktree, gh prints `failed to run git: fatal: 'main' is
//      already used by worktree …` and exits non-zero AFTER the merge succeeded — its
//      local branch switch fails, not the merge — so the view is the verdict, not the
//      exit code.
//   6. --cleanup: a local worktree on the PR's head branch with a clean `git status` is
//      removed (never forced), and its branch deleted if its tip is an ancestor of the
//      merged head (fetched first: update-branch puts a merge commit on top on GitHub).
//
// The first stop ends the run (`LAND #N stopped reason=…`, exit 1); later PRs are not
// touched. --dry-run only views, and prints what it would do.
//
// The gh/git runner and the sleep are injected (see `landPrs`), which is how
// tests/scripts/land-prs.test.ts drives every branch of this without a network.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const VIEW_FIELDS =
  "number,title,state,isDraft,baseRefName,headRefName,headRefOid,mergeStateStatus";

export const DEFAULT_TIMING = {
  afterUpdateSleepMs: 25_000,
  headPollIntervalMs: 10_000,
  headPollMaxMs: 180_000,
  maxCheckRounds: 3,
  noChecksRetries: 3,
  noChecksIntervalMs: 20_000,
  settleRetries: 3,
  settleIntervalMs: 10_000,
  mergeVerifyRetries: 3,
  mergeVerifyIntervalMs: 5_000,
};

const GH_TIMEOUT_MS = 60_000;
const GIT_TIMEOUT_MS = 15_000;
const GIT_FETCH_TIMEOUT_MS = 60_000;
// States GitHub reports while it is still recomputing mergeability after checks finish.
const SETTLING = new Set(["UNKNOWN", "BLOCKED"]);

const USAGE =
  "usage: node scripts/land-prs.mjs <pr> [<pr> …] [--repo owner/repo] [--dry-run] [--cleanup] [--checks-timeout-min N]";

class Stop extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

// ── arguments ────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const o = { prs: [], repo: undefined, dryRun: false, cleanup: false, checksTimeoutMin: 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--cleanup") o.cleanup = true;
    else if (a === "--repo") {
      const v = argv[++i];
      if (!v || !/^[\w.-]+\/[\w.-]+$/.test(v)) throw new Error(`--repo needs owner/repo`);
      o.repo = v;
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

/** gh's local branch switch after a successful merge, run from a worktree. */
export function isWorktreeNoise(text) {
  return /already used by worktree|is already checked out at/.test(text);
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

// ── gh ───────────────────────────────────────────────────────────────────────────────

function gh(ctx, args, timeoutMs = GH_TIMEOUT_MS) {
  return ctx.run("gh", [...args, "--repo", ctx.repo], { cwd: ctx.cwd, timeoutMs });
}

async function viewPr(ctx, n, fields = VIEW_FIELDS) {
  const r = await gh(ctx, ["pr", "view", String(n), "--json", fields]);
  if (r.code !== 0) throw new Stop(`gh pr view failed: ${firstLine(r.stderr || r.stdout)}`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Stop(`gh pr view returned no JSON: ${firstLine(r.stdout)}`);
  }
}

function refusal(pr) {
  if (pr.state !== "OPEN") return `state=${pr.state}`;
  if (pr.isDraft) return "draft";
  if (pr.baseRefName !== "main") return `base is ${pr.baseRefName}, not main`;
  if (isReleasePr(pr)) {
    return `release PR (title "${pr.title}", head ${pr.headRefName}) — always human, AUTONOMY.md §Merge authority`;
  }
  if (pr.mergeStateStatus === "DIRTY") return "mergeStateStatus=DIRTY (conflicts with main)";
  return "";
}

async function updateBranch(ctx, n, pr) {
  ctx.log(`LAND #${n} BEHIND — update-branch from ${short(pr.headRefOid)}`);
  const r = await gh(ctx, ["pr", "update-branch", String(n)]);
  if (r.code !== 0) throw new Stop(`update-branch failed: ${firstLine(r.stderr || r.stdout)}`);
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

async function failingChecks(ctx, n) {
  const r = await gh(ctx, ["pr", "checks", String(n), "--json", "name,bucket"]);
  try {
    return JSON.parse(r.stdout)
      .filter((c) => c.bucket === "fail" || c.bucket === "cancel")
      .map((c) => c.name);
  } catch {
    return [];
  }
}

async function waitForChecks(ctx, n, sha) {
  const deadline = Date.now() + ctx.checksTimeoutMin * 60_000;
  ctx.log(`LAND #${n} checks watching ${short(sha)} (timeout ${ctx.checksTimeoutMin} min)`);
  for (let attempt = 0; ; attempt++) {
    const remaining = Math.max(1_000, deadline - Date.now());
    const r = await gh(ctx, ["pr", "checks", String(n), "--watch", "--fail-fast"], remaining);
    if (r.timedOut)
      throw new Stop(`checks still running after ${ctx.checksTimeoutMin} min on ${short(sha)}`);
    if (r.code === 0) {
      ctx.log(`LAND #${n} checks passed on ${short(sha)}`);
      return;
    }
    // Right after a push the new head can have no check runs registered yet.
    if (/no checks reported/i.test(r.stdout + r.stderr)) {
      if (attempt < ctx.t.noChecksRetries) {
        await ctx.sleep(ctx.t.noChecksIntervalMs);
        continue;
      }
      throw new Stop(`no checks reported on ${short(sha)}`);
    }
    const names = await failingChecks(ctx, n);
    const what =
      names.length > 0 ? names.join(", ") : firstLine(r.stderr || r.stdout) || `exit ${r.code}`;
    throw new Stop(`checks failed on ${short(sha)}: ${what}`);
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

async function merge(ctx, n, sha) {
  const r = await gh(
    ctx,
    ["pr", "merge", String(n), "--squash", "--delete-branch", "--match-head-commit", sha],
    120_000,
  );
  const output = `${r.stdout}\n${r.stderr}`;
  const noise = r.code !== 0 && isWorktreeNoise(output);
  const tries = r.code === 0 || noise ? ctx.t.mergeVerifyRetries : 1;
  let v;
  for (let i = 0; i < tries; i++) {
    if (i > 0) await ctx.sleep(ctx.t.mergeVerifyIntervalMs);
    v = await viewPr(ctx, n, "state,mergeCommit");
    if (v.state === "MERGED") break;
  }
  if (!v || v.state !== "MERGED") {
    throw new Stop(
      `merge did not land (state=${v?.state}): ${firstLine(r.stderr || r.stdout) || `exit ${r.code}`}`,
    );
  }
  if (r.code !== 0 && !noise) {
    ctx.log(
      `LAND #${n} note: gh pr merge exited ${r.code} but the PR is MERGED: ${firstLine(r.stderr || r.stdout)}`,
    );
  }
  return v.mergeCommit?.oid ?? "(unknown merge commit)";
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
    // A squash merge leaves the branch's commits unreachable from main, so `branch -d`
    // always refuses. Force-delete only when the local tip is an ANCESTOR of the head
    // GitHub merged — then every local commit is in what landed — and keep it otherwise.
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
  const refused = refusal(pr);
  if (refused) throw new Stop(refused);
  ctx.log(
    `LAND #${n} open head=${short(pr.headRefOid)} merge=${pr.mergeStateStatus} "${pr.title}"`,
  );

  if (ctx.dryRun) {
    const steps = [];
    if (pr.mergeStateStatus === "BEHIND") steps.push("update-branch and wait for the new head");
    steps.push(`wait for checks (≤ ${ctx.checksTimeoutMin} min)`, "require CLEAN");
    steps.push(
      `merge --squash --delete-branch --match-head-commit ${pr.mergeStateStatus === "BEHIND" ? "<the new head>" : pr.headRefOid}`,
    );
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
  const mergeCommit = await merge(ctx, n, sha);
  ctx.log(`LAND #${n} merged ${mergeCommit} head=${sha}`);
  if (ctx.cleanup) await cleanupWorktree(ctx, n, pr.headRefName, sha);
  return { status: "merged", mergeCommit, head: sha };
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
  run = realRunner,
  sleep = realSleep,
  log = (line) => console.log(line),
  cwd = process.cwd(),
  timing = {},
}) {
  const ctx = {
    repo,
    dryRun,
    cleanup,
    checksTimeoutMin,
    run,
    sleep,
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
    const r = await realRunner(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
      {
        timeoutMs: GH_TIMEOUT_MS,
      },
    );
    o.repo = r.stdout.trim();
    if (r.code !== 0 || !o.repo) {
      process.stderr.write(
        `land-prs: cannot tell the repo (pass --repo): ${firstLine(r.stderr)}\n`,
      );
      process.exitCode = 2;
      return;
    }
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
