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
  writeFileSync,
} from "node:fs";
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
    fields: { failed: "boolean" },
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

// One item per check script: whether it failed.
export function checkItems(failed) {
  return CHECKS.map((name) => ({ name, failed: failed.includes(name) }));
}

// Whether a Bash command ran `pnpm run <script>` (or `pnpm <script>`) for this script, written
// out or as `for v in <words>; do ... pnpm run $v ...; done`, the form most arms use.
export function ranScript(commands, script) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const runs = (word) => new RegExp(`\\bpnpm\\s+(?:run\\s+)?${word}(?=$|[\\s;&|)'"])`, "m");
  const literal = runs(esc(script));
  const loop = /\bfor\s+([A-Za-z_]\w*)\s+in\s+([^;\n]*?)\s*(?:;|\n)\s*do\b([\s\S]*?)\bdone\b/g;
  return commands.some((raw) => {
    const c = String(raw);
    if (literal.test(c)) return true;
    for (const [, v, list, body] of c.matchAll(loop)) {
      const words = list.split(/\s+/).map((w) => w.replace(/^["']|["']$/g, ""));
      if (words.includes(script) && runs(`"?\\$\\{?${v}\\}?"?`).test(body)) return true;
    }
    return false;
  });
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
// - checks: its verdict on each check script, listed only when its transcript shows it ran that
//   script, so a verdict it never ran is a missing item, not a lucky guess.
// No output scores as no output; a missing or unparseable lockfile as an absent disk item.
export function observe(work, structured, agent) {
  if (!structured) return null;
  let disk = [];
  try {
    const file = join(work, "repo", LOCKFILE);
    if (existsSync(file)) disk = lockfileFacts(readFileSync(file, "utf8")).disk;
  } catch {
    disk = [];
  }
  const failed = Array.isArray(structured.checks?.failed) ? structured.checks.failed : [];
  const commands = agent?.bash || [];
  return {
    packages: Array.isArray(structured.packages)
      ? structured.packages.map((p) => ({ ...p, version: stripPeers(p?.version) }))
      : [],
    disk,
    checks: checkItems(failed).filter((c) => ranScript(commands, c.name)),
  };
}

// Builds the tarballs `prepare --root <out>` freezes, into a fresh directory. The registry
// snapshot is the pnpm metadata cache after one online `pnpm update --lockfile-only`; the install
// that follows puts every tarball the update resolves into this machine's shared store, so the
// offline runs can install. The offline runs need that store, and pnpm itself, still in place.
export function snapshot({ repo, commit, out }) {
  if (existsSync(out)) throw new Error(`${out} exists; pick a fresh --out`);
  mkdirSync(out, { recursive: true });
  const sha = execFileSync("git", ["-C", repo, "rev-parse", "--verify", `${commit}^{commit}`], {
    encoding: "utf8",
  }).trim();
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
    writeFileSync(
      join(out, "snapshot.json"),
      JSON.stringify({ repo: resolve(repo), commit: sha, takenAt }, null, 1) + "\n",
    );
    return { takenAt, commit: sha };
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
  const { takenAt, commit } = snapshot(values);
  console.log(`snapshot of ${commit} taken at ${takenAt} in ${resolve(values.out)}`);
}
