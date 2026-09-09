import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { ignoreRulesFor, pathsMissingFromHead } from "../../util/git.js";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { formatWithPrettier, PRETTIER_FLAG_NOTE } from "../_prettier.js";
import {
  MATCH_HARNESS_FILES,
  MATCH_HARNESS_PREVIOUS,
  HARNESS_JSON_RELATIVE,
  GITIGNORE_MARKER,
  GITIGNORE_BLOCK,
  PRETTIERIGNORE_MARKER,
  PRETTIERIGNORE_BLOCK,
  CLAUDE_MD_MARKER,
  CLAUDE_MD_BLOCK,
} from "./template.js";

export type MatchHarnessOptions = {
  /** The live reference URL the harness gates against. Required — a harness
   *  with no reference cannot produce evidence, only an absence of errors. */
  ref: string;
  /** Candidate origin. Defaults to the SvelteKit dev server. */
  cand?: string;
  /** Breakpoint matrix. Defaults to the fleet's 1440 / 834 / 390. */
  matrix?: number[];
};

export type MatchHarnessDeps = {
  spawn: SpawnFn;
  /** Previously shipped renders per relative path; injectable so the
   *  safe-replace path is testable before a second version exists. */
  previous?: Readonly<Record<string, readonly string[]>>;
};

type Plan = { ref: string; cand: string; matrix: number[] };

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** CRLF and trailing whitespace are the only differences a site's formatter is
 *  allowed to introduce before a file stops counting as "ours". */
function normalize(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * Append `block` under `marker` unless the marker is already present. The only
 * append-to-existing-file idiom in this repo is mergeGitignore, and it cannot
 * express a negated whitelist (`matching/*` then `!matching/*.sh`) as one unit:
 * it compares entries by normalized presence, so the ordering that makes the
 * block work would be lost. This keeps the block whole and idempotent.
 */
export function mergeBlock(existing: string | null, marker: string, block: string): string | null {
  if (existing === null) return `${marker}\n${block}`;
  if (existing.includes(marker)) return null;
  const base = existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${base}\n${marker}\n${block}`;
}

/** What to do with one installed file. `flag` never writes. */
export function planFileWrite(
  existing: string | null,
  template: string,
  owner: "recipe" | "site",
  previous: readonly string[],
): "write" | "replace" | "skip" | "flag" {
  if (existing === null) return "write";
  if (normalize(existing) === normalize(template)) return "skip";
  if (owner === "site") return "skip"; // records are never touched again
  if (previous.some((p) => normalize(existing) === normalize(p))) return "replace";
  return "flag";
}

/** The three files the recipe APPENDS a marked block to rather than writing whole. */
const APPENDED_BLOCKS = [
  [".gitignore", GITIGNORE_MARKER, GITIGNORE_BLOCK],
  [".prettierignore", PRETTIERIGNORE_MARKER, PRETTIERIGNORE_BLOCK],
  ["CLAUDE.md", CLAUDE_MD_MARKER, CLAUDE_MD_BLOCK],
] as const;

/**
 * Every path the installed harness requires to be IN THE COMMIT — deliberately
 * the whole manifest, NOT the paths written on this run. A re-run skips every
 * file already byte-correct on disk, so a check over the written delta would
 * find nothing missing and report a second hollow "applied" over the same
 * half-install.
 */
export const MATCH_HARNESS_INSTALLED_PATHS: readonly string[] = [
  ...MATCH_HARNESS_FILES.map((f) => f.rel),
  ...APPENDED_BLOCKS.map(([rel]) => rel),
];

/**
 * Installs the matching harness into a site: the dev-guarded `/dev/match/[uid]`
 * route, a `site-pages.js` scaffold and its fixture-vs-model test,
 * `matching/harness.json` + the read layer, the round scripts, the site records,
 * and the `.gitignore` / `.prettierignore` / `CLAUDE.md` blocks.
 *
 * Install-if-absent throughout. Files a site edits are never rewritten. A
 * recipe-owned script that matches a previously shipped render is safe-replaced;
 * one that has been hand-edited is FLAGGED in the notes and left alone.
 */
export async function matchHarness(
  site: Site,
  opts: MatchHarnessOptions,
  deps: MatchHarnessDeps = { spawn: defaultSpawn },
): Promise<RecipeResult> {
  return withRecipe<Plan>({
    name: "match-harness",
    site,
    plan: async () => {
      if (!opts.ref || !/^https?:\/\//.test(opts.ref)) {
        return {
          kind: "failed",
          notes:
            "--ref <url> is required: the harness gates against a live reference, and a harness with no reference can only ever report an absence of errors",
        };
      }
      return {
        kind: "apply",
        plan: {
          ref: opts.ref.replace(/\/$/, ""),
          cand: opts.cand ?? "http://localhost:5173",
          matrix: opts.matrix ?? [1440, 834, 390],
        },
      };
    },
    apply: async (planned, { commit, cwd }) => {
      const notes: string[] = [];
      const written: string[] = [];
      /** For every path this run writes: what was there BEFORE (null = the file
       *  did not exist). The refusal below restores from this, so a refused run
       *  leaves the checkout byte-identical to how it found it. */
      const before = new Map<string, string | null>();
      const previousAll = deps.previous ?? MATCH_HARNESS_PREVIOUS;

      for (const f of MATCH_HARNESS_FILES) {
        const target = join(cwd, f.rel);
        let template = f.template;
        if (f.rel === HARNESS_JSON_RELATIVE) {
          // Patch the PARSED object, never the text. The seed is pretty-printed
          // two-space JSON, so `matrix` renders as a four-line exploded array
          // and the literal "[1440, 834, 390]" does not occur — a string
          // replace on it is a no-op that drops --matrix with no error.
          const seed = JSON.parse(template) as Record<string, unknown>;
          seed.ref = planned.ref;
          seed.cand = planned.cand;
          seed.matrix = planned.matrix;
          template = JSON.stringify(seed, null, 2) + "\n";
        }
        const existing = await readIfExists(target);
        const action = planFileWrite(existing, template, f.owner, previousAll[f.rel] ?? []);
        if (action === "flag") {
          notes.push(
            `${f.rel} differs from the shipped template and was left alone (hand-edited?)`,
          );
          continue;
        }
        if (action === "skip") continue;
        await mkdir(dirname(target), { recursive: true });
        before.set(f.rel, existing);
        await writeFile(target, template, "utf-8");
        written.push(f.rel);
        if (action === "replace") notes.push(`${f.rel} upgraded from a previous version`);
      }

      // Three appended blocks, each idempotent on its own marker.
      for (const [rel, marker, block] of APPENDED_BLOCKS) {
        const path = join(cwd, rel);
        const existing = await readIfExists(path);
        const merged = mergeBlock(existing, marker, block);
        if (merged !== null) {
          before.set(rel, existing);
          await writeFile(path, merged, "utf-8");
          written.push(rel);
        }
      }

      // Format only what the SITE owns, decided by OWNERSHIP and never by path.
      // A recipe-owned file that a site's prettier reformats is indistinguishable
      // from a hand edit on the next install, so planFileWrite flags it and the
      // recipe can never upgrade it again. A path prefix cannot express that:
      // three recipe-owned files live under src/. This is an ALLOW-list on
      // purpose — a file added to MATCH_HARNESS_FILES is not formatted until its
      // owner says "site", because the unsafe default is silent and permanent.
      // The same files are in the .prettierignore block written above, which
      // stops the site's OWN `prettier --write .` from doing the identical
      // damage; that block and this filter must agree, and a test asserts it.
      // CLAUDE.md is not in the file table — it is an append into a file the
      // site owns — so it is named here.
      const siteOwned = new Set(
        MATCH_HARNESS_FILES.filter((f) => f.owner === "site").map((f) => f.rel),
      );
      const toFormat = written.filter((p) => siteOwned.has(p) || p === "CLAUDE.md");
      if (toFormat.length > 0 && !(await formatWithPrettier(deps.spawn, cwd, toFormat))) {
        notes.push(PRETTIER_FLAG_NOTE);
      }

      await commit(
        "feat: install the matching harness (/dev/match route + matching/ gate scripts)",
      );

      // POSITIVE EVIDENCE that the install is real: every installed path is
      // FOUND in HEAD's tree. `git add -A` honours the site's .gitignore and
      // exits 0 either way, and git cannot re-include a file whose PARENT
      // DIRECTORY is excluded — so a site that already ignores `matching/`
      // (or `**/matching/`, `/matching`, `src/lib/site-pages.js`, …) gets the
      // files on disk, nothing in the commit, and — before this check — a
      // result of "applied", plus 83 lines of CLAUDE.md rules naming scripts
      // that exist on no other machine.
      const missing = await pathsMissingFromHead(cwd, MATCH_HARNESS_INSTALLED_PATHS);
      if (missing.length > 0) {
        const rules = await ignoreRulesFor(cwd, missing);
        const sources = [...new Set(rules.map((r) => r.split("\t")[0]!))];
        const explained = new Set(rules.map((r) => r.split("\t")[1] ?? ""));
        const unexplained = missing.filter((p) => !explained.has(p));

        // Put the checkout back exactly as we found it. Only paths THIS RUN
        // wrote and git then refused are touched: one that reached the commit
        // is left to withRecipe's force-checkout, and one we never wrote is
        // never ours. `git checkout -f` cannot do this job — these paths are
        // ignored, so git does not know they exist.
        const removed: string[] = [];
        for (const rel of written.filter((p) => missing.includes(p))) {
          const prev = before.get(rel);
          if (prev === undefined) continue;
          if (prev === null) {
            await rm(join(cwd, rel), { force: true });
            removed.push(rel);
          } else {
            await writeFile(join(cwd, rel), prev, "utf-8");
          }
        }
        // Deepest-first, so `matching/spec-sections` goes before `matching`.
        // rmdir refuses a non-empty directory, which is exactly the guard wanted.
        for (const d of [...new Set(removed.map(dirname))].sort((a, b) => b.length - a.length)) {
          if (d !== ".") await rmdir(join(cwd, d)).catch(() => undefined);
        }

        return {
          kind: "failed",
          notes:
            `the harness was NOT installed: ${missing.length} of ${MATCH_HARNESS_INSTALLED_PATHS.length} paths git refused to track, so a fresh clone, CI and the next agent get a harness that does not exist. ` +
            `Absent from the commit: ${missing.join(", ")}. ` +
            (sources.length > 0
              ? `Excluded by ${sources.join(", ")} — narrow or remove those rules and re-run. `
              : "") +
            (unexplained.length > 0
              ? `No ignore rule matched ${unexplained.join(", ")} — check .git/info/exclude, core.excludesFile, and whether the directory is a nested repository. `
              : "") +
            "Everything this run wrote to those paths has been put back as it was.",
        };
      }

      return notes.length > 0 ? { kind: "ok", notes: notes.join("; ") } : { kind: "ok" };
    },
  });
}
