import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  it("keeps a line added as the section's last line, just before the next heading", () => {
    const added = ["58. **Appended last.** _Ask:_ yes or no"];
    const d = decisionLines(withDecision(added), diffAdding(6, added), MAIN_BACKLOG);
    expect(d.onlyOnBranch.map((l) => l.line)).toEqual([6]);
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
  it("a longer branch name that starts with this one is not this one", () => {
    const r3 = withDecision(["70. Held on `claude/a11y-browser-missing-csp-r3`."]);
    expect(namedInSection(r3, "claude/a11y-browser-missing-csp")).toBe(false);
    expect(namedInSection(r3, "claude/a11y-browser-missing-csp-r3")).toBe(true);
    const dotted = withDecision(["70. Held on `claude/a11y-browser-missing-csp.v2`."]);
    expect(namedInSection(dotted, "claude/a11y-browser-missing-csp")).toBe(false);
    const sentence = withDecision(["70. Held on claude/a11y-browser-missing-csp."]);
    expect(namedInSection(sentence, "claude/a11y-browser-missing-csp")).toBe(true);
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
    expect(prCoverage(prs, tip)).toEqual({
      kind: "after-merge",
      pr: 1014,
      headSha: "b".repeat(40),
    });
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
    expect(classify({ ...base, decisions: d("   _pick:_ (a)") }, opts).ask).toBe(true);
    const status = classify({ ...base, decisions: d("- **10-05: landed.**") }, opts);
    expect(status.question).toBe(true);
    expect(status.ask).toBe(false);
  });
});

describe("parseArgs", () => {
  it("defaults", () => {
    const B = ["--backlog", "docs/BACKLOG.md"];
    expect(parseArgs(B)).toMatchObject({
      backlog: "docs/BACKLOG.md",
      base: "main",
      minAgeHours: 2,
      freshHours: 36,
      sinceDays: 7,
      fetch: true,
    });
    expect(parseArgs([...B, "--main-since", "2026-10-05T12:07:00Z"]).mainSince).toBe(
      "2026-10-05T12:07:00Z",
    );
    expect(() => parseArgs([...B, "--main-since", "yesterday"])).toThrow(/ISO/);
    expect(() => parseArgs([...B, "--main-since", "2026-10-05T12:07:00"])).toThrow(/offset/);
    expect(parseArgs([...B, "--main-since", "2026-10-05T05:07:00-07:00"]).mainSince).toBe(
      "2026-10-05T05:07:00-07:00",
    );
  });
  it("requires --backlog, with no default path", () => {
    expect(() => parseArgs([])).toThrow(/--backlog <path> is required/);
    expect(() => parseArgs(["--repo", REPO])).toThrow(/--backlog <path> is required/);
    expect(() => parseArgs(["--backlog"])).toThrow(/needs a value/);
    expect(parseArgs(["--backlog", "backlog/BACKLOG.md"]).backlog).toBe("backlog/BACKLOG.md");
  });
  it("refuses a --backlog that starts with ./ or ../: it is relative to the repo root", () => {
    expect(() => parseArgs(["--backlog", "./docs/BACKLOG.md"])).toThrow(
      /relative to the repo root/,
    );
    expect(() => parseArgs(["--backlog", "../BACKLOG.md"])).toThrow(/relative to the repo root/);
    expect(parseArgs(["--backlog", ".backlog/BACKLOG.md"]).backlog).toBe(".backlog/BACKLOG.md");
  });
  it("refuses an absolute --backlog at parse time, not later in git show (#1457)", () => {
    expect(() => parseArgs(["--backlog", "/home/op/repo/docs/BACKLOG.md"])).toThrow(
      /--backlog \/home\/op\/repo\/docs\/BACKLOG\.md: give the path relative to the repo root, not an absolute path/,
    );
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
  ancestor?: string;
  cherryFrom?: Record<string, number>;
  prs: PrLike[];
  backlog?: string;
  diff?: string;
}

const MORNING_SHA = "9".repeat(40);
const TODAY_ASK = ["58. **New today.** _Ask:_ keep or drop?"];

function fakeRun(
  branches: FakeBranch[],
  mainNow = MAIN_BACKLOG,
  mainDiff = "",
  revList = MORNING_SHA + "\n",
) {
  const calls: string[] = [];
  const run = async (cmd: string, args: string[]): Promise<RunResult> => {
    calls.push(`${cmd} ${args.join(" ")}`);
    if (cmd === "gh") {
      const raw = /head=reddoorla:(.+)$/.exec(args[1] ?? "")?.[1];
      const head = raw === undefined ? undefined : decodeURIComponent(raw);
      return ok(JSON.stringify(branches.find((b) => b.name === head)?.prs ?? []));
    }
    const [sub, ...rest] = args;
    if (sub === "rev-parse") return ok("/repo\n");
    if (sub === "fetch") return ok();
    if (sub === "rev-list") return ok(revList);
    if (sub === "merge-base") {
      const b = branches.find((x) => `origin/${x.name}` === rest[2]);
      return b?.ancestor === rest[1] ? ok() : { code: 1, stdout: "", stderr: "" };
    }
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
      const n = (rest[2] ? b?.cherryFrom?.[rest[2]] : undefined) ?? b?.cherryPlus ?? 0;
      const plus = Array.from({ length: n }, (_, i) => `+ p${i}`);
      const minus = Array.from({ length: b?.cherryMinus ?? 0 }, (_, i) => `- m${i}`);
      return ok([...minus, ...plus].join("\n"));
    }
    if (sub === "diff" && rest[1] === `${MORNING_SHA}..origin/main`) return ok(mainDiff);
    if (sub === "diff") {
      const b = branches.find((x) => rest[1]!.endsWith(`...origin/${x.name}`));
      if (b?.ancestor && rest[1]!.startsWith(b.ancestor)) return ok("");
      return ok(b?.diff ?? "");
    }
    return { code: 1, stdout: "", stderr: `unrouted: ${args.join(" ")}` };
  };
  return { run, calls };
}

const OPTS: Options = {
  repo: REPO,
  backlog: "docs/BACKLOG.md",
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
      /^EVENING_BRANCHES_SUMMARY asks=1 decision_lines=0 stale=3 stale_fresh=2 scanned=7 older_skipped=1 now=\S+ backlog=docs\/BACKLOG\.md$/,
    );
    expect(text).toContain("L6: - _Ask:_ (a) split the workflow");
    expect(text).toContain("older claude/last-week: 1 commit(s) not on main, no PR");
    expect(text).toContain("NEW   claude/jolly-keller-9h8tzh: 3 commit(s) not on main, no PR");
  });

  it("issues only reads: git rev-parse/fetch/for-each-ref/show/cherry/diff and gh api GET", async () => {
    const { run, calls } = fakeRun(branches);
    await eveningBranches(OPTS, { run, now: NOW });
    for (const c of calls) {
      expect(c).toMatch(
        /^(git rev-parse --show-toplevel$|git (fetch -q --prune origin|for-each-ref|show|cherry|diff -U0|rev-list -1 --first-parent|merge-base --is-ancestor) |gh api repos\/)/,
      );
      expect(c).not.toMatch(/--method|-X |push|DELETE/);
    }
  });

  it("--no-fetch does not fetch", async () => {
    const { run, calls } = fakeRun(branches);
    await eveningBranches({ ...OPTS, fetch: false }, { run, now: NOW });
    expect(calls.some((c) => c.startsWith("git fetch"))).toBe(false);
  });

  it("reads and diffs only the backlog path it is given", async () => {
    const { run, calls } = fakeRun(branches, withDecision(TODAY_ASK), diffAdding(6, TODAY_ASK));
    const rep = await eveningBranches(
      { ...OPTS, backlog: "BACKLOG.md", mainSince: "2026-10-05T12:07:00Z" },
      { run, now: NOW },
    );
    expect(rep.backlog).toBe("BACKLOG.md");
    expect(calls).toContain("git show origin/main:BACKLOG.md");
    expect(calls).toContain(`git show ${MORNING_SHA}:BACKLOG.md`);
    expect(calls.some((c) => /^git diff -U0 .* -- BACKLOG\.md$/.test(c))).toBe(true);
    expect(calls.filter((c) => c.includes("docs/BACKLOG.md"))).toEqual([]);
  });

  it("refuses to run without a backlog path", async () => {
    const { run, calls } = fakeRun(branches);
    const { backlog: _, ...noBacklog } = OPTS;
    await expect(eveningBranches(noBacklog as Options, { run, now: NOW })).rejects.toThrow(
      /needs o\.backlog/,
    );
    expect(calls).toEqual([]);
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
    expect(calls).toContain(
      "git rev-list -1 --first-parent --before=2026-10-05T12:07:00Z origin/main",
    );
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

  it("--main-since before main's first commit stops instead of reading as no lines", async () => {
    const { run } = fakeRun(branches, MAIN_BACKLOG, "", "");
    await expect(
      eveningBranches({ ...OPTS, mainSince: "2001-01-01T00:00:00Z" }, { run, now: NOW }),
    ).rejects.toThrow(/no commit before/);
  });

  it("a branch reused after its PR merged counts only the commits after that PR's head", async () => {
    const head = "c".repeat(40);
    const reused: FakeBranch[] = [
      {
        name: "claude/a11y-blend-mode-unmeasured",
        sha: "d".repeat(40),
        tipHoursAgo: 10,
        cherryPlus: 6,
        cherryFrom: { [head]: 1 },
        ancestor: head,
        prs: [
          { number: 1014, state: "closed", merged_at: "2026-09-30T00:00:00Z", head: { sha: head } },
        ],
        backlog: withDecision(ask),
        diff: diffAdding(6, ask),
      },
    ];
    const { run, calls } = fakeRun(reused);
    const rep = await eveningBranches(OPTS, { run, now: NOW });
    expect(calls).toContain(
      `git cherry origin/main origin/claude/a11y-blend-mode-unmeasured ${head}`,
    );
    expect(rep.branches[0]).toMatchObject({ ahead: 1, question: false, ask: false, stale: true });
  });

  it("a reused branch that only merged main back in has nothing of its own", async () => {
    const head = "c".repeat(40);
    const remerged: FakeBranch[] = [
      {
        name: "claude/reused-then-merged-main",
        sha: "f".repeat(40),
        tipHoursAgo: 10,
        cherryPlus: 2,
        cherryFrom: { [head]: 0 },
        ancestor: head,
        prs: [
          { number: 7, state: "closed", merged_at: "2026-10-01T00:00:00Z", head: { sha: head } },
        ],
      },
    ];
    const rep = await eveningBranches(OPTS, { run: fakeRun(remerged).run, now: NOW });
    expect(rep.branches[0]).toMatchObject({ ahead: 0, stale: false, question: false });
  });

  it("collapses status lines on an old branch into one name list", () => {
    const old = { onlyOnBranch: [{ line: 9, text: "- **09-30: answered.**" }], alreadyOnMain: [] };
    const mk = (branch: string, fresh: boolean) => ({
      ref: `origin/${branch}`,
      branch,
      sha: "a".repeat(40),
      subject: "s",
      tipTime: 0,
      ahead: 1,
      coverage: { kind: "none" as const },
      decisions: old,
      namedOnMain: false,
      ageHours: fresh ? 3 : 130,
      fresh,
      stale: true,
      question: true,
      ask: false,
    });
    const text = formatReport({
      repo: REPO,
      backlog: "docs/BACKLOG.md",
      base: "main",
      now: "x",
      minAgeHours: 2,
      freshHours: 36,
      sinceDays: 7,
      scanned: 2,
      olderSkipped: 0,
      mainDecisions: null,
      branches: [mk("claude/new-one", true), mk("claude/old-one", false)],
    });
    expect(text).toContain("- claude/new-one (no PR, 1 line(s)");
    expect(text).not.toContain("- claude/old-one (no PR, 1 line(s)");
    expect(text).toContain("older, not repeated: claude/old-one");
  });

  it("puts the branch name into the PR query percent-encoded", async () => {
    const { run, calls } = fakeRun([
      { name: "fix/a+b", sha: "e".repeat(40), tipHoursAgo: 5, cherryPlus: 1, prs: [] },
    ]);
    await eveningBranches(OPTS, { run, now: NOW });
    expect(calls.some((c) => c.endsWith("head=reddoorla:fix%2Fa%2Bb"))).toBe(true);
  });

  it("without --main-since there is no main section", async () => {
    const { run } = fakeRun(branches);
    expect((await eveningBranches(OPTS, { run, now: NOW })).mainDecisions).toBeNull();
  });
});

describe("the CLI, run on a real repository", () => {
  const SCRIPT = fileURLToPath(new URL("../../scripts/evening-branches.mjs", import.meta.url));
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });
  // Neither the host's git config nor an inherited GIT_* variable may reach the fixture: a
  // global commit.gpgsign broke every commit, an inherited GIT_DIR wrote into the caller's
  // repo, and an inherited GIT_OBJECT_DIRECTORY wrote the fixture's objects into a foreign
  // store (#1457). So every GIT_* key goes, and only then are the two config variables set.
  const isolated = (base: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
    const env = { ...base };
    for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
    return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  };
  const ISOLATED = isolated(process.env);
  const git = (cwd: string, args: string[], at?: string) => {
    const env = at ? { ...ISOLATED, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : ISOLATED;
    const r = spawnSync("git", args, { cwd, encoding: "utf-8", env });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const commit = (dir: string, body: string, at: string) => {
    writeFileSync(join(dir, "docs/BACKLOG.md"), body);
    git(dir, ["add", "-A"]);
    git(
      dir,
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        at,
      ],
      at,
    );
  };

  // The stand-in `gh` sits outside the repo, so no commit or checkout in it can touch it.
  const BIN = mkdtempSync(join(tmpdir(), "evening-branches-bin-"));
  roots.push(BIN);
  writeFileSync(join(BIN, "gh"), "#!/bin/sh\necho '[]'\n", { mode: 0o755 });
  const fixture = () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "evening-branches-")));
    roots.push(dir);
    git(dir, ["init", "-q", "--initial-branch=main"]);
    mkdirSync(join(dir, "docs"));
    commit(dir, MAIN_BACKLOG + "\n", "2026-10-05T10:00:00Z");
    commit(dir, withDecision(TODAY_ASK) + "\n", "2026-10-05T13:00:00Z");
    git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    return dir;
  };
  // Every PR lookup goes to the stand-in `gh`, which answers "no PRs" with no network.
  const report = (cwd: string, extra: string[]) => {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, "--repo", REPO, "--backlog", "docs/BACKLOG.md", "--no-fetch", ...extra],
      {
        cwd,
        encoding: "utf-8",
        env: { ...ISOLATED, PATH: `${BIN}:${process.env.PATH}` },
      },
    );
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    return r.stdout;
  };
  const summary = (cwd: string) =>
    report(cwd, ["--main-since", "2026-10-05T12:07:00Z", "--since-days", "0"]).split("\n")[0]!;

  it("--main-since reads the same lines from a subdirectory as from the root (#1348)", () => {
    const dir = fixture();
    expect(summary(dir)).toMatch(/^EVENING_BRANCHES_SUMMARY main_decision_lines=1 /);
    expect(summary(join(dir, "docs"))).toMatch(/^EVENING_BRANCHES_SUMMARY main_decision_lines=1 /);
  });

  it("from a subdirectory, a branch's ask under Operator decisions is still found (#1348)", () => {
    const dir = fixture();
    git(dir, ["checkout", "-q", "-b", "held"]);
    const branchAsk = ["59. **Held on a branch.** _Ask:_ ship or hold?"];
    commit(dir, withDecision([...TODAY_ASK, ...branchAsk]) + "\n", new Date().toISOString());
    git(dir, ["update-ref", "refs/remotes/origin/claude/held", "HEAD"]);
    git(dir, ["checkout", "-q", "main"]);
    const text = report(join(dir, "docs"), []);
    expect(text.split("\n")[0]).toMatch(/^EVENING_BRANCHES_SUMMARY asks=1 .* scanned=1 /);
    expect(text).toContain("- claude/held (no PR, 1 line(s)");
    expect(text).toContain(`L7: ${branchAsk[0]}`);
  });

  it("strips every inherited GIT_* key before it sets the two config variables (#1457)", () => {
    expect(isolated({ GIT_CONFIG_GLOBAL: "/x", GIT_DIR: "/y", HOME: "/h" })).toEqual({
      HOME: "/h",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    });
  });

  it("an inherited GIT_OBJECT_DIRECTORY does not reach the fixture's git (#1457)", () => {
    const dir = fixture();
    const foreign = mkdtempSync(join(tmpdir(), "evening-branches-foreign-objects-"));
    roots.push(foreign);
    writeFileSync(join(dir, "probe.txt"), "probe\n");
    const r = spawnSync("git", ["hash-object", "-w", "probe.txt"], {
      cwd: dir,
      encoding: "utf-8",
      env: isolated({ ...process.env, GIT_OBJECT_DIRECTORY: foreign }),
    });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(readdirSync(foreign)).toEqual([]);
    const sha = r.stdout.trim();
    expect(git(dir, ["cat-file", "-t", sha]).trim()).toBe("blob");
  });

  it("the summary line names the backlog as given, relative to the repo root, from any cwd (#1349)", () => {
    const dir = fixture();
    expect(summary(join(dir, "docs"))).toMatch(/ backlog=docs\/BACKLOG\.md$/);
  });
});
