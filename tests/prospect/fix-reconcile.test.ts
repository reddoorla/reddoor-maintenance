import { describe, expect, it } from "vitest";
import { reconcileFixes } from "../../src/prospect/analyze.js";
import type { GoalFit, GoalRequirement } from "../../src/prospect/goals.js";
import type { Fix } from "../../src/prospect/types.js";

/**
 * The fix list is the only part of the report the model writes freely, and
 * nothing used to check it against what we had already measured. That is the
 * mechanism behind the report's worst failure mode: a document that tells a
 * prospect to do something the page above it says they have already done.
 *
 * The model is now asked to tag each fix with the requirement it would satisfy,
 * and a fix tagged with something we measured as MET is dropped here rather
 * than trusted.
 */

const req = (key: string, status: GoalRequirement["status"]): GoalRequirement => ({
  key,
  label: key,
  status,
  evidence: status === "met" ? "found" : null,
  why: "because",
  scope: "content",
});

const fit = (reqs: GoalRequirement[]): GoalFit => ({
  goal: "enquire",
  source: "operator",
  requirements: reqs,
  met: reqs.filter((r) => r.status === "met").length,
  total: reqs.filter((r) => r.status !== "unmeasured").length,
});

const fix = (title: string, addresses: string | null): Fix => ({
  title,
  why: "w",
  impact: "high",
  effort: "low",
  tier: "content",
  addresses,
});

describe("reconcileFixes", () => {
  it("drops a fix for something we measured as already there", () => {
    const out = reconcileFixes(
      [fix("Publish your pricing", "price-signal"), fix("Add a booking link", "booking")],
      fit([req("price-signal", "met"), req("booking", "missing")]),
    );
    expect(out.map((f) => f.title)).toEqual(["Add a booking link"]);
  });

  it("keeps a fix for something we measured as missing", () => {
    const out = reconcileFixes(
      [fix("Publish your pricing", "price-signal")],
      fit([req("price-signal", "missing")]),
    );
    expect(out).toHaveLength(1);
  });

  it("keeps a fix for something we could not measure", () => {
    // We do not know it is already done, so we cannot claim the fix is
    // redundant. Silence on our side is not evidence about their site.
    const out = reconcileFixes(
      [fix("Add a qualifying form", "qualifying-form")],
      fit([req("qualifying-form", "unmeasured")]),
    );
    expect(out).toHaveLength(1);
  });

  it("keeps an untagged fix", () => {
    // Most good fixes have no requirement to point at — a heavy image, a broken
    // link, a stale year. An untagged fix is the normal case, not a suspect one.
    const out = reconcileFixes([fix("Compress the hero image", null)], fit([req("price", "met")]));
    expect(out).toHaveLength(1);
  });

  it("keeps a fix tagged with a requirement this goal never checked", () => {
    const out = reconcileFixes(
      [fix("Publish shipping costs", "shipping")],
      fit([req("price", "met")]),
    );
    expect(out).toHaveLength(1);
  });

  it("leaves the list alone when the goal check did not run", () => {
    const fixes = [fix("Publish your pricing", "price-signal")];
    expect(reconcileFixes(fixes, null)).toEqual(fixes);
  });

  it("preserves the model's ordering of what survives", () => {
    const out = reconcileFixes(
      [fix("a", null), fix("b", "met-one"), fix("c", null), fix("d", null)],
      fit([req("met-one", "met")]),
    );
    expect(out.map((f) => f.title)).toEqual(["a", "c", "d"]);
  });
});
