import { describe, it, expect, afterEach } from "vitest";
import { runRenovateDispatchCommand } from "../../src/cli/commands/renovate-dispatch.js";

// Mirrors tests/cli/github-signals-command.test.ts: the two guard branches that
// the fleet-security.yml step relies on to never fail. (The dispatch happy path
// is covered by the pure helpers in tests/github/renovate-dispatch.test.ts.)
describe("runRenovateDispatchCommand guards", () => {
  const originalRenovate = process.env.RENOVATE_TOKEN;
  const originalGh = process.env.GH_TOKEN;

  afterEach(() => {
    if (originalRenovate === undefined) delete process.env.RENOVATE_TOKEN;
    else process.env.RENOVATE_TOKEN = originalRenovate;
    if (originalGh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGh;
  });

  it("rejects a non-fleet invocation with exit 2", async () => {
    const r = await runRenovateDispatchCommand({ fleet: false });
    expect(r.code).toBe(2);
  });

  it("clean-skips (exit 0) when no fleet token is configured", async () => {
    delete process.env.RENOVATE_TOKEN;
    delete process.env.GH_TOKEN;
    const r = await runRenovateDispatchCommand({ fleet: true });
    expect(r.code).toBe(0);
    expect(r.output).toContain("skipped");
  });
});
