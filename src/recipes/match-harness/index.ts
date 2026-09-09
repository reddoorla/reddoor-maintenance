import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
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
        await writeFile(target, template, "utf-8");
        written.push(f.rel);
        if (action === "replace") notes.push(`${f.rel} upgraded from a previous version`);
      }

      // Three appended blocks, each idempotent on its own marker.
      for (const [rel, marker, block] of [
        [".gitignore", GITIGNORE_MARKER, GITIGNORE_BLOCK],
        [".prettierignore", PRETTIERIGNORE_MARKER, PRETTIERIGNORE_BLOCK],
        ["CLAUDE.md", CLAUDE_MD_MARKER, CLAUDE_MD_BLOCK],
      ] as const) {
        const path = join(cwd, rel);
        const merged = mergeBlock(await readIfExists(path), marker, block);
        if (merged !== null) {
          await writeFile(path, merged, "utf-8");
          written.push(rel);
        }
      }

      // Format only what the SITE owns. The harness CODE ships template-verbatim
      // and is in .prettierignore: a site whose printWidth differs would
      // otherwise reformat every recipe-owned script on install, and the
      // byte-compare that makes the next upgrade possible would flag all of them
      // as hand-edited. The Markdown stubs are NOT formatted here either, so
      // they must be authored prettier-clean — they stay in `prettier --check .`
      // (Task 15 case 13 is that check).
      const toFormat = written.filter((p) => p.startsWith("src/") || p === "CLAUDE.md");
      if (toFormat.length > 0 && !(await formatWithPrettier(deps.spawn, cwd, toFormat))) {
        notes.push(PRETTIER_FLAG_NOTE);
      }

      await commit(
        "feat: install the matching harness (/dev/match route + matching/ gate scripts)",
      );
      return notes.length > 0 ? { kind: "ok", notes: notes.join("; ") } : { kind: "ok" };
    },
  });
}
