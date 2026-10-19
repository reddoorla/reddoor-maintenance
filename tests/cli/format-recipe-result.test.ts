import { describe, it, expect } from "vitest";
import { formatRecipeResult } from "../../src/cli/fleet/format-recipe-result.js";
import type { RecipeResult } from "../../src/types.js";

function result(over: Partial<RecipeResult>): RecipeResult {
  return { recipe: "bump-deps", site: "acme", status: "applied", commits: [], ...over };
}

describe("formatRecipeResult", () => {
  it("prints a noop with its notes, or an empty note by default", () => {
    expect(formatRecipeResult(result({ status: "noop", notes: "nothing to do" }))).toBe(
      "[acme] noop: nothing to do",
    );
    expect(formatRecipeResult(result({ status: "noop" }))).toBe("[acme] noop: ");
  });

  it("uses noopNote only when the result carries no notes", () => {
    expect(
      formatRecipeResult(result({ status: "noop" }), { noopNote: "all configs in sync" }),
    ).toBe("[acme] noop: all configs in sync");
    expect(
      formatRecipeResult(result({ status: "noop", notes: "own note" }), { noopNote: "default" }),
    ).toBe("[acme] noop: own note");
  });

  it("prints a failed result as failed, never as applied", () => {
    expect(formatRecipeResult(result({ status: "failed", notes: "pnpm install failed" }))).toBe(
      "[acme] failed: pnpm install failed",
    );
    expect(formatRecipeResult(result({ status: "failed" }))).toBe("[acme] failed: ");
  });

  it("prints an applied result with its commit count and notes", () => {
    expect(
      formatRecipeResult(result({ status: "applied", commits: ["a1", "b2"], notes: "bumped 3" })),
    ).toBe("[acme] applied: 2 commit(s)\nbumped 3");
    expect(formatRecipeResult(result({ status: "applied", commits: ["a1"] }))).toBe(
      "[acme] applied: 1 commit(s)\n",
    );
  });

  it("omits the commit count when commitCount is false", () => {
    expect(
      formatRecipeResult(result({ status: "applied", commits: ["a1"], notes: "enabled" }), {
        commitCount: false,
      }),
    ).toBe("[acme] applied\nenabled");
  });
});
