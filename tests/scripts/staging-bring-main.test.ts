// scripts/staging-bring-main.mjs against a real git repo and the real pnpm. The fixture's
// dependencies are `link:` packages inside the repo, so pnpm resolves them with no registry.
// The race of 2026-11-03 (caltex-landing #104/#105, medical-solutions-of-texas #111/#113):
// `main` and `staging` each rewrite pnpm-lock.yaml, git conflicts on the lockfile alone,
// and the promotion cannot merge.
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bringMain,
  parseArgs,
  pnpmCommand,
  type Options,
} from "../../scripts/staging-bring-main.mjs";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  CI: "",
};
Object.assign(process.env, {
  GIT_AUTHOR_NAME: ENV.GIT_AUTHOR_NAME,
  GIT_AUTHOR_EMAIL: ENV.GIT_AUTHOR_EMAIL,
  GIT_COMMITTER_NAME: ENV.GIT_COMMITTER_NAME,
  GIT_COMMITTER_EMAIL: ENV.GIT_COMMITTER_EMAIL,
});

function sh(cwd: string, cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd, env: ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
const git = (cwd: string, ...args: string[]) => sh(cwd, "git", args);
const code = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, env: ENV }).status;
/** The script cleaned up after itself: the checkout is its repo's only worktree. */
const onlyCheckout = (dir: string) =>
  expect(
    git(dir, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((l) => l.startsWith("worktree ")),
  ).toHaveLength(1);

/** package.json lines kept apart so git merges package.json cleanly; the lockfile sorts them together. */
function writePkg(dir: string, deps: Record<string, string>) {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "site", private: true, dependencies: deps }, null, 2),
  );
  sh(dir, "pnpm", ["install", "--lockfile-only", "--ignore-scripts", "--no-frozen-lockfile"]);
  git(dir, "add", "-A");
}

const BASE = {
  a: "link:./vendor/a1",
  m1: "link:./vendor/m1",
  m2: "link:./vendor/m2",
  m3: "link:./vendor/m3",
};

/** A repo whose `main` and `staging` have each changed the lockfile since they parted. */
function fixture(stagingDeps: Record<string, string>, mainDeps: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "bring-main-test-"));
  roots.push(root);
  const dir = join(root, "site");
  mkdirSync(dir);
  for (const p of ["a1", "a2", "a3", "aa", "m1", "m2", "m3"]) {
    mkdirSync(join(dir, "vendor", p), { recursive: true });
    writeFileSync(
      join(dir, "vendor", p, "package.json"),
      JSON.stringify({ name: p, version: "1.0.0" }),
    );
  }
  git(dir, "init", "-q", "-b", "main");
  writePkg(dir, BASE);
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "branch", "staging");
  writePkg(dir, mainDeps);
  git(dir, "commit", "-q", "-m", "main: a non-major bump");
  git(dir, "checkout", "-q", "staging");
  writePkg(dir, stagingDeps);
  git(dir, "commit", "-q", "-m", "staging: its own lockfile change");
  git(dir, "checkout", "-q", "main");
  return dir;
}

const opts = (dir: string, over: Partial<Options> = {}): Options => ({
  dir,
  main: "main",
  staging: "staging",
  branch: "bring",
  fetch: false,
  pnpm: "pnpm",
  ...over,
});

// main bumps `a`; staging adds `aa`, which pnpm sorts right under `a` in the lockfile.
const MAIN = { ...BASE, a: "link:./vendor/a2" };
const STAGING = { ...BASE, aa: "link:./vendor/aa" };

describe("staging-bring-main", () => {
  it("the fixture reproduces the race: git conflicts on pnpm-lock.yaml and nothing else", () => {
    const dir = fixture(STAGING, MAIN);
    const r = spawnSync("git", ["merge-tree", "--write-tree", "--name-only", "main", "staging"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect((r.stdout.split("\n\n")[0] ?? "").split("\n").slice(1)).toEqual(["pnpm-lock.yaml"]);
  });

  it("main and staging each changed the lockfile: the result promotes cleanly and carries both changes", () => {
    const dir = fixture(STAGING, MAIN);
    const r = bringMain(opts(dir));
    expect(r.status).toBe("made");
    if (r.status !== "made") return;
    expect(r.lockfileConflicted).toBe(true);
    // main is a parent, so the promotion PR (staging → main) has nothing left to merge from main
    expect(code(dir, "merge-base", "--is-ancestor", "main", "bring")).toBe(0);
    expect(code(dir, "merge-base", "--is-ancestor", "staging", "bring")).toBe(0);
    expect(code(dir, "merge-tree", "--write-tree", "main", "bring")).toBe(0);
    const lock = git(dir, "show", "bring:pnpm-lock.yaml");
    expect(lock).not.toMatch(/^(<{7}|={7}|>{7})/m);
    expect(lock).toContain("link:vendor/a2");
    expect(lock).toContain("link:vendor/aa");
    expect(lock).not.toContain("link:vendor/a1");
    onlyCheckout(dir);
    // the lockfile satisfies the merged package.json: a frozen install accepts it and writes nothing
    const check = join(dir, "..", "check");
    git(dir, "worktree", "add", "-q", check, "bring");
    sh(check, "pnpm", ["install", "--lockfile-only", "--frozen-lockfile", "--ignore-scripts"]);
    expect(git(check, "status", "--porcelain")).toBe("");
  });

  it("a conflict outside the lockfile stops with nothing made", () => {
    const dir = fixture({ ...BASE, a: "link:./vendor/a3" }, MAIN);
    const r = bringMain(opts(dir));
    expect(r).toEqual({ status: "conflict", files: ["package.json"] });
    expect(code(dir, "rev-parse", "--verify", "-q", "refs/heads/bring")).not.toBe(0);
    onlyCheckout(dir);
  });

  it("refuses a lockfile the regenerate step left conflicted", () => {
    const dir = fixture(STAGING, MAIN);
    expect(() => bringMain(opts(dir, { pnpm: "true" }))).toThrow(/conflict markers/);
    expect(code(dir, "rev-parse", "--verify", "-q", "refs/heads/bring")).not.toBe(0);
    onlyCheckout(dir);
  });

  it("refuses when pnpm changed a file besides the lockfile", () => {
    const dir = fixture(STAGING, MAIN);
    const stub = join(dir, "..", "stub.sh");
    writeFileSync(stub, 'pnpm "$@" && echo x > stray.txt\n');
    expect(() => bringMain(opts(dir, { pnpm: `sh ${stub}` }))).toThrow(
      /besides pnpm-lock.yaml: stray.txt/,
    );
    expect(code(dir, "rev-parse", "--verify", "-q", "refs/heads/bring")).not.toBe(0);
  });

  it("a worktree add that fails part-way leaves no worktree behind", () => {
    const dir = fixture(STAGING, MAIN);
    writeFileSync(join(dir, ".git", "hooks", "post-checkout"), "#!/bin/sh\nexit 1\n", {
      mode: 0o755,
    });
    expect(() => bringMain(opts(dir))).toThrow(/worktree add/);
    onlyCheckout(dir);
  });

  it("names a pnpm that cannot run", () => {
    const dir = fixture(STAGING, MAIN);
    expect(() => bringMain(opts(dir, { pnpm: "no-such-pnpm-here" }))).toThrow(
      /no-such-pnpm-here could not run/,
    );
  });

  it("refuses a shallow clone, whose merge base may be missing", () => {
    const dir = fixture(STAGING, MAIN);
    const shallow = join(dir, "..", "shallow");
    git(
      join(dir, ".."),
      "clone",
      "-q",
      "--depth",
      "1",
      "--no-single-branch",
      `file://${dir}`,
      shallow,
    );
    expect(() =>
      bringMain(opts(shallow, { main: "origin/main", staging: "origin/staging" })),
    ).toThrow(/shallow clone/);
  });

  it("fetches <remote>/<branch> refs before merging, and refuses to fetch any other ref", () => {
    const dir = fixture(STAGING, MAIN);
    const clone = join(dir, "..", "clone");
    git(join(dir, ".."), "clone", "-q", dir, clone);
    // staging moves on the remote after the clone: the script must merge into the moved staging
    git(dir, "checkout", "-q", "staging");
    writeFileSync(join(dir, "later.txt"), "x");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "staging moves");
    const moved = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-q", "main");
    const r = bringMain(
      opts(clone, { main: "origin/main", staging: "origin/staging", fetch: true }),
    );
    expect(r.status === "made" && r.staging).toBe(moved);
    expect(() => bringMain(opts(clone, { branch: "other", fetch: true }))).toThrow(
      /cannot fetch main/,
    );
  });

  it("nothing to bring when main is already in staging", () => {
    const dir = fixture(STAGING, MAIN);
    expect(bringMain(opts(dir)).status).toBe("made");
    git(dir, "branch", "-f", "staging", "bring");
    expect(bringMain(opts(dir, { branch: "again" }))).toEqual({ status: "up-to-date" });
    expect(code(dir, "rev-parse", "--verify", "-q", "refs/heads/again")).not.toBe(0);
  });

  it("uses the site's pinned pnpm through corepack, --pnpm over it, and refuses to guess", () => {
    const root = mkdtempSync(join(tmpdir(), "bring-main-pm-"));
    roots.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ packageManager: "pnpm@12.5.1+sha512.abc" }),
    );
    expect(pnpmCommand(root, undefined)).toEqual(["corepack", "pnpm@12.5.1"]);
    expect(pnpmCommand(root, "pnpm")).toEqual(["pnpm"]);
    expect(() => pnpmCommand(join(root, "missing"), undefined)).toThrow(/pins no pnpm/);
  });

  it("parses its flags", () => {
    const o = parseArgs(
      ["--dir", "/x", "--no-fetch", "--main", "m", "--staging", "s"],
      new Date("2026-11-03T20:05:00Z"),
    );
    expect(o).toMatchObject({
      dir: "/x",
      main: "m",
      staging: "s",
      fetch: false,
      branch: "claude/main-into-staging-20261103-2005",
    });
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown argument/);
  });
});
