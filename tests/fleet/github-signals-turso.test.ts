import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runGitHubSignalsCommand } from "../../src/cli/commands/github-signals.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const LAST_COMMIT = "2026-08-20T00:00:00.000Z";

const ROSTER = [
  makeWebsiteRow({
    id: "recA",
    name: "Acme Co",
    gitRepo: "reddoorla/acme-co",
    defaultBranchCi: "failing",
    githubSignalsAt: "2026-09-27T06:00:00.000Z",
  }),
  makeWebsiteRow({ id: "recB", name: "Beta Corp", gitRepo: "reddoorla/beta-corp" }),
];

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async (input: unknown) => {
    throw new Error(`network touched: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("TURSO_DATABASE_URL", "");
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
  vi.stubEnv("GH_TOKEN", "test-token");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("github-signals --fleet --write-back lands in Turso", () => {
  it("mirrors every row, records its events and exits 0", async () => {
    const mirrored: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
    const recorded: Array<{ type: string; siteId: string | null }> = [];
    const r = await runGitHubSignalsCommand(
      { fleet: true, writeBack: true },
      {
        roster: async () => ROSTER,
        makeGh: () => ({
          openPullRequests: async () => [],
          defaultBranchStatus: async () => ({ ciState: "passing", lastCommitAt: LAST_COMMIT }),
          mergedRenovatePullRequests: async (repo: string) =>
            repo === "reddoorla/acme-co"
              ? [
                  {
                    number: 42,
                    title: "chore(deps): update x",
                    url: "https://github.com/reddoorla/acme-co/pull/42",
                    mergedAt: "2026-09-27T12:00:00.000Z",
                  },
                ]
              : [],
        }),
        makeMirror: async () => async (siteId, fields) => {
          mirrored.push({ siteId, fields });
          return true;
        },
        recordEvents: async (events) => {
          recorded.push(...events.map((e) => ({ type: e.type, siteId: e.siteId })));
        },
      },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.code).toBe(0);
    expect(r.output).toContain(
      "FLEET_WRITE_SUMMARY wrote=2 failed=0 total=2 mirrored=2 mirror_failed=0 mirror_missed=0",
    );
    expect(mirrored).toEqual([
      {
        siteId: "recA",
        fields: {
          "Renovate Failing CIs": 0,
          "Default Branch CI": "passing",
          "GitHub Signals At": expect.any(String),
          "Last Commit At": LAST_COMMIT,
        },
      },
      { siteId: "recB", fields: expect.objectContaining({ "Default Branch CI": "passing" }) },
    ]);
    expect(recorded).toEqual(
      expect.arrayContaining([
        { type: "ci_recovered", siteId: "recA" },
        { type: "pr_automerged", siteId: "recA" },
        { type: "fleet_swept", siteId: null },
      ]),
    );
  });
});
