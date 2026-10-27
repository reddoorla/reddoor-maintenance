import { describe, it, expect } from "vitest";
import {
  landPrs,
  parseArgs,
  parseWorktreeList,
  ghFailureDetail,
  noChecksRetriesFor,
  refusal,
  prFromRest,
  checkBucket,
  checksFromRest,
  refPath,
  repoFromRemoteUrl,
  resolveRepo,
  isReadOnlyApiCall,
  isTransientReadFailure,
  chooseMergeMethod,
  isTestFile,
  testChangeFlags,
  testChangesSection,
  unnamedTestChanges,
  type RunResult,
  type PrFile,
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
  body: string | null;
  changedFiles?: number;
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
    body: "",
    ...over,
  };
  const merged = m.state === "MERGED";
  return ok(
    JSON.stringify({
      number: m.number,
      title: m.title,
      body: m.body,
      ...(m.changedFiles === undefined ? {} : { changed_files: m.changedFiles }),
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
const ANY_BRANCH = "[\\w./-]+";
const VIEW = (n: number) => new RegExp(`^gh api ${P}/pulls/${n}$`);
const RUNS = (sha = SHA) => new RegExp(`^gh api ${P}/commits/${sha}/check-runs\\?`);
const STATUSES = (sha = SHA) => new RegExp(`^gh api ${P}/commits/${sha}/status\\?`);
const COMMIT = (sha: string) => new RegExp(`^gh api ${P}/commits/${sha}$`);
const UPDATE = (n: number) => new RegExp(`^gh api ${P}/pulls/${n}/update-branch `);
const MERGE_CMD = (n: number) => new RegExp(`^gh api ${P}/pulls/${n}/merge `);
const DELETE = (branch = "feat/something") =>
  new RegExp(`^gh api ${P}/git/refs/heads/${branch} --method DELETE$`);
const REF = (branch = "feat/something") => new RegExp(`^gh api ${P}/git/ref/heads/${branch}$`);
const REPO_META = new RegExp(`^gh api ${P}$`);
const FILES = (n: number | string = "\\d+") =>
  new RegExp(`^gh api ${P}/pulls/${n}/files\\?per_page=100&page=\\d+$`);
const FILES_PAGE = (n: number, page: number) =>
  new RegExp(`^gh api ${P}/pulls/${n}/files\\?per_page=100&page=${page}$`);
const RULES = (branch = "main") =>
  new RegExp(`^gh api ${P}/rules/branches/${branch}\\?per_page=100&page=\\d+$`);

const repoMeta = (over: Record<string, boolean> = {}): RunResult =>
  ok(
    JSON.stringify({
      full_name: REPO,
      allow_squash_merge: true,
      allow_merge_commit: true,
      allow_rebase_merge: true,
      ...over,
    }),
  );

type Rule = { type: string; ruleset_id?: number; parameters?: Record<string, unknown> };
const pullRequestRule = (methods: string[], ruleset_id = 20165612): Rule => ({
  type: "pull_request",
  ruleset_id,
  parameters: { required_approving_review_count: 0, allowed_merge_methods: methods },
});
const rules = (...rs: Rule[]): RunResult => ok(JSON.stringify(rs));

// This repo's own `main` as GET rules/branches/main answered on 2026-10-04: linear history
// required and the pull_request rule allowing all three methods.
const MAINTENANCE_MAIN_RULES = rules(
  { type: "deletion", ruleset_id: 1 },
  { type: "required_linear_history", ruleset_id: 1 },
  pullRequestRule(["merge", "squash", "rebase"], 1),
);
// The files a PR changed: none by default, so a test that is not about test changes never
// trips the test-change gate. A test about them routes `FILES(n)` ahead of this one.
const methodRoutes: Route[] = [
  [REPO_META, [repoMeta()]],
  [RULES(ANY_BRANCH), [MAINTENANCE_MAIN_RULES]],
  [FILES(), [ok("[]")]],
];

// What Netlify posts on this repo's heads, about 2 s before Actions registers `build`
// (#953's head, 2026-09-29: the three neutral runs at 05:48:56Z, `build` at 05:48:58Z).
const NETLIFY: CheckRun[] = [
  ["Header rules - reddoor-maintenance", "completed", "neutral"],
  ["Pages changed - reddoor-maintenance", "completed", "neutral"],
  ["Redirect rules - reddoor-maintenance", "completed", "neutral"],
];

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
  extra: {
    dryRun?: boolean;
    cleanup?: boolean;
    cwd?: string;
    checksTimeoutMin?: number;
    base?: string;
  } = {},
) {
  const { run, calls } = fakeRunner([...routes, ...methodRoutes]);
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
    ...(extra.base === undefined ? {} : { base: extra.base }),
  });
  expect(
    calls.filter(
      (c) => c.startsWith("gh ") && !c.startsWith(`gh api ${P}/`) && c !== `gh api ${P}`,
    ),
  ).toEqual([]);
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
      body: "",
      changedFiles: null,
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

  it("an unrecognised state is pending, never pass: the default is the fail-safe one", () => {
    // `waiting` / `requested` / `pending` are check-run statuses (deployment protection,
    // re-requested runs), `stale` a conclusion GitHub gives a run left incomplete, and
    // `expected` the GraphQL status state for a required context nobody has posted.
    for (const state of [
      "waiting",
      "requested",
      "pending",
      "queued",
      "in_progress",
      "stale",
      "expected",
      "a_state_github_adds_tomorrow",
      "",
      null,
      undefined,
    ]) {
      expect([state, checkBucket(state)]).toEqual([state, "pending"]);
    }
    expect(
      checksFromRest(
        [
          { name: "deploy", status: "waiting", conclusion: null },
          { name: "rerun", status: "requested", conclusion: null },
          { name: "old", status: "completed", conclusion: "stale" },
        ],
        [{ context: "required-ci", state: "expected" }],
      ).map((c) => `${c.name}=${c.bucket}`),
    ).toEqual(["deploy=pending", "rerun=pending", "old=pending", "required-ci=pending"]);
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
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A} method=squash`);
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

  it("a 200 whose body is not JSON stops, saying so, instead of reading as an empty object", async () => {
    for (const [body, said] of [
      ["<html><body>502 Bad Gateway</body></html>", "<html><body>502 Bad Gateway</body></html>"],
      ["", "an empty body"],
    ] as const) {
      const r = await land([5], [[VIEW(5), [ok(body)]]]);
      expect(r.code).toBe(1);
      expect(r.lines.at(-1)).toBe(
        `LAND #5 stopped reason=gh api pulls/5 returned no JSON: ${said}`,
      );
    }
  });

  it("the refusals run again at the gate: a PR retargeted, retitled as a release or made a draft during the checks wait is not merged", async () => {
    for (const [over, reason] of [
      [{ baseRefName: "next" }, "base is next, not main (pass --base next to allow it)"],
      [
        { title: "chore(release): version packages" },
        'release PR (title "chore(release): version packages", head feat/something) — always human, AUTONOMY.md §Merge authority',
      ],
      // GitHub reports a draft's mergeable_state as "draft".
      [{ isDraft: true, mergeStateStatus: "DRAFT" }, "draft"],
    ] as const) {
      const r = await land([5], [[VIEW(5), [view(), view(over)]], ...green, ...landed()]);
      expect(r.code).toBe(1);
      expect(r.lines.at(-1)).toBe(
        `LAND #5 stopped reason=${reason}; seen after the checks wait on aaaaaaa`,
      );
      expect(kinds(r.calls)).toEqual(["checks"]);
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
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${B} method=squash`);
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
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A} method=squash`);
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

  it("a merge call that succeeds but leaves the PR CLOSED, not merged, is not landed: stop, delete nothing", async () => {
    const r = await land(
      [5, 6],
      [[VIEW(5), [view(), view(), view({ state: "CLOSED" })]], ...green, ...landed()],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      "LAND #5 stopped reason=merge did not land (state=CLOSED): the merge call succeeded",
    );
    expect(kinds(r.calls)).toEqual(["checks", "merge"]);
    expect(r.lines.some((l) => / merged /.test(l))).toBe(false);
    expect(r.results.map((x) => x.status)).toEqual(["stopped"]);
    expect(r.calls.some((c) => /\/pulls\/6\b/.test(c))).toBe(false);
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

  it("reads every page of commit statuses, so a failure on page 2 is not missed", async () => {
    const page = (ss: Array<{ context: string; state: string }>) =>
      ok(JSON.stringify({ state: "failure", total_count: 101, statuses: ss }));
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [RUNS(A), [GREEN]],
        [
          new RegExp(`^gh api ${P}/commits/${A}/status\\?per_page=100&page=1$`),
          [
            page(
              Array.from({ length: 100 }, (_, i) => ({ context: `ctx ${i}`, state: "success" })),
            ),
          ],
        ],
        [
          new RegExp(`^gh api ${P}/commits/${A}/status\\?per_page=100&page=2$`),
          [page([{ context: "ctx 100", state: "failure" }])],
        ],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe("LAND #5 stopped reason=checks failed on aaaaaaa: ctx 100");
    expect(r.calls.some((c) => MERGE_CMD(5).test(c))).toBe(false);
  });

  it("a check in a state it does not recognise holds the gate until the timeout, and never merges", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [
          RUNS(A),
          [
            runs(
              ["build", "completed", "success"],
              ["deploy", "waiting", null],
              ["old", "completed", "stale"],
            ),
          ],
        ],
        [STATUSES(A), [statuses(["required-ci", "expected"])]],
      ],
      { checksTimeoutMin: 1 },
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      "LAND #5 stopped reason=checks still running after 1 min on aaaaaaa: deploy, old, required-ci",
    );
    expect(r.calls.some((c) => MERGE_CMD(5).test(c))).toBe(false);
  });

  it("neutral-only checks are not a verdict: it waits, and gates on build once Actions registers it", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view(), view(), merged()]],
        [
          RUNS(A),
          [
            runs(...NETLIFY),
            runs(...NETLIFY, ["build", "in_progress", null]),
            runs(...NETLIFY, ["build", "completed", "success"]),
          ],
        ],
        [STATUSES(A), [statuses()]],
        [
          COMMIT(A),
          [ok(JSON.stringify({ commit: { committer: { date: "2026-09-28T11:59:50Z" } } }))],
        ],
        ...landed(),
      ],
    );
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => RUNS(A).test(c))).toHaveLength(3);
    // one no-checks round for the neutral-only poll, then one pending round for build
    expect(r.sleeps).toEqual([20_000, 10_000]);
    expect(r.lines).toContain("LAND #5 checks passed on aaaaaaa");
    expect(r.calls.find((c) => MERGE_CMD(5).test(c))).toContain(`sha=${A}`);
  });

  it("checks that are only neutral, skipped or cancelled, forever, stop with the reason and never merge", async () => {
    for (const [only, named] of [
      [
        NETLIFY,
        "Header rules - reddoor-maintenance (skipping), Pages changed - reddoor-maintenance (skipping), Redirect rules - reddoor-maintenance (skipping)",
      ],
      [
        [
          ["optional", "completed", "skipped"],
          ["claude-review", "completed", "cancelled"],
        ] as CheckRun[],
        "optional (skipping), claude-review (cancel)",
      ],
    ] as const) {
      const r = await land(
        [5],
        [
          [VIEW(5), [view()]],
          [RUNS(A), [runs(...only)]],
          [STATUSES(A), [statuses()]],
          [
            COMMIT(A),
            [ok(JSON.stringify({ commit: { committer: { date: "2026-09-28T11:00:00Z" } } }))],
          ],
          ...landed(),
        ],
      );
      expect(r.code).toBe(1);
      expect(r.lines.at(-1)).toBe(
        `LAND #5 stopped reason=no check passed on aaaaaaa after 60s, only ${named}`,
      );
      expect(r.sleeps).toEqual([20_000, 20_000, 20_000]);
      expect(r.calls.some((c) => MERGE_CMD(5).test(c))).toBe(false);
    }
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
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A} method=squash`);
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
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A} method=squash`);
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

  it("leaves @ in a dependabot branch literal, because the cloud proxy 400s on any percent-encoded path", async () => {
    const branch = "dependabot/npm_and_yarn/@types/node-22.1.0";
    const r = await land([5], through([[DELETE(branch), [ok()]]], { headRefName: branch }));
    expect(r.code).toBe(0);
    expect(r.calls).toContain(`gh api ${P}/git/refs/heads/${branch} --method DELETE`);
    expect(refPath("renovate/foo+bar@2,x=y")).toBe("renovate/foo+bar@2,x=y");
    expect(refPath("fix/100%-#1")).toBe("fix/100%25-%231");
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
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A} method=squash`);
    expect(r.lines).toContain(
      "LAND #5 cleanup left /repo/.claude/worktrees/mine: 2 uncommitted changes",
    );
    expect(r.calls.some((c) => c.startsWith("git worktree remove"))).toBe(false);
    expect(r.calls.some((c) => c.startsWith("git branch"))).toBe(false);
  });
});

/**
 * 2026-10-04: reddoor-website#240 could not land on that repo's `main`. The merge answered
 * 405 "Squash merges are not allowed on this repository" with `allow_squash_merge: true`,
 * because ruleset 20165612's pull_request rule allows only `merge`. The method is now read
 * from the repo flags AND the rules in force on the base; squash stays the first choice.
 */
describe("land-prs: merge method", () => {
  // reddoor-website's `main` as GET rules/branches/main answered on 2026-10-04.
  const WEBSITE_MAIN_RULES = rules(
    { type: "deletion", ruleset_id: 20165612 },
    { type: "non_fast_forward", ruleset_id: 20165612 },
    pullRequestRule(["merge"]),
    {
      type: "required_status_checks",
      ruleset_id: 20165612,
      parameters: { strict_required_status_checks_policy: true },
    },
  );
  const mergedWith = (n = 5) =>
    `gh api ${P}/pulls/${n}/merge --method PUT -f merge_method=merge -f sha=${A}`;

  it("a ruleset allowing only merge lands with a merge commit, pinned to the gated head", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view(), view(), merged()]],
        [RULES(), [WEBSITE_MAIN_RULES]],
        ...green,
        ...landed(),
      ],
    );
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => MERGE_CMD(5).test(c))).toEqual([mergedWith()]);
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A} method=merge`);
    expect(r.lines.some((l) => l.startsWith("LAND #5 open") && l.includes("method=merge"))).toBe(
      true,
    );
    expect(kinds(r.calls)).toEqual(["checks", "merge", "delete"]);
  });

  it("no ruleset restriction keeps squash", async () => {
    for (const none of [
      rules(),
      rules({ type: "deletion", ruleset_id: 22843978 }),
      rules({
        type: "pull_request",
        ruleset_id: 3,
        parameters: { required_approving_review_count: 1 },
      }),
    ]) {
      const r = await land(
        [5],
        [[VIEW(5), [view(), view(), merged()]], [RULES(), [none]], ...green, ...landed()],
      );
      expect(r.code).toBe(0);
      expect(r.calls.filter((c) => MERGE_CMD(5).test(c))).toEqual([
        `gh api ${P}/pulls/5/merge --method PUT -f merge_method=squash -f sha=${A}`,
      ]);
    }
  });

  it("a ruleset allowing nothing the repo allows refuses before any check is watched", async () => {
    const r = await land(
      [5, 6],
      [
        [VIEW(5), [view()]],
        [REPO_META, [repoMeta({ allow_squash_merge: false })]],
        [RULES(), [rules(pullRequestRule(["squash"]))]],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      "LAND #5 stopped reason=no merge method is allowed: repo allows merge/rebase; ruleset 20165612 allows squash (base main)",
    );
    expect(pastTheRefusal(r.calls)).toEqual([]);
    expect(r.calls.some((c) => /\/pulls\/6\b/.test(c))).toBe(false);
  });

  it("a rules read that fails stops the run before any check is watched", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [RULES(), [httpError(500, "Server Error")]],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      "LAND #5 stopped reason=gh api rules/branches/main?per_page=100&page=1 failed: gh: Server Error (HTTP 500)",
    );
    expect(pastTheRefusal(r.calls)).toEqual([]);
  });

  it("a 403 or 404 on the rules is read as no rulesets: a note, and the repo flags decide", async () => {
    for (const refused of [
      httpError(
        403,
        "Upgrade to GitHub Pro or make this repository public to enable this feature.",
      ),
      httpError(404, "Not Found"),
    ]) {
      const r = await land(
        [5],
        [
          [VIEW(5), [view()]],
          [REPO_META, [repoMeta({ allow_squash_merge: false })]],
          [RULES(), [refused]],
        ],
        { dryRun: true },
      );
      expect(r.code).toBe(0);
      expect(r.lines).toContain(
        `LAND #5 note: no rules read for main, choosing from the repo flags alone: ${firstLineOf(refused)}`,
      );
      expect(r.lines.some((l) => l.includes(`merge --merge pinned to sha=${A}`))).toBe(true);
    }
  });

  it("a rules read that fails in transport is retried, then decides", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [
          RULES(),
          [{ code: 1, stdout: "", stderr: "gh: HTTP 502\n" }, rules(pullRequestRule(["merge"]))],
        ],
      ],
      { dryRun: true },
    );
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => RULES().test(c))).toHaveLength(2);
    expect(r.lines.some((l) => l.includes(`merge --merge pinned to sha=${A}`))).toBe(true);
  });

  it("a rules endpoint that never stops paging stops the run after ten pages", async () => {
    const full = rules(
      ...Array.from({ length: 100 }, (_, i) => ({ type: "deletion", ruleset_id: i })),
    );
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [RULES(), [full]],
      ],
      { dryRun: true },
    );
    expect(r.code).toBe(1);
    expect(r.calls.filter((c) => RULES().test(c))).toHaveLength(10);
    expect(r.lines.at(-1)).toBe(
      "LAND #5 stopped reason=gh api rules/branches/main still had rules after 10 pages",
    );
  });

  it("reads every page of the rules: a merge-only rule on page 2 still decides", async () => {
    const filler = Array.from({ length: 100 }, (_, i) => ({ type: "deletion", ruleset_id: i }));
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [RULES(), [rules(...filler), WEBSITE_MAIN_RULES]],
      ],
      { dryRun: true },
    );
    expect(r.calls.filter((c) => RULES().test(c))).toEqual([
      `gh api ${P}/rules/branches/main?per_page=100&page=1`,
      `gh api ${P}/rules/branches/main?per_page=100&page=2`,
    ]);
    expect(r.lines.some((l) => l.includes(`merge --merge pinned to sha=${A}`))).toBe(true);
  });

  it("--dry-run names the method it would merge with", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view()]],
        [RULES(), [WEBSITE_MAIN_RULES]],
      ],
      {
        dryRun: true,
      },
    );
    expect(r.lines).toContain(
      `LAND #5 dry-run would: wait for checks (≤ 20 min); require CLEAN; merge --merge pinned to sha=${A}; delete branch feat/something`,
    );
  });

  it("the rules are read for the PR's own base", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view({ baseRefName: "staging" })]],
        [RULES("staging"), [rules({ type: "deletion", ruleset_id: 22843978 })]],
        [RULES(), [WEBSITE_MAIN_RULES]],
      ],
      { dryRun: true, base: "staging" },
    );
    expect(r.calls.some((c) => RULES("staging").test(c))).toBe(true);
    expect(r.calls.some((c) => RULES().test(c))).toBe(false);
    expect(r.lines.some((l) => l.includes("merge --squash pinned"))).toBe(true);
  });

  describe("chooseMergeMethod", () => {
    const all = { allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true };
    it("prefers squash, then merge, then rebase", () => {
      expect(chooseMergeMethod(all, [])).toEqual({ method: "squash" });
      expect(chooseMergeMethod({ ...all, allow_squash_merge: false }, [])).toEqual({
        method: "merge",
      });
      expect(
        chooseMergeMethod({ ...all, allow_squash_merge: false, allow_merge_commit: false }, []),
      ).toEqual({ method: "rebase" });
    });

    it("intersects every pull_request rule, from every ruleset", () => {
      expect(
        chooseMergeMethod(all, [
          pullRequestRule(["merge", "rebase"], 1),
          pullRequestRule(["rebase", "squash"], 2),
        ]),
      ).toEqual({ method: "rebase" });
    });

    it("a required_linear_history rule rules out a merge commit", () => {
      expect(
        chooseMergeMethod(all, [
          { type: "required_linear_history", ruleset_id: 7 },
          pullRequestRule(["merge"]),
        ]),
      ).toEqual({
        error:
          "no merge method is allowed: repo allows squash/merge/rebase; ruleset 7 requires linear history; ruleset 20165612 allows merge",
      });
    });

    it("an absent repo flag is not read as false; an explicit false is", () => {
      expect(chooseMergeMethod({}, [pullRequestRule(["merge"])])).toEqual({ method: "merge" });
      expect(chooseMergeMethod(null, [])).toEqual({ method: "squash" });
      expect(
        chooseMergeMethod(
          { allow_squash_merge: false, allow_merge_commit: false, allow_rebase_merge: false },
          [],
        ),
      ).toEqual({ error: "no merge method is allowed: repo allows nothing" });
    });
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
    expect(
      r.calls.every(
        (c) =>
          VIEW(852).test(c) ||
          VIEW(5).test(c) ||
          REPO_META.test(c) ||
          RULES().test(c) ||
          FILES(5).test(c),
      ),
    ).toBe(true);
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

/**
 * Landing #957 from a cloud session stopped on one transient read error from the egress
 * proxy — `read tcp 127.0.0.1:49958->127.0.0.1:42405: read: connection reset by peer` on
 * the check-runs GET — and an immediate re-run landed it. A READ that fails in transport is
 * now tried again (3 attempts, 2 s then 4 s apart); an answer is not, and a WRITE never is.
 *
 * Every failure fixture below except the #957 line is gh 2.101.0's own output, read on
 * 2026-09-29 by pointing `gh api --hostname localhost` at a local HTTPS server that failed
 * each way on purpose (reset, EOF, silent TLS, HTML/empty/text 5xx, JSON 5xx, 4xx, nothing
 * listening).
 */
describe("land-prs: a read that fails in transport is retried; an answer or a write never is", () => {
  const url = (path: string) => `https://api.github.com/${P}/${path}`;
  const failed = (stderr: string, stdout = ""): RunResult => ({ code: 1, stdout, stderr });
  const RUNS_PAGE_1 = `commits/${A}/check-runs?filter=latest&per_page=100&page=1`;
  // #957, verbatim but for the elided URL.
  const RESET = failed(
    `Get "${url(RUNS_PAGE_1)}": read tcp 127.0.0.1:49958->127.0.0.1:42405: read: connection reset by peer\n`,
  );
  const EOF_ = failed(`Get "${url(RUNS_PAGE_1)}": EOF\n`);
  const TLS_TIMEOUT = failed(`Get "${url("pulls/5")}": net/http: TLS handshake timeout\n`);
  // gh has no response timeout of its own: against a server that never answers it hangs
  // until the runner kills it.
  const KILLED: RunResult = { code: 1, stdout: "", stderr: "", timedOut: true };
  const HTML_502 = failed("gh: HTTP 502\n", "<html><body><h1>502 Bad Gateway</h1></body></html>\n");
  const EMPTY_503 = failed("gh: HTTP 503\n");
  const TEXT_504 = failed("gh: HTTP 504\n", "upstream request timeout");
  const HTML_404 = failed("gh: HTTP 404\n", "<html>nope</html>");
  const REFUSED = failed(
    `Get "${url("pulls/5")}": dial tcp 127.0.0.1:443: connect: connection refused\n`,
  );

  it("classifies real gh failures: transport and a proxy's bodiless 5xx are transient, every answer is final", () => {
    // Go's spellings of a body cut short and a read deadline; not yet seen from gh itself.
    const goOnly = {
      unexpectedEof: failed(`Get "${url("pulls/5")}": unexpected EOF\n`),
      ioTimeout: failed(
        `Get "${url("pulls/5")}": read tcp 127.0.0.1:1->127.0.0.1:2: i/o timeout\n`,
      ),
    };
    const transient = {
      RESET,
      EOF_,
      TLS_TIMEOUT,
      KILLED,
      HTML_502,
      EMPTY_503,
      TEXT_504,
      ...goOnly,
    };
    const final = {
      ok: ok("{}"),
      json502: httpError(502, "Server Error"),
      json404: httpError(404, "Not Found"),
      html404: HTML_404,
      proxy403: PROXY_403,
      conflict409: httpError(409, "Head branch was modified. Review and try the merge again."),
      unprocessable422: httpError(422, "Reference does not exist"),
      refused: REFUSED,
      // The transport check reads a GET's error line; a reset that is not one is not.
      notAGet: failed(`Put "${url("pulls/5/merge")}": read: connection reset by peer\n`),
      noOutput: failed(""),
    };
    const verdicts = (o: Record<string, RunResult>) =>
      Object.entries(o).map(([k, r]) => [k, isTransientReadFailure(r)]);
    expect(verdicts(transient)).toEqual(Object.keys(transient).map((k) => [k, true]));
    expect(verdicts(final)).toEqual(Object.keys(final).map((k) => [k, false]));
  });

  it("only a plain GET counts as a read: any method, any body flag, any flag it does not know is a write", () => {
    expect(isReadOnlyApiCall([])).toBe(true);
    expect(isReadOnlyApiCall(["--jq", ".full_name"])).toBe(true);
    for (const args of [
      ["--method", "PUT", "-f", "merge_method=squash", "-f", `sha=${A}`],
      ["--method", "PUT", "-f", `expected_head_sha=${A}`],
      ["--method", "DELETE"],
      ["--method", "GET"],
      ["-X", "POST"],
      // -f alone switches gh's default method from GET to POST.
      ["-f", "x=y"],
      ["-F", "x=1"],
      ["--input", "body.json"],
      ["--jq"],
      ["--paginate"],
    ]) {
      expect([args, isReadOnlyApiCall(args)]).toEqual([args, false]);
    }
  });

  it("one connection reset on the check-runs GET, then success: it lands", async () => {
    const r = await land(
      [5],
      [
        [VIEW(5), [view(), view(), merged()]],
        [RUNS(A), [RESET, GREEN]],
        [STATUSES(A), [statuses()]],
        ...landed(),
      ],
    );
    expect(r.code).toBe(0);
    expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A} method=squash`);
    expect(r.calls.filter((c) => RUNS(A).test(c))).toHaveLength(2);
    expect(r.sleeps[0]).toBe(2_000);
    expect(r.lines).toContain(
      `LAND note: gh api ${RUNS_PAGE_1} failed in transport (attempt 1 of 3), retrying in 2 s: ${firstLineOf(RESET)}`,
    );
    expect(kinds(r.calls)).toEqual(["checks", "checks", "merge", "delete"]);
  });

  it("a reset that persists stops after 3 attempts, naming the call and the LAST error", async () => {
    const r = await land(
      [5, 6],
      [
        [VIEW(5), [view()]],
        [RUNS(A), [RESET, RESET, EOF_]],
        [STATUSES(A), [statuses()]],
      ],
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      `LAND #5 stopped reason=gh api ${RUNS_PAGE_1} failed after 3 attempts: ${firstLineOf(EOF_)}`,
    );
    expect(r.calls.filter((c) => RUNS(A).test(c))).toHaveLength(3);
    expect(r.sleeps).toEqual([2_000, 4_000]);
    expect(kinds(r.calls)).toEqual(["checks", "checks", "checks"]);
    expect(r.calls.some((c) => /\/pulls\/6\b/.test(c))).toBe(false);
  });

  it("an answer is final: a 404, 403, 409, 422, a JSON 5xx, or nothing listening is issued once", async () => {
    for (const [answer, said] of [
      [httpError(404, "Not Found"), "gh: Not Found (HTTP 404)"],
      [HTML_404, "gh: HTTP 404"],
      [PROXY_403, firstLineOf(PROXY_403)],
      [httpError(409, "Conflict"), "gh: Conflict (HTTP 409)"],
      [httpError(422, "Unprocessable Entity"), "gh: Unprocessable Entity (HTTP 422)"],
      [httpError(502, "Server Error"), "gh: Server Error (HTTP 502)"],
      [REFUSED, firstLineOf(REFUSED)],
    ] as const) {
      const r = await land([5], [[VIEW(5), [answer, view()]]]);
      expect(r.code).toBe(1);
      // No "after N attempts": the reason reads exactly as it did before retries existed.
      expect(r.lines.at(-1)).toBe(`LAND #5 stopped reason=gh api pulls/5 failed: ${said}`);
      expect(r.calls).toEqual([`gh api ${P}/pulls/5`]);
      expect(r.sleeps).toEqual([]);
    }
  });

  // Each failure here is one the READ path would retry — asserted, so this test proves the
  // write gate and not merely that the classifier said no.
  const TRANSIENT_LOOKING = [RESET, KILLED, HTML_502, EMPTY_503];

  it("the merge PUT is issued once even when it fails transiently: the view, not a second PUT, decides", async () => {
    for (const failure of TRANSIENT_LOOKING) {
      expect(isTransientReadFailure(failure)).toBe(true);
      const r = await land([5], [[VIEW(5), [view()]], ...green, [MERGE_CMD(5), [failure, ok()]]]);
      expect(r.code).toBe(1);
      expect(r.lines.at(-1)).toMatch(/^LAND #5 stopped reason=merge did not land \(state=OPEN\): /);
      expect(r.calls.filter((c) => MERGE_CMD(5).test(c))).toHaveLength(1);
      expect(r.lines.some((l) => l.includes("retrying"))).toBe(false);
    }
  });

  it("update-branch is issued once even when it fails transiently", async () => {
    for (const failure of TRANSIENT_LOOKING) {
      const r = await land(
        [5],
        [
          [VIEW(5), [view({ mergeStateStatus: "BEHIND" })]],
          [UPDATE(5), [failure, ok()]],
        ],
      );
      expect(r.code).toBe(1);
      expect(r.lines.at(-1)).toMatch(/^LAND #5 stopped reason=update-branch failed: /);
      expect(kinds(r.calls)).toEqual(["update-branch"]);
    }
  });

  it("the branch DELETE is issued once even when it fails transiently", async () => {
    for (const failure of TRANSIENT_LOOKING) {
      const r = await land(
        [5],
        [
          [VIEW(5), [view(), view(), merged()]],
          ...green,
          [MERGE_CMD(5), [ok(JSON.stringify({ sha: MERGE, merged: true }))]],
          [DELETE(), [failure, ok()]],
          [REF(), [httpError(404, "Not Found")]],
        ],
      );
      expect(r.code).toBe(0);
      expect(r.calls.filter((c) => DELETE().test(c))).toHaveLength(1);
      expect(kinds(r.calls)).toEqual(["checks", "merge", "delete"]);
    }
  });

  it("resolving the repo retries a reset too, and says so when the retries run out", async () => {
    const guess = /^gh api repos\/reddoorla\/reddoor-maintenance --jq \.full_name$/;
    const origin: Route = [/^git remote/, [ok(`https://github.com/${REPO}\n`)]];
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      if (sleeps.length >= 100) throw new Error("runaway: 100 sleeps without an outcome");
      sleeps.push(ms);
    };
    const once = fakeRunner([origin, [guess, [RESET, ok(`${REPO}\n`)]]]);
    expect(await resolveRepo({ run: once.run, sleep })).toEqual({ repo: REPO });
    expect(once.calls.filter((c) => guess.test(c))).toHaveLength(2);
    const always = fakeRunner([origin, [guess, [RESET]]]);
    expect((await resolveRepo({ run: always.run, sleep })).error).toBe(
      `gh api repos/${REPO} failed after 3 attempts: ${firstLineOf(RESET)}`,
    );
    expect(always.calls.filter((c) => guess.test(c))).toHaveLength(3);
    expect(sleeps).toEqual([2_000, 2_000, 4_000]);
  });
});

function firstLineOf(r: RunResult): string {
  return (r.stderr || r.stdout).split("\n")[0]!.trim();
}

/**
 * P1-33 next-4(2), #1597: a PR that deletes, skips or weakens a test does not land unless
 * its body has a `Test changes:` section naming each flagged file. Over 79% of agent
 * cheats edit tests (workspace `reviews/2026-10-06-two-touch-review/recommendations.md`
 * §4), and this script is the path every landing takes. The fixtures are in the shape
 * `GET pulls/N/files` answers: a bare array, `patch` absent when GitHub leaves it out.
 */
describe("land-prs: test changes", () => {
  const file = (filename: string, status: string, patch?: string, over: Partial<PrFile> = {}) =>
    ({
      filename,
      status,
      changes: patch === undefined ? 0 : patch.split("\n").length,
      ...(patch === undefined ? {} : { patch }),
      ...over,
    }) as PrFile;
  const files = (...fs: PrFile[]): RunResult => ok(JSON.stringify(fs));
  const T = "tests/scripts/thing.test.ts";

  const WEAKENED = file(
    T,
    "modified",
    [
      '@@ -10,3 +10,3 @@ describe("thing", () => {',
      '   it("counts", () => {',
      "-    expect(count()).toBe(3);",
      "+    expect(count()).toBe(4);",
      "   });",
    ].join("\n"),
  );

  describe("which files are tests", () => {
    it("knows a test by its directory or its name, and nothing else", () => {
      for (const t of [
        "tests/scripts/land-prs.test.ts",
        "test/a.js",
        "src/lib/__tests__/x.ts",
        "e2e/forms.spec.ts",
        "src/a.test.mjs",
        "packages/x/src/b.spec.tsx",
      ]) {
        expect(isTestFile(t), t).toBe(true);
      }
      for (const n of ["src/testing.ts", "scripts/land-prs.mjs", "docs/tests.md", "contest/a.ts"]) {
        expect(isTestFile(n), n).toBe(false);
      }
    });
  });

  describe("testChangeFlags", () => {
    it("PASS control: an add-only PR, new test file and new cases in an old one, flags nothing", () => {
      expect(
        testChangeFlags([
          file(
            "tests/new.test.ts",
            "added",
            '@@ -0,0 +1,3 @@\n+it("a", () => {\n+  expect(1).toBe(1);\n+});',
          ),
          file(
            T,
            "modified",
            '@@ -5,2 +5,5 @@\n   });\n+  it("b", () => {\n+    assert.equal(2, 2);\n+  });\n });',
          ),
          file("src/a.ts", "removed", "@@ -1 +0,0 @@\n-export const expect = (x) => x;"),
        ]),
      ).toEqual([]);
    });

    it("a changed assertion is a removed one: toBe(3) → toBe(4) is flagged, with the line", () => {
      expect(testChangeFlags([WEAKENED])).toEqual([
        { file: T, reasons: ["removed assertion not re-added: expect(count()).toBe(3);"] },
      ]);
    });

    it("an assert line removed is flagged too", () => {
      const f = file(T, "modified", "@@ -1,2 +1,1 @@\n-assert.ok(x);\n keep();");
      expect(testChangeFlags([f])).toEqual([
        { file: T, reasons: ["removed assertion not re-added: assert.ok(x);"] },
      ]);
    });

    it("an assertion moved within the file, or only re-indented, is not flagged", () => {
      const f = file(
        T,
        "modified",
        "@@ -1,4 +1,4 @@\n-  expect(a).toBe(1);\n   other();\n+      expect(a).toBe(1);\n   more();",
      );
      expect(testChangeFlags([f])).toEqual([]);
    });

    it("an added skip, skipIf, todo, fails, xit or xdescribe is flagged", () => {
      for (const line of [
        'it.skip("a", () => {});',
        'describe.skipIf(isCi)("b", () => {});',
        'test.todo("c");',
        'it.fails("d", () => {});',
        'xit("e", () => {});',
        'xdescribe("f", () => {});',
      ]) {
        const f = file(T, "modified", `@@ -1,1 +1,2 @@\n keep();\n+${line}`);
        expect(testChangeFlags([f]), line).toEqual([{ file: T, reasons: [`added skip: ${line}`] }]);
      }
    });

    it("a skip that was already there and only moved is not flagged, nor is a word like skipped", () => {
      const f = file(
        T,
        "modified",
        '@@ -1,2 +1,3 @@\n-it.skip("old", () => {});\n+  it.skip("old", () => {});\n+const skipped = r.skipped;',
      );
      expect(testChangeFlags([f])).toEqual([]);
    });

    it("a deleted test file is flagged, whatever its patch says", () => {
      for (const f of [
        file(T, "removed", '@@ -1,1 +0,0 @@\n-it("a", () => {});'),
        file(T, "removed", undefined, { changes: 400 }),
      ]) {
        expect(testChangeFlags([f])).toEqual([{ file: T, reasons: ["test file deleted"] }]);
      }
    });

    it("a test file renamed to a path that is not a test is flagged as deleted", () => {
      const f = file("docs/old-thing.txt", "renamed", undefined, { previous_filename: T });
      expect(testChangeFlags([f])).toEqual([
        { file: T, reasons: ["test file renamed to docs/old-thing.txt, which is not a test"] },
      ]);
      // Round 4: a move between test paths is flagged too, because the runner's include may
      // not collect the new path; naming it costs one line.
      const moved = file("tests/b/thing.test.ts", "renamed", undefined, { previous_filename: T });
      expect(testChangeFlags([moved])).toEqual([
        {
          file: T,
          reasons: ["test file renamed to tests/b/thing.test.ts: say the runner still collects it"],
        },
      ]);
    });

    it("a test file whose patch GitHub left out is flagged; an unchanged one (a mode change) or a non-test file is not", () => {
      expect(testChangeFlags([file(T, "modified", undefined, { changes: 12_000 })])).toEqual([
        { file: T, reasons: ["GitHub left out the patch (12000 changed lines): read the diff"] },
      ]);
      expect(
        testChangeFlags([
          file(T, "modified", undefined, { changes: 0 }),
          file("src/huge.ts", "modified", undefined, { changes: 12_000 }),
        ]),
      ).toEqual([]);
    });

    it("lists every reason in a file, and every flagged file", () => {
      const f = file(
        T,
        "modified",
        '@@ -1,3 +1,2 @@\n-expect(a).toBe(1);\n-expect(b).toBe(2);\n+it.skip("x", () => {});',
      );
      const g = file("tests/other.test.ts", "removed");
      expect(testChangeFlags([f, g])).toEqual([
        {
          file: T,
          reasons: [
            "removed assertion not re-added: expect(a).toBe(1);",
            "removed assertion not re-added: expect(b).toBe(2);",
            'added skip: it.skip("x", () => {});',
          ],
        },
        { file: "tests/other.test.ts", reasons: ["test file deleted"] },
      ]);
    });
  });

  describe("round-1 review findings", () => {
    it("counts copies: removing an assertion twice and adding it back once loses one", () => {
      const f = file(
        T,
        "modified",
        '@@ -1,4 +1,3 @@\n-  expect(res.ok).toBe(true);\n-it("b", () => {\n-  expect(res.ok).toBe(true);\n+it("b", () => {});\n+    expect(res.ok).toBe(true);',
      );
      expect(testChangeFlags([f])).toEqual([
        { file: T, reasons: ["removed assertion not re-added: expect(res.ok).toBe(true);"] },
      ]);
    });

    it("counts copies of a skip too: one moved and one new is one added skip", () => {
      const f = file(
        T,
        "modified",
        '@@ -1,1 +1,2 @@\n-it.skip("a", () => {});\n+  it.skip("a", () => {});\n+  it.skip("a", () => {});',
      );
      expect(testChangeFlags([f])).toEqual([
        { file: T, reasons: ['added skip: it.skip("a", () => {});'] },
      ]);
    });

    it("a test renamed out of the runner but still under tests/ is flagged", () => {
      for (const to of ["tests/scripts/thing.test.ts.off", "tests/scripts/thing.ts"]) {
        const f = file(to, "renamed", undefined, { previous_filename: T });
        expect(testChangeFlags([f]), to).toEqual([
          { file: T, reasons: [`test file renamed to ${to}, which is not named as a test`] },
        ]);
      }
    });

    it("a property named todo, skip or fails is not a skip, nor is a call ending in xit", () => {
      const f = file(
        "tests/store.test.ts",
        "added",
        "@@ -0,0 +1,4 @@\n+expect(store.todo.length).toBe(1);\n+expect(summary.fails).toBe(0);\n+const o = opts.skip;\n+process.exit(1); fixit(2);",
      );
      expect(testChangeFlags([f])).toEqual([]);
    });

    it("assertions are calls: a comment, a name or an import that says assert is not one", () => {
      const f = file(
        T,
        "modified",
        '@@ -1,4 +1,4 @@\n-// The assertions are on the recorded commands.\n-const assertions = 3;\n-import { strict as assert } from "node:assert";\n- * expect(x) in a doc comment\n+// The checks are on the recorded commands.',
      );
      expect(testChangeFlags([f])).toEqual([]);
      const g = file(
        T,
        "modified",
        "@@ -1,3 +1,0 @@\n-assertEquals(a, b);\n-assert.strict.equal(a, b);\n-expect<number>(n).toBe(3);",
      );
      expect(testChangeFlags([g])[0]?.reasons).toHaveLength(3);
    });

    it("a name is the whole path: a longer path does not name the flagged one, a sentence's full stop does", () => {
      const flags = testChangeFlags([
        file("tests/a.test.ts", "removed"),
        file("test/a.js", "removed"),
      ]);
      expect(
        unnamedTestChanges(flags, "Test changes:\n- tests/a.test.tsx: renamed\n- src/test/a.json"),
      ).toEqual(["tests/a.test.ts", "test/a.js"]);
      expect(
        unnamedTestChanges(flags, "Test changes: removed tests/a.test.ts. And `test/a.js`, too."),
      ).toEqual([]);
    });

    it("a label section ends at a paragraph, and a hidden or fenced label does not count", () => {
      const flags = testChangeFlags([file("tests/a.test.ts", "removed")]);
      for (const body of [
        "Summary.\n\n**Test changes:** none.\n\nFiles touched: tests/a.test.ts, src/x.ts",
        "<!--\nTest changes: tests/a.test.ts\n-->\n\nSummary: cleanup of tests/a.test.ts",
        "```\nTest changes: tests/a.test.ts\n```\nSummary.",
      ]) {
        expect(unnamedTestChanges(flags, body), body).toEqual(["tests/a.test.ts"]);
      }
      for (const body of [
        "Test changes:\n\n- tests/a.test.ts: obsolete\n- more",
        "## Summary\n- Fixes x.\n- Test changes: tests/a.test.ts was obsolete.",
        "1. Test changes: tests/a.test.ts was obsolete.",
        "## Test changes\n\nOne paragraph.\n\ntests/a.test.ts was obsolete.",
      ]) {
        expect(unnamedTestChanges(flags, body), body).toEqual([]);
      }
    });
  });

  describe("round-2 review findings", () => {
    const one = (patch: string) => testChangeFlags([file(T, "modified", patch)]);

    it("a comment in front of a skip or an assertion does not hide it; a commented-out one is not code", () => {
      expect(one('@@ -1 +1 @@\n-it("x", () => {\n+/* flaky */ it.skip("x", () => {')).toHaveLength(
        1,
      );
      expect(one('@@ -1 +1 @@\n-it("x", () => {\n+*/ it.skip("x", () => {')).toHaveLength(1);
      expect(one("@@ -1 +0,0 @@\n-/* note */ expect(a).toBe(1);")).toHaveLength(1);
      expect(
        one(
          '@@ -0,0 +1,3 @@\n+// it.skip("x", () => {});\n+ * it.todo("doc");\n+/* xit("y") */ go();',
        ),
      ).toEqual([]);
    });

    it("a called .skip on any receiver is a skip: ctx, this, a test.extend alias, a split chain", () => {
      for (const line of [
        "ctx.skip();",
        "this.skip();",
        'myTest.skip("x", () => {});',
        'test.extend({}).skip("x", () => {});',
        'it("x", ({ skip }) => { skip(); });',
        'it .skip("x", () => {});',
        '.skip("x", () => {});',
      ]) {
        expect(one(`@@ -1 +1,2 @@\n keep();\n+${line}`), line).toEqual([
          { file: T, reasons: [`added skip: ${line}`] },
        ]);
      }
    });

    it("assertions with generics, nested or chained, and type assertions are assertions", () => {
      for (const line of [
        "expect<Array<number>>(xs).toEqual([1]);",
        "expect.soft<number>(x).toBe(1);",
        "assertType<string>(x);",
        'expectTypeOf<Site>().toHaveProperty("path");',
      ]) {
        expect(one(`@@ -1 +0,0 @@\n-${line}`), line).toHaveLength(1);
      }
    });

    it("a hostile line is not slow to scan", () => {
      const start = Date.now();
      one(`@@ -1 +0,0 @@\n-${"expect<".repeat(20_000)}`);
      testChangesSection(`Test changes:\n${"\n".repeat(60_000)}- a`);
      expect(Date.now() - start).toBeLessThan(1_000);
    });

    it("only a root tests/, test/ or e2e/ is a test directory; __tests__/ is one anywhere", () => {
      for (const p of [
        "src/routes/test/+page.svelte",
        "src/lib/test/utils.ts",
        "static/e2e/x.json",
      ]) {
        expect(isTestFile(p), p).toBe(false);
      }
      for (const p of ["packages/core/tests/a.ts", "e2e/a.ts", "src/__tests__/a.ts"]) {
        expect(isTestFile(p), p).toBe(true);
      }
    });

    it("names a file as ./path or as a GitHub blob link, but not as a longer name or another path", () => {
      const flags = testChangeFlags([file("tests/a.test.ts", "removed")]);
      for (const body of [
        "Test changes: ./tests/a.test.ts removed a dup",
        "Test changes: https://github.com/o/r/blob/main/tests/a.test.ts was a dup",
        "Test changes: [tests/a.test.ts](https://github.com/o/r/blob/main/tests/a.test.ts) was a dup",
      ]) {
        expect(unnamedTestChanges(flags, body), body).toEqual([]);
      }
      for (const body of [
        "Test changes: tests/a.test.ts.off is gone",
        "Test changes: foo.tests/a.test.ts",
        "Test changes: src/tests/a.test.ts",
      ]) {
        expect(unnamedTestChanges(flags, body), body).toEqual(["tests/a.test.ts"]);
      }
    });

    it("comments and fences hide only what GitHub hides", () => {
      const flags = testChangeFlags([file("tests/a.test.ts", "removed")]);
      for (const body of [
        "This PR escapes `<!--` in templates.\n\nTest changes: tests/a.test.ts, reason",
        "````md\n```\n````\n\nTest changes: tests/a.test.ts reason",
        "Test changes\n------------\n\ntests/a.test.ts: reason",
        "Test changes: none\n\n## Test changes\n- tests/a.test.ts: dup",
      ]) {
        expect(unnamedTestChanges(flags, body), body).toEqual([]);
      }
      for (const body of [
        "Summary.\n<!-- template\nTest changes: tests/a.test.ts",
        "Test changes: <!-- tests/a.test.ts --> none",
        "Test changes: none <!-- a > b, tests/a.test.ts -->",
        "Summary.\n```\nTest changes: tests/a.test.ts",
      ]) {
        expect(unnamedTestChanges(flags, body), body).toEqual(["tests/a.test.ts"]);
      }
    });

    it("prints the list once when the merging head flags what the first view did", async () => {
      const NAMED = `Test changes:\n- ${T}: the count is 4 now.`;
      const r = await land(
        [5],
        [
          [FILES(5), [files(WEAKENED)]],
          [VIEW(5), [view({ body: NAMED }), view({ body: NAMED }), merged()]],
          ...green,
          ...landed(),
        ],
      );
      expect(r.code).toBe(0);
      expect(r.lines.filter((l) => l.startsWith("LAND #5 test change"))).toHaveLength(2);
    });
  });

  describe("round-3 review findings", () => {
    const one = (patch: string) => testChangeFlags([file(T, "modified", patch)]);
    const added = (line: string) => one(`@@ -1 +1,2 @@\n keep();\n+${line}`);
    const removed = (line: string) => one(`@@ -1,2 +1 @@\n keep();\n-${line}`);

    it("a chained, aliased or Playwright skip is a skip", () => {
      for (const line of [
        'it.skip.each(cases)("x %s", (c) => {',
        'describe.skip.each([1, 2])("d", () => {',
        '(process.env.CI ? it.skip : it)("works", () => {',
        "const itLive = hasCreds ? it : it.skip;",
        'xtest("a", () => {});',
        'test.fixme("flaky webkit", async () => {});',
        'test.fail("x", () => {});',
      ]) {
        expect(added(line), line).toEqual([{ file: T, reasons: [`added skip: ${line}`] }]);
      }
      expect(added('myTest.skip.each(rows)("r", () => {});')).toHaveLength(1);
      expect(added("skip ();")).toHaveLength(1);
      expect(added("const n = store.todo.length + result.tests.skip;")).toEqual([]);
    });

    it("a string is data: comment markers and words inside one change nothing", () => {
      expect(removed('expect(cronOf(wf)).toBe("*/15 * * * *");')).toHaveLength(1);
      expect(removed('expect(fg.sync("**/*.svelte")).toHaveLength(12);')).toHaveLength(1);
      expect(added('it.skip("matches **/ globs", () => {});')).toHaveLength(1);
      expect(added('it.skip("x", () => { // */')).toHaveLength(1);
      expect(added('it.skip("x", () => {}); */')).toHaveLength(1);
      expect(
        removed('await page.goto("https://x.test/"); expect(page).toHaveURL(/x/);'),
      ).toHaveLength(1);
      expect(
        one(
          '@@ -1 +1 @@\n-it("redirects as users expect (no 404)", async () => {\n+it("redirects as users expect (no 404 page)", async () => {',
        ),
      ).toEqual([]);
      expect(added('it("does not skip (hidden) rows", () => {')).toEqual([]);
      expect(added(`const fixture = 'it.skip("a", () => {});';`)).toEqual([]);
      expect(removed('const s = "expect(x).toBe(3)";')).toEqual([]);
      expect(removed("expect (x).toBe(3);")).toHaveLength(1);
      expect(added("const html = `<p>Click to skip (or wait)</p>`;")).toEqual([]);
    });

    it("no line makes the assertion scan slow", () => {
      const start = Date.now();
      removed(`expect${"<>".repeat(40)}x`);
      removed(`expect ${"<b>".repeat(60)}`);
      removed(`expect${"<a>".repeat(60)}`);
      expect(Date.now() - start).toBeLessThan(1_000);
    });

    it("adding a semicolon, or re-spacing a line, does not remove the assertion", () => {
      expect(one("@@ -1 +1 @@\n-expect(x).toBe(1)\n+expect(x).toBe(1);")).toEqual([]);
      expect(one("@@ -1 +1 @@\n-expect(x).toBe( 1 );\n+expect(x).toBe(  1 );")).toEqual([]);
    });

    it("a table or an inline-code line carries a label's section past a blank line", () => {
      const flags = testChangeFlags([file("tests/a.test.ts", "removed")]);
      for (const body of [
        "Test changes:\n\n| file | why |\n|---|---|\n| tests/a.test.ts | renamed title |\n",
        "**Test changes:**\n\n`tests/a.test.ts`: title only\n",
        "Test changes: one file.\n\n| tests/a.test.ts | renamed title |\n",
        "Test changes: one file.\n\n`tests/a.test.ts`: title only\n",
      ]) {
        expect(unnamedTestChanges(flags, body), body).toEqual([]);
      }
      expect(unnamedTestChanges(flags, "Test changes: foo./tests/a.test.ts")).toEqual([
        "tests/a.test.ts",
      ]);
    });
  });

  describe("round-4 review findings", () => {
    const one = (patch: string) => testChangeFlags([file(T, "modified", patch)]);
    const added = (line: string) => one(`@@ -1 +1,2 @@\n keep();\n+${line}`);
    const removed = (line: string) => one(`@@ -1,2 +1 @@\n keep();\n-${line}`);
    const A_TEST = testChangeFlags([file("tests/a.test.ts", "removed")]);
    const names = (body: string) => unnamedTestChanges(A_TEST, body, ["claude/x", "main"]);

    it("every rename of a test is flagged: the runner's include may not collect the new path", () => {
      const f = file("scripts/land-prs.test.ts", "renamed", undefined, {
        previous_filename: "tests/scripts/land-prs.test.ts",
      });
      expect(testChangeFlags([f])).toEqual([
        {
          file: "tests/scripts/land-prs.test.ts",
          reasons: [
            "test file renamed to scripts/land-prs.test.ts: say the runner still collects it",
          ],
        },
      ]);
    });

    it("a section names the file wherever a reader sees it in the section", () => {
      for (const body of [
        "Test changes:\n\ntests/a.test.ts: the count is now 4 because the fixture gained a row.",
        "**Test changes:**\n\nThe assertion in tests/a.test.ts now expects 4.",
        "## Test changes\n\n### tests/a.test.ts\nThe count is now 4.",
        "## Test changes\n\n- tests/a.test.ts: the count is now 4.\n---\nRelated: #12",
        "Test changes:\ntests/a.test.ts: retitled the case\n---\nCloses #12",
        "```pnpm test``` passes locally.\n\nTest changes: tests/a.test.ts, the count is now 4.",
        "Test changes: https://github.com/o/r/blob/claude/x/tests/a.test.ts#L3 is 4 now.",
        "Test changes:\n\n\n- tests/a.test.ts: dup",
      ]) {
        expect(names(body), body).toEqual([]);
      }
    });

    it("text a reader does not see does not name it", () => {
      for (const body of [
        "Refactor.\n\nTest changes:\n[//]: # (tests/a.test.ts)\n",
        "Test changes:\n[a]: tests/a.test.ts",
        "Uses ```x``` now.\n```x```\n<!--\n```\nTest changes: tests/a.test.ts\n-->\n",
        "Test changes: none\n\n## Other\ntests/a.test.ts",
      ]) {
        expect(names(body), body).toEqual(["tests/a.test.ts"]);
      }
    });

    it("whitespace inside a string is part of the assertion", () => {
      expect(
        one('@@ -1 +1 @@\n-  expect(s).toBe("a  b");\n+  expect(s).toBe("a b");'),
      ).toHaveLength(1);
    });

    it("a skip by bracket access is a skip; RxJS skip(1) and a query's .skip(10) are not", () => {
      expect(added('it["skip"]("x", () => {')).toHaveLength(1);
      expect(added("source$.pipe(skip(1), take(1));")).toEqual([]);
      expect(added("await db.find().skip(10).limit(5);")).toEqual([]);
    });

    it("assertion names are exact, generics may hold function types, a lone quote does not hide a call", () => {
      expect(removed("const want = expectedFor(input);")).toEqual([]);
      expect(removed("expectTypeOf<() => void>().toBeFunction();")).toHaveLength(1);
      expect(removed("assertType<(x: number) => string>(fn);")).toHaveLength(1);
      expect(
        removed('render(<p>Don\'t</p>); expect(screen.getByText("x")).toBeTruthy();'),
      ).toHaveLength(1);
    });

    it("an escaped quote stays in its string, and an unclosed /* hides the rest of the line", () => {
      expect(added('it("says \\"skip (\\" here", () => {});')).toEqual([]);
      expect(added('/* TODO: it.skip("a") once fixed')).toEqual([]);
    });

    it("a line too long to scan is flagged unless it comes back unchanged", () => {
      const long = `const fixture = "${"x".repeat(2_500)}";`;
      expect(added(long)[0]?.reasons).toEqual([
        `a changed line of ${long.length} characters, too long to scan: read it`,
      ]);
      expect(one(`@@ -1 +1 @@\n-${long}\n+  ${long}`)).toEqual([]);
    });

    it("no body or line makes a scan slow", () => {
      const start = Date.now();
      testChangesSection(`test changes${"*".repeat(65_500)}x`);
      testChangesSection("`".repeat(65_536));
      testChangesSection(`Test changes:\n${"<!--".repeat(16_000)}`);
      added("it.".repeat(20_000));
      expect(Date.now() - start).toBeLessThan(1_000);
    });
  });

  describe("round-5 review findings", () => {
    const one = (patch: string, name = T) => testChangeFlags([file(name, "modified", patch)]);
    const added = (line: string) => one(`@@ -1 +1,2 @@\n keep();\n+${line}`);
    const removed = (line: string) => one(`@@ -1,2 +1 @@\n keep();\n-${line}`);
    const A_TEST = testChangeFlags([file("tests/a.test.ts", "removed")]);

    it("a renamed test is flagged for the rename and still scanned", () => {
      const f = file(
        "tests/b.test.ts",
        "renamed",
        "@@ -1,2 +1,1 @@\n-it('a', () => {\n+it.skip('a', () => {\n-  expect(x).toBe(1);",
        { previous_filename: "tests/a.test.ts" },
      );
      expect(testChangeFlags([f])).toEqual([
        {
          file: "tests/a.test.ts",
          reasons: [
            "test file renamed to tests/b.test.ts: say the runner still collects it",
            "removed assertion not re-added: expect(x).toBe(1);",
            "added skip: it.skip('a', () => {",
          ],
        },
      ]);
    });

    it("a conditional skip() from the test context is a skip", () => {
      for (const line of [
        "if (process.env.CI) skip();",
        'it("x", async ({ skip }) => { if (!process.env.DB) skip(); });',
        "else skip();",
        "cond && skip();",
        "return skip();",
        'test("x", (c) => { c.skip(); });',
        'it.runIf(false)("x", () => {});',
        "base.skip('x', async () => {});",
        "authed.skip(true, 'flaky');",
      ]) {
        expect(added(line), line).toEqual([{ file: T, reasons: [`added skip: ${line}`] }]);
      }
    });

    it("a stream's or a query's skip is not, on one line or split", () => {
      for (const line of [
        "skip(1),",
        ".skip(10)",
        "const rows = latest.skip(1);",
        "const page = query.skip(10);",
      ]) {
        expect(added(line), line).toEqual([]);
      }
      expect(removed("const n = assertionsFor(x);")).toEqual([]);
    });

    it("a regex literal does not hide a call after it", () => {
      expect(added('const p = s.replace(/\\//g, ""); it.skip("x", () => {});')).toHaveLength(1);
      expect(
        removed('const parts = url.split(/\\//); expect(parts).toEqual(["a", "b"]);'),
      ).toHaveLength(1);
      expect(added("/'/.test(a); it.skip(\"x\", () => {}); /'/.test(b);")).toHaveLength(1);
    });

    it("a name a reader never sees does not count", () => {
      for (const body of [
        "Test changes: none[](tests/a.test.ts)",
        "Test changes: none ![](tests/a.test.ts)",
        'Test changes: none <span title="tests/a.test.ts"></span>',
        "Test changes: [ ](https://github.com/o/r/blob/main/tests/a.test.ts)",
        "## Test changes\n\nnone\n\n[tests/a.test.ts]:<x>",
        "Test changes:\n- https://github.com/o/r/blob/main/packages/web/tests/a.test.ts: toBe(1) -> toBe(2)",
      ]) {
        expect(unnamedTestChanges(A_TEST, body, ["main"]), body).toEqual(["tests/a.test.ts"]);
      }
      expect(unnamedTestChanges(A_TEST, "<!-->\nTest changes: tests/a.test.ts\n-->")).toEqual([]);
    });

    it("a line of chained dots is not slow", () => {
      const start = Date.now();
      for (let i = 0; i < 300; i++) added("it . ".repeat(390));
      expect(Date.now() - start).toBeLessThan(2_000);
    });
  });

  // #1604: Prettier breaks a long assertion so its matcher sits on a line of its own.
  describe("a matcher on a continuation line (#1604)", () => {
    const one = (patch: string) => testChangeFlags([file(T, "modified", patch)]);
    const multiLine = (from: string, to: string) =>
      one(
        [
          '@@ -10,4 +10,4 @@ it("x", () => {',
          "   expect(",
          "     summarize(x),",
          `-  ${from}`,
          `+  ${to}`,
        ].join("\n"),
      );

    it("a changed matcher under a multi-line expect( is flagged", () => {
      for (const [from, to] of [
        [").toBe(false);", ").toBe(true);"],
        [").not.toBe(1);", ").toBe(1);"],
        [").resolves.toEqual([1]);", ").resolves.toBeDefined();"],
        [").rejects.toThrow(/boom/);", ").rejects.toThrow();"],
        ["  ).toHaveLength(3);", "  ).toHaveLength(4);"],
        ['))).toMatch("a");', '))).toMatch("b");'],
      ] as const) {
        expect(multiLine(from, to), from).toEqual([
          { file: T, reasons: [`removed assertion not re-added: ${from.trim()}`] },
        ]);
      }
    });

    it("a matcher line re-indented or moved is not flagged", () => {
      expect(multiLine(").toBe(false);", "    ).toBe(false)")).toEqual([]);
    });

    it("a removed ) line that closes a call, not an assertion, is not flagged", () => {
      for (const line of [");", "),", ").toString();", ").toFixed(2);", "]).then(done);", ")"]) {
        expect(multiLine(line, ""), line).toEqual([]);
      }
    });

    it("an added matcher line alone is not flagged", () => {
      expect(one("@@ -10,2 +10,3 @@\n   expect(\n     x,\n+  ).toBe(true);")).toEqual([]);
    });
  });

  describe("the Test changes: section", () => {
    it("is found as a label or a heading, and ends at the next heading", () => {
      for (const body of [
        `Summary.\n\nTest changes: \`${T}\` pinned the old count.\n\n## Next\nother.test.ts`,
        `## Test changes\n\n- ${T}: the count changed.\n\n## Next\nother.test.ts`,
        `**Test changes:**\n- ${T}: the count changed.\n### Next\nother.test.ts`,
      ]) {
        const section = testChangesSection(body);
        expect(section, body).toContain(T);
        expect(section, body).not.toContain("other.test.ts");
      }
      expect(testChangesSection("No section here; tests/a.test.ts changed.")).toBeNull();
      expect(testChangesSection(null)).toBeNull();
    });

    it("names the flagged files the section leaves out, and a file named outside it does not count", () => {
      const flags = testChangeFlags([WEAKENED, file("tests/other.test.ts", "removed")]);
      expect(unnamedTestChanges(flags, `Test changes:\n- ${T}: the count changed.`)).toEqual([
        "tests/other.test.ts",
      ]);
      expect(unnamedTestChanges(flags, `I changed ${T} and tests/other.test.ts.`)).toEqual([
        T,
        "tests/other.test.ts",
      ]);
      expect(unnamedTestChanges([], "")).toEqual([]);
    });
  });

  describe("at landing", () => {
    const NAMED = `Fix.\n\nTest changes:\n- \`${T}\`: the count is 4 now (#1597).`;

    it("a flagged change with no Test changes: section stops before any check is watched, saying what to add", async () => {
      const r = await land(
        [5, 9],
        [
          [FILES(5), [files(WEAKENED)]],
          [VIEW(5), [view()]],
        ],
      );
      expect(r.code).toBe(1);
      expect(r.lines).toContain(
        `LAND #5 test change: ${T}: removed assertion not re-added: expect(count()).toBe(3);`,
      );
      expect(r.lines.at(-1)).toBe(
        `LAND #5 stopped reason=1 flagged test file is not named in the PR body: add a "Test changes:" line or heading to the PR body naming ${T}, each with why its test changed, then land again`,
      );
      expect(pastTheRefusal(r.calls)).toEqual([]);
      expect(r.calls.some((c) => /\/pulls\/9\b/.test(c))).toBe(false);
    });

    it("the same change lands once the section names the file, re-read on the merging head", async () => {
      const r = await land(
        [5],
        [
          [FILES(5), [files(WEAKENED)]],
          [VIEW(5), [view({ body: NAMED }), view({ body: NAMED }), merged()]],
          ...green,
          ...landed(),
        ],
      );
      expect(r.code).toBe(0);
      expect(r.lines).toContain(`LAND #5 merged ${MERGE} head=${A} method=squash`);
      expect(r.calls.filter((c) => FILES(5).test(c))).toHaveLength(2);
      const checks = r.calls.findIndex((c) => RUNS().test(c));
      const files2 = r.calls.map((c) => FILES(5).test(c)).lastIndexOf(true);
      const mergeAt = r.calls.findIndex((c) => MERGE_CMD(5).test(c));
      expect(checks < files2 && files2 < mergeAt).toBe(true);
    });

    it("a section that names only some of the files stops, naming the rest", async () => {
      const other = file("tests/other.test.ts", "removed");
      const r = await land(
        [5],
        [
          [FILES(5), [files(WEAKENED, other)]],
          [VIEW(5), [view({ body: NAMED })]],
        ],
      );
      expect(r.code).toBe(1);
      expect(r.lines.at(-1)).toBe(
        `LAND #5 stopped reason=1 flagged test file is not named in the PR body: the "Test changes:" section does not name tests/other.test.ts; add each, with why its test changed, then land again`,
      );
    });

    it("reads every page of the files: a deleted test on page 2 still stops", async () => {
      const clean = Array.from({ length: 100 }, (_, i) =>
        file(`src/f${i}.ts`, "added", "@@ -0,0 +1 @@\n+x"),
      );
      const r = await land(
        [5],
        [
          [FILES_PAGE(5, 1), [files(...clean)]],
          [FILES_PAGE(5, 2), [files(file(T, "removed"))]],
          [VIEW(5), [view()]],
        ],
      );
      expect(r.code).toBe(1);
      expect(r.lines).toContain(`LAND #5 test change: ${T}: test file deleted`);
      expect(r.calls.some((c) => FILES_PAGE(5, 3).test(c))).toBe(false);
    });

    it("a file list at GitHub's 3000-file cap stops: the check cannot see past it", async () => {
      const page = Array.from({ length: 100 }, (_, i) =>
        file(`src/f${i}.ts`, "added", "@@ -0,0 +1 @@\n+x"),
      );
      const r = await land(
        [5],
        [
          [FILES(5), [files(...page)]],
          [VIEW(5), [view()]],
        ],
      );
      expect(r.code).toBe(1);
      expect(r.lines.at(-1)).toBe(
        "LAND #5 stopped reason=gh api pulls/5/files listed 3000 of an unknown number of changed files (GitHub lists at most 3000): the test-change check cannot see them all",
      );
      expect(pastTheRefusal(r.calls)).toEqual([]);
      const over = await land(
        [5],
        [
          [FILES(5), [files(...page)]],
          [VIEW(5), [view({ changedFiles: 3412 })]],
        ],
      );
      expect(over.lines.at(-1)).toContain("listed 3000 of 3412 changed files");
    });

    it("a PR of exactly 3000 files is complete, and is not stopped for the cap", async () => {
      const page = Array.from({ length: 100 }, (_, i) =>
        file(`src/f${i}.ts`, "added", "@@ -0,0 +1 @@\n+x"),
      );
      const r = await land(
        [5],
        [
          [FILES(5), [files(...page)]],
          [VIEW(5), [view({ changedFiles: 3000 })]],
        ],
        {
          dryRun: true,
        },
      );
      expect(r.code).toBe(0);
      expect(r.lines).toContain("LAND #5 test changes: none flagged");
    });

    it("a change that appears only on the merging head stops there, and nothing merges", async () => {
      const r = await land(
        [5],
        [
          [FILES(5), [files(), files(WEAKENED)]],
          [VIEW(5), [view(), view()]],
          ...green,
          ...landed(),
        ],
      );
      expect(r.code).toBe(1);
      expect(r.lines).toContain(
        `LAND #5 test change: ${T}: removed assertion not re-added: expect(count()).toBe(3);`,
      );
      expect(r.lines.at(-1)).toMatch(
        /^LAND #5 stopped reason=1 flagged test file is not named in the PR body: .*; checked before merging head aaaaaaa$/,
      );
      expect(kinds(r.calls)).toEqual(["checks"]);
    });

    it("a section removed from the body during the checks wait stops at the gate", async () => {
      const r = await land(
        [5],
        [
          [FILES(5), [files(WEAKENED)]],
          [VIEW(5), [view({ body: NAMED }), view({ body: "Fix." })]],
          ...green,
          ...landed(),
        ],
      );
      expect(r.code).toBe(1);
      expect(r.lines.at(-1)).toMatch(
        /not named in the PR body: .*; checked before merging head aaaaaaa$/,
      );
      expect(kinds(r.calls)).toEqual(["checks"]);
    });

    it("--dry-run prints the list and the stop it would make", async () => {
      const r = await land(
        [5],
        [
          [FILES(5), [files(WEAKENED)]],
          [VIEW(5), [view()]],
        ],
        {
          dryRun: true,
        },
      );
      expect(r.code).toBe(1);
      expect(r.lines).toContain(
        `LAND #5 test change: ${T}: removed assertion not re-added: expect(count()).toBe(3);`,
      );
      expect(r.lines.at(-1)).toMatch(/^LAND #5 stopped reason=1 flagged test file is not named/);
    });

    it("--dry-run with the file named prints the list, then the plan", async () => {
      const r = await land(
        [5],
        [
          [FILES(5), [files(WEAKENED)]],
          [VIEW(5), [view({ body: NAMED })]],
        ],
        {
          dryRun: true,
        },
      );
      expect(r.code).toBe(0);
      expect(r.lines).toContain(
        `LAND #5 test change: ${T}: removed assertion not re-added: expect(count()).toBe(3);`,
      );
      expect(r.lines).toContain(`LAND #5 test changes: 1 flagged file, named in the PR body`);
      expect(r.lines.some((l) => l.startsWith("LAND #5 dry-run would: wait for checks"))).toBe(
        true,
      );
    });

    it("--dry-run says when nothing is flagged", async () => {
      const r = await land([5], [[VIEW(5), [view()]]], { dryRun: true });
      expect(r.lines).toContain("LAND #5 test changes: none flagged");
    });

    it("a files read GitHub refuses stops with the call and its reason", async () => {
      const r = await land(
        [5],
        [
          [FILES(5), [httpError(404, "Not Found")]],
          [VIEW(5), [view()]],
        ],
      );
      expect(r.code).toBe(1);
      expect(r.lines.at(-1)).toBe(
        "LAND #5 stopped reason=gh api pulls/5/files?per_page=100&page=1 failed: gh: Not Found (HTTP 404)",
      );
    });
  });

  // #1617 and #1755: the gate's minors and its two matcher gaps.
  describe("#1617 and #1755", () => {
    const patch = (...ls: string[]) => `@@ -1,${ls.length} +1,${ls.length} @@\n${ls.join("\n")}`;

    it("test paths match in any case, and a root spec/ directory holds tests", () => {
      for (const t of [
        "Tests/a.ts",
        "TESTS/fixtures/x.json",
        "E2E/a.ts",
        "spec/a.rb",
        "packages/x/spec/b.ts",
        "src/A.Test.ts",
        "src/b.SPEC.tsx",
      ]) {
        expect(isTestFile(t), t).toBe(true);
      }
      for (const n of ["src/spec/a.ts", "docs/spec.md", "specs/a.ts"]) {
        expect(isTestFile(n), n).toBe(false);
      }
    });

    it("a deleted non-code file under a test directory is named as a fixture, not as a test", () => {
      expect(testChangeFlags([file("tests/fixtures/old-site.json", "removed")])).toEqual([
        {
          file: "tests/fixtures/old-site.json",
          reasons: ["fixture deleted (not a test's code): say why"],
        },
      ]);
      expect(testChangeFlags([file("tests/a.test.ts", "removed")])).toEqual([
        { file: "tests/a.test.ts", reasons: ["test file deleted"] },
      ]);
    });

    it("a non-code file under a test directory is not scanned, and its left-out patch is not flagged", () => {
      expect(
        testChangeFlags([
          file(
            "tests/fixtures/page.html",
            "modified",
            patch("-<p>expect(x).toBe(1)</p>", "+<p>gone</p>"),
          ),
          file("tests/fixtures/big.json", "modified", undefined, { changes: 9_000 }),
          file("tests/__snapshots__/a.test.ts.snap", "modified", undefined, { changes: 9_000 }),
        ]),
      ).toEqual([]);
    });

    it("an added .only is flagged: it skips every other test in the file", () => {
      for (const line of [
        'it.only("a", () => {});',
        'describe.only("b", () => {});',
        'test.concurrent.only("c", async () => {});',
        'fit("d", () => {});',
        'fdescribe("e", () => {});',
      ]) {
        const f = file(T, "modified", patch(" keep();", `+${line}`));
        expect(testChangeFlags([f]), line).toEqual([
          { file: T, reasons: [`added .only: ${line}`] },
        ]);
      }
      // A word, a read, or an unrelated `only` is not.
      for (const line of ["const only = pick(xs);", "if (opts.only) run();", 'logger.only("x");']) {
        expect(testChangeFlags([file(T, "modified", patch(" keep();", `+${line}`))]), line).toEqual(
          [],
        );
      }
    });

    it("an added { skip: true } or { todo: true } in a test's options is flagged", () => {
      for (const line of [
        'it("a", { skip: true }, () => {});',
        'test("b", { todo: true }, () => {});',
      ]) {
        const f = file(T, "modified", patch(" keep();", `+${line}`));
        expect(testChangeFlags([f]), line).toEqual([{ file: T, reasons: [`added skip: ${line}`] }]);
      }
    });

    it("any changed line in a test runner's config is flagged, added or removed", () => {
      for (const name of [
        "vitest.config.ts",
        "cockpit/vitest.config.mts",
        "vitest.workspace.ts",
        "playwright.config.ts",
      ]) {
        const f = file(
          name,
          "modified",
          patch('-    exclude: ["dist/**"],', '+    exclude: ["dist/**", "tests/slow/**"],'),
        );
        expect(testChangeFlags([f]), name).toEqual([
          {
            file: name,
            reasons: [
              'test runner config changed: -exclude: ["dist/**"],',
              'test runner config changed: +exclude: ["dist/**", "tests/slow/**"],',
            ],
          },
        ]);
      }
      // Round 1 (#1812): a removed project, one item of a multi-line array, a grepInvert.
      for (const line of [
        '-  { extends: true, test: { name: "node", include: ["tests/**/*.test.ts"] } },',
        '-      "tests/**/*.test.ts",',
        "+  grepInvert: /@slow/,",
      ]) {
        const f = file("vitest.config.ts", "modified", patch(" keep,", line));
        expect(testChangeFlags([f]), line).toEqual([
          {
            file: "vitest.config.ts",
            reasons: [`test runner config changed: ${line.slice(0, 1)}${line.slice(1).trim()}`],
          },
        ]);
      }
      // A line only moved or re-indented is not a change.
      expect(
        testChangeFlags([
          file("vitest.config.ts", "modified", patch('-  include: ["a"],', '+    include: ["a"],')),
        ]),
      ).toEqual([]);
      expect(
        testChangeFlags([
          file("src/exclude.ts", "modified", patch("-  exclude: 1,", "+  exclude: 2,")),
        ]),
      ).toEqual([]);
    });

    it("a removed assertion re-added without its trailing comment is not a removal", () => {
      const f = file(T, "modified", patch("-expect(x).toBe(1); // flaky", "+expect(x).toBe(1);"));
      expect(testChangeFlags([f])).toEqual([]);
      // A string is still compared whole: a // inside it is not a comment.
      const g = file(
        T,
        "modified",
        patch('-expect(u).toBe("http://a"); // x', '+expect(u).toBe("http://b");'),
      );
      expect(testChangeFlags([g])[0]?.reasons).toEqual([
        'removed assertion not re-added: expect(u).toBe("http://a"); // x',
      ]);
    });

    it("#1755: a matcher line opening with }) or ]) is an assertion line", () => {
      for (const line of [
        "}).toEqual({ a: 1 });",
        "]).toStrictEqual([1]);",
        "}).not.toThrow();",
        "})).resolves.toBe(1);",
      ]) {
        const f = file(T, "modified", patch(`-${line}`, " keep();"));
        expect(testChangeFlags([f]), line).toEqual([
          { file: T, reasons: [`removed assertion not re-added: ${line}`] },
        ]);
      }
      for (const line of ["});", "}).catch(() => {});", "]);"]) {
        expect(testChangeFlags([file(T, "modified", patch(`-${line}`, " keep();"))]), line).toEqual(
          [],
        );
      }
    });

    it("#1755: a type assertion's matcher line with generics or .returns is an assertion line", () => {
      for (const line of [
        ").toEqualTypeOf<{ a: number }>();",
        ").returns.toEqualTypeOf<string>();",
        ").parameters.toEqualTypeOf<[number]>();",
      ]) {
        const f = file(T, "modified", patch(`-${line}`, " keep();"));
        expect(testChangeFlags([f]), line).toEqual([
          { file: T, reasons: [`removed assertion not re-added: ${line}`] },
        ]);
      }
    });

    it("#1755: a line of an expected value written across lines is part of the assertion", () => {
      const f = file(
        T,
        "modified",
        [
          "@@ -10,6 +10,6 @@",
          "   expect(read()).toEqual({",
          "     id: 7,",
          "-    a: 1,",
          "+    a: 2,",
          "     b: [1, 2],",
          "   });",
          "   other({",
          "-    a: 1,",
          "+    a: 3,",
          "   });",
        ].join("\n"),
      );
      expect(testChangeFlags([f])).toEqual([
        { file: T, reasons: ["removed assertion not re-added: a: 1,"] },
      ]);
      // The value opened on a matcher line Prettier split off, and a value moved within it.
      const g = file(
        T,
        "modified",
        [
          "@@ -3,6 +3,6 @@",
          "   expect(",
          "     read(),",
          "   ).toEqual([",
          "-    1,",
          "     2,",
          "+    1,",
          "   ]);",
        ].join("\n"),
      );
      expect(testChangeFlags([g])).toEqual([]);
      const h = file(
        T,
        "modified",
        [
          "@@ -3,5 +3,5 @@",
          "   ).toMatchObject({",
          "-    ok: true,",
          "+    ok: false,",
          "   });",
        ].join("\n"),
      );
      expect(testChangeFlags([h])).toEqual([
        { file: T, reasons: ["removed assertion not re-added: ok: true,"] },
      ]);
    });

    it("round 1 (#1812): fit( must name a test; skip, todo and only may stand on their own line", () => {
      const flag = (line: string) =>
        testChangeFlags([file(T, "modified", patch(" keep();", `+${line}`))]);
      expect(flag('fit([req("price-signal", "met")]),')).toEqual([]);
      expect(flag("  skip: true,")[0]?.reasons).toEqual(["added skip: skip: true,"]);
      expect(flag('it("a", { only: true }, () => {});')[0]?.reasons).toEqual([
        'added skip: it("a", { only: true }, () => {});',
      ]);
    });

    it("round 1 (#1812): only a matcher opens a value, and a template literal left open does not", () => {
      const sorted = file(
        T,
        "modified",
        [
          "@@ -1,4 +1,4 @@",
          "   const s = arr.toSorted((a, b) => {",
          "-    return a - b;",
          "+    return b - a;",
          "   });",
        ].join("\n"),
      );
      expect(testChangeFlags([sorted])).toEqual([]);
      const snap = file(
        T,
        "modified",
        [
          "@@ -1,6 +1,6 @@",
          "   expect(x).toMatchInlineSnapshot(`",
          "     a: 1",
          "   `);",
          "   other({",
          "-    z: 1,",
          "+    z: 2,",
          "   });",
        ].join("\n"),
      );
      expect(testChangeFlags([snap])).toEqual([]);
    });

    it("round 1 (#1812): a long run of // takes linear time", () => {
      const t = "x//".repeat(40_000);
      const f = file(T, "modified", patch(`-${t}`, `+${t}y`));
      const at = performance.now();
      testChangeFlags([f]);
      expect(performance.now() - at).toBeLessThan(500);
    });

    it("round 2 (#1812): a comment on the matcher line still opens the value", () => {
      for (const opener of ["expect(x).toEqual({ // shape", "expect(x).toEqual({ /* shape */"]) {
        const f = file(
          T,
          "modified",
          ["@@ -1,4 +1,4 @@", `   ${opener}`, "-    a: 1,", "+    a: 2,", "   });"].join("\n"),
        );
        expect(testChangeFlags([f]), opener).toEqual([
          { file: T, reasons: ["removed assertion not re-added: a: 1,"] },
        ]);
      }
    });

    it("round 2 (#1812): fit( with a variable name or its title on the next line is a .only", () => {
      for (const line of ["fit(name, () => {", "fit("]) {
        const f = file(T, "modified", patch(" keep();", `+${line}`));
        expect(testChangeFlags([f]), line).toEqual([
          { file: T, reasons: [`added .only: ${line}`] },
        ]);
      }
    });

    it("round 2 (#1812): a runner config renamed, or with its patch left out, is flagged; a comment-only change is not", () => {
      expect(
        testChangeFlags([
          file("vitest.config.bak", "renamed", undefined, {
            previous_filename: "vitest.config.ts",
          }),
        ]),
      ).toEqual([
        {
          file: "vitest.config.bak",
          reasons: ["test runner config renamed from vitest.config.ts"],
        },
      ]);
      expect(
        testChangeFlags([file("vitest.config.ts", "modified", undefined, { changes: 900 })]),
      ).toEqual([
        {
          file: "vitest.config.ts",
          reasons: ["test runner config changed, and GitHub left out the patch: read the diff"],
        },
      ]);
      expect(
        testChangeFlags([
          file("vitest.config.ts", "modified", patch("-  // old note", "+  // new note")),
        ]),
      ).toEqual([]);
    });

    it("a stop says when a flagged file is written only outside the section, or only where a reader cannot see it", async () => {
      for (const [body, why] of [
        [
          `Test changes: none\n\n${T}: dup`,
          `${T} is written outside the "Test changes:" section, which ends at a heading, or at a blank line followed by anything but a list item`,
        ],
        [
          `Test changes:\n\n\`\`\`\n${T}\n\`\`\``,
          `${T} is written only where a reader cannot see it (an HTML comment, a fenced block or a link's destination), which does not count`,
        ],
        [
          `Test changes:\n- see below\n<!-- ${T} -->`,
          `${T} is written only where a reader cannot see it (an HTML comment, a fenced block or a link's destination), which does not count`,
        ],
        [
          `Tests changed: ${T}: why`,
          `${T} is written in the body, but not under a "Test changes:" line or heading`,
        ],
      ] as const) {
        const r = await land(
          [5],
          [
            [FILES(5), [files(WEAKENED)]],
            [VIEW(5), [view({ body })]],
          ],
        );
        expect(r.code, body).toBe(1);
        expect(r.lines.at(-1), body).toContain(why);
      }
      // Round 1 (#1812): a longer path is not a hidden mention of the flagged one.
      const r = await land(
        [5],
        [
          [FILES(5), [files(WEAKENED)]],
          [VIEW(5), [view({ body: `Test changes:\n- ${T}x: renamed` })]],
        ],
      );
      expect(r.code).toBe(1);
      expect(r.lines.at(-1)).not.toMatch(/is written/);
    });
  });
});
