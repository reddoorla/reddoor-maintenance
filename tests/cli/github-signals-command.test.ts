import { describe, it, expect, afterEach } from "vitest";
import {
  githubSignalsExitCode,
  runGitHubSignalsCommand,
} from "../../src/cli/commands/github-signals.js";

describe("githubSignalsExitCode", () => {
  it("exits 0 when the whole fleet wrote", () => {
    expect(githubSignalsExitCode(12, 0)).toBe(0);
  });

  it("exits 0 when only a minority of the fleet failed (1/12)", () => {
    expect(githubSignalsExitCode(11, 1)).toBe(0);
  });

  it("exits 1 when the majority of the fleet failed (11/12)", () => {
    // The old `failed>0 && written===0` rule returned 0 here, masking the outage.
    expect(githubSignalsExitCode(1, 11)).toBe(1);
  });

  it("exits 1 on a total wipeout", () => {
    expect(githubSignalsExitCode(0, 12)).toBe(1);
  });

  it("treats an exact tie as non-majority (exit 0)", () => {
    expect(githubSignalsExitCode(6, 6)).toBe(0);
  });
});

describe("runGitHubSignalsCommand guards", () => {
  const originalRenovate = process.env.RENOVATE_TOKEN;
  const originalGh = process.env.GH_TOKEN;

  afterEach(() => {
    if (originalRenovate === undefined) delete process.env.RENOVATE_TOKEN;
    else process.env.RENOVATE_TOKEN = originalRenovate;
    if (originalGh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGh;
  });

  it("rejects a non-fleet invocation with exit 2", async () => {
    const r = await runGitHubSignalsCommand({ fleet: false, writeAirtable: true });
    expect(r.code).toBe(2);
  });

  it("clean-skips (exit 0) when no fleet token is configured", async () => {
    delete process.env.RENOVATE_TOKEN;
    delete process.env.GH_TOKEN;
    const r = await runGitHubSignalsCommand({ fleet: true, writeAirtable: true });
    expect(r.code).toBe(0);
    expect(r.output).toContain("skipped");
  });
});
