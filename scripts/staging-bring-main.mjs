#!/usr/bin/env node
// Bring `main` into `staging` on a staging-flow site, with pnpm-lock.yaml merged by pnpm
// instead of by git as text.
//
//   node scripts/staging-bring-main.mjs --dir <site checkout> [--main <ref>] [--staging <ref>]
//                                       [--branch <name>] [--no-fetch] [--pnpm "<command>"]
//
// Run it from this repo against a site's checkout (`--dir`); the site needs a full clone, not
// a shallow one, because the merge needs the merge base.
//
// Why (2026-11-03): on the staging flow, Renovate's patches and minors land on `main`, and
// lock-file maintenance and majors land on `staging`, so both branches rewrite pnpm-lock.yaml
// between promotions. Git then conflicts on the lockfile and nothing else: the 11-03 states of
// caltex-landing (non-major #104 on main, lock-file maintenance #105 on staging; 51 hunks) and
// medical-solutions-of-texas (#111 on main, #113 and #117 on staging; 31 hunks) left both the
// bring-main PR and the promotion PR dirty. GitHub could only resolve that by hand-editing the
// text, and on a bring-main PR whose head is `main` it would commit the result to `main`. This
// script is the runbook's conflict path, done the same way every time:
//
//   1. fetch the two refs (unless --no-fetch); nothing to do when `main` is already an
//      ancestor of `staging`;
//   2. in a temporary worktree at `staging`, `git merge --no-ff --no-commit main`;
//   3. a conflict in any file but the root pnpm-lock.yaml stops with exit 2: a real fork (a
//      major on `staging` against a minor of the same package on `main`), or a nested lockfile
//      this script does not handle. Either is a human's;
//   4. `pnpm install --lockfile-only --ignore-scripts` with the site's pinned pnpm (its
//      `packageManager`, through corepack; with no pin it refuses unless --pnpm is given). pnpm
//      merges the two sides of a conflicted lockfile itself ("Merge conflict detected in
//      pnpm-lock.yaml and successfully merged") and re-resolves only what the merged
//      package.json no longer matches. It runs after a clean textual merge too, because two
//      clean hunks can still leave a lockfile that disagrees with package.json;
//   5. refuse the result if a conflict marker or unmerged path is left, or if pnpm changed any
//      file but the lockfile;
//   6. commit it as a merge commit, so `main` is a parent and the promotion PR has nothing
//      left to merge from `main`, and create <branch> at it in the checkout.
//
// It changes nothing on GitHub. Push <branch>, open its PR into `staging`, and merge that PR
// as a merge commit on green, only while `staging`'s live tip is still the sha printed here
// (docs/runbooks/staging-flow.md, "Promotion, each time").
//
// Exit codes: 0 the branch was made, or there was nothing to bring; 2 a conflict outside the
// root pnpm-lock.yaml (nothing was made); 1 any other failure (nothing was made).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { flagValue, isMain } from "./lib/cli.mjs";

export const LOCKFILE = "pnpm-lock.yaml";
const USAGE =
  "usage: node scripts/staging-bring-main.mjs --dir <site checkout> [--main <ref>] [--staging <ref>]\n" +
  '                                           [--branch <name>] [--no-fetch] [--pnpm "<command>"]\n' +
  "exit: 0 made or nothing to bring, 2 a conflict outside pnpm-lock.yaml, 1 error";

export function parseArgs(argv, now = new Date()) {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const o = {
    dir: process.cwd(),
    main: "origin/main",
    staging: "origin/staging",
    branch: `claude/main-into-staging-${stamp}`,
    fetch: true,
    pnpm: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") o.dir = resolve(flagValue(argv[++i], a));
    else if (a === "--main") o.main = flagValue(argv[++i], a);
    else if (a === "--staging") o.staging = flagValue(argv[++i], a);
    else if (a === "--branch") o.branch = flagValue(argv[++i], a);
    else if (a === "--pnpm") o.pnpm = flagValue(argv[++i], a);
    else if (a === "--no-fetch") o.fetch = false;
    else throw new Error(`unknown argument: ${a}\n${USAGE}`);
  }
  return o;
}

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}

function mustGit(cwd, args) {
  const r = git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/** The pnpm to run: --pnpm as given, else the site's pinned `packageManager` through corepack. */
export function pnpmCommand(siteDir, override) {
  if (override) return override.split(/\s+/).filter(Boolean);
  let pm;
  try {
    pm = JSON.parse(readFileSync(join(siteDir, "package.json"), "utf8")).packageManager;
  } catch {
    pm = undefined;
  }
  const m = typeof pm === "string" && /^pnpm@([^+\s]+)/.exec(pm);
  if (!m)
    throw new Error(
      "package.json pins no pnpm (`packageManager`); pass --pnpm with the version CI uses, " +
        "or a different pnpm may rewrite the whole lockfile",
    );
  return ["corepack", `pnpm@${m[1]}`];
}

/** `origin/main` → ["origin", "main"] when `origin` is a remote of `dir`; anything else → null. */
function remoteBranch(ref, remotes) {
  const i = ref.indexOf("/");
  return i > 0 && remotes.includes(ref.slice(0, i)) ? [ref.slice(0, i), ref.slice(i + 1)] : null;
}

const MARKER = /^(<{7}|={7}|>{7})( |$)/m;

/**
 * @returns {{status: "up-to-date"} | {status: "conflict", files: string[]} |
 *           {status: "made", branch: string, sha: string, main: string, staging: string, lockfileConflicted: boolean}}
 */
export function bringMain(o) {
  if (mustGit(o.dir, ["rev-parse", "--is-shallow-repository"]) === "true")
    throw new Error(
      `${o.dir} is a shallow clone, so the merge base may be missing; run \`git fetch --unshallow\` there first`,
    );
  if (o.fetch) {
    const remotes = mustGit(o.dir, ["remote"]).split("\n");
    for (const ref of [o.main, o.staging]) {
      const rb = remoteBranch(ref, remotes);
      if (!rb)
        throw new Error(`cannot fetch ${ref}: name it as <remote>/<branch>, or pass --no-fetch`);
      mustGit(o.dir, ["fetch", "-q", rb[0], `+refs/heads/${rb[1]}:refs/remotes/${ref}`]);
    }
  }
  // After a fetch, read the remote-tracking ref itself: a local branch named `origin/main` would shadow it.
  const full = (ref) => (o.fetch ? `refs/remotes/${ref}` : ref);
  const main = mustGit(o.dir, ["rev-parse", "--verify", `${full(o.main)}^{commit}`]);
  const staging = mustGit(o.dir, ["rev-parse", "--verify", `${full(o.staging)}^{commit}`]);
  if (git(o.dir, ["merge-base", "--is-ancestor", main, staging]).code === 0)
    return { status: "up-to-date" };
  if (git(o.dir, ["rev-parse", "--verify", "-q", `refs/heads/${o.branch}`]).code === 0)
    throw new Error(`branch ${o.branch} already exists`);

  const tmp = mkdtempSync(join(tmpdir(), "bring-main-"));
  const wt = join(tmp, "wt");
  try {
    // Inside the try: a `worktree add` that fails part-way (a hook, a lazy blob fetch cut off)
    // still leaves a registered worktree, which the finally removes.
    mustGit(o.dir, ["worktree", "add", "-q", "--detach", wt, staging]);
    const merged = git(wt, ["merge", "--no-ff", "--no-commit", main]);
    const unmerged = () =>
      git(wt, ["diff", "--name-only", "--diff-filter=U"]).stdout.split("\n").filter(Boolean);
    const conflicted = unmerged();
    const others = conflicted.filter((f) => f !== LOCKFILE);
    if (others.length) {
      git(wt, ["merge", "--abort"]);
      return { status: "conflict", files: others };
    }
    if (merged.code !== 0 && conflicted.length === 0)
      throw new Error(`git merge failed: ${merged.stderr || merged.stdout}`);

    if (existsSync(join(wt, LOCKFILE))) {
      const [cmd, ...pre] = pnpmCommand(wt, o.pnpm);
      const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
      const args = [
        ...pre,
        "install",
        "--lockfile-only",
        "--ignore-scripts",
        "--no-frozen-lockfile",
      ];
      const r = spawnSync(cmd, args, { cwd: wt, env, encoding: "utf8" });
      if (r.error)
        throw new Error(
          `${cmd} could not run: ${r.error.message}` +
            (cmd === "corepack"
              ? `. Node 25 and later ship no corepack: \`npm i -g corepack\`, or pass --pnpm "npx pnpm@${pre[0]?.slice(5)}"`
              : ""),
        );
      if (r.status !== 0)
        throw new Error(
          `${[cmd, ...args].join(" ")} failed (${r.status ?? r.signal}):\n${r.stderr || r.stdout}`,
        );
      if (MARKER.test(readFileSync(join(wt, LOCKFILE), "utf8")))
        throw new Error(
          `${LOCKFILE} still has conflict markers after ${[cmd, ...pre].join(" ")} install`,
        );
      mustGit(wt, ["add", LOCKFILE]);
      const stray = [
        ...git(wt, ["diff", "--name-only"]).stdout.split("\n"),
        ...git(wt, ["ls-files", "--others", "--exclude-standard"]).stdout.split("\n"),
      ].filter(Boolean);
      if (stray.length)
        throw new Error(`pnpm changed files besides ${LOCKFILE}: ${stray.join(", ")}`);
    }
    const left = unmerged();
    if (left.length) throw new Error(`still unmerged: ${left.join(", ")}`);

    const how = conflicted.includes(LOCKFILE)
      ? `${LOCKFILE} conflicted, and pnpm merged it (\`pnpm install --lockfile-only\`), not a hand edit.`
      : `${LOCKFILE} merged as text, then went through \`pnpm install --lockfile-only\`.`;
    mustGit(wt, [
      "commit",
      "-q",
      "--no-verify",
      "-m",
      "Merge main into staging",
      "-m",
      `main ${main.slice(0, 7)} into staging ${staging.slice(0, 7)}, by scripts/staging-bring-main.mjs ` +
        `(reddoorla/reddoor-maintenance). ${how}`,
    ]);
    const sha = mustGit(wt, ["rev-parse", "HEAD"]);
    mustGit(o.dir, ["branch", o.branch, sha]);
    return {
      status: "made",
      branch: o.branch,
      sha,
      main,
      staging,
      lockfileConflicted: conflicted.includes(LOCKFILE),
    };
  } finally {
    git(o.dir, ["worktree", "remove", "--force", wt]);
    rmSync(tmp, { recursive: true, force: true });
    git(o.dir, ["worktree", "prune"]);
  }
}

if (isMain(import.meta.url)) {
  let code = 1;
  try {
    const o = parseArgs(process.argv.slice(2));
    const remote = o.staging.includes("/") ? o.staging.slice(0, o.staging.indexOf("/")) : "origin";
    const r = bringMain(o);
    if (r.status === "up-to-date") {
      console.log("nothing to bring: main is already an ancestor of staging");
      code = 0;
    } else if (r.status === "conflict") {
      console.error(
        `stopped: main and staging conflict outside the root ${LOCKFILE}, in ${r.files.join(", ")}. ` +
          "That is a real fork or a nested lockfile, not the lockfile race; nothing was made.",
      );
      code = 2;
    } else {
      console.log(
        `made ${r.branch} at ${r.sha.slice(0, 7)}: main ${r.main.slice(0, 7)} into staging ${r.staging}` +
          (r.lockfileConflicted
            ? `, ${LOCKFILE} conflicted and merged by pnpm`
            : `, ${LOCKFILE} merged as text and passed through pnpm`),
      );
      console.log(
        `next: git push ${remote} ${r.branch}; open its PR into staging; merge it on green as a merge commit, ` +
          `never a squash, and only while staging's live tip (GET branches/staging) is still ${r.staging}; ` +
          "if it has moved, close the PR and run this again",
      );
      code = 0;
    }
  } catch (e) {
    console.error(`staging-bring-main: ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exitCode = code;
}
