import { describe, it, expect } from "vitest";
import {
  landPrs,
  parseArgs,
  parseWorktreeList,
  ghFailureDetail,
  noChecksRetriesFor,
  refusal,
  type RunResult,
} from "../../scripts/land-prs.mjs";

/**
 * scripts/land-prs.mjs driven through a FAKE gh/git runner: every command the script
 * issues is matched against a route table, recorded, and answered from a queue (the last
 * answer repeats). Nothing touches GitHub. The assertions are on the recorded commands —
 * above all, which SHA the merge was pinned to, and that no command ever named a PR after
 * the one that stopped the run.
 */

const REPO = "reddoorla/reddoor-maintenance";
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);
const E = "e".repeat(40);
const MERGE = "f".repeat(40);

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });

function view(over: Record<string, unknown> = {}): RunResult {
  return ok(
    JSON.stringify({
      number: 5,
      title: "feat: something",
      state: "OPEN",
      isDraft: false,
      baseRefName: "main",
      headRefName: "feat/something",
      headRefOid: A,
      mergeStateStatus: "CLEAN",
      ...over,
    }),
  );
}

const merged = (oid = MERGE) => ok(JSON.stringify({ state: "MERGED", mergeCommit: { oid } }));

type Route = [RegExp, RunResult[]];

function fakeRunner(routes: Route[]) {
  const calls: string[] = [];
  const queues = routes.map(([re, rs]) => ({ re, rs: [...rs] }));
  const run = async (cmd: string, args: string[]): Promise<RunResult> => {
    const line = [cmd, ...args].join(" ");
    calls.push(line);
    const q = queues.find((x) => x.re.test(line));
    if (!q) throw new Error(`unexpected command: ${line}`);
    return q.rs.length > 1 ? q.rs.shift()! : q.rs[0]!;
  };
  return { run, calls };
}

async function land(
  prs: number[],
  routes: Route[],
  extra: { dryRun?: boolean; cleanup?: boolean; cwd?: string } = {},
) {
  const { run, calls } = fakeRunner(routes);
  const lines: string[] = [];
  const sleeps: number[] = [];
  const out = await landPrs({
    prs,
    repo: REPO,
    run,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (l) => lines.push(l),
    cwd: extra.cwd ?? "/repo",
    ...(extra.dryRun === undefined ? {} : { dryRun: extra.dryRun }),
    ...(extra.cleanup === undefined ? {} : { cleanup: extra.cleanup }),
  });
  return { ...out, calls, lines, sleeps };
}

const VIEW = (n: number) => new RegExp(`^gh pr view ${n} --json number,`);
const VERIFY = (n: number) => new RegExp(`^gh pr view ${n} --json state,mergeCommit`);
const CHECKS = (n: number) => new RegExp(`^gh pr checks ${n} --watch --fail-fast`);
const MERGE_CMD = (n: number) => new RegExp(`^gh pr merge ${n} `);
const mutations = (calls: string[]) =>
  calls.filter((c) => /pr (merge|update-branch)|--watch|worktree remove|branch -D/.test(c));

describe("land-prs: arguments", () => {
  it("parses PRs and flags, and rejects the unknown", () => {
    expect(parseArgs(["852", "#848", "--dry-run", "--checks-timeout-min", "5"])).toEqual({
      prs: [852, 848],
      repo: undefined,
      dryRun: true,
      cleanup: false,
      checksTimeoutMin: 5,
      base: "main",
    });
    expect(() => parseArgs(["--dry-run"])).toThrow(/no PR numbers/);
    expect(() => parseArgs(["5", "--force"])).toThrow(/unknown argument/);
  });

  it("takes an explicit --base and rejects a malformed one", () => {
    expect(parseArgs(["1", "--base", "staging"]).base).toBe("staging");
    expect(() => parseArgs(["1", "--base"])).toThrow(/--base needs a branch name/);
    expect(() => parseArgs(["1", "--base", "--dry-run"])).toThrow(/--base needs a branch name/);
  });
});

/**
 * #899. Three gaps found on the script's second real day, each of which cost
 * time rather than correctness — every stop was safe, and the wrong ones were
 * wrong about WHY.
 */
describe("land-prs: #899", () => {
  // 1. reddoor-starter#154 stopped with `gh pr view failed:` and nothing after
  // the colon. The machine had slept mid-run and gh died with no output, and
  // `firstLine("")` is `""` — a stop reason with no reason in it.
  it("a gh failure with no output still says why", () => {
    expect(ghFailureDetail({ code: 1, stdout: "", stderr: "boom" })).toBe("boom");
    expect(ghFailureDetail({ code: 1, stdout: "from stdout", stderr: "" })).toBe("from stdout");
    expect(ghFailureDetail({ code: 1, stdout: "", stderr: "", timedOut: true })).toBe(
      "timed out with no output",
    );
    expect(ghFailureDetail({ code: 7, stdout: "", stderr: "" })).toBe("exit 7 with no output");
    // The bug itself: never empty, whatever the shape.
    for (const r of [
      { code: 1, stdout: "", stderr: "" },
      { code: 0, stdout: "", stderr: "", timedOut: true },
    ]) {
      expect(ghFailureDetail(r).length).toBeGreaterThan(0);
    }
  });

  // 2. .github#35: the head landed at 04:47:14Z and Actions did not register
  // `validate` until 04:50:48Z — 3.5 minutes against a 3 x 20s budget.
  it("gives a fresh head a longer wait for its first check, and an old one the short budget", () => {
    const t = { noChecksRetries: 3, noChecksFreshRetries: 15, freshHeadMaxAgeMs: 10 * 60_000 };
    const now = Date.parse("2026-09-22T05:00:00Z");
    // The exact case: pushed 3.5 min before the check appeared.
    expect(noChecksRetriesFor(Date.parse("2026-09-22T04:58:00Z"), now, t)).toBe(15);
    // An old head with no checks really has none.
    expect(noChecksRetriesFor(Date.parse("2026-09-22T04:30:00Z"), now, t)).toBe(3);
    // Exactly at the boundary is not fresh.
    expect(noChecksRetriesFor(now - t.freshHeadMaxAgeMs - 1, now, t)).toBe(3);
    // "I could not tell" takes the SHORT budget: the long one only delays a
    // stop, and a stop is the safe outcome, so there is nothing to buy by
    // guessing generously.
    expect(noChecksRetriesFor(NaN, now, t)).toBe(3);
    // A clock that says the commit is from the future is not evidence either.
    expect(noChecksRetriesFor(now + 60_000, now, t)).toBe(3);
  });

  // 3. It refused every base but main, so each merge into reddoor-website
  // `staging` went by hand — the unscripted path the script exists to remove.
  it("refuses a non-main base by default and names the flag that allows it", () => {
    const pr = {
      state: "OPEN",
      isDraft: false,
      baseRefName: "staging",
      headRefName: "fix/thing",
      title: "fix: thing",
      mergeStateStatus: "CLEAN",
    };
    expect(refusal(pr)).toMatch(/base is staging, not main/);
    expect(refusal(pr)).toMatch(/--base staging/);
    expect(refusal(pr, "staging")).toBe("");
  });

  // Promotion stays the operator's (#623) whatever --base says.
  it("refuses promotion from staging to main even when --base main is explicit", () => {
    const promo = {
      state: "OPEN",
      isDraft: false,
      baseRefName: "main",
      headRefName: "staging",
      title: "promote staging",
      mergeStateStatus: "CLEAN",
    };
    expect(refusal(promo)).toMatch(/promotion staging → main is the operator's/);
    expect(refusal(promo, "main")).toMatch(/promotion staging → main is the operator's/);
  });

  // An allowed base does not weaken any other refusal.
  it("keeps every other refusal under an explicit --base", () => {
    const base = { baseRefName: "staging", headRefName: "h", mergeStateStatus: "CLEAN" };
    expect(refusal({ ...base, state: "MERGED", isDraft: false, title: "x" }, "staging")).toBe(
      "state=MERGED",
    );
    expect(refusal({ ...base, state: "OPEN", isDraft: true, title: "x" }, "staging")).toBe("draft");
    expect(
      refusal(
        { ...base, state: "OPEN", isDraft: false, title: "chore(release): version packages" },
        "staging",
      ),
    ).toMatch(/release PR/);
    expect(
      refusal(
        { ...base, state: "OPEN", isDraft: false, title: "x", mergeStateStatus: "DIRTY" },
        "staging",
      ),
      // It used to say "conflicts with main" about a PR with nothing to do
      // with main.
    ).toMatch(/DIRTY \(conflicts with staging\)/);
  });
});

describe("land-prs: refusals and skips", () => {
  it("refuses a release PR by title, and by head branch, before any mutation", async () => {
    for (const over of [
      { title: "chore(release): version packages" },
      { headRefName: "changeset-release/main" },
    ]) {
      const r = await land([848, 9], [[VIEW(848), [view({ number: 848, ...over })]]]);
      expect(r.code).toBe(1);
      expect(r.lines.at(-1)).toMatch(/^LAND #848 stopped reason=release PR .*always human/);
      expect(mutations(r.calls)).toEqual([]);
      expect(r.calls.some((c) => / 9\b/.test(c))).toBe(false);
    }
  });

  it("skips an already-merged PR and carries on to the next one", async () => {
    const r = await land(
      [852, 5],
      [
        [VIEW(852), [view({ number: 852, state: "MERGED" })]],
        [VIEW(5), [view()]],
        [CHECKS(5), [ok()]],
        [MERGE_CMD(5), [ok()]],
        [VERIFY(5), [merged()]],
      ],
    );
    expect(r.code).toBe(0);
    expect(r.lines).toContain("LAND #852 skipped reason=already merged");
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A}`);
    expect(r.calls.filter((c) => /pr (merge|checks) 852/.test(c))).toEqual([]);
  });

  it("refuses closed, draft, non-main base and a conflicted PR", async () => {
    for (const [over, reason] of [
      [{ state: "CLOSED" }, "state=CLOSED"],
      [{ isDraft: true }, "draft"],
      [{ baseRefName: "next" }, "base is next, not main"],
      [{ mergeStateStatus: "DIRTY" }, "mergeStateStatus=DIRTY"],
    ] as const) {
      const r = await land([5], [[VIEW(5), [view(over)]]]);
      expect(r.code).toBe(1);
      expect(r.lines.at(-1)).toContain(`LAND #5 stopped reason=${reason}`);
      expect(mutations(r.calls)).toEqual([]);
    }
  });
});

describe("land-prs: the head-SHA gate", () => {
  it("BEHIND: update-branch, wait for the head to move, and merge pinned to the NEW sha", async () => {
    const r = await land(
      [5],
      [
        // start BEHIND on A; the first poll still sees A; the second sees B
        [
          VIEW(5),
          [
            view({ mergeStateStatus: "BEHIND" }),
            view({ mergeStateStatus: "BEHIND" }),
            view({ headRefOid: B, mergeStateStatus: "BLOCKED" }),
            view({ headRefOid: B, mergeStateStatus: "CLEAN" }),
          ],
        ],
        [/^gh pr update-branch 5 /, [ok()]],
        [CHECKS(5), [ok()]],
        [MERGE_CMD(5), [ok()]],
        [VERIFY(5), [merged()]],
      ],
    );
    expect(r.code).toBe(0);
    expect(r.sleeps[0]).toBe(25_000);
    const order = r.calls.map((c) => c.split(" ").slice(0, 3).join(" "));
    expect(order.indexOf("gh pr update-branch")).toBeLessThan(order.indexOf("gh pr checks"));
    const mergeCall = r.calls.find((c) => MERGE_CMD(5).test(c))!;
    expect(mergeCall).toContain(`--match-head-commit ${B}`);
    expect(mergeCall).not.toContain(A);
    expect(mergeCall).toContain("--squash --delete-branch");
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${B}`);
  });

  it("head moves during the checks wait: re-gates on the newer sha before merging", async () => {
    const r = await land(
      [5],
      [
        [
          VIEW(5),
          [
            view({ headRefOid: A }),
            // after the first checks wait, somebody pushed C
            view({ headRefOid: C, mergeStateStatus: "BLOCKED" }),
            view({ headRefOid: C, mergeStateStatus: "CLEAN" }),
          ],
        ],
        [CHECKS(5), [ok()]],
        [MERGE_CMD(5), [ok()]],
        [VERIFY(5), [merged()]],
      ],
    );
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => CHECKS(5).test(c))).toHaveLength(2);
    expect(r.lines.some((l) => l.includes("head moved during checks aaaaaaa -> ccccccc"))).toBe(
      true,
    );
    const mergeCall = r.calls.find((c) => MERGE_CMD(5).test(c))!;
    expect(mergeCall).toContain(`--match-head-commit ${C}`);
    expect(mergeCall).not.toContain(A);
  });

  it("UNKNOWN on the first view settles to BEHIND: update-branch runs BEFORE any checks, merge on the new sha", async () => {
    // The first live run: #858 was viewed right after #857 merged, read UNKNOWN, skipped
    // the BEHIND step, watched stale checks, and only met BEHIND at the gate.
    const r = await land(
      [5],
      [
        [
          VIEW(5),
          [
            view({ mergeStateStatus: "UNKNOWN" }),
            view({ mergeStateStatus: "BEHIND" }),
            view({ headRefOid: B, mergeStateStatus: "BLOCKED" }),
            view({ headRefOid: B, mergeStateStatus: "CLEAN" }),
          ],
        ],
        [/^gh pr update-branch 5 /, [ok()]],
        [CHECKS(5), [ok()]],
        [MERGE_CMD(5), [ok()]],
        [VERIFY(5), [merged()]],
      ],
    );
    expect(r.code).toBe(0);
    expect(r.sleeps.slice(0, 2)).toEqual([10_000, 25_000]);
    const order = r.calls.map((c) => c.split(" ").slice(0, 3).join(" "));
    expect(order.indexOf("gh pr update-branch")).toBeGreaterThan(-1);
    expect(order.indexOf("gh pr update-branch")).toBeLessThan(order.indexOf("gh pr checks"));
    expect(r.calls.filter((c) => CHECKS(5).test(c))).toHaveLength(1);
    expect(r.lines.some((l) => l.startsWith("LAND #5 open head=aaaaaaa merge=BEHIND"))).toBe(true);
    expect(r.calls.find((c) => MERGE_CMD(5).test(c))).toContain(`--match-head-commit ${B}`);
  });

  it("BEHIND discovered at the post-checks gate: update-branch, re-check the new head, merge on it", async () => {
    const r = await land(
      [5],
      [
        [
          VIEW(5),
          [
            view({ mergeStateStatus: "CLEAN" }), // first view
            view({ mergeStateStatus: "BEHIND" }), // gate: main moved during the checks
            view({ headRefOid: B, mergeStateStatus: "BLOCKED" }), // post-update poll
            view({ headRefOid: B, mergeStateStatus: "CLEAN" }), // gate 2
          ],
        ],
        [/^gh pr update-branch 5 /, [ok()]],
        [CHECKS(5), [ok()]],
        [MERGE_CMD(5), [ok()]],
        [VERIFY(5), [merged()]],
      ],
    );
    expect(r.code).toBe(0);
    const kinds = r.calls
      .map((c) => c.split(" ").slice(0, 3).join(" "))
      .filter((k) => /checks|update-branch|merge/.test(k));
    expect(kinds).toEqual(["gh pr checks", "gh pr update-branch", "gh pr checks", "gh pr merge"]);
    expect(r.lines).toContain("LAND #5 BEHIND at the gate on aaaaaaa; updating again");
    const mergeCall = r.calls.find((c) => MERGE_CMD(5).test(c))!;
    expect(mergeCall).toContain(`--match-head-commit ${B}`);
    expect(mergeCall).not.toContain(A);
  });

  it("BEHIND at every gate is bounded by the round cap, and stops with a clear reason", async () => {
    const r = await land(
      [5],
      [
        [
          VIEW(5),
          [
            view({ headRefOid: A, mergeStateStatus: "CLEAN" }),
            view({ headRefOid: A, mergeStateStatus: "BEHIND" }),
            view({ headRefOid: B, mergeStateStatus: "BLOCKED" }),
            view({ headRefOid: B, mergeStateStatus: "BEHIND" }),
            view({ headRefOid: C, mergeStateStatus: "BLOCKED" }),
            view({ headRefOid: C, mergeStateStatus: "BEHIND" }),
          ],
        ],
        [/^gh pr update-branch 5 /, [ok()]],
        [CHECKS(5), [ok()]],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      "LAND #5 stopped reason=still BEHIND after 3 check rounds on ccccccc: main kept moving",
    );
    expect(r.calls.filter((c) => c.startsWith("gh pr update-branch"))).toHaveLength(2);
    expect(r.calls.some((c) => MERGE_CMD(5).test(c))).toBe(false);
  });

  it("failing checks stop the run with the failing names, and later PRs are never touched", async () => {
    const r = await land(
      [5, 6, 7],
      [
        [VIEW(5), [view()]],
        [CHECKS(5), [{ code: 1, stdout: "X test\n✓ lint\n", stderr: "" }]],
        [
          /^gh pr checks 5 --json name,bucket/,
          [
            {
              code: 1,
              stdout: JSON.stringify([
                { name: "test", bucket: "fail" },
                { name: "lint", bucket: "pass" },
                { name: "e2e", bucket: "cancel" },
              ]),
              stderr: "",
            },
          ],
        ],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(`LAND #5 stopped reason=checks failed on aaaaaaa: test, e2e`);
    expect(r.calls.some((c) => MERGE_CMD(5).test(c))).toBe(false);
    expect(r.calls.some((c) => /\b(6|7)\b/.test(c))).toBe(false);
    expect(r.results.map((x) => x.pr)).toEqual([5]);
  });

  it("a merge state other than CLEAN after the checks stops the run, naming the state", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view({ mergeStateStatus: "CLEAN" }), view({ mergeStateStatus: "UNSTABLE" })]],
        [CHECKS(5), [ok()]],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe("LAND #5 stopped reason=mergeStateStatus=UNSTABLE on aaaaaaa");
    expect(r.calls.some((c) => MERGE_CMD(5).test(c))).toBe(false);
  });

  it("gh's worktree message on a merge that landed is noise: the view says MERGED, so it succeeded", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [CHECKS(5), [ok()]],
        [
          MERGE_CMD(5),
          [
            {
              code: 1,
              stdout: "",
              stderr:
                "failed to run git: fatal: 'main' is already used by worktree at '/Users/x/reddoor-maintenance'\n",
            },
          ],
        ],
        [VERIFY(5), [merged()]],
      ],
    );
    expect(r.code).toBe(0);
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A}`);
    expect(r.lines.some((l) => l.includes("note:"))).toBe(false);
  });

  it("a merge that did NOT land stops, even when gh exits 0 (control for the case above)", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [CHECKS(5), [ok()]],
        [MERGE_CMD(5), [ok()]],
        [VERIFY(5), [ok(JSON.stringify({ state: "OPEN", mergeCommit: null }))]],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toMatch(/^LAND #5 stopped reason=merge did not land \(state=OPEN\)/);
  });
});

describe("land-prs: --cleanup", () => {
  const porcelain = [
    "worktree /repo",
    `HEAD ${C}`,
    "branch refs/heads/main",
    "",
    "worktree /repo/.claude/worktrees/mine",
    `HEAD ${A}`,
    "branch refs/heads/feat/something",
    "",
    "worktree /repo/.claude/worktrees/other",
    `HEAD ${B}`,
    "branch refs/heads/feat/other",
    "",
  ].join("\n");

  // The merged head is A. `tip` is the local branch's tip; `ancestor` is what
  // `git merge-base --is-ancestor <tip> A` answers.
  const routesThrough = (
    status: RunResult,
    { tip = A, ancestor = ok() }: { tip?: string; ancestor?: RunResult } = {},
  ): Route[] => [
    [VIEW(5), [view()]],
    [CHECKS(5), [ok()]],
    [MERGE_CMD(5), [ok()]],
    [VERIFY(5), [merged()]],
    [/^git worktree list --porcelain$/, [ok(porcelain)]],
    [/^git -C \/repo\/\.claude\/worktrees\/mine status --porcelain$/, [status]],
    [/^git worktree remove \/repo\/\.claude\/worktrees\/mine$/, [ok()]],
    [/^git rev-parse --verify -q refs\/heads\/feat\/something$/, [ok(`${tip}\n`)]],
    [/^git fetch --no-tags --no-write-fetch-head origin refs\/pull\/5\/head$/, [ok()]],
    [new RegExp(`^git merge-base --is-ancestor ${tip} ${A}$`), [ancestor]],
    [/^git branch -D feat\/something$/, [ok()]],
  ];

  it("parses the porcelain worktree list", () => {
    expect(parseWorktreeList(porcelain).map((w) => [w.path, w.branch])).toEqual([
      ["/repo", "refs/heads/main"],
      ["/repo/.claude/worktrees/mine", "refs/heads/feat/something"],
      ["/repo/.claude/worktrees/other", "refs/heads/feat/other"],
    ]);
  });

  it("PASS control: a clean worktree on the PR's branch is removed and its branch deleted", async () => {
    const r = await land([5], routesThrough(ok("")), { cleanup: true });
    expect(r.code).toBe(0);
    expect(r.calls).toContain("git worktree remove /repo/.claude/worktrees/mine");
    expect(r.calls).toContain("git branch -D feat/something");
    // never forced, and the worktree on another branch is never looked at
    expect(r.calls.some((c) => c.includes("--force"))).toBe(false);
    expect(r.calls.some((c) => c.includes("worktrees/other"))).toBe(false);
  });

  it("deletes a branch whose tip is an ANCESTOR of the merged head (update-branch added a merge on top)", async () => {
    // The first live run: #857's local tip a8fcfc2 was behind the merged head a5da697 only
    // by GitHub's update-branch merge commit, and the old equality test kept the branch.
    const r = await land([5], routesThrough(ok(""), { tip: D, ancestor: ok() }), { cleanup: true });
    expect(r.code).toBe(0);
    const i = (re: RegExp) => r.calls.findIndex((c) => re.test(c));
    expect(i(/^git fetch .* refs\/pull\/5\/head$/)).toBeGreaterThan(-1);
    expect(i(/^git fetch /)).toBeLessThan(i(/^git merge-base --is-ancestor /));
    expect(r.calls).toContain(`git merge-base --is-ancestor ${D} ${A}`);
    expect(r.calls).toContain("git branch -D feat/something");
    expect(r.lines).toContain("LAND #5 cleanup deleted branch feat/something");
  });

  it("keeps a branch whose tip is NOT an ancestor of the merged head, and says why", async () => {
    const r = await land(
      [5],
      routesThrough(ok(""), { tip: E, ancestor: { code: 1, stdout: "", stderr: "" } }),
      { cleanup: true },
    );
    expect(r.code).toBe(0);
    expect(r.calls).toContain("git worktree remove /repo/.claude/worktrees/mine");
    expect(r.calls.some((c) => c.startsWith("git branch"))).toBe(false);
    expect(r.lines).toContain(
      "LAND #5 cleanup kept branch feat/something: local tip eeeeeee is not an ancestor of the merged head aaaaaaa (it has commits that did not land)",
    );
  });

  it("leaves a dirty worktree alone and says why", async () => {
    const r = await land([5], routesThrough(ok(" M src/a.ts\n?? notes.md\n")), { cleanup: true });
    expect(r.code).toBe(0);
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A}`);
    expect(r.lines).toContain(
      "LAND #5 cleanup left /repo/.claude/worktrees/mine: 2 uncommitted changes",
    );
    expect(r.calls.some((c) => c.startsWith("git worktree remove"))).toBe(false);
    expect(r.calls.some((c) => c.startsWith("git branch"))).toBe(false);
  });
});

describe("land-prs: --dry-run", () => {
  it("views, prints the plan, and issues no mutating command", async () => {
    const r = await land(
      [852, 5],
      [
        [VIEW(852), [view({ number: 852, state: "MERGED" })]],
        [VIEW(5), [view({ mergeStateStatus: "BEHIND" })]],
      ],
      { dryRun: true },
    );
    expect(r.code).toBe(0);
    expect(r.calls.every((c) => c.startsWith("gh pr view"))).toBe(true);
    expect(r.lines).toContain("LAND #852 skipped reason=already merged");
    expect(r.lines.some((l) => l.startsWith("LAND #5 dry-run would: update-branch"))).toBe(true);
    expect(r.sleeps).toEqual([]);
  });
});
