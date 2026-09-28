import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  githubSignalsExitCode,
  runGitHubSignalsCommand,
  type GitHubSignalsDeps,
} from "../../src/cli/commands/github-signals.js";
import type { HealthMirror } from "../../src/audits/health-mirror.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

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
    const r = await runGitHubSignalsCommand({ fleet: false, writeBack: true });
    expect(r.code).toBe(2);
  });

  it("clean-skips (exit 0) when no fleet token is configured", async () => {
    delete process.env.RENOVATE_TOKEN;
    delete process.env.GH_TOKEN;
    const r = await runGitHubSignalsCommand({ fleet: true, writeBack: true });
    expect(r.code).toBe(0);
    expect(r.output).toContain("skipped");
  });

  it("RENOVATE_TOKEN ALONE no longer authorizes the sweep — the retired PAT name is not a token source", async () => {
    // The nightly passes the minted App token as GH_TOKEN. A leftover
    // RENOVATE_TOKEN (the retired operator PAT) must not quietly revive the
    // old identity: without GH_TOKEN this is the no-token skip, and the roster
    // is never read.
    process.env.RENOVATE_TOKEN = "ghp_retired_pat";
    delete process.env.GH_TOKEN;
    let read = false;
    const r = await runGitHubSignalsCommand(
      { fleet: true, writeBack: true },
      {
        roster: async () => {
          read = true;
          throw new Error("read the roster on the strength of RENOVATE_TOKEN alone");
        },
      },
    );
    expect(read).toBe(false);
    expect(r.code).toBe(0);
    expect(r.output).toContain("skipped: no GH_TOKEN");
  });
});

describe("the github-signals Turso mirror (#539 Phase 3 dual-write)", () => {
  const originalRenovate = process.env.RENOVATE_TOKEN;
  const originalGh = process.env.GH_TOKEN;

  beforeEach(() => {
    process.env.GH_TOKEN = "test-token";
    delete process.env.RENOVATE_TOKEN;
  });

  afterEach(() => {
    if (originalRenovate === undefined) delete process.env.RENOVATE_TOKEN;
    else process.env.RENOVATE_TOKEN = originalRenovate;
    if (originalGh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGh;
  });

  const LAST_COMMIT = "2026-08-20T00:00:00.000Z";

  const ROSTER = websiteRowsFrom([
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
  ]);

  // #646 step 4: the sweep's roster is Turso's, injected here.
  const deps = (mirror: HealthMirror | null): Partial<GitHubSignalsDeps> => ({
    roster: async () => ROSTER,
    makeGh: () => ({
      openPullRequests: async () => [],
      defaultBranchStatus: async () => ({ ciState: "passing", lastCommitAt: LAST_COMMIT }),
      mergedRenovatePullRequests: async () => [],
    }),
    makeMirror: async () => mirror,
    recordEvents: async () => {},
  });

  const run = (mirror: HealthMirror | null) =>
    runGitHubSignalsCommand({ fleet: true, writeBack: true }, deps(mirror));

  it("a THROWING mirror is counted as mirror_failed, never as failed, and reds the sweep", async () => {
    const r = await run(async () => {
      throw new Error("turso down");
    });
    expect(r.code).toBe(1);
    expect(r.output).toContain(
      "FLEET_WRITE_SUMMARY wrote=3 failed=0 total=3 mirrored=0 mirror_failed=3 mirror_missed=0",
    );
  });

  it("exits 0 when every row lands in Turso (known-good control)", async () => {
    const r = await run(async () => true);
    expect(r.code).toBe(0);
    expect(r.output).toContain(
      "FLEET_WRITE_SUMMARY wrote=3 failed=0 total=3 mirrored=3 mirror_failed=0 mirror_missed=0",
    );
  });

  it("counts mirrored and mirror_failed independently — 2 land, 1 throws (kills the increment swap)", async () => {
    // Asymmetric on purpose: a 1-success/1-throw run reads identically with the
    // increments swapped; 2/1 does not.
    const r = await run(async (siteId) => {
      if (siteId === "recB") throw new Error("boom");
      return true;
    });
    expect(r.code).toBe(1);
    expect(r.output).toContain(
      "FLEET_WRITE_SUMMARY wrote=3 failed=0 total=3 mirrored=2 mirror_failed=1 mirror_missed=0",
    );
  });

  it("counts a mirror that matched no site_health row as mirror_missed — not mirrored, not mirror_failed", async () => {
    // recC has no site_health row: the real mirror's UPDATE matches 0 rows and
    // resolves false.
    const r = await run(async (siteId) => siteId !== "recC");
    expect(r.code).toBe(1);
    expect(r.output).toContain(
      "FLEET_WRITE_SUMMARY wrote=3 failed=0 total=3 mirrored=2 mirror_failed=0 mirror_missed=1",
    );
  });

  it("the mirror receives the exact record id and the exact FieldSet for each row", async () => {
    const calls: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
    const r = await run(async (siteId, fields) => {
      calls.push({ siteId, fields });
      return true;
    });
    expect(r.output).toContain("mirrored=3 mirror_failed=0 mirror_missed=0");
    expect(calls.map((c) => c.siteId).sort()).toEqual(["recA", "recB", "recC"]);
    for (const call of calls) {
      expect(call.fields, `mirror payload for ${call.siteId}`).toEqual({
        "Renovate Failing CIs": 0,
        "Default Branch CI": "passing",
        "GitHub Signals At": expect.any(String),
        "Last Commit At": LAST_COMMIT,
      });
    }
    expect(new Set(calls.map((c) => c.fields["GitHub Signals At"])).size).toBe(1);
  });

  it("records a repo's events from its prior watermark", async () => {
    const recorded: string[] = [];
    const since: string[] = [];
    const r = await runGitHubSignalsCommand(
      { fleet: true, writeBack: true },
      {
        roster: async () => [
          makeWebsiteRow({
            id: "recA",
            name: "Acme Co",
            gitRepo: "reddoorla/acme-co",
            defaultBranchCi: "failing",
            githubSignalsAt: "2026-09-27T06:00:00.000Z",
          }),
        ],
        makeGh: () => ({
          openPullRequests: async () => [],
          defaultBranchStatus: async () => ({ ciState: "passing", lastCommitAt: LAST_COMMIT }),
          mergedRenovatePullRequests: async (_repo: string, from: string) => {
            since.push(from);
            return [
              {
                number: 42,
                title: "chore(deps): update x",
                url: "https://github.com/reddoorla/acme-co/pull/42",
                mergedAt: "2026-09-27T12:00:00.000Z",
              },
            ];
          },
        }),
        makeMirror: async () => async () => true,
        recordEvents: async (events) => {
          recorded.push(...events.map((e) => e.type));
        },
      },
    );
    expect(r.output).toContain("FLEET_WRITE_SUMMARY wrote=1 failed=0 total=1 mirrored=1");
    expect(since).toEqual(["2026-09-27T06:00:00.000Z"]);
    expect(recorded.sort()).toEqual(["ci_recovered", "fleet_swept", "pr_automerged"]);
  });

  it("makeMirror resolving null (no libSQL creds): no mirror keys, and the sweep reds", async () => {
    const r = await run(null);
    expect(r.code).toBe(1);
    expect(r.output).toContain("FLEET_WRITE_SUMMARY wrote=3 failed=0 total=3");
    expect(r.output).not.toContain("mirrored=");
  });
});
