import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/recipes/init.js", () => ({ init: vi.fn() }));
vi.mock("../../src/cli/fleet/resolve-sites.js", () => ({ resolveSites: vi.fn() }));

import { init } from "../../src/recipes/init.js";
import { resolveSites } from "../../src/cli/fleet/resolve-sites.js";
import { runInitCommand } from "../../src/cli/commands/init.js";

describe("runInitCommand — per-site isolation", () => {
  it("isolates a per-site throw: the bad site reports STOPPED, the rest STILL run", async () => {
    vi.mocked(resolveSites).mockResolvedValue([
      { path: "/a", name: "a" },
      { path: "/bad", name: "bad" },
      { path: "/c", name: "c" },
    ]);
    vi.mocked(init).mockImplementation(async (s) => {
      if (s.name === "bad") throw new Error("git index locked");
      return { site: s.name || s.path, steps: [], complete: true };
    });

    const res = await runInitCommand(undefined, {});

    // Every site was attempted — "c" was NOT skipped by the "bad" throw.
    expect(vi.mocked(init)).toHaveBeenCalledTimes(3);
    expect(res.output).toContain("[a] init — complete");
    expect(res.output).toContain("[bad] init — STOPPED");
    expect(res.output).toContain("git index locked"); // the throw surfaces as an error step
    expect(res.output).toContain("[c] init — complete");
    expect(res.code).toBe(1); // a stopped (incomplete) site → exit 1
  });
});
