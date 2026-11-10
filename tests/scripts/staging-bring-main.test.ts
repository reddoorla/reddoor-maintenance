// scripts/staging-bring-main.mjs against a real git repo and the real pnpm. The fixture's
// dependencies are `link:` packages inside the repo, so pnpm resolves them with no registry.
// The race of 2026-11-03 (caltex-landing #104/#105, medical-solutions-of-texas #111/#113):
// `main` and `staging` each rewrite pnpm-lock.yaml, git conflicts on the lockfile alone,
// and the promotion cannot merge.
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  bringMain,
  compareVersions,
  lockfilePackages,
  lockfileRegressions,
  parseArgs,
  pnpmCommand,
  satisfies,
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

// The 2026-11-10 promotions (reddoorla/alamo-anatomy#108, reddoorla/mantis-landscaping#87): pnpm
// 12.5.1 merged its own lockfile conflict, the script passed it, and the merge had put three of
// staging's lock-file-maintenance versions back to main's older ones. The fixtures are Alamo's
// lockfiles at main 490f148 and staging fbe8c7e, and the one this script's pnpm merge made from
// them (`--main 490f148 --staging fbe8c7e --no-fetch`, pnpm 12.5.1).
const ALAMO = join(__dirname, "..", "fixtures", "bring-main-lockfiles", "alamo-2026-11-10");
const alamo = (side: "main" | "staging" | "merged") =>
  gunzipSync(readFileSync(join(ALAMO, `${side}.pnpm-lock.yaml.gz`))).toString("utf8");

describe("lockfile regressions", () => {
  it("reads every packages: section of pnpm 12's two-document lockfile", () => {
    const pkgs = lockfilePackages(alamo("staging"));
    // the first document is pnpm's own env; the project's ~390 entries are in the second
    expect(pkgs.get("@pnpm/exe.linux-x64")).toEqual(["12.5.1"]);
    expect(pkgs.get("rolldown")).toContain("1.3.0");
    expect([...pkgs.values()].flat().length).toBeGreaterThan(380);
  });

  it("a known-good merge passes: staging's own lockfile against both parents", () => {
    expect(
      lockfileRegressions(alamo("staging"), { main: alamo("main"), staging: alamo("staging") }),
    ).toEqual([]);
  });

  it("the 2026-11-10 Alamo merge is caught, naming exactly the three packages put back", () => {
    const r = lockfileRegressions(alamo("merged"), {
      main: alamo("main"),
      staging: alamo("staging"),
    });
    // rolldown's own @rolldown/binding-* 1.3.0 went with it; they hang off rolldown@1.3.0, which
    // the merged lockfile no longer has, so rolldown's own edge names the regression
    expect(r).toEqual([
      { name: "@netlify/types", side: "staging", had: "3.3.1", merged: "3.3.0" },
      { name: "cookie", side: "staging", had: "2.0.2", merged: "2.0.1" },
      { name: "rolldown", side: "staging", had: "1.3.0", merged: "1.2.16" },
    ]);
  });

  it("orders versions by semver precedence, prereleases included", () => {
    expect(compareVersions("2.0.0-beta.2", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0-beta.10", "2.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0-beta.2", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("3.3.1", "3.3.1")).toBe(0);
  });

  it("knows which versions a package.json range admits, and says when it cannot tell", () => {
    expect(satisfies("25.0.3", "^24.10.1")).toBe(false);
    expect(satisfies("24.12.0", "^24.10.1")).toBe(true);
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfies("0.3.9", "^0.2.0")).toBe(false);
    expect(satisfies("2.5.0", ">=2.0.0 <3")).toBe(true);
    expect(satisfies("3.0.0", "^1 || ^2")).toBe(false);
    expect(satisfies("2.1.0", "^1 || ^2")).toBe(true);
    expect(satisfies("12.5.1", "12.5.1")).toBe(true);
    expect(satisfies("1.4.0", "1.x")).toBe(true);
    expect(satisfies("4.0.0", "*")).toBe(true);
    expect(satisfies("2.0.0-beta.3", "^2.0.0-beta.2")).toBe(true);
    expect(satisfies("2.1.0-beta.1", "^2.0.0")).toBe(false);
    expect(satisfies("1.0.0", "workspace:*")).toBeUndefined();
    expect(satisfies("1.0.0", "catalog:")).toBeUndefined();
  });

  type Deps = Record<string, [string, string]>;
  /** A pnpm 9 lockfile document: importer `.` (and any `more` importers), packages, snapshots. */
  const doc = (
    deps: Deps,
    pkgs: string[],
    o: { snaps?: Record<string, Record<string, string>>; more?: Record<string, Deps> } = {},
  ) =>
    [
      "---",
      "lockfileVersion: '9.0'",
      "",
      "importers:",
      "",
      ...Object.entries({ ".": deps, ...o.more }).flatMap(([path, ds]) => [
        `  ${path}:`,
        "    dependencies:",
        ...Object.entries(ds).flatMap(([n, [spec, v]]) => [
          `      '${n}':`,
          `        specifier: '${spec}'`,
          `        version: ${v}`,
        ]),
        "",
      ]),
      "packages:",
      "",
      ...pkgs.flatMap((p) => [`  '${p}':`, "    resolution: {integrity: sha512-x}", ""]),
      ...(o.snaps
        ? [
            "snapshots:",
            "",
            ...Object.entries(o.snaps).flatMap(([k, ds]) => [
              `  '${k}':`,
              "    dependencies:",
              ...Object.entries(ds).map(([n, v]) => `      '${n}': ${v}`),
              "",
            ]),
          ]
        : []),
    ].join("\n");

  it("a version the merged package.json no longer admits is not a regression (P1-106's @types/node 25 to 24)", () => {
    const staging = doc({ "@types/node": ["^25.0.0", "25.0.3"] }, ["@types/node@25.0.3"]);
    const merged = doc({ "@types/node": ["^24.10.1", "24.12.0"] }, ["@types/node@24.12.0"]);
    expect(lockfileRegressions(merged, { staging })).toEqual([]);
    // the same lockfile with the range still admitting 25 is one
    const kept = doc({ "@types/node": ["^25.0.0", "24.12.0"] }, ["@types/node@24.12.0"]);
    expect(lockfileRegressions(kept, { staging })).toEqual([
      { name: "@types/node", side: "staging", had: "25.0.3", merged: "24.12.0" },
    ]);
  });

  it("with no snapshots, a package whose line is gone is not a regression (cssesc after postcss-selector-parser 7.2.0)", () => {
    const main = doc({}, ["postcss-selector-parser@7.1.0", "cssesc@3.0.0"]);
    const merged = doc({}, ["postcss-selector-parser@7.2.0"]);
    expect(lockfileRegressions(merged, { main })).toEqual([]);
  });

  it("compares each major line on its own: an older copy put back is caught", () => {
    const staging = doc({}, ["foo@2.0.0", "foo@1.5.0"]);
    expect(lockfileRegressions(doc({}, ["foo@2.0.0", "foo@1.0.0"]), { staging })).toEqual([
      { name: "foo", side: "staging", had: "1.5.0", merged: "1.0.0" },
    ]);
    // 0.x lines are 0.minor, as `^` reads them
    expect(
      lockfileRegressions(doc({}, ["z@0.3.1", "z@0.2.0"]), {
        staging: doc({}, ["z@0.3.1", "z@0.2.4"]),
      }),
    ).toEqual([{ name: "z", side: "staging", had: "0.2.4", merged: "0.2.0" }]);
    // a line the merged lockfile no longer has, while a newer line stays, is an upgrade
    expect(lockfileRegressions(doc({}, ["foo@2.0.0"]), { staging })).toEqual([]);
  });

  it("with no snapshots, a direct range for one copy does not exempt another copy in its line", () => {
    const staging = doc({ cookie: ["^1.0.0", "1.0.2"] }, ["cookie@1.0.2", "cookie@2.0.2"]);
    const merged = doc({ cookie: ["^1.0.0", "1.0.2"] }, ["cookie@1.0.2", "cookie@2.0.1"]);
    expect(lockfileRegressions(merged, { staging })).toEqual([
      { name: "cookie", side: "staging", had: "2.0.2", merged: "2.0.1" },
    ]);
  });

  it("with no snapshots, an exact direct pin does not excuse a transitive copy in its line", () => {
    const staging = doc({ foo: ["1.5.0", "1.5.0"] }, ["foo@1.5.0", "foo@1.9.0"]);
    const merged = doc({ foo: ["1.5.0", "1.5.0"] }, ["foo@1.5.0"]);
    expect(lockfileRegressions(merged, { staging })).toEqual([
      { name: "foo", side: "staging", had: "1.9.0", merged: "1.5.0" },
    ]);
    // the pinned copy itself moving down on purpose is still exempt
    const pinned = doc({ foo: ["1.4.0", "1.4.0"] }, ["foo@1.4.0"]);
    expect(
      lockfileRegressions(pinned, { staging: doc({ foo: ["1.5.0", "1.5.0"] }, ["foo@1.5.0"]) }),
    ).toEqual([]);
  });

  it("a gone line whose range resolved to a newer version is an upgrade, not a put-back", () => {
    const staging = doc({ qux: ["*", "2.1.0"] }, ["qux@2.1.0", "qux@1.9.0"]);
    const merged = doc({ qux: ["*", "2.1.0"] }, ["qux@2.1.0"]);
    expect(lockfileRegressions(merged, { staging })).toEqual([]);
  });

  it("a copy whose only dependent left the merged lockfile is gone, even with a lower copy in its line", () => {
    // staging: x needs foo 2.5.0 and y needs foo ~2.3; main removed x, so merged keeps y's 2.3.1
    const staging = doc(
      { x: ["^1", "1.0.0"], y: ["^1", "1.0.0"] },
      ["x@1.0.0", "y@1.0.0", "foo@2.5.0", "foo@2.3.1"],
      { snaps: { "x@1.0.0": { foo: "2.5.0" }, "y@1.0.0": { foo: "2.3.1" } } },
    );
    const merged = doc({ y: ["^1", "1.0.0"] }, ["y@1.0.0", "foo@2.3.1"], {
      snaps: { "y@1.0.0": { foo: "2.3.1" } },
    });
    expect(lockfileRegressions(merged, { staging })).toEqual([]);
    // the same merge with x kept, and x's foo put back, is a regression
    const back = doc(
      { x: ["^1", "1.0.0"], y: ["^1", "1.0.0"] },
      ["x@1.0.0", "y@1.0.0", "foo@2.3.1"],
      { snaps: { "x@1.0.0": { foo: "2.3.1" }, "y@1.0.0": { foo: "2.3.1" } } },
    );
    expect(lockfileRegressions(back, { staging })).toEqual([
      { name: "foo", side: "staging", had: "2.5.0", merged: "2.3.1" },
    ]);
  });

  it("one importer's pin does not excuse another importer's copy", () => {
    const staging = doc({ foo: ["^2.0.0", "2.5.0"] }, ["foo@2.5.0", "foo@2.1.0"], {
      more: { "pkg/b": { foo: ["2.1.0", "2.1.0"] } },
    });
    const merged = doc({ foo: ["^2.0.0", "2.1.0"] }, ["foo@2.1.0"], {
      more: { "pkg/b": { foo: ["2.1.0", "2.1.0"] } },
    });
    expect(lockfileRegressions(merged, { staging })).toEqual([
      { name: "foo", side: "staging", had: "2.5.0", merged: "2.1.0" },
    ]);
  });

  it("a side written by an older pnpm, one document with no env, is still checked edge by edge", () => {
    // pnpm 12 puts its own env first; pnpm 10 and older write the project alone
    const env = [
      "---",
      "lockfileVersion: '9.0'",
      "",
      "importers:",
      "",
      "  .:",
      "    packageManagerDependencies:",
      "      pnpm:",
      "        specifier: 12.5.1",
      "        version: 12.5.1",
      "",
      "packages:",
      "",
      "  pnpm@12.5.1:",
      "    resolution: {integrity: sha512-p}",
      "",
    ].join("\n");
    const deps = { flatpickr: ["^4.6.13", "4.6.14"] } as Deps;
    const side = doc(deps, ["flatpickr@4.6.14"]);
    const merged = env + "\n" + doc({ flatpickr: ["^4.6.13", "4.6.13"] }, ["flatpickr@4.6.13"]);
    const want = [{ name: "flatpickr", side: "main", had: "4.6.14", merged: "4.6.13" }];
    expect(lockfileRegressions(merged, { main: side })).toEqual(want);
    // and the other way round: a two-document side against a one-document merge
    expect(
      lockfileRegressions(doc({ flatpickr: ["^4.6.13", "4.6.13"] }, ["flatpickr@4.6.13"]), {
        main: env + "\n" + side,
      }),
    ).toEqual(want);
  });

  it("each peer variant of a package is compared with its own variant", () => {
    const staging = doc({ foo: ["^1", "1.0.0(react@18.0.0)"] }, ["foo@1.0.0", "bar@2.0.0"], {
      snaps: { "foo@1.0.0(react@18.0.0)": { bar: "2.0.0" } },
    });
    const merged = doc(
      { foo: ["^1", "1.0.0(react@18.0.0)"] },
      ["foo@1.0.0", "bar@1.0.0", "bar@2.0.0"],
      {
        snaps: {
          "foo@1.0.0(react@18.0.0)": { bar: "1.0.0" },
          "foo@1.0.0(react@19.0.0)": { bar: "2.0.0" },
        },
      },
    );
    expect(lockfileRegressions(merged, { staging })).toEqual([
      { name: "bar", side: "staging", had: "2.0.0", merged: "1.0.0" },
    ]);
  });

  it("an npm: alias's range counts only for the package it names", () => {
    // pnpm writes a same-name alias (`cookie: npm:cookie@^0.7.0`) with a plain version: that range
    // is cookie's own, so a deliberate rollback through it is a downgrade on purpose
    const staging = doc({ cookie: ["^1.0.0", "1.1.1"] }, ["cookie@1.1.1"]);
    const back = doc({ cookie: ["npm:cookie@^0.7.0", "0.7.2"] }, ["cookie@0.7.2"]);
    expect(lockfileRegressions(back, { staging })).toEqual([]);
    // an alias of another package (`react: npm:@preact/compat@^17`) says nothing of react itself
    const spec = "npm:@preact/compat@^17.0.0";
    const reactSide = doc({ react: [spec, "18.3.1"] }, ["react@18.3.1"]);
    const reactMerged = doc({ react: [spec, "18.3.0"] }, ["react@18.3.0"]);
    expect(lockfileRegressions(reactMerged, { staging: reactSide })).toEqual([
      { name: "react", side: "staging", had: "18.3.1", merged: "18.3.0" },
    ]);
  });

  it("an npm: alias of another package is checked as that package, under its alias key (review round 7)", () => {
    // pnpm writes `foo: npm:bar@^1.0.0` with `version: bar@1.2.0`: the edge is bar's, held by `foo`
    const staging = doc({ foo: ["npm:bar@^1.0.0", "bar@1.2.0"], bar: ["^1.5.0", "1.5.0"] }, [
      "bar@1.2.0",
      "bar@1.5.0",
    ]);
    const back = doc({ foo: ["npm:bar@^1.0.0", "bar@1.1.0"], bar: ["^1.5.0", "1.5.0"] }, [
      "bar@1.1.0",
      "bar@1.5.0",
    ]);
    expect(lockfileRegressions(back, { staging })).toEqual([
      { name: "bar", side: "staging", had: "1.2.0", merged: "1.1.0" },
    ]);
    // the alias's own range moved below 1.2.0: a rollback on purpose
    const rolled = doc({ foo: ["npm:bar@~1.1.0", "bar@1.1.5"], bar: ["^1.5.0", "1.5.0"] }, [
      "bar@1.1.5",
      "bar@1.5.0",
    ]);
    expect(lockfileRegressions(rolled, { staging })).toEqual([]);
    // in a snapshot (`@isaacs/cliui` holds `string-width-cjs: string-width@4.2.3`), beside a plain
    // edge to a newer copy that must not hide it
    const snap = (cjs: string) =>
      doc(
        { cliui: ["^8", "8.0.2"] },
        ["cliui@8.0.2", `string-width@${cjs}`, "string-width@5.1.2"],
        {
          snaps: {
            "cliui@8.0.2": { "string-width": "5.1.2", "string-width-cjs": `string-width@${cjs}` },
          },
        },
      );
    expect(lockfileRegressions(snap("4.2.3"), { staging: snap("4.2.3") })).toEqual([]);
    expect(lockfileRegressions(snap("4.2.0"), { staging: snap("4.2.3") })).toEqual([
      { name: "string-width", side: "staging", had: "4.2.3", merged: "4.2.0" },
    ]);
  });

  it("a catalog: specifier is read through the merged lockfile's catalogs (review round 7)", () => {
    const cat = (range: string) =>
      [
        "",
        "catalogs:",
        "  default:",
        "    react:",
        `      specifier: ${range}`,
        "      version: x",
        "",
      ].join("\n");
    const staging = doc({ react: ["catalog:", "19.1.0"] }, ["react@19.1.0"]) + cat("^19.0.0");
    // the catalog moved to ^18.3.0: a rollback on purpose
    const rolled = doc({ react: ["catalog:", "18.3.1"] }, ["react@18.3.1"]) + cat("^18.3.0");
    expect(lockfileRegressions(rolled, { staging })).toEqual([]);
    // the catalog still admits 19.1.0: a put-back
    const back = doc({ react: ["catalog:", "19.0.0"] }, ["react@19.0.0"]) + cat("^19.0.0");
    expect(lockfileRegressions(back, { staging })).toEqual([
      { name: "react", side: "staging", had: "19.1.0", merged: "19.0.0" },
    ]);
  });

  it("a dependent bumped to a newer copy in its line still resolves its dependencies at least as new (review round 7)", () => {
    // staging's maintenance moved foo@1.0.0's bar to 2.1.0; main's Renovate moved foo to 1.0.1,
    // whose snapshot pnpm kept with bar 2.0.0
    const staging = doc({ foo: ["^1.0.0", "1.0.0"] }, ["foo@1.0.0", "bar@2.1.0"], {
      snaps: { "foo@1.0.0": { bar: "2.1.0" } },
    });
    const merged = (foo: string) =>
      doc({ foo: [`^${foo}`, foo] }, [`foo@${foo}`, "bar@2.0.0"], {
        snaps: { [`foo@${foo}`]: { bar: "2.0.0" } },
      });
    expect(lockfileRegressions(merged("1.0.1"), { staging })).toEqual([
      { name: "bar", side: "staging", had: "2.1.0", merged: "2.0.0" },
    ]);
    // a new major of the dependent may ask for another bar: gone, as before
    expect(lockfileRegressions(merged("2.0.0"), { staging })).toEqual([]);
  });

  it("a peer variant the merged lockfile lacks is compared with the lowest of its variants (review round 7)", () => {
    const staging = doc({ foo: ["^1", "1.0.0(react@18.3.0)"] }, ["foo@1.0.0", "bar@2.1.0"], {
      snaps: {
        "foo@1.0.0(react@18.3.0)": { bar: "2.1.0" },
        "foo@1.0.0(react@19.0.0)": { bar: "2.1.0" },
      },
    });
    const merged = doc(
      { foo: ["^1", "1.0.0(react@18.3.1)"] },
      ["foo@1.0.0", "bar@2.0.0", "bar@2.1.0"],
      {
        snaps: {
          "foo@1.0.0(react@18.3.1)": { bar: "2.0.0" },
          "foo@1.0.0(react@19.0.0)": { bar: "2.1.0" },
        },
      },
    );
    expect(lockfileRegressions(merged, { staging })).toEqual([
      { name: "bar", side: "staging", had: "2.1.0", merged: "2.0.0" },
    ]);
  });

  it("an override whose selector holds `>` (`cookie@>=2.0.2`) is global, not scoped under a parent", () => {
    const staging = doc({}, ["cookie@2.0.2"]);
    const pin = (key: string) =>
      ["overrides:", `  '${key}': 2.0.1`, "", doc({}, ["cookie@2.0.1"])].join("\n");
    expect(lockfileRegressions(pin("cookie@>=2.0.2"), { staging })).toEqual([]);
    expect(lockfileRegressions(pin("cookie@>=2.0.0 <=2.0.5"), { staging })).toEqual([]);
    // a parent-scoped key still speaks for no other copy
    expect(lockfileRegressions(pin("kit@3>cookie"), { staging })).toHaveLength(1);
  });

  it("an override that pins a package lower is a downgrade on purpose", () => {
    const staging = doc({}, ["bar@1.2.0"]);
    const merged = ["overrides:", "  bar: 1.0.0", "", doc({}, ["bar@1.0.0"])].join("\n");
    expect(lockfileRegressions(merged, { staging })).toEqual([]);
    const scoped = ["overrides:", "  '@s/bar@^1': 1.0.0", "", doc({}, ["@s/bar@1.0.0"])].join("\n");
    expect(lockfileRegressions(scoped, { staging: doc({}, ["@s/bar@1.2.0"]) })).toEqual([]);
    // an override under one parent (`foo@1>baz`) does not speak for baz's other copies
    const parent = ["overrides:", "  'foo@1>baz': 1.0.0", "", doc({}, ["baz@1.0.0"])].join("\n");
    expect(lockfileRegressions(parent, { staging: doc({}, ["baz@1.0.0", "baz@1.9.0"]) })).toEqual([
      { name: "baz", side: "staging", had: "1.9.0", merged: "1.0.0" },
    ]);
  });

  it("reads pnpm 8's `/name@version` keys, so a side on the older format is still compared", () => {
    const staging = [
      "lockfileVersion: '6.0'",
      "",
      "packages:",
      "",
      "  /foo@1.0.1:",
      "    resolution: {integrity: sha512-x}",
      "",
    ].join("\n");
    expect(lockfileRegressions(doc({}, ["foo@1.0.0"]), { staging })).toEqual([
      { name: "foo", side: "staging", had: "1.0.1", merged: "1.0.0" },
    ]);
  });

  it("compares the newest version of each line, and skips versions that are not semver", () => {
    const staging = doc({}, ["a@1.0.0", "a@2.1.0", "t@https://example.com/t.tgz"]);
    const merged = doc({}, ["a@2.1.0", "a@1.0.1", "t@file:vendor/t.tgz"]);
    expect(lockfileRegressions(merged, { staging })).toEqual([]);
    expect(lockfileRegressions(doc({}, ["a@2.0.9"]), { staging })).toEqual([
      { name: "a", side: "staging", had: "2.1.0", merged: "2.0.9" },
    ]);
  });
});

/**
 * A two-document pnpm 12 lockfile (pnpm's env, then the project) with the given versions. Each
 * version sits on its own line, so two branches that move the same package conflict in git.
 */
function lock(v: Record<string, string | string[]>) {
  const env = [
    "---",
    "lockfileVersion: '9.0'",
    "",
    "packages:",
    "",
    `  '@pnpm/exe@${v.pnpm ?? "12.5.1"}':`,
    "    resolution: {integrity: sha512-p}",
    "",
  ];
  const project = ["---", "lockfileVersion: '9.0'", "", "packages:", ""];
  for (const [n, vers] of Object.entries(v))
    if (n !== "pnpm")
      for (const ver of [vers].flat())
        project.push(`  ${n}@${ver}:`, `    resolution: {integrity: sha512-${n}${ver}}`, "");
  return [...env, ...project].join("\n");
}

/**
 * A site whose main and staging each rewrote pnpm-lock.yaml (and, when given, package.json),
 * and a pnpm stub that merges a conflicted lockfile the way pnpm 12.5.1 did on 2026-11-10: it
 * writes `bad` over it. On a lockfile with no markers it changes nothing.
 */
function regressFixture(f: {
  base: Record<string, string | string[]>;
  main: Record<string, string | string[]>;
  staging: Record<string, string | string[]>;
  bad: Record<string, string | string[]>;
  mainPkg?: boolean;
  stagingPkg?: boolean;
  /** a file main adds besides package.json, e.g. a pnpm-workspace.yaml */
  mainFile?: [string, string];
}) {
  const root = mkdtempSync(join(tmpdir(), "bring-main-regress-"));
  roots.push(root);
  const dir = join(root, "site");
  mkdirSync(dir);
  const pkg = (o: { description?: string | undefined; extra?: boolean | undefined }) =>
    JSON.stringify(
      {
        name: "site",
        description: o.description ?? "a site",
        private: true,
        version: "0.0.0",
        type: "module",
        license: "UNLICENSED",
        dependencies: { cookie: "^2.0.0", ...(o.extra ? { zz: "^1.0.0" } : {}) },
      },
      null,
      2,
    );
  const commit = (msg: string, lockfile: Record<string, string | string[]>, p: string) => {
    writeFileSync(join(dir, "package.json"), p);
    writeFileSync(join(dir, "pnpm-lock.yaml"), lock(lockfile));
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", msg);
  };
  git(dir, "init", "-q", "-b", "main");
  commit("base", f.base, pkg({}));
  git(dir, "branch", "staging");
  if (f.mainFile) writeFileSync(join(dir, f.mainFile[0]), f.mainFile[1]);
  commit("main", f.main, pkg({ description: f.mainPkg ? "main moved" : undefined }));
  git(dir, "checkout", "-q", "staging");
  commit("staging", f.staging, pkg({ extra: f.stagingPkg }));
  git(dir, "checkout", "-q", "main");
  const bad = join(root, "bad.yaml");
  writeFileSync(bad, lock(f.bad));
  const stub = join(root, "pnpm-stub.sh");
  writeFileSync(
    stub,
    `if grep -q '^<<<<<<<' pnpm-lock.yaml; then cp '${bad}' pnpm-lock.yaml; fi\n`,
  );
  return { dir, pnpm: `sh ${stub}` };
}

describe("staging-bring-main: what pnpm chose", () => {
  it("the stub fixture's clean case: pnpm keeps the newer side, and the merge is made as before", () => {
    const f = regressFixture({
      base: { cookie: "2.0.0" },
      main: { cookie: "2.0.1" },
      staging: { cookie: "2.0.2" },
      bad: { cookie: "2.0.2" },
    });
    const r = bringMain(opts(f.dir, { pnpm: f.pnpm }));
    expect(r).toMatchObject({ status: "made", seededFrom: null, regressions: [] });
    expect(code(f.dir, "diff", "--quiet", "staging", "bring", "--", "pnpm-lock.yaml")).toBe(0);
  });

  it("pnpm's merge puts staging's version back, main changed no package.json: retried from staging's lockfile", () => {
    const f = regressFixture({
      base: { cookie: "2.0.0" },
      main: { cookie: "2.0.1" },
      staging: { cookie: "2.0.2" },
      bad: { cookie: "2.0.1" },
    });
    const r = bringMain(opts(f.dir, { pnpm: f.pnpm }));
    expect(r).toMatchObject({
      status: "made",
      seededFrom: "staging",
      regressions: [{ name: "cookie", side: "staging", had: "2.0.2", merged: "2.0.1" }],
    });
    // staging's lockfile byte for byte, final newline included
    expect(code(f.dir, "diff", "--quiet", "staging", "bring", "--", "pnpm-lock.yaml")).toBe(0);
    expect(code(f.dir, "merge-base", "--is-ancestor", "main", "bring")).toBe(0);
    expect(git(f.dir, "log", "-1", "--format=%B", "bring")).toMatch(
      /seeded from staging's pnpm-lock.yaml/,
    );
    onlyCheckout(f.dir);
  });

  it("both sides changed package.json: no side's lockfile can seed it, so it stops and names the package", () => {
    const f = regressFixture({
      base: { cookie: "2.0.0" },
      main: { cookie: "2.0.1" },
      staging: { cookie: "2.0.2" },
      bad: { cookie: "2.0.1" },
      mainPkg: true,
      stagingPkg: true,
    });
    const r = bringMain(opts(f.dir, { pnpm: f.pnpm }));
    expect(r).toMatchObject({
      status: "regressed",
      regressions: [{ name: "cookie", side: "staging", had: "2.0.2", merged: "2.0.1" }],
      seeds: [],
      skipped: [
        { side: "staging", reason: expect.stringMatching(/not staging's/) },
        { side: "main", reason: expect.stringMatching(/not main's/) },
      ],
    });
    expect(code(f.dir, "rev-parse", "--verify", "-q", "refs/heads/bring")).not.toBe(0);
    onlyCheckout(f.dir);
  });

  it("the seeded lockfile is checked too: main's newer version of another package stops it", () => {
    const f = regressFixture({
      base: { cookie: "2.0.0", foo: "1.0.0" },
      main: { cookie: "2.0.1", foo: "1.1.0" },
      staging: { cookie: "2.0.2", foo: "1.0.0" },
      bad: { cookie: "2.0.1", foo: "1.1.0" },
    });
    const r = bringMain(opts(f.dir, { pnpm: f.pnpm }));
    expect(r).toMatchObject({
      status: "regressed",
      regressions: [{ name: "cookie", side: "staging" }],
      // neither side changed package.json, so each side's lockfile is tried, and each puts the other's back
      seeds: [
        {
          side: "staging",
          regressions: [{ name: "foo", side: "main", had: "1.1.0", merged: "1.0.0" }],
        },
        {
          side: "main",
          regressions: [{ name: "cookie", side: "staging", had: "2.0.2", merged: "2.0.1" }],
        },
      ],
    });
    expect(code(f.dir, "rev-parse", "--verify", "-q", "refs/heads/bring")).not.toBe(0);
    onlyCheckout(f.dir);
  });

  it("only main's package.json is the merged one: retried from main's lockfile", () => {
    const f = regressFixture({
      base: { cookie: "2.0.0" },
      main: { cookie: "2.0.2" },
      staging: { cookie: "2.0.1" },
      bad: { cookie: "2.0.1" },
      mainPkg: true,
    });
    const r = bringMain(opts(f.dir, { pnpm: f.pnpm }));
    expect(r).toMatchObject({
      status: "made",
      seededFrom: "main",
      regressions: [{ name: "cookie", side: "main", had: "2.0.2", merged: "2.0.1" }],
    });
    expect(code(f.dir, "diff", "--quiet", "main", "bring", "--", "pnpm-lock.yaml")).toBe(0);
  });

  it("a pnpm-workspace.yaml one side changed keeps the other side's lockfile from seeding", () => {
    const f = regressFixture({
      base: { cookie: "2.0.0" },
      main: { cookie: "2.0.1" },
      staging: { cookie: "2.0.2" },
      bad: { cookie: "2.0.1" },
      mainFile: ["pnpm-workspace.yaml", "overrides:\n  cookie: ^2.0.1\n"],
    });
    const r = bringMain(opts(f.dir, { pnpm: f.pnpm }));
    // staging's lockfile was never written: only main's was tried, and it regressed cookie
    expect(r).toMatchObject({
      status: "regressed",
      seeds: [{ side: "main", regressions: [{ name: "cookie", side: "staging" }] }],
      skipped: [{ side: "staging", reason: expect.stringMatching(/pnpm-workspace.yaml/) }],
    });
  });

  it("the CLI says when it seeded, and from which side", () => {
    const f = regressFixture({
      base: { cookie: "2.0.0" },
      main: { cookie: "2.0.1" },
      staging: { cookie: "2.0.2" },
      bad: { cookie: "2.0.1" },
    });
    const r = spawnSync(
      process.execPath,
      [
        join(__dirname, "..", "..", "scripts", "staging-bring-main.mjs"),
        ...["--dir", f.dir, "--no-fetch", "--main", "main", "--staging", "staging"],
        ...["--branch", "bring", "--pnpm", f.pnpm],
      ],
      { env: ENV, encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      /seeded from staging's because pnpm's merge put back cookie 2\.0\.2 \(staging\) -> 2\.0\.1/,
    );
  });

  it("a seed that would drop the other side's change to an older copy is refused, not committed", () => {
    // main's lock-file maintenance moved foo's 1.x copy; staging's lockfile has the old one
    const f = regressFixture({
      base: { cookie: "2.0.0", foo: ["1.0.0", "2.0.0"] },
      main: { cookie: "2.0.1", foo: ["1.0.5", "2.0.0"] },
      staging: { cookie: "2.0.2", foo: ["1.0.0", "2.0.0"] },
      bad: { cookie: "2.0.1", foo: ["1.0.5", "2.0.0"] },
    });
    const r = bringMain(opts(f.dir, { pnpm: f.pnpm }));
    expect(r).toMatchObject({
      status: "regressed",
      seeds: [
        {
          side: "staging",
          regressions: [{ name: "foo", side: "main", had: "1.0.5", merged: "1.0.0" }],
        },
        { side: "main", regressions: [{ name: "cookie", side: "staging" }] },
      ],
    });
    expect(code(f.dir, "rev-parse", "--verify", "-q", "refs/heads/bring")).not.toBe(0);
  });

  it("the CLI exits 2 on a regression it could not repair, naming each package", () => {
    const f = regressFixture({
      base: { cookie: "2.0.0" },
      main: { cookie: "2.0.1" },
      staging: { cookie: "2.0.2" },
      bad: { cookie: "2.0.1" },
      mainPkg: true,
      stagingPkg: true,
    });
    const r = spawnSync(
      process.execPath,
      [
        join(__dirname, "..", "..", "scripts", "staging-bring-main.mjs"),
        ...[
          "--dir",
          f.dir,
          "--no-fetch",
          "--main",
          "main",
          "--staging",
          "staging",
          "--branch",
          "bring",
          "--pnpm",
          f.pnpm,
        ],
      ],
      { env: ENV, encoding: "utf8" },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/cookie 2\.0\.2 \(staging\) -> 2\.0\.1/);
  });
});
