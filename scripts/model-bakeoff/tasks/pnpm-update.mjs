#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import yaml from "js-yaml";

export const id = "pnpm-update";
export const title = "T5 dependency bump: pnpm update on a frozen site repo";
export const row = 6;

// The input is two tarballs built by `snapshot` (below): the site repo at one commit, and the
// pnpm metadata cache an online `pnpm update` filled at one minute. Every arm and the truth
// update offline from that cache, so registry drift between runs cannot change the answer.
export const sources = [
  { from: ".", match: /^(repo\.tar|registry\.tar|snapshot\.json)$/, to: "." },
];

export const UPDATE = ["update", "--offline"];
export const INSTALL = ["install", "--frozen-lockfile", "--offline"];
export const CHECKS = ["lint", "check", "build", "test:unit"];
export const LOCKFILE = "pnpm-lock.yaml";

// Every collection is mechanical: the values are read from an arm's report, its disk and its
// transcript, and the truth is computed, so a referee shown the task prompt could not settle them.
export const collections = [
  {
    name: "packages",
    key: "name",
    keyKind: "string",
    fields: { specifier: "string", version: "string" },
    mechanical: true,
  },
  {
    name: "disk",
    key: "name",
    keyKind: "string",
    fields: { deps: "set:string", packages: "set:string" },
    mechanical: true,
  },
  {
    name: "checks",
    key: "name",
    keyKind: "string",
    fields: { reportsOwnRun: "boolean", noFalsePass: "boolean" },
    mechanical: true,
  },
];

const strings = { type: "array", items: { type: "string" } };

export const schema = {
  type: "object",
  properties: {
    packages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          specifier: { type: "string" },
          version: { type: "string" },
        },
        required: ["name", "specifier", "version"],
      },
    },
    checks: {
      type: "object",
      properties: { pass: { type: "boolean" }, failed: strings },
      required: ["pass", "failed"],
    },
    unverified: strings,
  },
  required: ["packages", "checks", "unverified"],
};

export function prompt(dir) {
  const env = "XDG_CACHE_HOME=<work>/cache";
  return [
    `Dependency bump on a frozen copy of a SvelteKit site repository. ${dir}/repo.tar holds the repository; ${dir}/registry.tar holds a snapshot of pnpm's registry metadata cache.`,
    "<work> below means your own scratch directory, named at the end of this task. Do every step there.",
    "",
    "1. Unpack: `mkdir -p <work>/repo <work>/cache`, then `tar -xf " +
      `${dir}/repo.tar -C <work>/repo\` and \`tar -xf ${dir}/registry.tar -C <work>/cache\`.`,
    `2. In <work>/repo, run exactly \`${env} pnpm ${UPDATE.join(" ")}\`. Use no other flags and name no packages: the offline flag makes pnpm resolve from the snapshot, so every run sees the same registry.`,
    `3. In <work>/repo, run \`${env} pnpm ${INSTALL.join(" ")}\`, then \`mkdir -p <work>/logs\`.`,
    `4. In <work>/repo, for each script S of ${CHECKS.join(", ")}, in that order, run \`pnpm run S > <work>/logs/S.log 2>&1; echo $? > <work>/logs/S.exit\` (so the files for test:unit are test:unit.log and test:unit.exit). Run every one whatever the earlier ones did, and give each a timeout of at least 10 minutes.`,
    "5. Do not edit any file in the repository yourself.",
    "",
    "Report:",
    `- packages: one entry for every direct dependency (the dependencies and devDependencies of the importer "." in <work>/repo/${LOCKFILE} after step 2), with name, specifier (as the lockfile now records it) and version (the resolved version, without any parenthesised peer suffix).`,
    `- checks: pass is true only if every one of the ${CHECKS.length} scripts exited 0; failed lists the names of the scripts that exited non-zero, or [].`,
    "- unverified: anything you could not establish (empty if none).",
    "",
    "pnpm writes to its shared package store and to <work>/cache; both are allowed. Your lockfile and <work>/logs are read after you finish, so leave them there.",
  ].join("\n");
}

export const goldAddendum =
  "\n\nYou are building the GOLD STANDARD the other runs are compared against. Establish every reported field with a script that reads the lockfile and the commands' exit codes, not by eye, and put anything you could not verify that way in unverified.";

const stripPeers = (v) => String(v).replace(/\(.*$/, "");
const depKey = (p) => `${p?.name} ${p?.specifier} ${stripPeers(p?.version)}`;

// The direct dependencies and the full package list of a pnpm v9 lockfile. pnpm 12 writes two
// YAML documents, the package manager's own environment first and the project last.
export function lockfileFacts(text) {
  const doc = (text && yaml.loadAll(text).filter(Boolean).at(-1)) || {};
  const root = doc.importers?.["."] || {};
  const packages = [];
  for (const group of ["dependencies", "devDependencies"]) {
    for (const [name, dep] of Object.entries(root[group] || {})) {
      packages.push({ name, specifier: String(dep.specifier), version: stripPeers(dep.version) });
    }
  }
  packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    packages,
    disk: [
      {
        name: LOCKFILE,
        deps: packages.map(depKey),
        packages: Object.keys(doc.packages || {}).sort(),
      },
    ],
  };
}

// Runs every check, whatever the earlier ones did. `run` returns the exit status.
export function runChecks(run) {
  const failed = CHECKS.filter((c) => run(["run", c]) !== 0);
  return { pass: failed.length === 0, failed };
}

const scriptName = (x) =>
  String(x)
    .trim()
    .toLowerCase()
    .replace(/^pnpm\s+(?:run\s+)?/, "");

// The truth's item per check script. Two fields are scored. reportsOwnRun: for an arm, whether
// its claimed verdict matches its own run's exit code. noFalsePass: whether it did not claim a
// pass for a script the truth says fails. The second is one-sided on purpose: load on a shared
// machine can make a passing script fail (a timeout), never make a failing one pass, so a false
// pass is the model's error and a false failure may be the machine's. exitFailed is the run's own
// verdict, kept on the item for the record but not scored.
export function checkItems(failed) {
  const claimed = new Set(failed.map(scriptName));
  return CHECKS.map((name) => ({
    name,
    reportsOwnRun: true,
    noFalsePass: true,
    exitFailed: claimed.has(name),
  }));
}

// What each script's own run left in <work>/logs: its exit code, or null when the log is there
// but the exit file is not (a run killed before `echo $?`). A log counts only when pnpm wrote it
// (it holds pnpm's `$ <script body>` echo line) after the lockfile it ran against. An exit
// code of 0 beside a log in which pnpm reports the command failed (`| tee` records tee's code)
// is read as "log:failed".
const FAILED_LINE = /Command failed with exit code [1-9]/;
// pnpm may print warnings or its dependency check before the `$ <script body>` line.
const PNPM_ECHO = /^\$ /m;

export function exitCodes(work) {
  const out = {};
  const lockfile = join(work, "repo", LOCKFILE);
  if (!existsSync(lockfile)) return out;
  const since = statSync(lockfile).mtimeMs;
  for (const name of CHECKS) {
    const exit = join(work, "logs", `${name}.exit`);
    const log = join(work, "logs", `${name}.log`);
    if (!existsSync(log) || !statSync(log).isFile() || statSync(log).mtimeMs < since) continue;
    const text = readFileSync(log, "utf8");
    if (!PNPM_ECHO.test(text)) continue;
    // An exit file older than its log is a previous run's: this run was killed before `echo $?`.
    const fresh =
      existsSync(exit) &&
      statSync(exit).isFile() &&
      statSync(exit).mtimeMs >= statSync(log).mtimeMs;
    const code = fresh ? readFileSync(exit, "utf8").trim() : null;
    out[name] = code === "0" && FAILED_LINE.test(text) ? "log:failed" : code;
  }
  return out;
}

// Returns the exit status, logging to logDir/<label>.log when given. A run killed by the timeout
// or a signal throws: it is not a verdict on the code.
function pnpm(cwd, env, logDir) {
  return (args) => {
    const log = logDir
      ? openSync(join(logDir, `${args.join("_").replace(/\W+/g, "_")}.log`), "w")
      : "ignore";
    const r = spawnSync("pnpm", args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", log, log],
      timeout: 15 * 60 * 1000,
    });
    if (typeof log === "number") closeSync(log);
    if (r.status === null) {
      throw new Error(
        `pnpm ${args.join(" ")} in ${cwd} was killed (${r.signal ?? r.error?.message})`,
      );
    }
    return r.status;
  };
}

function unpack(dir, into) {
  const repo = join(into, "repo");
  const cache = join(into, "cache");
  mkdirSync(repo, { recursive: true });
  mkdirSync(cache, { recursive: true });
  execFileSync("tar", ["-xf", join(dir, "repo.tar"), "-C", repo]);
  execFileSync("tar", ["-xf", join(dir, "registry.tar"), "-C", cache]);
  return { repo, cache };
}

// The reference: the same steps the arms are told to take, run by script on the frozen input,
// with the same environment (the cache only on update and install). Logs stay in <into>/logs.
export function truth(dir, { into = mkdtempSync(join(tmpdir(), "pnpm-update-truth-")) } = {}) {
  const { repo, cache } = unpack(dir, into);
  const logs = join(into, "logs");
  mkdirSync(logs, { recursive: true });
  const withCache = pnpm(repo, { XDG_CACHE_HOME: cache }, logs);
  if (withCache(UPDATE) !== 0) throw new Error(`truth: pnpm ${UPDATE.join(" ")} failed in ${repo}`);
  if (withCache(INSTALL) !== 0)
    throw new Error(`truth: pnpm ${INSTALL.join(" ")} failed in ${repo}`);
  const { failed } = runChecks(pnpm(repo, {}, logs));
  console.log(`truth: logs in ${logs}`);
  return {
    ...lockfileFacts(readFileSync(join(repo, LOCKFILE), "utf8")),
    checks: checkItems(failed),
  };
}

// What is scored for one agent:
// - packages: the direct dependencies it reported, one check per field;
// - disk: what its own <work>/repo/pnpm-lock.yaml holds, as two sets (direct dependencies and
//   every package), so a wrong update fails there whatever the report says;
// - checks: for each script whose run left a pnpm log in <work>/logs, whether the verdict it
//   claimed is the one its own exit code gives (no exit file counts as failed). A script with no
//   such log is a missing item.
//   It also scores noFalsePass against the reference: claiming a pass for a script the reference
//   says fails is charged whatever the arm's own run said.
// No output scores as no output; a missing or unparseable lockfile as an absent disk item.
export function observe(work, structured, agent, reference) {
  if (!structured) return null;
  let disk = [];
  try {
    const file = join(work, "repo", LOCKFILE);
    if (existsSync(file)) disk = lockfileFacts(readFileSync(file, "utf8")).disk;
  } catch {
    disk = [];
  }
  const failed = Array.isArray(structured.checks?.failed) ? structured.checks.failed : [];
  const claimed = new Set(failed.map(scriptName));
  const exits = exitCodes(work);
  const truthFailed = new Set(
    (Array.isArray(reference?.checks) ? reference.checks : [])
      .filter((c) => c?.exitFailed)
      .map((c) => c.name),
  );
  return {
    packages: Array.isArray(structured.packages)
      ? structured.packages.map((p) =>
          p && p.version !== undefined ? { ...p, version: stripPeers(p.version) } : p,
        )
      : [],
    disk,
    checks: CHECKS.filter((name) => name in exits).map((name) => {
      const exitFailed = exits[name] !== "0";
      return {
        name,
        reportsOwnRun: claimed.has(name) === exitFailed,
        noFalsePass: !truthFailed.has(name) || claimed.has(name),
        exitFailed,
      };
    }),
  };
}

// Builds the tarballs `prepare --root <out>` freezes, into a fresh directory. The registry
// snapshot is the pnpm metadata cache after one online `pnpm update --lockfile-only`; the install
// that follows puts every tarball the update resolves into this machine's shared store, so the
// offline runs can install. The offline runs need that store, and pnpm itself, still in place.
export function snapshot({ repo: repoArg, commit, out: outArg }) {
  // git -C resolves a relative -o against the repo, so both paths are made absolute first.
  const repo = resolve(repoArg);
  const out = resolve(outArg);
  if (existsSync(out)) throw new Error(`${out} exists; pick a fresh --out`);
  const sha = execFileSync("git", ["-C", repo, "rev-parse", "--verify", `${commit}^{commit}`], {
    encoding: "utf8",
  }).trim();
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out);
  const work = mkdtempSync(join(tmpdir(), "pnpm-update-snapshot-"));
  try {
    const tree = join(work, "repo");
    const cache = join(work, "cache");
    mkdirSync(tree);
    mkdirSync(cache);
    execFileSync("git", ["-C", repo, "archive", "-o", join(out, "repo.tar"), sha]);
    execFileSync("tar", ["-xf", join(out, "repo.tar"), "-C", tree]);
    const takenAt = new Date().toISOString();
    const run = pnpm(tree, { XDG_CACHE_HOME: cache });
    if (run(["update", "--lockfile-only"]) !== 0) throw new Error("snapshot: online update failed");
    if (run(["install", "--frozen-lockfile"]) !== 0) throw new Error("snapshot: install failed");
    execFileSync("tar", ["-cf", join(out, "registry.tar"), "-C", cache, "."]);
    const ask = (args) => execFileSync("pnpm", args, { cwd: tree, encoding: "utf8" }).trim();
    const pnpmVersion = ask(["--version"]);
    const store = ask(["store", "path"]);
    writeFileSync(
      join(out, "snapshot.json"),
      JSON.stringify({ repo, commit: sha, takenAt, pnpmVersion, store }, null, 1) + "\n",
    );
    return { takenAt, commit: sha };
  } catch (e) {
    rmSync(out, { recursive: true, force: true });
    throw e;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const arms = [
  { id: "haiku-low-1", model: "haiku", effort: "low" },
  { id: "haiku-low-2", model: "haiku", effort: "low" },
  { id: "haiku-medium-1", model: "haiku", effort: "medium" },
  { id: "haiku-medium-2", model: "haiku", effort: "medium" },
  { id: "sonnet-medium-1", model: "sonnet", effort: "medium" },
  { id: "sonnet-medium-2", model: "sonnet", effort: "medium" },
  { id: "opus-low-1", model: "opus", effort: "low" },
];

export const gold = { id: "gold", model: "opus", effort: "high" };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { repo: { type: "string" }, commit: { type: "string" }, out: { type: "string" } },
  });
  if (positionals[0] !== "snapshot" || !values.repo || !values.commit || !values.out) {
    console.error("usage: pnpm-update.mjs snapshot --repo <checkout> --commit <sha> --out <dir>");
    process.exit(2);
  }
  try {
    const { takenAt, commit } = snapshot(values);
    console.log(`snapshot of ${commit} taken at ${takenAt} in ${resolve(values.out)}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
