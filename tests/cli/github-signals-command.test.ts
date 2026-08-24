import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  githubSignalsExitCode,
  runGitHubSignalsCommand,
  type GitHubSignalsDeps,
} from "../../src/cli/commands/github-signals.js";
import { makeFakeBase, type FakeAirtableBase } from "../reports/_helpers/fake-airtable-base.js";
import type { HealthMirror } from "../../src/audits/health-mirror.js";

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

describe("the github-signals Turso mirror (#539 Phase 3 dual-write)", () => {
  const originalRenovate = process.env.RENOVATE_TOKEN;
  const originalGh = process.env.GH_TOKEN;

  beforeEach(() => {
    process.env.RENOVATE_TOKEN = "test-token";
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    if (originalRenovate === undefined) delete process.env.RENOVATE_TOKEN;
    else process.env.RENOVATE_TOKEN = originalRenovate;
    if (originalGh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGh;
  });

  const LAST_COMMIT = "2026-08-20T00:00:00.000Z";

  const seededBase = () =>
    makeFakeBase({
      Websites: [
        {
          id: "recA",
          fields: { Name: "Acme Co", Status: "maintenance", "Git repo": "reddoorla/acme-co" },
        },
        {
          id: "recB",
          fields: { Name: "Beta Corp", Status: "maintenance", "Git repo": "reddoorla/beta-corp" },
        },
        {
          id: "recC",
          fields: { Name: "Gamma Inc", Status: "maintenance", "Git repo": "reddoorla/gamma-inc" },
        },
      ],
    });

  // The REAL updateGitHubSignals runs against this fake base, so the FieldSet
  // asserted below is built by production code — not by the test's own mock.
  const deps = (
    base: FakeAirtableBase,
    mirror: HealthMirror | null,
  ): Partial<GitHubSignalsDeps> => ({
    openBase: () => base,
    makeGh: () => ({
      openPullRequests: async () => [],
      defaultBranchStatus: async () => ({ ciState: "passing", lastCommitAt: LAST_COMMIT }),
      mergedRenovatePullRequests: async () => [],
    }),
    makeMirror: async () => mirror,
    recordEvents: async () => {},
  });

  const run = (base: FakeAirtableBase, mirror: HealthMirror | null) =>
    runGitHubSignalsCommand({ fleet: true, writeAirtable: true }, deps(base, mirror));

  it("a THROWING mirror never moves an Airtable-written row into failed, and never reds the sweep", async () => {
    // Kills the delete-the-inner-try/catch mutation: a mirror throw landing in
    // the outer per-row catch would file an Airtable-successful row under
    // `failed` and (here, 0 written vs 3 failed) flip the exit code to 1 —
    // redding the nightly on a Turso blip.
    const base = seededBase();
    const r = await run(base, async () => {
      throw new Error("turso down");
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain(
      "FLEET_WRITE_SUMMARY wrote=3 failed=0 total=3 mirrored=0 mirror_failed=3 mirror_missed=0",
    );
    // The Airtable writes themselves all happened.
    expect(base.__calls.filter((c) => c.kind === "update")).toHaveLength(3);
  });

  it("counts mirrored and mirror_failed independently — 2 land, 1 throws (kills the increment swap)", async () => {
    // Asymmetric on purpose: a 1-success/1-throw run reads identically with the
    // increments swapped; 2/1 does not.
    const base = seededBase();
    const r = await run(base, async (siteId) => {
      if (siteId === "recB") throw new Error("boom");
      return true;
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain(
      "FLEET_WRITE_SUMMARY wrote=3 failed=0 total=3 mirrored=2 mirror_failed=1 mirror_missed=0",
    );
  });

  it("counts a mirror that matched no site_health row as mirror_missed — not mirrored, not mirror_failed", async () => {
    const base = seededBase();
    // recC was created in Airtable after the last hourly import: the real
    // mirror's UPDATE matches 0 rows and resolves false.
    const r = await run(base, async (siteId) => siteId !== "recC");
    expect(r.code).toBe(0);
    expect(r.output).toContain(
      "FLEET_WRITE_SUMMARY wrote=3 failed=0 total=3 mirrored=2 mirror_failed=0 mirror_missed=1",
    );
  });

  it("the mirror receives the exact record id and the exact FieldSet the Airtable update wrote", async () => {
    const base = seededBase();
    const calls: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
    const r = await run(base, async (siteId, fields) => {
      calls.push({ siteId, fields });
      return true;
    });
    expect(r.output).toContain("mirrored=3 mirror_failed=0 mirror_missed=0");
    // Channel 1: what the REAL updateGitHubSignals wrote to (fake) Airtable —
    // mirror payload must be that exact FieldSet, per record id.
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect(updates).toHaveLength(3);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.siteId).sort()).toEqual(["recA", "recB", "recC"]);
    for (const call of calls) {
      const update = updates.find((u) => u.records[0]!.id === call.siteId);
      expect(update, `no Airtable update matches mirrored id ${call.siteId}`).toBeDefined();
      expect(call.fields, `mirror payload for ${call.siteId}`).toEqual(update!.records[0]!.fields);
    }
    // Channel 2, independent of the update capture: the literal values the
    // probe data dictates (not the mock echoing itself back).
    const acme = calls.find((c) => c.siteId === "recA")!;
    expect(acme.fields).toMatchObject({
      "Renovate Failing CIs": 0,
      "Default Branch CI": "passing",
      "Last Commit At": LAST_COMMIT,
    });
    expect(typeof acme.fields["GitHub Signals At"]).toBe("string");
  });

  it("makeMirror resolving null (no libSQL creds): the sweep runs Airtable-only, no mirror keys", async () => {
    const base = seededBase();
    const r = await run(base, null);
    expect(r.code).toBe(0);
    expect(r.output).toContain("FLEET_WRITE_SUMMARY wrote=3 failed=0 total=3");
    expect(r.output).not.toContain("mirrored=");
  });
});
