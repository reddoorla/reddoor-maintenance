import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import {
  GITIGNORE_BLOCK,
  PRETTIERIGNORE_BLOCK,
  CLAUDE_MD_BLOCK,
  MATCH_HARNESS_PREVIOUS,
  MATCH_HARNESS_COUPLED,
  MATCH_HARNESS_FILES,
} from "../../src/recipes/match-harness/template.js";

const here = dirname(fileURLToPath(import.meta.url));
const generatorPath = resolve(here, "../../scripts/gen-match-harness-template.mjs");

/**
 * template.ts is GENERATED, and its header says so — which means a correction
 * applied to template.ts and not to its source survives exactly until the next
 * regeneration, and the header tells you to regenerate. That happened: three
 * false claims were corrected in template.ts alone, and `node
 * scripts/gen-match-harness-template.mjs` reverted all three (8 insertions, 15
 * deletions) because they lived in the copied site files, plus a fourth that
 * lived in the generator's own PRETTIERIGNORE_BLOCK.
 *
 * The seven COPIED constants cannot be checked here — their source is a client
 * repo that does not exist in CI. The three AUTHORED blocks can: they are
 * written inside the generator, so a hand edit to template.ts that the
 * generator does not agree with is detectable with no external checkout.
 *
 * This is a partial guard and says so. It covers the constants whose source is
 * in this repo; #732-adjacent drift in the copied files needs the regeneration
 * itself, which only runs where the source site is checked out.
 */
async function authoredBlock(name: string): Promise<string> {
  const src = await readFile(generatorPath, "utf-8");
  const m = new RegExp(`const ${name} = \`([\\s\\S]*?)\\n\`;`, "m").exec(src);
  const body = m?.[1];
  if (body === undefined) throw new Error(`could not find const ${name} in the generator`);
  // The generator's own escaping, undone by the JS engine rather than by hand:
  // these bodies ARE template literals in the generator's source, so evaluating
  // one as a template literal is correct for every escape it can carry —
  // backtick, ${, and the backslash-escaped `\[uid\]` glob in
  // PRETTIERIGNORE_BLOCK, which a hand-rolled backtick/${ pass silently gets
  // wrong. Same technique the generator's own round-trip check uses
  // (scripts/gen-match-harness-template.mjs `embed`). Repo source only — never
  // anything read from a site.
  return new Function(`return \`${body}\n\`;`)() as string;
}

describe("match-harness generator agrees with the committed template", () => {
  const cases: Array<[string, string]> = [
    ["GITIGNORE_BLOCK", GITIGNORE_BLOCK],
    ["PRETTIERIGNORE_BLOCK", PRETTIERIGNORE_BLOCK],
    ["CLAUDE_MD_BLOCK", CLAUDE_MD_BLOCK],
  ];

  for (const [name, committed] of cases) {
    it(`${name} in template.ts matches the generator's own string`, async () => {
      expect(await authoredBlock(name)).toBe(committed);
    });
  }

  it("finds a real body for each block, so a silent regex miss cannot pass", async () => {
    for (const [name] of cases) {
      const body = await authoredBlock(name);
      expect(body.length, `${name} body looks empty`).toBeGreaterThan(80);
    }
    // The PREVIOUS bodies are checked below by VALUE, but a table that came
    // back empty would satisfy every `for` loop over it vacuously — the same
    // silent-miss shape this test exists for, one level up.
    expect(Object.keys(MATCH_HARNESS_PREVIOUS).length).toBeGreaterThan(0);
    for (const [rel, bodies] of Object.entries(MATCH_HARNESS_PREVIOUS)) {
      expect(bodies.length, `${rel} has no previous bodies`).toBeGreaterThan(0);
      for (const b of bodies)
        expect(b.length, `${rel} previous body looks empty`).toBeGreaterThan(80);
    }
  });
});

/**
 * MATCH_HARNESS_PREVIOUS is what lets an ALREADY-INSTALLED site take a fix: a
 * body that does not byte-match one of these is flagged as hand-edited and left
 * broken. A corrupted entry is therefore silent in the worst way — it does not
 * fail here, it fails as a spurious refusal on somebody's site months later. So
 * the committed table is checked against the committed prior renders, both of
 * which are in this repo and need no client checkout.
 */
describe("MATCH_HARNESS_PREVIOUS matches the committed prior renders", () => {
  const prevRoot = resolve(here, "../../scripts/match-harness-previous");

  it("carries every prior render byte-for-byte, and invents none", async () => {
    const versions = (await readdir(prevRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(versions.length, "no prior renders are committed at all").toBeGreaterThan(0);

    const current = new Map(MATCH_HARNESS_FILES.map((f) => [f.rel, f.template]));
    const expected = new Map<string, string[]>();
    for (const version of versions.sort()) {
      for (const rel of current.keys()) {
        let body: string;
        try {
          body = await readFile(join(prevRoot, version, rel), "utf-8");
        } catch {
          continue;
        }
        // A prior render identical to the current one needs no entry:
        // planFileWrite returns `skip` before `previous` is ever consulted.
        if (body === current.get(rel)) continue;
        expected.set(rel, [...(expected.get(rel) ?? []), body]);
      }
    }

    expect(Object.keys(MATCH_HARNESS_PREVIOUS).sort()).toEqual([...expected.keys()].sort());
    for (const [rel, bodies] of expected) {
      expect(MATCH_HARNESS_PREVIOUS[rel], `${rel} previous bodies`).toEqual(bodies);
    }
  });

  it("names every coupled script, and every one of them is a real installed file", () => {
    // The set is what stops a partial upgrade bricking a harness, so a typo in
    // a path would silently exempt that file from the whole mechanism.
    const rels = new Set(MATCH_HARNESS_FILES.map((f) => f.rel));
    expect(MATCH_HARNESS_COUPLED.length).toBeGreaterThan(0);
    for (const rel of MATCH_HARNESS_COUPLED)
      expect(rels, `${rel} is not an installed file`).toContain(rel);
    // Every file that CHANGED in this release must be in the set — an upgraded
    // script outside it could move alone.
    for (const rel of Object.keys(MATCH_HARNESS_PREVIOUS)) {
      expect(MATCH_HARNESS_COUPLED, `${rel} changed but is not coupled`).toContain(rel);
    }
  });
});
