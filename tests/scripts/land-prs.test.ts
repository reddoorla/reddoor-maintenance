import { describe, it, expect } from "vitest";
import {
  landPrs,
  parseArgs,
  parseWorktreeList,
  ghFailureDetail,
  noChecksRetriesFor,
  refusal,
  prFromRest,
  checksFromRest,
  repoFromRemoteUrl,
  resolveRepo,
  type RunResult,
} from "../../scripts/land-prs.mjs";

/**
 * scripts/land-prs.mjs driven through a FAKE gh/git runner: every command the script
 * issues is matched against a route table, recorded, and answered from a queue (the last
 * answer repeats). Nothing touches GitHub. The assertions are on the recorded commands —
 * above all, which SHA the merge was pinned to, and that no command ever named a PR after
 * the one that stopped the run.
 *
 * Every GitHub call is REST (`gh api repos/…`), because the Claude Code on the web proxy
 * refuses GraphQL, and `land()` fails any test whose run issues any other `gh` command.
 * The fakes answer in the shapes the REST API answered with on 2026-09-28.
 */

const REPO = "reddoorla/reddoor-maintenance";
const P = `repos/${REPO}`;
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);
const E = "e".repeat(40);
const MERGE = "f".repeat(40);
const TEST_MERGE = "9".repeat(40);
const T0 = Date.parse("2026-09-28T12:00:00Z");

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
const httpError = (status: number, message: string): RunResult => ({
  code: 1,
  stdout: JSON.stringify({ message, status: String(status) }),
  stderr: `gh: ${message} (HTTP ${status})\n`,
});
const PROXY_403 = httpError(
  403,
  "Write access to this GitHub API path is not permitted through this proxy.",
);

interface Model {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  mergeStateStatus: string;
  headRepo: string | null;
  mergeCommit: string;
}

function view(over: Partial<Model> = {}): RunResult {
  const m: Model = {
    number: 5,
    title: "feat: something",
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feat/something",
    headRefOid: A,
    mergeStateStatus: "CLEAN",
    headRepo: REPO,
    mergeCommit: MERGE,
    ...over,
  };
  const merged = m.state === "MERGED";
  return ok(
    JSON.stringify({
      number: m.number,
      title: m.title,
      state: m.state === "OPEN" ? "open" : "closed",
      merged,
      merged_at: merged ? "2026-09-28T12:30:00Z" : null,
      draft: m.isDraft,
      mergeable_state: m.mergeStateStatus.toLowerCase(),
      merge_commit_sha: merged ? m.mergeCommit : TEST_MERGE,
      head: {
        ref: m.headRefName,
        sha: m.headRefOid,
        repo: m.headRepo === null ? null : { full_name: m.headRepo },
      },
      base: { ref: m.baseRefName, repo: { full_name: REPO } },
    }),
  );
}

const merged = (oid = MERGE) =>
  view({ state: "MERGED", mergeStateStatus: "UNKNOWN", mergeCommit: oid });

type CheckRun = [name: string, status: string, conclusion: string | null];

const runs = (...rs: CheckRun[]): RunResult =>
  ok(
    JSON.stringify({
      total_count: rs.length,
      check_runs: rs.map(([name, status, conclusion]) => ({ name, status, conclusion })),
    }),
  );

const statuses = (...ss: Array<[context: string, state: string]>): RunResult =>
  ok(
    JSON.stringify({
      state: ss.length === 0 || ss.some(([, s]) => s === "pending") ? "pending" : "success",
      total_count: ss.length,
      statuses: ss.map(([context, state]) => ({ context, state })),
    }),
  );

const GREEN = runs(
  ["build", "completed", "success"],
  ["Pages changed - reddoor-maintenance", "completed", "neutral"],
);

type Route = [RegExp, RunResult[]];

const SHA = "[0-9a-f]{40}";
const VIEW = (n: number) => new RegExp(`^gh api ${P}/pulls/${n}$`);
const RUNS = (sha = SHA) => new RegExp(`^gh api ${P}/commits/${sha}/check-runs\\?`);
const STATUSES = (sha = SHA) => new RegExp(`^gh api ${P}/commits/${sha}/status\\?`);
const COMMIT = (sha: string) => new RegExp(`^gh api ${P}/commits/${sha}$`);
const UPDATE = (n: number) => new RegExp(`^gh api ${P}/pulls/${n}/update-branch `);
const MERGE_CMD = (n: number) => new RegExp(`^gh api ${P}/pulls/${n}/merge `);
const DELETE = (branch = "feat/something") =>
  new RegExp(`^gh api ${P}/git/refs/heads/${branch} --method DELETE$`);
const REF = (branch = "feat/something") => new RegExp(`^gh api ${P}/git/ref/heads/${branch}$`);

const green: Route[] = [
  [RUNS(), [GREEN]],
  [STATUSES(), [statuses()]],
];
const landed = (n = 5): Route[] => [
  [
    MERGE_CMD(n),
    [ok(JSON.stringify({ sha: MERGE, merged: true, message: "Pull Request successfully merged" }))],
  ],
  [DELETE(), [ok()]],
];

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
  extra: { dryRun?: boolean; cleanup?: boolean; cwd?: string; checksTimeoutMin?: number } = {},
) {
  const { run, calls } = fakeRunner(routes);
  const lines: string[] = [];
  const sleeps: number[] = [];
  let clock = T0;
  const out = await landPrs({
    prs,
    repo: REPO,
    run,
    sleep: async (ms) => {
      if (sleeps.length >= 1_000) throw new Error("runaway: 1000 sleeps without an outcome");
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    log: (l) => lines.push(l),
    cwd: extra.cwd ?? "/repo",
    ...(extra.dryRun === undefined ? {} : { dryRun: extra.dryRun }),
    ...(extra.cleanup === undefined ? {} : { cleanup: extra.cleanup }),
    ...(extra.checksTimeoutMin === undefined ? {} : { checksTimeoutMin: extra.checksTimeoutMin }),
  });
  expect(calls.filter((c) => c.startsWith("gh ") && !c.startsWith(`gh api ${P}/`))).toEqual([]);
  return { ...out, calls, lines, sleeps };
}

const kindOf = (c: string) =>
  /\/check-runs\?/.test(c)
    ? "checks"
    : /\/update-branch /.test(c)
      ? "update-branch"
      : /\/merge /.test(c)
        ? "merge"
        : /--method DELETE/.test(c)
          ? "delete"
          : "";
const kinds = (calls: string[]) => calls.map(kindOf).filter(Boolean);
const pastTheRefusal = (calls: string[]) =>
  calls.filter((c) => /--method (PUT|DELETE)|\/check-runs\?|worktree remove|branch -D/.test(c));

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

describe("land-prs: REST shapes", () => {
  const PR_920 = {
    number: 920,
    title: "feat(recipes): analytics-tag — start GA4 on a site, and let the CSP run it",
    state: "open",
    merged: false,
    merged_at: null,
    draft: false,
    mergeable: true,
    mergeable_state: "clean",
    merge_commit_sha: "40d0da7effdc378de1dc46030ae1c6dc462b0522",
    head: {
      ref: "feat/analytics-recipe",
      sha: "4bfaa7446db961b44f2b274bc620648be965c2a0",
      repo: { full_name: REPO },
    },
    base: { ref: "feat/fleet-analytics", repo: { full_name: REPO } },
  };
  const PR_925 = {
    number: 925,
    title:
      "feat(hooks): cloud sessions reach laptop parity — setup hook, proxy CA for Chromium, Node 24, gh",
    state: "closed",
    merged: true,
    merged_at: "2026-09-28T04:13:49Z",
    draft: false,
    mergeable: null,
    mergeable_state: "unknown",
    merge_commit_sha: "219aee75c037f9e5f2d663c8d11ce8b8995a9f89",
    head: {
      ref: "claude/zen-maxwell-hl95jk",
      sha: "bca498cac6cf26dded9b75c6d09a5b333468e7b2",
      repo: { full_name: REPO },
    },
    base: { ref: "main", repo: { full_name: REPO } },
  };

  it("reads a real open PR, and ignores the test-merge sha REST reports on it", () => {
    expect(prFromRest(PR_920)).toEqual({
      number: 920,
      title: PR_920.title,
      state: "OPEN",
      isDraft: false,
      baseRefName: "feat/fleet-analytics",
      headRefName: "feat/analytics-recipe",
      headRefOid: "4bfaa7446db961b44f2b274bc620648be965c2a0",
      mergeStateStatus: "CLEAN",
      mergeCommit: null,
      sameRepo: true,
    });
  });

  it("reads a real merged PR as MERGED with its squash commit, and a closed one as CLOSED", () => {
    const v = prFromRest(PR_925);
    expect(v.state).toBe("MERGED");
    expect(v.mergeCommit).toEqual({ oid: "219aee75c037f9e5f2d663c8d11ce8b8995a9f89" });
    expect(prFromRest({ ...PR_920, state: "closed" }).state).toBe("CLOSED");
  });

  it("an uncomputed merge state is UNKNOWN, so the settle loops still run", () => {
    expect(
      prFromRest({ ...PR_920, mergeable: null, mergeable_state: "unknown" }).mergeStateStatus,
    ).toBe("UNKNOWN");
    expect(prFromRest({ ...PR_920, mergeable_state: undefined }).mergeStateStatus).toBe("UNKNOWN");
    expect(prFromRest({ ...PR_920, mergeable_state: "behind" }).mergeStateStatus).toBe("BEHIND");
  });

  it("a fork's head, or a deleted fork, is not the same repo", () => {
    const head = (repo: unknown) => ({ ...PR_920, head: { ...PR_920.head, repo } });
    expect(prFromRest(head({ full_name: "someone/reddoor-maintenance" })).sameRepo).toBe(false);
    expect(prFromRest(head(null)).sameRepo).toBe(false);
    expect(prFromRest(head({ full_name: "ReddoorLA/Reddoor-Maintenance" })).sameRepo).toBe(true);
  });

  it("buckets check runs and commit statuses the way gh pr checks does", () => {
    expect(
      checksFromRest(
        [
          { name: "build", status: "completed", conclusion: "success" },
          { name: "Header rules", status: "completed", conclusion: "neutral" },
          { name: "optional", status: "completed", conclusion: "skipped" },
          { name: "test", status: "completed", conclusion: "failure" },
          { name: "slow", status: "completed", conclusion: "timed_out" },
          { name: "boot", status: "completed", conclusion: "startup_failure" },
          { name: "approve", status: "completed", conclusion: "action_required" },
          { name: "superseded", status: "completed", conclusion: "cancelled" },
          { name: "e2e", status: "in_progress", conclusion: null },
          { name: "queued", status: "queued", conclusion: null },
        ],
        [
          { context: "renovate/stability-days", state: "success" },
          { context: "legacy-ci", state: "error" },
          { context: "deploy", state: "failure" },
          { context: "preview", state: "pending" },
        ],
      ).map((c) => `${c.name}=${c.bucket}`),
    ).toEqual([
      "build=pass",
      "Header rules=skipping",
      "optional=skipping",
      "test=fail",
      "slow=fail",
      "boot=fail",
      "approve=fail",
      "superseded=cancel",
      "e2e=pending",
      "queued=pending",
      "renovate/stability-days=pass",
      "legacy-ci=fail",
      "deploy=fail",
      "preview=pending",
    ]);
  });
});

describe("land-prs: which repo", () => {
  it("reads owner/repo from every remote URL form", () => {
    for (const url of [
      "https://github.com/reddoorla/reddoor-maintenance",
      "https://github.com/reddoorla/reddoor-maintenance.git\n",
      "https://github.com/reddoorla/reddoor-maintenance/",
      "https://x-access-token:secret@github.com/reddoorla/reddoor-maintenance.git",
      "git@github.com:reddoorla/reddoor-maintenance.git",
      "ssh://git@github.com/reddoorla/reddoor-maintenance.git",
    ]) {
      expect(repoFromRemoteUrl(url)).toBe(REPO);
    }
    expect(repoFromRemoteUrl("")).toBe("");
    expect(repoFromRemoteUrl("not-a-remote")).toBe("");
  });

  it("asks REST, not gh repo view, for the name GitHub uses", async () => {
    const { run, calls } = fakeRunner([
      [/^git remote get-url origin$/, [ok("git@github.com:tucksravin/invitations.git\n")]],
      [
        /^gh api repos\/tucksravin\/invitations --jq \.full_name$/,
        [ok("tucksravin/invitations\n")],
      ],
    ]);
    expect(await resolveRepo({ run, cwd: "/repo" })).toEqual({ repo: "tucksravin/invitations" });
    expect(calls.some((c) => /^gh (repo|pr) /.test(c))).toBe(false);
  });

  it("says why when it cannot tell", async () => {
    const noOrigin = fakeRunner([
      [/^git remote/, [{ code: 2, stdout: "", stderr: "error: No such remote 'origin'\n" }]],
    ]);
    expect((await resolveRepo({ run: noOrigin.run })).error).toBe(
      "git remote get-url origin failed: error: No such remote 'origin'",
    );
    const notAttached = fakeRunner([
      [/^git remote/, [ok("https://github.com/reddoorla/other-site\n")]],
      [/^gh api /, [httpError(403, "Forbidden")]],
    ]);
    expect((await resolveRepo({ run: notAttached.run })).error).toBe(
      "gh api repos/reddoorla/other-site failed: gh: Forbidden (HTTP 403)",
    );
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
      expect(pastTheRefusal(r.calls)).toEqual([]);
      expect(r.calls.some((c) => /\/pulls\/9\b/.test(c))).toBe(false);
    }
  });

  it("skips an already-merged PR and carries on to the next one", async () => {
    const r = await land(
      [852, 5],
      [
        [VIEW(852), [view({ number: 852, state: "MERGED" })]],
        [VIEW(5), [view(), view(), merged()]],
        ...green,
        ...landed(),
      ],
    );
    expect(r.code).toBe(0);
    expect(r.lines).toContain("LAND #852 skipped reason=already merged");
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A}`);
    expect(r.calls.filter((c) => c.includes("/pulls/852/"))).toEqual([]);
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
      expect(pastTheRefusal(r.calls)).toEqual([]);
    }
  });

  it("a view GitHub refuses stops with the call and its reason", async () => {
    const r = await land([5], [[VIEW(5), [httpError(404, "Not Found")]]]);
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      `LAND #5 stopped reason=gh api pulls/5 failed: gh: Not Found (HTTP 404)`,
    );
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
            merged(),
          ],
        ],
        [UPDATE(5), [ok(JSON.stringify({ message: "Updating pull request branch." }))]],
        ...green,
        ...landed(),
      ],
    );
    expect(r.code).toBe(0);
    expect(r.sleeps[0]).toBe(25_000);
    expect(kinds(r.calls)).toEqual(["update-branch", "checks", "merge", "delete"]);
    expect(r.calls.find((c) => UPDATE(5).test(c))).toBe(
      `gh api ${P}/pulls/5/update-branch --method PUT -f expected_head_sha=${A}`,
    );
    expect(r.calls.some((c) => RUNS(B).test(c))).toBe(true);
    expect(r.calls.some((c) => RUNS(A).test(c))).toBe(false);
    const mergeCall = r.calls.find((c) => MERGE_CMD(5).test(c))!;
    expect(mergeCall).toBe(
      `gh api ${P}/pulls/5/merge --method PUT -f merge_method=squash -f sha=${B}`,
    );
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
            merged(),
          ],
        ],
        ...green,
        ...landed(),
      ],
    );
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => RUNS(A).test(c))).toHaveLength(1);
    expect(r.calls.filter((c) => RUNS(C).test(c))).toHaveLength(1);
    expect(r.lines.some((l) => l.includes("head moved during checks aaaaaaa -> ccccccc"))).toBe(
      true,
    );
    const mergeCall = r.calls.find((c) => MERGE_CMD(5).test(c))!;
    expect(mergeCall).toContain(`sha=${C}`);
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
            merged(),
          ],
        ],
        [UPDATE(5), [ok()]],
        ...green,
        ...landed(),
      ],
    );
    expect(r.code).toBe(0);
    expect(r.sleeps.slice(0, 2)).toEqual([10_000, 25_000]);
    expect(kinds(r.calls)).toEqual(["update-branch", "checks", "merge", "delete"]);
    expect(r.lines.some((l) => l.startsWith("LAND #5 open head=aaaaaaa merge=BEHIND"))).toBe(true);
    expect(r.calls.find((c) => MERGE_CMD(5).test(c))).toContain(`sha=${B}`);
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
            merged(),
          ],
        ],
        [UPDATE(5), [ok()]],
        ...green,
        ...landed(),
      ],
    );
    expect(r.code).toBe(0);
    expect(kinds(r.calls)).toEqual(["checks", "update-branch", "checks", "merge", "delete"]);
    expect(r.lines).toContain("LAND #5 BEHIND at the gate on aaaaaaa; updating again");
    const mergeCall = r.calls.find((c) => MERGE_CMD(5).test(c))!;
    expect(mergeCall).toContain(`sha=${B}`);
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
        [UPDATE(5), [ok()]],
        ...green,
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      "LAND #5 stopped reason=still BEHIND after 3 check rounds on ccccccc: main kept moving",
    );
    expect(r.calls.filter((c) => UPDATE(5).test(c))).toHaveLength(2);
    expect(r.calls.some((c) => MERGE_CMD(5).test(c))).toBe(false);
  });

  it("an update-branch GitHub refuses stops, saying why", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view({ mergeStateStatus: "BEHIND" })]],
        [UPDATE(5), [httpError(422, "expected head sha didn’t match current head ref.")]],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      "LAND #5 stopped reason=update-branch failed: gh: expected head sha didn’t match current head ref. (HTTP 422)",
    );
    expect(kinds(r.calls)).toEqual(["update-branch"]);
  });

  it("failing checks stop the run at once with the failing names, and later PRs are never touched", async () => {
    const r = await land(
      [5, 6, 7],
      [
        [VIEW(5), [view()]],
        [
          RUNS(A),
          [
            runs(
              ["test", "completed", "failure"],
              ["lint", "completed", "success"],
              ["e2e", "completed", "cancelled"],
              ["slow", "in_progress", null],
            ),
          ],
        ],
        [STATUSES(A), [statuses()]],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(`LAND #5 stopped reason=checks failed on aaaaaaa: test, e2e`);
    expect(r.sleeps).toEqual([]);
    expect(r.calls.some((c) => MERGE_CMD(5).test(c))).toBe(false);
    expect(r.calls.some((c) => /\/pulls\/(6|7)\b/.test(c))).toBe(false);
    expect(r.results.map((x) => x.pr)).toEqual([5]);
  });

  it("a merge state other than CLEAN after the checks stops the run, naming the state", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view({ mergeStateStatus: "CLEAN" }), view({ mergeStateStatus: "UNSTABLE" })]],
        ...green,
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe("LAND #5 stopped reason=mergeStateStatus=UNSTABLE on aaaaaaa");
    expect(r.calls.some((c) => MERGE_CMD(5).test(c))).toBe(false);
  });

  it("the merge GitHub refuses because the head moved after the gate stops, and deletes nothing", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        ...green,
        [
          MERGE_CMD(5),
          [httpError(409, "Head branch was modified. Review and try the merge again.")],
        ],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      "LAND #5 stopped reason=merge did not land (state=OPEN): gh: Head branch was modified. Review and try the merge again. (HTTP 409)",
    );
    expect(kinds(r.calls)).toEqual(["checks", "merge"]);
  });

  it("a merge call that fails after the merge landed is a note, not a stop: the view is the verdict", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view(), view(), merged()]],
        ...green,
        [MERGE_CMD(5), [{ code: 1, stdout: "", stderr: "", timedOut: true }]],
        [DELETE(), [ok()]],
      ],
    );
    expect(r.code).toBe(0);
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A}`);
    expect(r.lines).toContain(
      "LAND #5 note: the merge call failed but the PR is MERGED: timed out with no output",
    );
  });

  it("a merge that did NOT land stops, even when the merge call succeeded (control for the case above)", async () => {
    const r = await land([5], [[VIEW(5), [view()]], ...green, ...landed()]);
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toMatch(/^LAND #5 stopped reason=merge did not land \(state=OPEN\)/);
    expect(r.sleeps).toEqual([5_000, 5_000]);
    expect(kinds(r.calls)).toEqual(["checks", "merge"]);
  });
});

describe("land-prs: waiting for checks", () => {
  it("polls pending checks every 10 s until they pass", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view(), view(), merged()]],
        [RUNS(A), [runs(["build", "queued", null]), runs(["build", "in_progress", null]), GREEN]],
        [STATUSES(A), [statuses()]],
        ...landed(),
      ],
    );
    expect(r.code).toBe(0);
    expect(r.sleeps).toEqual([10_000, 10_000]);
    expect(r.calls.filter((c) => RUNS(A).test(c))).toHaveLength(3);
    expect(r.lines).toContain("LAND #5 checks passed on aaaaaaa");
  });

  it("a check still pending at the timeout stops the run, naming it", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [RUNS(A), [runs(["build", "completed", "success"], ["e2e", "in_progress", null])]],
        [STATUSES(A), [statuses(["preview", "pending"])]],
      ],
      { checksTimeoutMin: 1 },
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      "LAND #5 stopped reason=checks still running after 1 min on aaaaaaa: e2e, preview",
    );
    expect(r.sleeps).toEqual(Array(6).fill(10_000));
    expect(r.calls.some((c) => MERGE_CMD(5).test(c))).toBe(false);
  });

  it("a combined status of 'pending' with no statuses behind it is not a pending check", async () => {
    // GET commits/{sha}/status answers {"state":"pending","total_count":0} for a commit
    // nothing has ever posted a status to (#920's head on 2026-09-28).
    const r = await land([5], [[VIEW(5), [view(), view(), merged()]], ...green, ...landed()]);
    expect(r.code).toBe(0);
    expect(r.sleeps).toEqual([]);
  });

  it("a cancelled check does not fail the wait, as in gh pr checks; the CLEAN gate still decides", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view(), view(), merged()]],
        [
          RUNS(A),
          [runs(["build", "completed", "success"], ["claude-review", "completed", "cancelled"])],
        ],
        [STATUSES(A), [statuses()]],
        ...landed(),
      ],
    );
    expect(r.code).toBe(0);
    expect(r.lines).toContain("LAND #5 checks passed on aaaaaaa");
  });

  it("commit statuses are checks: a status-only head passes, and a failed status stops", async () => {
    const pass = await land(
      [5],
      [
        [VIEW(5), [view(), view(), merged()]],
        [RUNS(A), [runs()]],
        [STATUSES(A), [statuses(["renovate/stability-days", "success"])]],
        ...landed(),
      ],
    );
    expect(pass.code).toBe(0);
    expect(pass.calls.some((c) => COMMIT(A).test(c))).toBe(false);

    const fail = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [RUNS(A), [GREEN]],
        [STATUSES(A), [statuses(["renovate/stability-days", "success"], ["legacy-ci", "error"])]],
      ],
    );
    expect(fail.lines.at(-1)).toBe("LAND #5 stopped reason=checks failed on aaaaaaa: legacy-ci");
  });

  it("reads every page of check runs, so a failure on page 2 is not missed", async () => {
    const page1 = ok(
      JSON.stringify({
        total_count: 101,
        check_runs: Array.from({ length: 100 }, (_, i) => ({
          name: `shard ${i}`,
          status: "completed",
          conclusion: "success",
        })),
      }),
    );
    const page2 = ok(
      JSON.stringify({
        total_count: 101,
        check_runs: [{ name: "shard 100", status: "completed", conclusion: "failure" }],
      }),
    );
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [
          new RegExp(`^gh api ${P}/commits/${A}/check-runs\\?filter=latest&per_page=100&page=1$`),
          [page1],
        ],
        [
          new RegExp(`^gh api ${P}/commits/${A}/check-runs\\?filter=latest&per_page=100&page=2$`),
          [page2],
        ],
        [STATUSES(A), [statuses()]],
      ],
    );
    expect(r.lines.at(-1)).toBe("LAND #5 stopped reason=checks failed on aaaaaaa: shard 100");
  });

  it("checks GitHub will not return stop the run with the call and its reason", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [RUNS(A), [httpError(502, "Server Error")]],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      `LAND #5 stopped reason=gh api commits/${A}/check-runs?filter=latest&per_page=100&page=1 failed: gh: Server Error (HTTP 502)`,
    );
  });

  it("an old head with no checks stops after the short budget", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [RUNS(A), [runs()]],
        [STATUSES(A), [statuses()]],
        [
          COMMIT(A),
          [ok(JSON.stringify({ commit: { committer: { date: "2026-09-28T11:00:00Z" } } }))],
        ],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe("LAND #5 stopped reason=no checks reported on aaaaaaa after 60s");
    expect(r.sleeps).toEqual([20_000, 20_000, 20_000]);
  });

  it("a fresh head with no checks yet gets the long budget, and lands once they register", async () => {
    // .github#35: the head landed at 04:47:14Z and Actions registered `validate` 3.5 min later.
    const r = await land(
      [5],
      [
        [VIEW(5), [view(), view(), merged()]],
        [RUNS(A), [runs(), runs(), runs(), runs(), runs(), runs(), GREEN]],
        [STATUSES(A), [statuses()]],
        [
          COMMIT(A),
          [ok(JSON.stringify({ commit: { committer: { date: "2026-09-28T11:58:00Z" } } }))],
        ],
        ...landed(),
      ],
    );
    expect(r.code).toBe(0);
    expect(r.lines).toContain("LAND #5 head is fresh — waiting up to 15 rounds for a first check");
    expect(r.sleeps).toEqual(Array(6).fill(20_000));
    expect(r.calls.filter((c) => COMMIT(A).test(c))).toHaveLength(1);
  });
});

describe("land-prs: deleting the head branch", () => {
  const through = (routes: Route[], over: Partial<Model> = {}): Route[] => [
    [VIEW(5), [view(over), view(over), merged()]],
    ...green,
    [MERGE_CMD(5), [ok(JSON.stringify({ sha: MERGE, merged: true }))]],
    ...routes,
  ];

  it("deletes it after the merge, and says nothing when that worked", async () => {
    const r = await land([5], through([[DELETE(), [ok()]]]));
    expect(r.code).toBe(0);
    expect(kinds(r.calls)).toEqual(["checks", "merge", "delete"]);
    expect(r.lines.some((l) => l.includes("note:"))).toBe(false);
  });

  it("the cloud proxy refuses the delete, but GitHub already removed the branch: no note", async () => {
    // Measured 2026-09-28: the proxy answers DELETE git/refs/… with 403, and
    // reddoor-maintenance has delete_branch_on_merge on, so #925's branch was already 404.
    const r = await land(
      [5],
      through([
        [DELETE(), [PROXY_403]],
        [REF(), [ok(JSON.stringify({ object: { sha: A } })), httpError(404, "Not Found")]],
      ]),
    );
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => REF().test(c))).toHaveLength(2);
    expect(r.lines.some((l) => l.includes("note:"))).toBe(false);
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A}`);
  });

  it("a refused delete that leaves the branch is a note, not a stop", async () => {
    const r = await land(
      [5],
      through([
        [DELETE(), [PROXY_403]],
        [REF(), [ok(JSON.stringify({ object: { sha: A } }))]],
      ]),
    );
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => REF().test(c))).toHaveLength(3);
    expect(r.lines).toContain(
      "LAND #5 note: branch feat/something is still on GitHub: delete failed: gh: Write access to this GitHub API path is not permitted through this proxy. (HTTP 403)",
    );
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A}`);
  });

  it("422 on the delete means the branch is already gone, as gh treated it", async () => {
    const r = await land([5], through([[DELETE(), [httpError(422, "Reference does not exist")]]]));
    expect(r.code).toBe(0);
    expect(r.calls.some((c) => REF().test(c))).toBe(false);
    expect(r.lines.some((l) => l.includes("note:"))).toBe(false);
  });

  it("never deletes a branch that lives on a fork", async () => {
    const r = await land([5], through([], { headRepo: "someone/reddoor-maintenance" }));
    expect(r.code).toBe(0);
    expect(kinds(r.calls)).toEqual(["checks", "merge"]);
  });

  it("encodes a branch name GitHub would otherwise read as a URL fragment", async () => {
    const r = await land(
      [5],
      through([[DELETE("fix/%23123-thing"), [ok()]]], { headRefName: "fix/#123-thing" }),
    );
    expect(r.code).toBe(0);
    expect(r.calls).toContain(`gh api ${P}/git/refs/heads/fix/%23123-thing --method DELETE`);
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
    [VIEW(5), [view(), view(), merged()]],
    ...green,
    ...landed(),
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
    expect(r.calls.every((c) => /^gh api \S+\/pulls\/\d+$/.test(c))).toBe(true);
    expect(r.lines).toContain("LAND #852 skipped reason=already merged");
    expect(r.lines.some((l) => l.startsWith("LAND #5 dry-run would: update-branch"))).toBe(true);
    expect(r.sleeps).toEqual([]);
  });

  it("names the sha a CLEAN PR would merge on, and the branch it would delete", async () => {
    const r = await land([5], [[VIEW(5), [view()]]], { dryRun: true });
    expect(r.lines).toContain(
      `LAND #5 dry-run would: wait for checks (≤ 20 min); require CLEAN; merge --squash pinned to sha=${A}; delete branch feat/something`,
    );
    const fork = await land([5], [[VIEW(5), [view({ headRepo: "someone/fork" })]]], {
      dryRun: true,
    });
    expect(fork.lines.some((l) => l.includes("delete branch"))).toBe(false);
  });
});
