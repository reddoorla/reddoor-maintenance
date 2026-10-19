#!/usr/bin/env node
// Rebuilds cases/ from key.json: for each case, the commit's diff of its one file
// (`<case>.diff`) and that file as the commit left it (`<case>.after.<name>`).
// `index` lines are dropped so a diff carries no blob ids to look up in history.
// Needs full history (a --depth 50 clone lacks the older commits), and pins every
// diff option so the user's git config cannot change the bytes.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
// No user, system or environment config reaches git: only the repository's own, and
// the -c pins below override every diff knob that changes output bytes.
const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k !== "GIT_DIFF_OPTS" && !k.startsWith("GIT_CONFIG")),
);
Object.assign(GIT_ENV, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
const git = (...args) =>
  execFileSync("git", args, { cwd: REPO, env: GIT_ENV, encoding: "utf8", maxBuffer: 64 << 20 });

export const DIFF_ARGS = Object.freeze([
  ...[
    "core.quotePath=true",
    "diff.suppressBlankEmpty=false",
    "diff.interHunkContext=0",
    "diff.indentHeuristic=true",
    "diff.relative=false",
    "diff.mnemonicPrefix=false",
  ].flatMap((kv) => ["-c", kv]),
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--diff-algorithm=myers",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "-U5",
]);

export function caseFiles(c) {
  return { diff: `${c.case}.diff`, after: `${c.case}.after.${basename(c.path)}` };
}

export function cleanDiff(text) {
  return text
    .split("\n")
    .filter((l) => !/^index [0-9a-f]+\.\.[0-9a-f]+/.test(l))
    .join("\n");
}

/** Writes every case's two files into `dir`, which must exist and be empty. */
export function buildCases(dir, key = JSON.parse(readFileSync(join(HERE, "key.json"), "utf8"))) {
  for (const c of key.cases) {
    const files = caseFiles(c);
    const diff = cleanDiff(git(...DIFF_ARGS, `${c.commit}^`, c.commit, "--", c.path));
    if (!diff.trim()) throw new Error(`${c.case}: ${c.commit} does not change ${c.path}`);
    writeFileSync(join(dir, files.diff), diff);
    writeFileSync(join(dir, files.after), git("show", "--no-textconv", `${c.commit}:${c.path}`));
  }
  return key.cases;
}

/** True when every case's commit and its parent are in this clone's history. */
export function haveHistory(key = JSON.parse(readFileSync(join(HERE, "key.json"), "utf8"))) {
  try {
    for (const c of key.cases)
      for (const rev of [c.commit, `${c.commit}^`]) git("cat-file", "-e", `${rev}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = join(HERE, "cases");
  // Build beside cases/ and swap it in only once every case is written.
  const next = join(HERE, "cases.next");
  rmSync(next, { recursive: true, force: true });
  mkdirSync(next);
  for (const c of buildCases(next)) console.log(`${c.case} ${c.kind} ${c.commit} ${c.path}`);
  rmSync(out, { recursive: true, force: true });
  renameSync(next, out);
}
