import { describe, it, expect } from "vitest";
import { landPrs, parseArgs, parseWorktreeList, type RunResult } from "../../scripts/land-prs.mjs";

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
    });
    expect(() => parseArgs(["--dry-run"])).toThrow(/no PR numbers/);
    expect(() => parseArgs(["5", "--force"])).toThrow(/unknown argument/);
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

  const routesThrough = (status: RunResult): Route[] => [
    [VIEW(5), [view()]],
    [CHECKS(5), [ok()]],
    [MERGE_CMD(5), [ok()]],
    [VERIFY(5), [merged()]],
    [/^git worktree list --porcelain$/, [ok(porcelain)]],
    [/^git -C \/repo\/\.claude\/worktrees\/mine status --porcelain$/, [status]],
    [/^git worktree remove \/repo\/\.claude\/worktrees\/mine$/, [ok()]],
    [/^git rev-parse --verify -q refs\/heads\/feat\/something$/, [ok(`${A}\n`)]],
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
