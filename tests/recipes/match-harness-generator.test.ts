import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import {
  GITIGNORE_BLOCK,
  PRETTIERIGNORE_BLOCK,
  CLAUDE_MD_BLOCK,
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
  // The generator's own escaping, undone: it writes these into a template
  // literal, so backticks and ${ are escaped in its source.
  return body.replace(/\\`/g, "`").replace(/\\\$\{/g, "${") + "\n";
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
  });
});
