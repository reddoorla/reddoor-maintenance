import { describe, it, expect } from "vitest";
import { availableParallelism } from "node:os";
import config, { maxWorkersFor } from "../../vitest.config.js";

describe("the suite's worker count (#1507)", () => {
  it("uses every core on CI, where vitest's default would leave one idle", () => {
    expect(maxWorkersFor({ CI: "true" })).toBe(availableParallelism());
  });

  it("leaves vitest's default alone off CI", () => {
    expect(maxWorkersFor({})).toBeUndefined();
  });

  it("is what the config passes to vitest", () => {
    expect(config.test?.maxWorkers).toBe(maxWorkersFor(process.env));
  });
});
