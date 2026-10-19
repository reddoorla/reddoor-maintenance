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
const git = (...args) =>
  execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 });

export const DIFF_ARGS = Object.freeze([
  "-c",
  "core.quotePath=true",
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const key = JSON.parse(readFileSync(join(HERE, "key.json"), "utf8"));
  const out = join(HERE, "cases");
  // Build beside cases/ and swap it in only once every case is written.
  const next = join(HERE, "cases.next");
  rmSync(next, { recursive: true, force: true });
  mkdirSync(next);
  for (const c of key.cases) {
    const files = caseFiles(c);
    const diff = cleanDiff(git(...DIFF_ARGS, `${c.commit}^`, c.commit, "--", c.path));
    if (!diff.trim()) throw new Error(`${c.case}: ${c.commit} does not change ${c.path}`);
    writeFileSync(join(next, files.diff), diff);
    writeFileSync(join(next, files.after), git("show", "--no-textconv", `${c.commit}:${c.path}`));
    console.log(`${c.case} ${c.kind} ${c.commit} ${c.path}`);
  }
  rmSync(out, { recursive: true, force: true });
  renameSync(next, out);
}
