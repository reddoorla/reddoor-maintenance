import { describe, it, expect } from "vitest";
import {
  parseArgs,
  sectionRange,
  addedLines,
  decisionLines,
  prCoverage,
  namedInSection,
  classify,
  eveningBranches,
  formatReport,
  type RunResult,
  type Options,
  type PrLike,
} from "../../scripts/evening-branches.mjs";

const REPO = "reddoorla/reddoor-maintenance";
const NOW = Date.parse("2026-10-05T14:30:00Z");
const hoursAgo = (h: number) => Math.floor((NOW - h * 3_600_000) / 1000);
const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });

const MAIN_BACKLOG = [
  "# Backlog",
  "## P1 — next",
  "- an item",
  "## Operator decisions (🔴 or product calls — agents prepare, never do)",
  "57. **D1 pull-sync.** Waiting on the build.",
  "## Done",
  "- old",
].join("\n");

const withDecision = (lines: string[]) =>
  [
    "# Backlog",
    "## P1 — next",
    "- an item",
    "## Operator decisions (🔴 or product calls — agents prepare, never do)",
    "57. **D1 pull-sync.** Waiting on the build.",
    ...lines,
    "## Done",
    "- old",
  ].join("\n");

const diffAdding = (at: number, lines: string[]) =>
  [
    "diff --git a/docs/BACKLOG.md b/docs/BACKLOG.md",
    "--- a/docs/BACKLOG.md",
    "+++ b/docs/BACKLOG.md",
    `@@ -5,0 +${at},${lines.length} @@ 57. **D1 pull-sync.**`,
    ...lines.map((l) => `+${l}`),
  ].join("\n");

describe("sectionRange", () => {
  it("spans from the Operator decisions heading to the next level-2 heading", () => {
    expect(sectionRange(MAIN_BACKLOG)).toEqual({ start: 4, end: 5 });
  });
  it("is null when the heading is absent", () => {
    expect(sectionRange("# x\n## P1\n- a")).toBeNull();
  });
  it("runs to the end of the file when no heading follows", () => {
    expect(sectionRange("## Operator decisions\n- a\n- b")).toEqual({ start: 1, end: 3 });
  });
});

describe("addedLines", () => {
  it("numbers added lines on the new side across hunks", () => {
    const d = ["+++ b/x", "@@ -1,0 +2,2 @@", "+a", "+b", "@@ -9 +11 @@ ctx", "-old", "+new"].join(
      "\n",
    );
    expect(addedLines(d)).toEqual([
      { line: 2, text: "a" },
      { line: 3, text: "b" },
      { line: 11, text: "new" },
    ]);
  });
});

describe("decisionLines", () => {
  it("keeps only added lines inside the section that main does not carry", () => {
    const added = [
      "   - _Ask:_ (a) split the workflow, or (b) a third round.",
      "57. **D1 pull-sync.** Waiting on the build.",
    ];
    const branch = withDecision(added);
    const d = decisionLines(branch, diffAdding(6, added), MAIN_BACKLOG);
    expect(d.onlyOnBranch.map((l) => l.line)).toEqual([6]);
    expect(d.alreadyOnMain.map((l) => l.line)).toEqual([7]);
  });
  it("ignores lines added outside the section", () => {
    const branch = MAIN_BACKLOG.replace("- an item", "- an item\n- _Ask:_ not a decision");
    const diff = ["+++ b/docs/BACKLOG.md", "@@ -3,0 +4 @@", "+- _Ask:_ not a decision"].join("\n");
    expect(decisionLines(branch, diff, MAIN_BACKLOG).onlyOnBranch).toEqual([]);
  });
});

describe("namedInSection", () => {
  it("is true only when the branch is named inside the Operator decisions section", () => {
    const carried = withDecision(["72. Held; the ask was on `claude/wizardly-brown-2ylvcv`."]);
    expect(namedInSection(carried, "claude/wizardly-brown-2ylvcv")).toBe(true);
    const elsewhere = MAIN_BACKLOG.replace(
      "- an item",
      "- an item on claude/wizardly-brown-2ylvcv",
    );
    expect(namedInSection(elsewhere, "claude/wizardly-brown-2ylvcv")).toBe(false);
  });
});

describe("prCoverage", () => {
  const tip = "a".repeat(40);
  it("an open PR covers the branch", () => {
    expect(prCoverage([{ number: 1143, state: "open", draft: true }], tip)).toEqual({
      kind: "open",
      pr: 1143,
      draft: true,
    });
  });
  it("a merged PR at the tip covers it", () => {
    const prs: PrLike[] = [
      { number: 1153, state: "closed", merged_at: "2026-10-05T14:20:00Z", head: { sha: tip } },
    ];
    expect(prCoverage(prs, tip).kind).toBe("merged");
  });
  it("commits after a merged PR are not covered", () => {
    const prs: PrLike[] = [
      {
        number: 1014,
        state: "closed",
        merged_at: "2026-09-29T00:00:00Z",
        head: { sha: "b".repeat(40) },
      },
    ];
    expect(prCoverage(prs, tip)).toEqual({ kind: "after-merge", pr: 1014 });
  });
  it("a closed, unmerged PR is not cover", () => {
    expect(prCoverage([{ number: 9, state: "closed", merged_at: null }], tip)).toEqual({
      kind: "closed",
      pr: 9,
    });
  });
  it("no PR at all", () => {
    expect(prCoverage([], tip)).toEqual({ kind: "none" });
  });
});

describe("classify", () => {
  const none = { onlyOnBranch: [], alreadyOnMain: [] };
  const opts = { now: NOW, minAgeHours: 2, freshHours: 36 };
  it("stale at the minimum age exactly, not a minute before", () => {
    const b = { ahead: 1, coverage: { kind: "none" as const }, decisions: none };
    expect(classify({ ...b, tipTime: hoursAgo(2) }, opts).stale).toBe(true);
    expect(classify({ ...b, tipTime: hoursAgo(2) + 60 }, opts).stale).toBe(false);
  });
  it("a branch with nothing off main is never flagged", () => {
    const c = classify(
      { ahead: 0, tipTime: hoursAgo(50), coverage: { kind: "none" }, decisions: none },
      opts,
    );
    expect(c.stale).toBe(false);
    expect(c.question).toBe(false);
  });
  it("an ask needs an Ask/Pick line or a trailing question mark", () => {
    const d = (text: string) => ({ onlyOnBranch: [{ line: 9, text }], alreadyOnMain: [] });
    const base = {
      ahead: 1,
      tipTime: hoursAgo(3),
      coverage: { kind: "open" as const, pr: 1, draft: false },
    };
    expect(classify({ ...base, decisions: d("- _Ask:_ (a) or (b)") }, opts).ask).toBe(true);
    expect(classify({ ...base, decisions: d("which colour comes back?") }, opts).ask).toBe(true);
    const status = classify({ ...base, decisions: d("- **10-05: landed.**") }, opts);
    expect(status.question).toBe(true);
    expect(status.ask).toBe(false);
  });
});

describe("parseArgs", () => {
  it("defaults", () => {
    expect(parseArgs([])).toMatchObject({
      base: "main",
      minAgeHours: 2,
      freshHours: 36,
      sinceDays: 7,
      fetch: true,
    });
    expect(parseArgs(["--main-since", "2026-10-05T12:07:00Z"]).mainSince).toBe(
      "2026-10-05T12:07:00Z",
    );
    expect(() => parseArgs(["--main-since", "yesterday"])).toThrow(/ISO/);
  });
  it("refuses an unknown flag and a missing value", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown/);
    expect(() => parseArgs(["--since-days"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--min-age-hours", "-1"])).toThrow();
  });
});

interface FakeBranch {
  name: string;
  sha: string;
  tipHoursAgo: number;
  cherryPlus: number;
  cherryMinus?: number;
  prs: PrLike[];
  backlog?: string;
  diff?: string;
}

const MORNING_SHA = "9".repeat(40);
const TODAY_ASK = ["58. **New today.** _Ask:_ keep or drop?"];

function fakeRun(branches: FakeBranch[], mainNow = MAIN_BACKLOG, mainDiff = "") {
  const calls: string[] = [];
  const run = async (cmd: string, args: string[]): Promise<RunResult> => {
    calls.push(`${cmd} ${args.join(" ")}`);
    if (cmd === "gh") {
      const head = /head=reddoorla:(.+)$/.exec(args[1] ?? "")?.[1];
      return ok(JSON.stringify(branches.find((b) => b.name === head)?.prs ?? []));
    }
    const [sub, ...rest] = args;
    if (sub === "fetch") return ok();
    if (sub === "rev-list") return ok(MORNING_SHA + "\n");
    if (sub === "for-each-ref")
      return ok(
        branches
          .map(
            (b) => `origin/${b.name}\t${b.sha}\t${hoursAgo(b.tipHoursAgo)}\tsubject of ${b.name}`,
          )
          .join("\n") + "\n",
      );
    if (sub === "show") {
      const [ref] = rest[0]!.split(":");
      if (ref === "origin/main") return ok(mainNow);
      if (ref === MORNING_SHA) return ok(MAIN_BACKLOG);
      const b = branches.find((x) => `origin/${x.name}` === ref);
      return b?.backlog
        ? ok(b.backlog)
        : { code: 128, stdout: "", stderr: "fatal: path not in tree" };
    }
    if (sub === "cherry") {
      const b = branches.find((x) => `origin/${x.name}` === rest[1]);
      const plus = Array.from({ length: b?.cherryPlus ?? 0 }, (_, i) => `+ p${i}`);
      const minus = Array.from({ length: b?.cherryMinus ?? 0 }, (_, i) => `- m${i}`);
      return ok([...minus, ...plus].join("\n"));
    }
    if (sub === "diff" && rest[1] === `${MORNING_SHA}..origin/main`) return ok(mainDiff);
    if (sub === "diff") {
      const b = branches.find((x) => rest[1] === `origin/main...origin/${x.name}`);
      return ok(b?.diff ?? "");
    }
    return { code: 1, stdout: "", stderr: `unrouted: ${args.join(" ")}` };
  };
  return { run, calls };
}

const OPTS: Options = {
  repo: REPO,
  base: "main",
  minAgeHours: 2,
  freshHours: 36,
  sinceDays: 7,
  mainSince: undefined,
  fetch: true,
  json: false,
};

describe("eveningBranches, end to end on a fake runner", () => {
  const ask = ["   - _Ask:_ (a) split the workflow; (b) a third round. _Pick:_ (a)."];
  const branches: FakeBranch[] = [
    {
      name: "claude/wizardly-brown-2ylvcv",
      sha: "1".repeat(40),
      tipHoursAgo: 16,
      cherryPlus: 5,
      prs: [{ number: 1143, state: "open", draft: true }],
      backlog: withDecision(ask),
      diff: diffAdding(6, ask),
    },
    {
      name: "claude/jolly-keller-9h8tzh",
      sha: "2".repeat(40),
      tipHoursAgo: 13,
      cherryPlus: 3,
      prs: [],
    },
    {
      name: "claude/awesome-bardeen-llz7v7",
      sha: "3".repeat(40),
      tipHoursAgo: 0.3,
      cherryPlus: 2,
      prs: [
        {
          number: 1153,
          state: "closed",
          merged_at: "2026-10-05T14:20:00Z",
          head: { sha: "3".repeat(40) },
        },
      ],
      backlog: withDecision(ask),
      diff: diffAdding(6, ask),
    },
    { name: "claude/working-now", sha: "4".repeat(40), tipHoursAgo: 0.5, cherryPlus: 1, prs: [] },
    {
      name: "claude/rebased-in",
      sha: "6".repeat(40),
      tipHoursAgo: 20,
      cherryPlus: 0,
      cherryMinus: 3,
      prs: [],
    },
    {
      name: "claude/declined",
      sha: "7".repeat(40),
      tipHoursAgo: 30,
      cherryPlus: 2,
      prs: [{ number: 9, state: "closed", merged_at: null }],
    },
    { name: "claude/last-week", sha: "8".repeat(40), tipHoursAgo: 100, cherryPlus: 1, prs: [] },
    { name: "fix/ancient", sha: "5".repeat(40), tipHoursAgo: 24 * 30, cherryPlus: 4, prs: [] },
  ];

  it("flags the held ask and the unprotected branches, and nothing else", async () => {
    const { run } = fakeRun(branches);
    const rep = await eveningBranches(OPTS, { run, now: NOW });
    const by = Object.fromEntries(rep.branches.map((b) => [b.branch, b]));
    expect(rep.scanned).toBe(7);
    expect(rep.olderSkipped).toBe(1);
    expect(by["claude/wizardly-brown-2ylvcv"]).toMatchObject({ ask: true, stale: false });
    expect(by["claude/jolly-keller-9h8tzh"]).toMatchObject({
      ask: false,
      stale: true,
      fresh: true,
    });
    expect(by["claude/awesome-bardeen-llz7v7"]).toMatchObject({
      ask: false,
      question: false,
      stale: false,
    });
    expect(by["claude/working-now"]).toMatchObject({ stale: false });
    expect(by["claude/last-week"]).toMatchObject({ stale: true, fresh: false });
    expect(by["claude/declined"]).toMatchObject({ stale: true, fresh: true });
    expect(by["claude/rebased-in"]).toMatchObject({ ahead: 0, stale: false, question: false });
  });

  it("the summary line counts what the sections list", async () => {
    const { run } = fakeRun(branches);
    const text = formatReport(await eveningBranches(OPTS, { run, now: NOW }));
    expect(text.split("\n")[0]).toMatch(
      /^EVENING_BRANCHES_SUMMARY asks=1 decision_lines=0 stale=3 stale_fresh=2 scanned=7 older_skipped=1 /,
    );
    expect(text).toContain("L6: - _Ask:_ (a) split the workflow");
    expect(text).toContain("older claude/last-week: 1 commit(s) not on main, no PR");
    expect(text).toContain("NEW   claude/jolly-keller-9h8tzh: 3 commit(s) not on main, no PR");
  });

  it("issues only reads: git fetch/for-each-ref/show/cherry/diff and gh api GET", async () => {
    const { run, calls } = fakeRun(branches);
    await eveningBranches(OPTS, { run, now: NOW });
    for (const c of calls) {
      expect(c).toMatch(
        /^(git (fetch -q --prune origin|for-each-ref|show|cherry|diff -U0|rev-list -1) |gh api repos\/)/,
      );
      expect(c).not.toMatch(/--method|-X |push|DELETE/);
    }
  });

  it("--no-fetch does not fetch", async () => {
    const { run, calls } = fakeRun(branches);
    await eveningBranches({ ...OPTS, fetch: false }, { run, now: NOW });
    expect(calls.some((c) => c.startsWith("git fetch"))).toBe(false);
  });

  it("a failed PR lookup stops the run instead of reading as no PR", async () => {
    const { run } = fakeRun(branches);
    const failing = async (cmd: string, args: string[]): Promise<RunResult> =>
      cmd === "gh" ? { code: 1, stdout: "", stderr: "HTTP 403" } : run(cmd, args);
    await expect(eveningBranches(OPTS, { run: failing, now: NOW })).rejects.toThrow(/403/);
  });

  it("--main-since lists the Operator decisions lines main gained since that time", async () => {
    const { run, calls } = fakeRun(branches, withDecision(TODAY_ASK), diffAdding(6, TODAY_ASK));
    const rep = await eveningBranches(
      { ...OPTS, mainSince: "2026-10-05T12:07:00Z" },
      { run, now: NOW },
    );
    expect(calls).toContain("git rev-list -1 --before=2026-10-05T12:07:00Z origin/main");
    expect(rep.mainDecisions?.lines).toEqual([{ line: 6, text: TODAY_ASK[0] }]);
    const text = formatReport(rep);
    expect(text.split("\n")[0]).toMatch(/^EVENING_BRANCHES_SUMMARY main_decision_lines=1 asks=1 /);
    expect(text).toContain("L6: 58. **New today.** _Ask:_ keep or drop?");
  });

  it("marks an ask whose branch main already names", async () => {
    const carried = withDecision(["72. Held; the ask was on `claude/wizardly-brown-2ylvcv`."]);
    const rep = await eveningBranches(OPTS, { run: fakeRun(branches, carried).run, now: NOW });
    const b = rep.branches.find((x) => x.branch === "claude/wizardly-brown-2ylvcv");
    expect(b).toMatchObject({ ask: true, namedOnMain: true });
    expect(formatReport(rep)).toContain("already names this branch");
    const plain = await eveningBranches(OPTS, { run: fakeRun(branches).run, now: NOW });
    expect(
      plain.branches.find((x) => x.branch === "claude/wizardly-brown-2ylvcv")?.namedOnMain,
    ).toBe(false);
  });

  it("without --main-since there is no main section", async () => {
    const { run } = fakeRun(branches);
    expect((await eveningBranches(OPTS, { run, now: NOW })).mainDecisions).toBeNull();
  });
});
