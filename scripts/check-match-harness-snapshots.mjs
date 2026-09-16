import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_REL = "src/recipes/match-harness/template.ts";

const escape = (b) => b.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

export function parseTemplate(text) {
  const lines = text.split("\n");
  const rel = new Map(),
    owner = new Map(),
    body = new Map();
  for (const m of text.matchAll(/^export const ([A-Z0-9_]+)_RELATIVE = ("(?:[^"\\]|\\.)*");$/gm))
    rel.set(m[1], JSON.parse(m[2]));
  for (const m of text.matchAll(
    /\{ rel: ([A-Z0-9_]+)_RELATIVE, template: [A-Z0-9_]+_TEMPLATE, owner: "(recipe|site)" \}/g,
  ))
    owner.set(m[1], m[2]);
  for (let i = 0; i < lines.length; i++) {
    const m = /^export const ([A-Z0-9_]+)_TEMPLATE = `(.*)$/.exec(lines[i]);
    if (!m) continue;
    const buf = [m[2]];
    let j = i + 1,
      closed = false;
    for (; j < lines.length; j++) {
      if (lines[j] === "`;") {
        closed = true;
        break;
      }
      buf.push(lines[j]);
    }
    if (!closed) throw new Error(`unterminated ${m[1]}_TEMPLATE in ${TEMPLATE_REL}`);
    body.set(m[1], buf.join("\n") + "\n");
    i = j;
  }
  const files = new Map();
  for (const [name, r] of rel) {
    if (!body.has(name)) continue;
    files.set(r, { escaped: body.get(name), owner: owner.get(name) ?? "recipe" });
  }
  return files;
}

export function corpusBodies(prevRoot) {
  const out = new Map();
  if (!existsSync(prevRoot)) return out;
  for (const version of readdirSync(prevRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)) {
    const walk = (dir, prefix) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name),
          r = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) walk(p, r);
        else {
          if (!out.has(r)) out.set(r, []);
          out.get(r).push({ version, escaped: escape(readFileSync(p, "utf8")) });
        }
      }
    };
    walk(join(prevRoot, version), "");
  }
  return out;
}

/** Recipe-owned bodies that CHANGED since `previous` and whose prior render is
 *  in no committed snapshot. Those are the ones an installed site would be
 *  told it hand-edited. */
export function findUnsnapshotted(previous, current, corpus) {
  const offenders = [];
  for (const [rel, prev] of previous) {
    const cur = current.get(rel);
    if (!cur) continue; // removed from the manifest
    if (cur.escaped === prev.escaped) continue; // unchanged -> planFileWrite skips
    if (cur.owner !== "recipe") continue; // a site record is never consulted
    const have = (corpus.get(rel) ?? []).some((c) => c.escaped === prev.escaped);
    if (!have) offenders.push(rel);
  }
  return offenders;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1e9, cwd: join(HERE, "..") });
}

export function previousReleaseTag() {
  const tags = git(["tag", "--list", "v*", "--sort=-v:refname"]).trim().split("\n").filter(Boolean);
  return tags[0] ?? null;
}

/** `--template <path>` and `--previous <path>` replace the two inputs this
 *  guard compares. A release manager uses them to rehearse a snapshot against a
 *  body that is not committed yet; the spec uses them to exercise every arm
 *  without standing up a git repository with tags in it. Neither changes what
 *  is compared, only where the two sides are read from. */
function argvOverride(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

function main() {
  const root = join(HERE, "..");
  const templateOverride = argvOverride("--template");
  const previousOverride = argvOverride("--previous");
  const tag = previousOverride ? `--previous ${previousOverride}` : previousReleaseTag();
  // FAIL CLOSED. A shallow clone has no tags, and "no tags so nothing changed"
  // is precisely the silent pass this guard exists to prevent.
  if (!tag) {
    console.error("check-match-harness-snapshots: no v* tag is reachable, so the previous release");
    console.error("  cannot be read. This guard cannot run on a shallow clone — ci.yml's checkout");
    console.error("  needs `fetch-depth: 0`. Refusing to pass over a comparison never made.");
    process.exit(1);
  }
  const current = parseTemplate(readFileSync(templateOverride ?? join(root, TEMPLATE_REL), "utf8"));
  const previous = parseTemplate(
    previousOverride
      ? readFileSync(previousOverride, "utf8")
      : git(["show", `${tag}:${TEMPLATE_REL}`]),
  );
  // Vacuity guard: a parser that silently matched nothing would report a clean
  // bill of health over zero comparisons.
  if (current.size === 0 || previous.size === 0) {
    console.error(
      `check-match-harness-snapshots: parsed ${current.size} current and ${previous.size} previous bodies.`,
    );
    console.error("  One of them is empty, so nothing was actually compared. Refusing to pass.");
    process.exit(1);
  }
  const corpus = corpusBodies(argvOverride("--corpus") ?? join(HERE, "match-harness-previous"));
  const offenders = findUnsnapshotted(previous, current, corpus);
  if (offenders.length > 0) {
    console.error(
      `check-match-harness-snapshots: ${offenders.length} shipped body/bodies changed since ${tag}`,
    );
    console.error(`  with no committed snapshot of what ${tag} shipped:\n`);
    for (const rel of offenders) console.error(`    ${rel}`);
    console.error(
      `\n  Every site running ${tag} byte-compares its copy against MATCH_HARNESS_PREVIOUS.`,
    );
    console.error(
      "  With no entry the comparison fails, the site is accused of a hand edit it never",
    );
    console.error("  made, and the file is left broken — permanently, since the recipe never");
    console.error("  overwrites a flagged file.\n");
    console.error(`  Fix: git show ${tag}:${TEMPLATE_REL} -> extract each body above into`);
    console.error(`    scripts/match-harness-previous/${tag.slice(1)}/<rel>`);
    console.error("  then regenerate. Source the body from the TAG, never the working tree.");
    process.exit(1);
  }
  console.log(
    `check-match-harness-snapshots: OK — ${current.size} bodies compared against ${tag};`,
  );
  console.log(`  every recipe-owned body that changed carries a committed snapshot.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
