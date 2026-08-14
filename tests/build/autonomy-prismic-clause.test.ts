import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const doc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../AUTONOMY.md"),
  "utf-8",
);

/**
 * WHICH TIER a clause is in is the whole classification, so this test reads the
 * tier sections rather than the file. A `toMatch` over the whole document passes
 * just as happily when the delete clause has been moved into the 🟢 list — which
 * is the one edit this test exists to catch.
 *
 * Fails loudly when a heading it keys on disappears: a section that silently
 * resolves to "" would make every membership assertion below unsatisfiable in
 * one direction and vacuous in the other.
 */
const tier = (heading: string): string => {
  const start = doc.indexOf(heading);
  if (start === -1) throw new Error(`AUTONOMY.md no longer has a "${heading}" heading`);
  const rest = doc.slice(start + heading.length);
  const end = rest.search(/\n#{2,3} /);
  return end === -1 ? rest : rest.slice(0, end);
};

const GREEN = tier("### 🟢 GREEN");
const RED = tier("### 🔴 RED");

// The control on the parser above, and it is not ceremony: if `tier()` ever
// returned the whole document (a changed heading, a slice that ran past its
// section), every membership assertion below would pass while asserting nothing
// about which tier anything is in — the one property this file exists to check.
if (GREEN.includes("### 🔴 RED") || RED.includes("### 🟢 GREEN")) {
  throw new Error("tier() is not slicing AUTONOMY.md into disjoint sections");
}

// Live Prismic model writes were UNCLASSIFIED and are not `git revert`-able.
// An unclassified mutation is one an agent gets to reason about case by case,
// which is exactly how the 2026-07-26 unreviewed majors merged.
describe("AUTONOMY.md — Prismic model writes", () => {
  it("classifies model push via CI on a merged PR as green", () => {
    expect(GREEN).toMatch(/model push via CI on a merged PR/i);
  });

  it("classifies model deletes as red", () => {
    expect(RED).toMatch(/\*\*Prismic model deletes\*\*/i);
    // The claim the clause rests on: there is no delete path to authorise.
    // `\s+` throughout this file, not a space: these are wrapped prose lines and
    // a guard that reds when prettier moves a word is a guard someone deletes.
    expect(RED).toMatch(/no delete\s+path/i);
  });

  it("classifies a fleet-wide model push outside CI as red", () => {
    expect(RED).toMatch(/fleet-wide model push outside\s+CI/i);
    // …and says which side of the line the fleet command sits on, because
    // "read-only by construction" is what makes the green clause above safe.
    expect(RED).toMatch(/--fleet --apply/);
  });

  // All secret handling is 🔴 in this repo; the Prismic tokens are named because
  // the fleet sweep needs fifteen of them and the naming rule is not the repo
  // directory name, which is exactly the shape of a list somebody hand-writes.
  it("classifies minting/rotating a Prismic write token as red", () => {
    expect(RED).toMatch(/minting or rotating any Prismic write token/i);
    expect(RED).toMatch(/PRISMIC_TOKEN_/);
    expect(RED).toMatch(/PRISMIC_WRITE_TOKEN/);
  });

  // The tiers are exclusive: a clause in two lists is a clause an agent can cite
  // either way. Keyed on the CLAUSE LABELS, not on the words in them — the green
  // clause legitimately says the push "never deletes", and a guard that banned
  // the word would forbid the sentence that makes the green clause safe.
  it("keeps the red clauses out of the green list", () => {
    expect(GREEN).not.toMatch(/\*\*Prismic model deletes\*\*/i);
    expect(GREEN).not.toMatch(/minting or rotating/i);
  });
});
