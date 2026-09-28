import { describe, it, vi, expect, beforeEach, afterEach } from "vitest";
import { runGitHubSignalsCommand } from "../../src/cli/commands/github-signals.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

vi.mock("../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

const LAST_COMMIT = "2026-08-20T00:00:00.000Z";

const ROSTER = [
  makeWebsiteRow({ id: "recA", name: "Acme Co", gitRepo: "reddoorla/acme-co" }),
  makeWebsiteRow({ id: "recB", name: "Beta Corp", gitRepo: "reddoorla/beta-corp" }),
];

type Write = { siteId: string; fields: Record<string, unknown> };

function orderedBase(log: string[], sent: Write[], fail: boolean): AirtableBase {
  return ((table: string) => ({
    update: async (records: Array<{ id: string; fields: Record<string, unknown> }>) => {
      log.push(`airtable:${table}:${records[0]!.id}`);
      sent.push({ siteId: records[0]!.id, fields: records[0]!.fields });
      if (fail) {
        throw Object.assign(new Error("Airtable monthly API call quota exhausted"), {
          code: "AIRTABLE_QUOTA_EXHAUSTED",
        });
      }
      return records;
    },
  })) as unknown as AirtableBase;
}

async function run(fail: boolean) {
  const log: string[] = [];
  const mirrored: Write[] = [];
  const shadowed: Write[] = [];
  const r = await runGitHubSignalsCommand(
    { fleet: true, writeBack: true },
    {
      openBase: () => orderedBase(log, shadowed, fail),
      roster: async () => ROSTER,
      makeGh: () => ({
        openPullRequests: async () => [],
        defaultBranchStatus: async () => ({ ciState: "passing", lastCommitAt: LAST_COMMIT }),
        mergedRenovatePullRequests: async () => [],
      }),
      makeMirror: async () => async (siteId, fields) => {
        log.push(`turso:${siteId}`);
        mirrored.push({ siteId, fields });
        return true;
      },
      recordEvents: async () => {},
    },
  );
  return { r, log, mirrored, shadowed };
}

describe("github-signals writes Turso before the Airtable shadow", () => {
  const originalGh = process.env.GH_TOKEN;

  beforeEach(() => {
    process.env.GH_TOKEN = "test-token";
  });

  afterEach(() => {
    if (originalGh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGh;
  });

  it("mirrors each row before its Airtable update (both succeed: known-good control)", async () => {
    const { r, log, mirrored, shadowed } = await run(false);
    expect(r.code).toBe(0);
    expect(r.output).toContain(
      "FLEET_WRITE_SUMMARY wrote=2 failed=0 total=2 mirrored=2 mirror_failed=0 mirror_missed=0",
    );
    expect(log).toEqual([
      "turso:recA",
      "airtable:Websites:recA",
      "turso:recB",
      "airtable:Websites:recB",
    ]);
    expect(mirrored).toEqual(shadowed);
  });

  it("still lands every row in Turso when every Airtable write fails, and still files them as failed", async () => {
    const { r, mirrored, shadowed } = await run(true);
    expect(mirrored.map((m) => m.siteId)).toEqual(["recA", "recB"]);
    expect(mirrored[0]!.fields).toEqual({
      "Renovate Failing CIs": 0,
      "Default Branch CI": "passing",
      "GitHub Signals At": expect.any(String),
      "Last Commit At": LAST_COMMIT,
    });
    expect(mirrored).toEqual(shadowed);
    expect(r.output).toContain(
      "FLEET_WRITE_SUMMARY wrote=0 failed=2 total=2 mirrored=2 mirror_failed=0 mirror_missed=0",
    );
    expect(r.output).toContain("acme-co (Airtable monthly API call quota exhausted)");
    expect(r.code).toBe(1);
  });

  it("records a repo's events once Turso has advanced its watermark, even when the shadow fails", async () => {
    const recorded: Array<{ id: string; type: string }> = [];
    const since: string[] = [];
    const r = await runGitHubSignalsCommand(
      { fleet: true, writeBack: true },
      {
        openBase: () => orderedBase([], [], true),
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
          recorded.push(...events.map((e) => ({ id: e.id, type: e.type })));
        },
      },
    );
    expect(r.output).toContain("FLEET_WRITE_SUMMARY wrote=0 failed=1 total=1 mirrored=1");
    expect(since).toEqual(["2026-09-27T06:00:00.000Z"]);
    expect(recorded.map((e) => e.type).sort()).toEqual([
      "ci_recovered",
      "fleet_swept",
      "pr_automerged",
    ]);
  });
});
