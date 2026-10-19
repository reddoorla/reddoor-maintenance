#!/usr/bin/env node
// Rebuilds cases/ from key.json: for each case, the commit's diff of its one file
// (`<case>.diff`) and that file as the commit left it (`<case>.after.<name>`).
// `index` lines are dropped so a diff carries no blob ids to look up in history.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
const git = (...args) =>
  execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 });

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
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  for (const c of key.cases) {
    const files = caseFiles(c);
    const diff = cleanDiff(git("diff", "-U5", `${c.commit}^`, c.commit, "--", c.path));
    if (!diff.trim()) throw new Error(`${c.case}: ${c.commit} does not change ${c.path}`);
    writeFileSync(join(out, files.diff), diff);
    writeFileSync(join(out, files.after), git("show", `${c.commit}:${c.path}`));
    console.log(`${c.case} ${c.kind} ${c.commit} ${c.path}`);
  }
}
