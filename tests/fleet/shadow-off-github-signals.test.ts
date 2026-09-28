import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runGitHubSignalsCommand } from "../../src/cli/commands/github-signals.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { untouchableBase, untouchableFetch } from "./_helpers/untouchable-airtable.js";

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

let touched: string[] = [];
let logged: () => string;

beforeEach(() => {
  touched = [];
  vi.stubGlobal("fetch", untouchableFetch(touched));
  vi.stubEnv("TURSO_DATABASE_URL", "");
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
  vi.stubEnv("GH_TOKEN", "test-token");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  logged = () => log.mock.calls.flat().join("\n");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("shipped shadow-off: github-signals never touches Airtable", () => {
  it("mirrors every row, records its events and exits 0 against a base that throws on contact", async () => {
    const mirrored: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
    const recorded: Array<{ type: string; siteId: string | null }> = [];
    const r = await runGitHubSignalsCommand(
      { fleet: true, writeBack: true },
      {
        openBase: () => untouchableBase(touched),
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
    expect(touched).toEqual([]);
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
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=updateGitHubSignals id=recA",
    );
  });
});
