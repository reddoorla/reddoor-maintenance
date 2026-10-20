import { describe, it, expect, vi } from "vitest";
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

  // The case above compares undefined with undefined off CI, so it guards only
  // where CI is set (#1512). This one loads the config with CI set explicitly.
  it("passes every core to vitest when CI is set, wherever the suite runs", async () => {
    vi.stubEnv("CI", "true");
    vi.resetModules();
    try {
      const { default: ciConfig } = await import("../../vitest.config.js");
      expect(ciConfig.test?.maxWorkers).toBe(availableParallelism());
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
