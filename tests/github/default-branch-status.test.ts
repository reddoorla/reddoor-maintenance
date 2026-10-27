import { describe, it, expect } from "vitest";
import { makeGitHub } from "../../src/github/gh.js";

function fakeSpawn(stdout: string) {
  return async () => ({ code: 0, stdout, stderr: "" });
}

describe("defaultBranchStatus", () => {
  it("maps the rollup state and returns the commit date", async () => {
    const gh = makeGitHub({
      token: "t",
      spawn: fakeSpawn(
        JSON.stringify({
          data: {
            repository: {
              defaultBranchRef: {
                target: {
                  committedDate: "2026-06-01T10:00:00Z",
                  statusCheckRollup: { state: "FAILURE" },
                },
              },
            },
          },
        }),
      ),
    });
    expect(await gh.defaultBranchStatus("reddoorla/caltex")).toEqual({
      ciState: "failing",
      lastCommitAt: "2026-06-01T10:00:00Z",
    });
  });

  it("reads SUCCESS as passing", async () => {
    const gh = makeGitHub({
      token: "t",
      spawn: fakeSpawn(
        JSON.stringify({
          data: {
            repository: {
              defaultBranchRef: {
                target: {
                  committedDate: "2026-06-02T00:00:00Z",
                  statusCheckRollup: { state: "SUCCESS" },
                },
              },
            },
          },
        }),
      ),
    });
    expect(await gh.defaultBranchStatus("o/r")).toEqual({
      ciState: "passing",
      lastCommitAt: "2026-06-02T00:00:00Z",
    });
  });

  it("an empty/branchless repo → none + null date", async () => {
    const gh = makeGitHub({
      token: "t",
      spawn: fakeSpawn(JSON.stringify({ data: { repository: { defaultBranchRef: null } } })),
    });
    expect(await gh.defaultBranchStatus("o/r")).toEqual({ ciState: "none", lastCommitAt: null });
  });

  it("no checks reported → none, with the date still returned", async () => {
    const gh = makeGitHub({
      token: "t",
      spawn: fakeSpawn(
        JSON.stringify({
          data: {
            repository: {
              defaultBranchRef: {
                target: { committedDate: "2026-06-03T00:00:00Z", statusCheckRollup: null },
              },
            },
          },
        }),
      ),
    });
    expect(await gh.defaultBranchStatus("o/r")).toEqual({
      ciState: "none",
      lastCommitAt: "2026-06-03T00:00:00Z",
    });
  });

  it("rejects a non owner/repo string", async () => {
    const gh = makeGitHub({ token: "t", spawn: fakeSpawn("{}") });
    await expect(gh.defaultBranchStatus("not-a-repo")).rejects.toThrow(/owner\/repo/);
  });
});
