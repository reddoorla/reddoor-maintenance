import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { ignoreRulesFor, pathsMissingFromHead } from "../../util/git.js";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { formatWithPrettier, resolveTargetPrettier, PRETTIER_FLAG_NOTE } from "../_prettier.js";
import {
  MATCH_HARNESS_FILES,
  MATCH_HARNESS_PREVIOUS,
  MATCH_HARNESS_COUPLED,
  HARNESS_JSON_RELATIVE,
  GITIGNORE_MARKER,
  GITIGNORE_BLOCK,
  PRETTIERIGNORE_MARKER,
  PRETTIERIGNORE_BLOCK,
  CLAUDE_MD_MARKER,
  CLAUDE_MD_BLOCK,
} from "./template.js";
import { MATCH_HARNESS_BLOCK_PREVIOUS } from "./previous.js";

/** How long the target's own prettier gets. Also what makes the fleet's default
 *  spawn detach the child, so the kill reaches prettier and not just a wrapper.
 *  Same budget as `prismic-ci` and the Prismic pull-down path. */
const PRETTIER_TIMEOUT_MS = 60_000;

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
  /** Previously shipped BLOCK bodies per target file; injectable for the same
   *  reason, and empty in the shipped table until a body is superseded. */
  blockPrevious?: Readonly<Record<string, readonly string[]>>;
  /** Resolve the TARGET repo's own prettier. Injected so a test can assert the
   *  absolute-path spawn without a populated `node_modules`. */
  resolvePrettier?: (repoRoot: string) => Promise<string | null>;
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

/** What to do with one marked block region. `flag` and `skip` never write.
 *  One member per action, so `content` narrows on the discriminant alone. */
export type BlockPlan =
  | { action: "write"; content: string }
  | { action: "replace"; content: string }
  | { action: "terminate"; content: string }
  | { action: "skip" }
  | { action: "flag" };

/**
 * Plan one marked block region. The only append-to-existing-file idiom in this
 * repo is mergeGitignore, and it cannot express a negated whitelist
 * (`matching/*` then `!matching/*.sh`) as one unit: it compares entries by
 * normalized presence, so the ordering that makes the block work would be lost.
 * So the block is kept whole — and, being whole, it needs an END as well as a
 * start if it is ever to be CORRECTED rather than only appended.
 *
 * That was #739. The predecessor returned "already done" the instant the marker
 * was present, which is right for "never append twice" and wrong for everything
 * else: the block's CONTENTS could then never change on a site that had already
 * installed. On `.gitignore` that is not staleness but a brick — the block is a
 * negated whitelist, so a harness file at a path it does not re-include is
 * absent from the commit, `pathsMissingFromHead` refuses the install, and the
 * remedy (widen the whitelist) is the one edit that cannot land.
 *
 * Four states, and the third is the one that made this worth doing properly:
 *
 * - No marker: append the region, terminator included.
 * - Marker AND terminator: the extent is KNOWN. Body still current -> skip.
 *   Body byte-matches something we shipped before -> replace IN PLACE, keeping
 *   everything before and after the region. Anything else -> flag, write
 *   nothing.
 * - Marker, NO terminator — every site installed from 0.95.0: the extent is not
 *   known, so it is never guessed. A candidate qualifies only by matching
 *   EXACTLY, byte-for-byte, at the exact offset the body starts; what follows
 *   is the site's own and is preserved verbatim. Guessing end-of-file instead
 *   would eat whatever mergeGitignore appended after us.
 * - Anything unrecognised: flag. Anchoring is on the FIRST occurrence of the
 *   marker, so a marker quoted in the site's own prose mis-anchors into text
 *   that matches no candidate — which degrades to a flag, never to a write.
 */
export function planBlockWrite(
  existing: string | null,
  marker: string,
  endMarker: string,
  block: string,
  previous: readonly string[],
): BlockPlan {
  const region = `${marker}\n${block}\n${endMarker}`;
  if (existing === null) return { action: "write", content: `${region}\n` };

  const start = existing.indexOf(marker);
  if (start === -1) {
    const base = existing.endsWith("\n") ? existing : `${existing}\n`;
    return { action: "write", content: `${base}\n${region}\n` };
  }

  const head = existing.slice(0, start);
  const bodyStart = start + marker.length + 1;

  const endAt = existing.indexOf(endMarker, bodyStart);
  if (endAt !== -1) {
    const body = existing.slice(bodyStart, endAt);
    if (normalize(body) === normalize(block)) return { action: "skip" };
    if (previous.some((p) => normalize(body) === normalize(p)))
      return {
        action: "replace",
        content: head + region + existing.slice(endAt + endMarker.length),
      };
    return { action: "flag" };
  }

  for (const candidate of [block, ...previous]) {
    if (!existing.startsWith(candidate, bodyStart)) continue;
    const content = `${head}${region}\n${existing.slice(bodyStart + candidate.length)}`;
    // Matching the CURRENT block means the bytes do not change at all and only
    // the terminator is added — the migration write is content-neutral.
    return candidate === block ? { action: "terminate", content } : { action: "replace", content };
  }
  return { action: "flag" };
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
 * Where each block region ENDS. Deliberately NOT in template.ts beside the
 * start markers, and the split is a real smell being paid for on purpose:
 * template.ts is GENERATED, and regenerating it today drags in undeclared drift
 * from the source site and would flag three already-installed scripts forever.
 * Reuniting them belongs to #753, which makes the generator's
 * `MATCH_HARNESS_PREVIOUS` emission trustworthy enough to regenerate against.
 * That table stays in template.ts and stays POPULATED in the meantime: it is
 * what upgrades an installed site's gate.sh past #744, so pointing this recipe
 * at an empty one un-ships that fix to every site already carrying the v1 gate.
 *
 * None of the three contains its own start marker as a substring — `# end
 * reddoor-maint …` never yields `# reddoor-maint …` — which is what keeps
 * `indexOf(marker)` from anchoring the region on its own terminator. A test
 * asserts it in both directions.
 */
export const GITIGNORE_END_MARKER = "# end reddoor-maint match-harness";
export const PRETTIERIGNORE_END_MARKER = "# end reddoor-maint match-harness";
export const CLAUDE_MD_END_MARKER = "<!-- end reddoor-maint match-harness -->";

/** The three files the recipe APPENDS a marked block to rather than writing whole. */
const APPENDED_BLOCKS = [
  [".gitignore", GITIGNORE_MARKER, GITIGNORE_END_MARKER, GITIGNORE_BLOCK],
  [".prettierignore", PRETTIERIGNORE_MARKER, PRETTIERIGNORE_END_MARKER, PRETTIERIGNORE_BLOCK],
  ["CLAUDE.md", CLAUDE_MD_MARKER, CLAUDE_MD_END_MARKER, CLAUDE_MD_BLOCK],
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
 *
 * ONE EXCEPTION TO PER-FILE INDEPENDENCE: the scripts in MATCH_HARNESS_COUPLED
 * upgrade as a SET. If any one of them is hand-edited, none of them is written,
 * because gate.sh calls `harness.mjs --check-run` and next.mjs imports from
 * harness.mjs — upgrading the others around a pinned one leaves a harness that
 * cannot run at all. See the measurement on MATCH_HARNESS_COUPLED.
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
      const blockPreviousAll = deps.blockPrevious ?? MATCH_HARNESS_BLOCK_PREVIOUS;

      // PASS 1 — decide everything, write nothing. The coupled-set demotion
      // below needs the whole picture before the first byte is written.
      type Planned = {
        f: (typeof MATCH_HARNESS_FILES)[number];
        template: string;
        existing: string | null;
        action: ReturnType<typeof planFileWrite>;
      };
      const plans: Planned[] = [];
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
        plans.push({
          f,
          template,
          existing,
          action: planFileWrite(existing, template, f.owner, previousAll[f.rel] ?? []),
        });
      }

      // The coupled set moves together or not at all. Two deliberate limits,
      // both of them the difference between a guard and an outage:
      //
      // ONLY `flag` demotes. `skip` means the file is already byte-correct, and
      // treating that as a flag would make every re-run refuse itself and the
      // recipe permanently inert — the demotion's own failure mode is
      // OVER-refusal, so its test has to GRANT an upgrade, not merely deny one.
      //
      // ONLY `replace` is demoted. A file that is ABSENT cannot be "left
      // alone": there is nothing to preserve, and skipping the write leaves the
      // site with no harness at all rather than an old one. The hazard being
      // guarded is upgrading HALF of an installed set past a pinned member;
      // writing a missing file is the only action that makes the set exist.
      // (Measured: demoting `write` too broke a fresh install alongside one
      // hand-edited script — 16 files silently unwritten, then a failed run.)
      const coupled = new Set(MATCH_HARNESS_COUPLED);
      const blockedBy = plans
        .filter((p) => coupled.has(p.f.rel) && p.action === "flag")
        .map((p) => p.f.rel);
      const demoted = plans.filter(
        (p) => coupled.has(p.f.rel) && p.action === "replace" && !blockedBy.includes(p.f.rel),
      );
      if (blockedBy.length > 0 && demoted.length > 0) {
        for (const p of demoted) p.action = "flag";
        notes.push(
          `${blockedBy.join(", ")} differs from the shipped template, so the whole coupled set ` +
            `was left alone: ${MATCH_HARNESS_COUPLED.join(", ")} upgrade together. ` +
            `matching/gate.sh calls \`harness.mjs --check-run\` and matching/next.mjs imports from ` +
            `harness.mjs, so upgrading one without the others leaves a harness that cannot run.`,
        );
      }

      // PASS 2 — write.
      const demotedRels = new Set(demoted.map((p) => p.f.rel));
      for (const { f, template, existing, action } of plans) {
        if (action === "flag") {
          if (demotedRels.has(f.rel)) continue; // named in the set note above
          notes.push(
            `${f.rel} differs from the shipped template and was left alone (hand-edited?)`,
          );
          continue;
        }
        if (action === "skip") continue;
        const target = join(cwd, f.rel);
        await mkdir(dirname(target), { recursive: true });
        before.set(f.rel, existing);
        await writeFile(target, template, "utf-8");
        written.push(f.rel);
        if (action === "replace") notes.push(`${f.rel} upgraded from a previous version`);
      }

      // Three appended blocks, each a delimited region that is replaced in
      // place when its body is one this recipe shipped, and flagged — never
      // overwritten — when it is anything else.
      for (const [rel, marker, endMarker, block] of APPENDED_BLOCKS) {
        const path = join(cwd, rel);
        const existing = await readIfExists(path);
        const plan = planBlockWrite(
          existing,
          marker,
          endMarker,
          block,
          blockPreviousAll[rel] ?? [],
        );
        if (plan.action === "skip") continue;
        if (plan.action === "flag") {
          // Never enters `written`: not formatted, and not restored by the
          // refusal path below, because this run did not touch it.
          notes.push(
            `${rel} carries a match-harness block that differs from every block this recipe has shipped, and was left alone (hand-edited?)`,
          );
          continue;
        }
        before.set(rel, existing);
        await writeFile(path, plan.content, "utf-8");
        written.push(rel);
        if (plan.action === "replace")
          notes.push(`${rel}'s match-harness block upgraded from a previous version`);
        if (plan.action === "terminate")
          notes.push(
            `${rel}'s match-harness block region was terminated so a future version can update it`,
          );
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

      // Run the SITE's own prettier, resolved POSITIVELY and invoked by absolute
      // path. `pnpm exec prettier` here would first run a full, unbounded
      // `pnpm install` in the client's checkout — which on `--fleet` is the
      // NORMAL path, because `prepareFleetSites` clones and never installs — and
      // would then, in a repo whose install left no prettier of its own, fall
      // through to the CALLING repo's binary and exit 0, reporting success for a
      // format the target never did. A `true` from here must mean the target's
      // own prettier ran, so nothing about which binary runs is left to
      // resolution.
      if (toFormat.length > 0) {
        const bin = await (deps.resolvePrettier ?? resolveTargetPrettier)(cwd);
        if (bin === null) {
          notes.push(PRETTIER_FLAG_NOTE);
        } else if (
          !(await formatWithPrettier(deps.spawn, cwd, toFormat, {
            bin,
            timeoutMs: PRETTIER_TIMEOUT_MS,
          }))
        ) {
          notes.push(PRETTIER_FLAG_NOTE);
        }
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
