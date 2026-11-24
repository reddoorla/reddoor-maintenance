import { describe, it, expect } from "vitest";
import { recordModelCost, withCostScope } from "../../src/prospect/run-record.js";

describe("recordModelCost", () => {
  it("is a no-op outside a cost scope", () => {
    expect(() => recordModelCost(0.5)).not.toThrow();
  });

  it("sums finite, non-negative costs recorded inside a scope", async () => {
    const out = await withCostScope(async () => {
      recordModelCost(0.25);
      recordModelCost(0.1);
      return "done";
    });
    expect(out.value).toBe("done");
    expect(out.costUsd).toBeCloseTo(0.35, 10);
    expect(out.calls).toBe(2);
  });

  it("ignores NaN, negative, infinite and non-number values", async () => {
    const out = await withCostScope(async () => {
      recordModelCost(Number.NaN);
      recordModelCost(-1);
      recordModelCost(Number.POSITIVE_INFINITY);
      recordModelCost("0.42");
      recordModelCost(undefined);
      recordModelCost(0.2);
      return null;
    });
    expect(out.costUsd).toBeCloseTo(0.2, 10);
    expect(out.calls).toBe(1);
  });

  it("reports nothing recorded as undefined, not zero", async () => {
    const out = await withCostScope(async () => {
      recordModelCost("nope");
      return 1;
    });
    expect(out.costUsd).toBeUndefined();
    expect(out.calls).toBeUndefined();
  });

  it("keeps scopes apart when two run at once", async () => {
    const [a, b] = await Promise.all([
      withCostScope(async () => {
        await new Promise((r) => setTimeout(r, 5));
        recordModelCost(1);
      }),
      withCostScope(async () => {
        recordModelCost(2);
      }),
    ]);
    expect(a.costUsd).toBe(1);
    expect(b.costUsd).toBe(2);
  });
});
