#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import yaml from "js-yaml";

export const id = "pnpm-update";
export const title = "T5 dependency bump: pnpm update on a frozen site repo";
export const row = 6;

// The input is two tarballs built by `snapshot` (below): the site repo at one commit, and the
// pnpm metadata cache an online `pnpm update` filled at one minute. Every arm and the truth
// update offline from that cache, so registry drift between runs cannot change the answer.
export const sources = [{ from: ".", match: /^(repo|registry)\.tar$/, to: "." }];

export const UPDATE = ["update", "--offline"];
export const INSTALL = ["install", "--frozen-lockfile", "--offline"];
export const CHECKS = ["lint", "check", "build", "test:unit"];
export const LOCKFILE = "pnpm-lock.yaml";

export const collections = [
  {
    name: "packages",
    key: "name",
    keyKind: "string",
    fields: { specifier: "string", version: "string" },
  },
  { name: "lockfile", key: "name", keyKind: "string", fields: { packages: "set:string" } },
  {
    name: "checks",
    key: "name",
    keyKind: "string",
    fields: { pass: "boolean", failed: "set:string" },
  },
  { name: "report", key: "name", keyKind: "string", fields: { matchesDisk: "boolean" } },
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
    `3. In <work>/repo, run \`${env} pnpm ${INSTALL.join(" ")}\`, then each of ${CHECKS.map((c) => `\`pnpm run ${c}\``).join(", ")} in that order, running every one even if an earlier one fails. Give each command a timeout of at least 10 minutes.`,
    "4. Do not edit any file in the repository yourself, and do not try to fix a failure: report it.",
    "",
    "Report:",
    `- packages: one entry for every direct dependency (the dependencies and devDependencies of the importer "." in <work>/repo/${LOCKFILE} after step 2), with name, specifier (as the lockfile now records it) and version (the resolved version, without any parenthesised peer suffix).`,
    `- checks: pass is true only if every one of the ${CHECKS.length} \`pnpm run\` commands exited 0; failed lists the script names (e.g. "lint") that exited non-zero, or [].`,
    "- unverified: anything you could not establish (empty if none).",
    "",
    "pnpm writes to its shared package store and to <work>/cache; both are allowed. Your lockfile is read from <work>/repo after you finish, so leave it there.",
  ].join("\n");
}

export const goldAddendum =
  "\n\nYou are building the GOLD STANDARD the other runs are compared against. Establish every reported field with a script that reads the lockfile and the commands' exit codes, not by eye, and put anything you could not verify that way in unverified.";

const stripPeers = (v) => String(v).replace(/\(.*$/, "");

// The direct dependencies and the full package list of a pnpm v9 lockfile. pnpm 12 writes two
// YAML documents, the package manager's own environment first and the project last.
export function lockfileFacts(text) {
  const doc = (text && yaml.loadAll(text).at(-1)) || {};
  const root = doc.importers?.["."] || {};
  const packages = [];
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, dep] of Object.entries(root[group] || {})) {
      packages.push({ name, specifier: String(dep.specifier), version: stripPeers(dep.version) });
    }
  }
  packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    packages,
    lockfile: [{ name: LOCKFILE, packages: Object.keys(doc.packages || {}).sort() }],
  };
}

// Runs every check, whatever the earlier ones did. `run` returns the exit status.
export function runChecks(run) {
  const failed = CHECKS.filter((c) => run(["run", c]) !== 0);
  return { pass: failed.length === 0, failed };
}

function pnpm(cwd, cache) {
  return (args) => {
    const r = spawnSync("pnpm", args, {
      cwd,
      env: { ...process.env, XDG_CACHE_HOME: cache },
      stdio: "ignore",
      timeout: 15 * 60 * 1000,
    });
    return r.status ?? 1;
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

// The reference: the same steps the arms are told to take, run by script on the frozen input.
export function truth(dir, { into = mkdtempSync(join(tmpdir(), "pnpm-update-truth-")) } = {}) {
  const { repo, cache } = unpack(dir, into);
  const run = pnpm(repo, cache);
  if (run(UPDATE) !== 0) throw new Error(`truth: pnpm ${UPDATE.join(" ")} failed in ${repo}`);
  if (run(INSTALL) !== 0) throw new Error(`truth: pnpm ${INSTALL.join(" ")} failed in ${repo}`);
  const checks = runChecks(run);
  const facts = lockfileFacts(readFileSync(join(repo, LOCKFILE), "utf8"));
  return {
    ...facts,
    checks: [{ name: "repo-checks", ...checks }],
    report: [{ name: "report", matchesDisk: true }],
  };
}

const depKey = (p) => `${p?.name}\u0000${p?.specifier}\u0000${stripPeers(p?.version)}`;

// What an arm actually left on disk, plus what it claimed. Its packages and lockfile are read
// from <work>/repo, not from its report; its check verdict can only come from its report, and
// `report` scores whether the packages it reported are the ones on disk.
export function observe(work, structured) {
  const file = join(work, "repo", LOCKFILE);
  const facts = existsSync(file)
    ? lockfileFacts(readFileSync(file, "utf8"))
    : { packages: [], lockfile: [] };
  const out = { ...facts, checks: [], report: [] };
  if (!structured) return out;
  if (structured.checks && typeof structured.checks === "object") {
    out.checks.push({
      name: "repo-checks",
      pass: structured.checks.pass,
      failed: structured.checks.failed,
    });
  }
  const reported = (Array.isArray(structured.packages) ? structured.packages : [])
    .map(depKey)
    .sort();
  const onDisk = facts.packages.map(depKey).sort();
  out.report.push({
    name: "report",
    matchesDisk: JSON.stringify(reported) === JSON.stringify(onDisk),
  });
  return out;
}

// Builds the two tarballs `prepare --root <out>` freezes. The registry snapshot is the pnpm
// metadata cache after one online `pnpm update --lockfile-only`; the install that follows puts
// every tarball the update resolves into the shared store, so the offline runs can install.
export function snapshot({ repo, commit, out }) {
  mkdirSync(out, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "pnpm-update-snapshot-"));
  const tree = join(work, "repo");
  const cache = join(work, "cache");
  mkdirSync(tree);
  mkdirSync(cache);
  execFileSync("git", ["-C", repo, "archive", "-o", join(out, "repo.tar"), commit]);
  execFileSync("tar", ["-xf", join(out, "repo.tar"), "-C", tree]);
  const takenAt = new Date().toISOString();
  const run = pnpm(tree, cache);
  if (run(["update", "--lockfile-only"]) !== 0) throw new Error("snapshot: online update failed");
  if (run(["install", "--frozen-lockfile"]) !== 0) throw new Error("snapshot: install failed");
  execFileSync("tar", ["-cf", join(out, "registry.tar"), "-C", cache, "."]);
  writeFileSync(
    join(out, "snapshot.json"),
    JSON.stringify({ repo: resolve(repo), commit, takenAt }, null, 1) + "\n",
  );
  return { takenAt };
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
  const { takenAt } = snapshot(values);
  console.log(`snapshot of ${values.commit} taken at ${takenAt} in ${resolve(values.out)}`);
}
