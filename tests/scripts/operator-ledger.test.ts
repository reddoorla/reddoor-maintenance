import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realRunner } from "../../scripts/land-prs.mjs";
import {
  parseArgs,
  ptMidnight,
  weekWindow,
  defaultWeek,
  askKind,
  askTimelines,
  askLedger,
  median,
  p90,
  staleAsks,
  fetchPrs,
  namedPrs,
  prLedger,
  ledger,
  formatLedger,
  type Runner,
  type PrLike,
} from "../../scripts/operator-ledger.mjs";

const SCRIPT = join(__dirname, "../../scripts/operator-ledger.mjs");
const REPO = "reddoorla/reddoor-maintenance";
const DAY = 86_400_000;
const T = (iso: string) => Date.parse(iso);
// The week ending Mon 2026-10-19 00:00 PT: [Mon 10-12 07:00Z, Mon 10-19 07:00Z), PDT.
const WEEK = "2026-10-19";
const START = T("2026-10-12T07:00:00Z");
const END = T("2026-10-19T07:00:00Z");

// ── a home base, built commit by commit with fixed dates ────────────────────────────

function decisionText(name: string, status: string, refs: string[] = []) {
  const m = /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})-/.exec(name)!;
  return [
    "---",
    `status: ${status}`,
    `asked: ${m[1]}T${m[2]}:${m[3]}Z`,
    "from: https://claude.ai/code/session_01FIXTURE",
    `refs: [${refs.join(", ")}]`,
    "---",
    "",
    "Should the fixture do the thing?",
    "",
    "## Answer",
    "",
    status === "answered" ? "Yes, do it." : "",
    "",
  ].join("\n");
}

function g(cwd: string, args: string[], date?: string) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  const r = spawnSync("git", args, { cwd, env, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

const REFS: Record<string, string[]> = {
  "2026-10-01-1200-old-open.md": [`${REPO}#10`],
  "2026-10-16-0000-answered-next-week.md": [`${REPO}#11`],
};

function commit(dir: string, date: string, files: Record<string, string>) {
  for (const [name, status] of Object.entries(files))
    writeFileSync(join(dir, "decisions", name), decisionText(name, status, REFS[name]));
  g(dir, ["add", "-A"]);
  g(dir, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", `at ${date}`], date);
}

/**
 * Hand-computed against the week ending 2026-10-19 00:00 PT:
 *   old-open                 asked 10-01 12:00Z, open throughout → open, oldest 17.8d,
 *                            stale (ref #10 merged 10-15)
 *   answered-last-week       asked and answered before the week → nothing
 *   answered-in-week         asked 10-13 00:00Z, answered 10-14 00:00Z → answered, 1.0d, born
 *   round-five-dirty         asked 10-14 00:00Z, answered 10-17 00:00Z → answered, 3.0d, born
 *                            (review-round stop)
 *   at-birth                 lands already answered → born, never open, never answered
 *   answered-next-week       asked 10-16, answered 10-20 → open at the end, born, not stale
 *                            (ref #11 merged after the end)
 *   sunday-morning           asked 10-18 12:00Z (Sun 5am PT) → born, open
 *   branch-only              only on a side branch → nothing
 * So: open 3, oldest 17.8d, stale 1; answered 2, median 2.0d, p90 3.0d, 1 at birth;
 * born 5 (review-round stop 1, other 4).
 */
function buildHome() {
  const dir = mkdtempSync(join(tmpdir(), "ledger-home-"));
  g(dir, ["init", "-q", "-b", "main"]);
  mkdirSync(join(dir, "decisions"));
  writeFileSync(join(dir, "decisions", "README.md"), "# Operator decisions\n");
  commit(dir, "2026-10-01T12:05:00Z", { "2026-10-01-1200-old-open.md": "open" });
  commit(dir, "2026-10-05T00:05:00Z", { "2026-10-05-0000-answered-last-week.md": "open" });
  commit(dir, "2026-10-08T00:00:00Z", { "2026-10-05-0000-answered-last-week.md": "answered" });
  commit(dir, "2026-10-13T00:30:00Z", { "2026-10-13-0000-answered-in-week.md": "open" });
  commit(dir, "2026-10-14T00:00:00Z", {
    "2026-10-13-0000-answered-in-week.md": "answered",
    "2026-10-14-0000-round-five-dirty.md": "open",
  });
  commit(dir, "2026-10-15T00:10:00Z", { "2026-10-15-0000-at-birth.md": "answered" });
  commit(dir, "2026-10-16T00:10:00Z", { "2026-10-16-0000-answered-next-week.md": "open" });
  commit(dir, "2026-10-17T00:00:00Z", { "2026-10-14-0000-round-five-dirty.md": "answered" });
  g(dir, ["checkout", "-qb", "side"]);
  commit(dir, "2026-10-17T01:00:00Z", { "2026-10-17-0000-branch-only.md": "open" });
  g(dir, ["checkout", "-q", "main"]);
  commit(dir, "2026-10-18T12:10:00Z", { "2026-10-18-1200-sunday-morning.md": "open" });
  commit(dir, "2026-10-20T00:00:00Z", { "2026-10-16-0000-answered-next-week.md": "answered" });
  return dir;
}

// ── GitHub, faked ──────────────────────────────────────────────────────────────────

const pr = (number: number, title: string, f: Partial<PrLike> = {}): PrLike => ({
  number,
  title,
  body: "",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: f.merged_at ?? f.closed_at ?? "2026-10-18T00:00:00Z",
  closed_at: f.merged_at ?? null,
  merged_at: null,
  user: { type: "User" },
  ...f,
});

/**
 * fix-of-fix 1 (#60 after #58), reverts 1 (#62), release open #50 waiting 3.0d,
 * release merged #63 after 5.0d.
 */
const OPEN_PRS: PrLike[] = [
  pr(50, "chore(release): version packages", { created_at: "2026-10-16T07:00:00Z" }),
  pr(70, "feat: still open", { created_at: "2026-10-14T00:00:00Z" }),
];
const CLOSED_PRS: PrLike[] = [
  pr(75, "chore(release): version packages", {
    created_at: "2026-10-17T07:00:00Z",
    merged_at: "2026-10-19T07:00:00Z",
  }), // merged exactly at the end: still open at it
  pr(66, "Revert x", { merged_at: "2026-10-19T07:00:00Z" }), // exactly the end: next week
  pr(67, "chore(release): version packages", {
    created_at: "2026-10-18T07:00:00Z",
    merged_at: "2026-10-19T08:00:00Z",
  }), // open at the end, merged after it
  pr(68, "fix: q", {
    body: "Context: #58 changed this file; fixes #30.",
    merged_at: "2026-10-17T00:00:00Z",
  }), // cites #58 for context only, and fixes a PR older than 7 days
  pr(62, 'Revert "feat: y"', { merged_at: "2026-10-16T00:00:00Z" }),
  pr(73, "fix: t (#74)", { merged_at: "2026-10-16T00:00:00Z" }), // exactly 7 days after #74
  pr(64, "fix: w (#60)", { closed_at: "2026-10-15T00:00:00Z" }), // closed, never merged
  pr(61, "fix: z", { body: "Follow-up to #40.", merged_at: "2026-10-15T00:00:00Z" }),
  pr(71, "fix: s again (#72)", { merged_at: "2026-10-15T00:00:00Z" }), // 8 days after #72
  pr(60, "fix(x): repair the y from #58", { merged_at: "2026-10-14T00:00:00Z" }),
  pr(63, "chore(release): version packages", {
    created_at: "2026-10-08T00:00:00Z",
    merged_at: "2026-10-13T00:00:00Z",
  }),
  pr(65, "fix(deps): update x", {
    body: "fixes #58",
    merged_at: "2026-10-12T10:00:00Z",
    user: { type: "Bot" },
  }),
  pr(69, 'Revert "feat: u"', { merged_at: "2026-10-12T07:00:00Z" }), // exactly the start: counts
  pr(58, "feat: y", { merged_at: "2026-10-10T00:00:00Z" }),
  pr(74, "feat: t", { merged_at: "2026-10-09T00:00:00Z" }),
  pr(72, "feat: s", { merged_at: "2026-10-07T00:00:00Z" }),
  pr(40, "feat: v", { merged_at: "2026-09-30T00:00:00Z" }),
  pr(30, "feat: old", { merged_at: "2026-09-01T00:00:00Z" }),
];
const ISSUES: Record<string, unknown> = {
  [`repos/${REPO}/issues/10`]: { pull_request: { merged_at: "2026-10-15T00:00:00Z" } },
  [`repos/${REPO}/issues/11`]: { pull_request: { merged_at: "2026-10-20T00:00:00Z" } },
  [`repos/${REPO}/issues/12`]: {
    pull_request: { merged_at: null },
    closed_at: "2026-10-15T00:00:00Z",
  },
  [`repos/${REPO}/issues/13`]: { closed_at: "2026-10-15T00:00:00Z" }, // an issue, not a PR
};

function fakeGh(perPage: number, calls: string[] = []): Runner {
  return async (cmd, args, opts) => {
    if (cmd === "git") return realRunner(cmd, args, opts);
    const path = args[1] ?? "";
    calls.push(path);
    if (path in ISSUES) return { code: 0, stdout: JSON.stringify(ISSUES[path]), stderr: "" };
    const m = /pulls\?state=(open|closed).*&page=(\d+)/.exec(path);
    if (!m) return { code: 1, stdout: "", stderr: `gh: Not Found (HTTP 404) ${path}` };
    const all = m[1] === "open" ? OPEN_PRS : CLOSED_PRS;
    const page = all.slice((Number(m[2]) - 1) * perPage, Number(m[2]) * perPage);
    return { code: 0, stdout: JSON.stringify(page), stderr: "" };
  };
}

// ── tests ───────────────────────────────────────────────────────────────────────────

describe("the week", () => {
  it("ends at 00:00 PT on the --week date and starts seven PT days before", () => {
    expect(weekWindow(WEEK)).toEqual({
      start: START,
      end: END,
      startDate: "2026-10-12",
      endDate: "2026-10-19",
    });
  });

  it("follows DST: the week ending 2026-11-02 is 7 days and 1 hour long", () => {
    const w = weekWindow("2026-11-02");
    expect(new Date(w.start).toISOString()).toBe("2026-10-26T07:00:00.000Z");
    expect(new Date(w.end).toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(ptMidnight(2026, 3, 9)).toBe(T("2026-03-09T07:00:00Z"));
  });

  it("defaults to the latest Monday PT, today when today is Monday", () => {
    expect(defaultWeek(T("2026-10-21T13:00:00Z"))).toBe("2026-10-19");
    expect(defaultWeek(T("2026-10-19T07:00:00Z"))).toBe("2026-10-19");
    // Sun 2026-10-18 11:59pm PT is still the week before.
    expect(defaultWeek(T("2026-10-19T06:59:00Z"))).toBe("2026-10-12");
  });
});

describe("parseArgs", () => {
  it("takes the home base and the flags", () => {
    expect(parseArgs(["/h", "--week", WEEK, "--rev", "main", "--json"])).toEqual({
      home: "/h",
      week: WEEK,
      rev: "main",
      repo: REPO,
      json: true,
    });
  });
  it("refuses a missing home base, a bad week, a stray flag and a flag as a value", () => {
    expect(() => parseArgs([])).toThrow(/home base path is required/);
    expect(() => parseArgs(["/h", "--week", "2026-02-30"])).toThrow(/--week needs YYYY-MM-DD/);
    expect(() => parseArgs(["/h", "--week", "2026-10-20"])).toThrow(/2026-10-20 is not a Monday/);
    expect(() => parseArgs(["/h", "--weeks", WEEK])).toThrow(/unknown argument/);
    expect(() => parseArgs(["/h", "--rev", "--json"])).toThrow(/--rev needs a value/);
    expect(() => parseArgs(["/h", "/i"])).toThrow(/one home base path only/);
  });
});

describe("percentiles and kinds", () => {
  it("median averages the middle two; p90 is nearest-rank", () => {
    expect(median([])).toBeNull();
    expect(median([1, 3])).toBe(2);
    expect(median([1, 2, 9])).toBe(2);
    expect(p90([1, 3])).toBe(3);
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe(10);
  });
  it("a review-round stop is named by its slug", () => {
    expect(askKind("od18-r2-round-five-dirty")).toBe("review-round stop");
    expect(askKind("hedloc-73-round-5")).toBe("review-round stop");
    expect(askKind("around-the-house")).toBe("other");
  });
});

describe("the asks, from a fixture home base", () => {
  let home: string;
  beforeAll(() => {
    home = buildHome();
  });

  it("reads only what is on the rev, with each file's status history", async () => {
    const { asks } = await askTimelines(home, "main");
    expect(asks.map((a) => a.file)).not.toContain("2026-10-17-0000-branch-only.md");
    expect(asks).toHaveLength(7);
    const a = asks.find((x) => x.file === "2026-10-13-0000-answered-in-week.md")!;
    expect(a.events).toEqual([
      { at: T("2026-10-13T00:30:00Z"), status: "open" },
      { at: T("2026-10-14T00:00:00Z"), status: "answered" },
    ]);
  });

  it("the branch-only ask counts once its branch is the rev (the control can go the other way)", async () => {
    const { asks } = await askTimelines(home, "side");
    expect(asks.map((a) => a.file)).toContain("2026-10-17-0000-branch-only.md");
  });

  it("matches the hand-computed ask lines", async () => {
    const { asks } = await askTimelines(home, "main");
    const l = askLedger(asks, { start: START, end: END });
    expect(l.open.map((o) => o.file)).toEqual([
      "2026-10-01-1200-old-open.md",
      "2026-10-16-0000-answered-next-week.md",
      "2026-10-18-1200-sunday-morning.md",
    ]);
    expect(l.open[0]?.ageMs).toBe(END - T("2026-10-01T12:00:00Z"));
    expect(l.answered).toEqual([
      { file: "2026-10-13-0000-answered-in-week.md", latencyMs: 1 * DAY },
      { file: "2026-10-14-0000-round-five-dirty.md", latencyMs: 3 * DAY },
    ]);
    expect(l.medianMs).toBe(2 * DAY);
    expect(l.p90Ms).toBe(3 * DAY);
    expect(l.atBirth).toEqual(["2026-10-15-0000-at-birth.md"]);
    expect(l.born).toHaveLength(5);
    expect(l.bornByKind).toEqual({ "review-round stop": 1, other: 4 });
    expect(l.unparsed).toEqual([]);
  });

  it("the answer that lands next week is answered in that week, and closes the ask there", async () => {
    const { asks } = await askTimelines(home, "main");
    const next = askLedger(asks, weekWindow("2026-10-26"));
    expect(next.answered.map((a) => a.file)).toEqual(["2026-10-16-0000-answered-next-week.md"]);
    expect(next.answered[0]?.latencyMs).toBe(4 * DAY);
    expect(next.open.map((o) => o.file)).toEqual([
      "2026-10-01-1200-old-open.md",
      "2026-10-18-1200-sunday-morning.md",
    ]);
    expect(next.born).toEqual([]);
  });

  it("refuses a shallow clone, whose cut-off history would date asks wrongly", async () => {
    const shallow = mkdtempSync(join(tmpdir(), "ledger-shallow-"));
    g(shallow, ["clone", "-q", "--depth", "2", `file://${home}`, "c"]);
    await expect(askTimelines(join(shallow, "c"), "HEAD")).rejects.toThrow(/shallow clone/);
  });

  it("refuses a rev that would reach git as an option", async () => {
    await expect(askTimelines(home, "--all")).rejects.toThrow(/may not start with -/);
  });
});

/**
 * The edges review rounds 1 and 2 reproduced, against the week ending 2026-10-19:
 *   oops           lands answered 10-05 by mistake, corrected to open an hour later → open
 *   typo-slug      lands as typo-slg 10-13 00:10Z, renamed and answered 10-14 00:00Z → answered
 *                  1.0d, not "at birth"
 *   reopened       open 01:05Z, answered 02:00Z, open again 03:00Z on 10-13 → open at the end,
 *                  and answered in the week (1h after asked 01:00Z)
 *   late-slug      lands as late-slg 10-13 02:10Z, answered 10-14 03:00Z; renamed 10-21 while
 *                  its answer grows past git's 50% → still answered in the week, 25h
 *   bad-status     lands with "status: Answered" → unparsed, never counted
 *   fixed-later    lands with "status: Answered", corrected to open → counted open, and named
 *                  as having an unreadable old version
 *   migrated       asked 10-15, reaches main open on 10-20 → open at the end, backfilled
 *   at-start       answered exactly at START → answered in the week, 7h
 *   birth-reopened lands answered 10-16, reopened 10-22 → still "at birth" for this week
 *   at-end         open 10-18, answered exactly at END → open at the end, not answered
 * The tag before-end marks the last commit before the week's end.
 */
function buildEdgeHome() {
  const dir = mkdtempSync(join(tmpdir(), "ledger-edge-"));
  g(dir, ["init", "-q", "-b", "main"]);
  mkdirSync(join(dir, "decisions"));
  commit(dir, "2026-10-05T00:10:00Z", { "2026-10-05-0000-oops.md": "answered" });
  commit(dir, "2026-10-05T01:10:00Z", { "2026-10-05-0000-oops.md": "open" });
  commit(dir, "2026-10-12T01:00:00Z", { "2026-10-12-0000-at-start.md": "open" });
  commit(dir, "2026-10-12T07:00:00Z", { "2026-10-12-0000-at-start.md": "answered" });
  commit(dir, "2026-10-13T00:10:00Z", { "2026-10-13-0000-typo-slg.md": "open" });
  commit(dir, "2026-10-13T01:05:00Z", { "2026-10-13-0100-reopened.md": "open" });
  commit(dir, "2026-10-13T02:00:00Z", { "2026-10-13-0100-reopened.md": "answered" });
  commit(dir, "2026-10-13T02:10:00Z", { "2026-10-13-0200-late-slg.md": "open" });
  commit(dir, "2026-10-13T03:00:00Z", { "2026-10-13-0100-reopened.md": "open" });
  g(dir, ["mv", "decisions/2026-10-13-0000-typo-slg.md", "decisions/2026-10-13-0000-typo-slug.md"]);
  commit(dir, "2026-10-14T00:00:00Z", { "2026-10-13-0000-typo-slug.md": "answered" });
  commit(dir, "2026-10-14T00:10:00Z", { "2026-10-14-0000-bad-status.md": "Answered" });
  commit(dir, "2026-10-14T01:10:00Z", { "2026-10-14-0100-fixed-later.md": "Answered" });
  commit(dir, "2026-10-14T02:00:00Z", { "2026-10-14-0100-fixed-later.md": "open" });
  commit(dir, "2026-10-14T03:00:00Z", { "2026-10-13-0200-late-slg.md": "answered" });
  commit(dir, "2026-10-16T00:10:00Z", { "2026-10-16-0000-birth-reopened.md": "answered" });
  commit(dir, "2026-10-18T01:00:00Z", { "2026-10-18-0000-at-end.md": "open" });
  g(dir, ["tag", "before-end"]);
  commit(dir, "2026-10-19T07:00:00Z", { "2026-10-18-0000-at-end.md": "answered" });
  commit(dir, "2026-10-20T00:00:00Z", { "2026-10-15-0000-migrated.md": "open" });
  g(dir, ["rm", "-q", "decisions/2026-10-13-0200-late-slg.md"]);
  writeFileSync(
    join(dir, "decisions", "2026-10-13-0200-late-slug.md"),
    decisionText("2026-10-13-0200-late-slug.md", "answered") +
      Array.from({ length: 30 }, (_, i) => `The answer grew, line ${i}.`).join("\n") +
      "\n",
  );
  g(dir, ["add", "-A"]);
  g(
    dir,
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "rename"],
    "2026-10-21T00:00:00Z",
  );
  commit(dir, "2026-10-22T00:00:00Z", { "2026-10-16-0000-birth-reopened.md": "open" });
  return dir;
}

describe("the asks, at the edges", () => {
  let edge: string;
  beforeAll(() => {
    edge = buildEdgeHome();
  });

  it("counts the status in force at the end, follows renames, names unreadable files", async () => {
    const { asks } = await askTimelines(edge, "main");
    const l = askLedger(asks, { start: START, end: END });
    expect(l.open.map((o) => o.file)).toEqual([
      "2026-10-05-0000-oops.md",
      "2026-10-13-0100-reopened.md",
      "2026-10-14-0100-fixed-later.md",
      "2026-10-15-0000-migrated.md",
      "2026-10-18-0000-at-end.md",
    ]);
    expect(l.backfilled).toEqual(["2026-10-15-0000-migrated.md"]);
    expect(l.answered).toEqual([
      { file: "2026-10-12-0000-at-start.md", latencyMs: 7 * 3_600_000 },
      { file: "2026-10-13-0000-typo-slug.md", latencyMs: 1 * DAY },
      { file: "2026-10-13-0100-reopened.md", latencyMs: 3_600_000 },
      { file: "2026-10-13-0200-late-slug.md", latencyMs: 25 * 3_600_000 },
    ]);
    expect(l.atBirth).toEqual(["2026-10-16-0000-birth-reopened.md"]);
    expect(l.unparsed).toEqual(["2026-10-14-0000-bad-status.md"]);
    expect(l.unreadable).toEqual(["2026-10-14-0100-fixed-later.md"]);
  });

  it("says in the header what it backfilled, could not parse, or could only partly read", async () => {
    const l = await ledger(
      { home: edge, week: WEEK, rev: "main", repo: REPO, json: false },
      { run: fakeGh(100) },
    );
    const head = formatLedger(l).split("\n")[0];
    expect(head).toContain(
      " · 1 open ask(s) reached main after the week and are counted from their asked time",
    );
    expect(head).toContain(" · 1 file(s) unparsed, not counted: 2026-10-14-0000-bad-status.md");
    expect(head).toContain(
      " · 1 file(s) with an unreadable old version, counted from the rest: 2026-10-14-0100-fixed-later.md",
    );
    expect(head).not.toContain("NOTE");
  });

  it("notes a rev whose newest commit is older than the week's end", async () => {
    const l = await ledger(
      { home: edge, week: WEEK, rev: "before-end", repo: REPO, json: false },
      { run: fakeGh(100) },
    );
    expect(formatLedger(l).split("\n")[0]).toContain(
      " · NOTE before-end's newest commit is older than the week's end; fetch it if it may be stale",
    );
  });

  it("never grafts one ask's history onto an unrelated ask added as another goes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-graft-"));
    g(dir, ["init", "-q", "-b", "main"]);
    mkdirSync(join(dir, "decisions"));
    writeFileSync(join(dir, "decisions", "README.md"), "# Operator decisions\n");
    commit(dir, "2026-10-01T00:10:00Z", { "2026-10-01-0000-gone.md": "open" });
    g(dir, ["rm", "-q", "decisions/2026-10-01-0000-gone.md"]);
    commit(dir, "2026-10-14T00:10:00Z", { "2026-10-14-0000-new.md": "open" });
    const { asks } = await askTimelines(dir, "main");
    expect(asks.map((x) => [x.file, x.events])).toEqual([
      [
        "2026-10-01-0000-gone.md",
        [
          { at: T("2026-10-01T00:10:00Z"), status: "open" },
          { at: T("2026-10-14T00:10:00Z"), status: "deleted" },
        ],
      ],
      ["2026-10-14-0000-new.md", [{ at: T("2026-10-14T00:10:00Z"), status: "open" }]],
    ]);
  });

  it("links a delete and an add only when each is alone with its ask time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-pair-"));
    g(dir, ["init", "-q", "-b", "main"]);
    mkdirSync(join(dir, "decisions"));
    writeFileSync(join(dir, "decisions", "README.md"), "# Operator decisions\n");
    commit(dir, "2026-10-02T00:10:00Z", {
      "2026-10-02-0000-a.md": "open",
      "2026-10-02-0000-b.md": "open",
    });
    g(dir, ["rm", "-q", "decisions/2026-10-02-0000-a.md", "decisions/2026-10-02-0000-b.md"]);
    writeFileSync(
      join(dir, "decisions", "2026-10-02-0000-c.md"),
      decisionText("2026-10-02-0000-c.md", "open") +
        Array.from({ length: 30 }, (_, i) => `Unrelated, line ${i}.`).join("\n") +
        "\n",
    );
    g(dir, ["add", "-A"]);
    g(
      dir,
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"],
      "2026-10-14T00:00:00Z",
    );
    const { asks } = await askTimelines(dir, "main");
    const gone = (f: string) => [
      f,
      [
        { at: T("2026-10-02T00:10:00Z"), status: "open" },
        { at: T("2026-10-14T00:00:00Z"), status: "deleted" },
      ],
    ];
    expect(asks.map((x) => [x.file, x.events])).toEqual([
      gone("2026-10-02-0000-a.md"),
      gone("2026-10-02-0000-b.md"),
      ["2026-10-02-0000-c.md", [{ at: T("2026-10-14T00:00:00Z"), status: "open" }]],
    ]);
  });

  it("still counts an ask in the weeks it lived through after it is deleted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-deleted-"));
    g(dir, ["init", "-q", "-b", "main"]);
    mkdirSync(join(dir, "decisions"));
    writeFileSync(join(dir, "decisions", "README.md"), "# Operator decisions\n");
    commit(dir, "2026-10-13T00:10:00Z", { "2026-10-13-0000-tidied.md": "open" });
    commit(dir, "2026-10-14T00:00:00Z", { "2026-10-13-0000-tidied.md": "answered" });
    g(dir, ["rm", "-q", "decisions/2026-10-13-0000-tidied.md"]);
    g(
      dir,
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "tidy"],
      "2026-11-02T00:00:00Z",
    );
    const { asks } = await askTimelines(dir, "main");
    const l = askLedger(asks, { start: START, end: END });
    expect(l.answered).toEqual([{ file: "2026-10-13-0000-tidied.md", latencyMs: 1 * DAY }]);
    expect(l.born).toEqual([{ file: "2026-10-13-0000-tidied.md", kind: "other" }]);
    expect(askLedger(asks, weekWindow("2026-11-09")).open).toEqual([]);
  });

  it("refuses a week that has not ended", async () => {
    await expect(
      ledger(
        { home: edge, week: "2026-10-26", rev: "main", repo: REPO, json: false },
        { run: fakeGh(3), now: T("2026-10-21T14:00:00Z") },
      ),
    ).rejects.toThrow(/has not ended yet/);
  });
});

/** A home base with a README, for the one-scenario tests below. */
function bareHome(tag: string) {
  const dir = mkdtempSync(join(tmpdir(), `ledger-${tag}-`));
  g(dir, ["init", "-q", "-b", "main"]);
  mkdirSync(join(dir, "decisions"));
  writeFileSync(join(dir, "decisions", "README.md"), "# Operator decisions\n");
  return dir;
}

/** Write one ask whose `asked` need not match its name, and commit it at `date`. */
function writeAsk(dir: string, date: string, name: string, asked: string, status: string) {
  const text = decisionText(name, status).replace(/^asked: .*$/m, `asked: ${asked}`);
  writeFileSync(join(dir, "decisions", name), text);
  g(dir, ["add", "-A"]);
  g(dir, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", name], date);
}

describe("the asks, at round 5's edges", () => {
  it("links a rename that corrects the ask time, so the old name never lingers", async () => {
    const dir = bareHome("hhmm");
    writeAsk(dir, "2026-10-14T00:10:00Z", "2026-10-14-0000-ask.md", "2026-10-14T00:05Z", "open");
    g(dir, ["mv", "decisions/2026-10-14-0000-ask.md", "decisions/2026-10-14-0005-ask.md"]);
    g(
      dir,
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "mv"],
      "2026-10-15T00:00:00Z",
    );
    const { asks } = await askTimelines(dir, "main");
    expect(asks.map((x) => [x.file, x.events.map((e) => e.status)])).toEqual([
      ["2026-10-14-0005-ask.md", ["open", "open"]],
    ]);
    const l = askLedger(asks, { start: START, end: END });
    expect(l.unparsed).toEqual([]);
    expect(l.open.map((o) => o.file)).toEqual(["2026-10-14-0005-ask.md"]);
  });

  it("counts once an ask whose name and asked time are both corrected after the week", async () => {
    const dir = bareHome("both");
    writeAsk(dir, "2026-10-14T00:10:00Z", "2026-10-14-0000-ask.md", "2026-10-14T00:00Z", "open");
    g(dir, ["rm", "-q", "decisions/2026-10-14-0000-ask.md"]);
    writeAsk(dir, "2026-10-21T00:00:00Z", "2026-10-14-0005-ask.md", "2026-10-14T00:05Z", "open");
    const { asks } = await askTimelines(dir, "main");
    const l = askLedger(asks, { start: START, end: END });
    expect(l.open.map((o) => o.file)).toEqual(["2026-10-14-0005-ask.md"]);
    expect(l.born).toHaveLength(1);
    expect(l.backfilled).toEqual([]);
  });

  it("an ask born answered and deleted in the same week is still answered at birth", async () => {
    const dir = bareHome("birth-deleted");
    writeAsk(dir, "2026-10-14T00:10:00Z", "2026-10-14-0000-ab.md", "2026-10-14T00:00Z", "answered");
    g(dir, ["rm", "-q", "decisions/2026-10-14-0000-ab.md"]);
    g(
      dir,
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "rm"],
      "2026-10-15T00:00:00Z",
    );
    const { asks } = await askTimelines(dir, "main");
    const l = askLedger(asks, { start: START, end: END });
    expect(l.atBirth).toEqual(["2026-10-14-0000-ab.md"]);
    expect(l.answered).toEqual([]);
  });

  it("never reads a subfolder as an ask", async () => {
    const dir = bareHome("subfolder");
    mkdirSync(join(dir, "decisions", "archive"));
    writeFileSync(join(dir, "decisions", "archive", "notes.md"), "# notes\n");
    writeAsk(dir, "2026-10-14T00:10:00Z", "2026-10-14-0000-ask.md", "2026-10-14T00:00Z", "open");
    const { asks } = await askTimelines(dir, "main");
    expect(asks.map((x) => x.file)).toEqual(["2026-10-14-0000-ask.md"]);
    expect(askLedger(asks, { start: START, end: END }).unparsed).toEqual([]);
  });

  it("an ask moved into a subfolder leaves the ledger then, as a delete does", async () => {
    const dir = bareHome("moved");
    writeAsk(dir, "2026-10-13T00:10:00Z", "2026-10-13-0000-ask.md", "2026-10-13T00:00Z", "open");
    mkdirSync(join(dir, "decisions", "archive"));
    g(dir, ["mv", "decisions/2026-10-13-0000-ask.md", "decisions/archive/2026-10-13-0000-ask.md"]);
    g(
      dir,
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "mv"],
      "2026-10-14T00:00:00Z",
    );
    const { asks } = await askTimelines(dir, "main");
    expect(asks.map((x) => [x.file, x.events.map((e) => e.status)])).toEqual([
      ["2026-10-13-0000-ask.md", ["open", "deleted"]],
    ]);
  });

  it("dates the first ask in PT, not UTC", async () => {
    const dir = bareHome("pt-date");
    // 03:00Z on 10-02 is 8pm PT on 10-01.
    writeAsk(dir, "2026-10-02T03:00:00Z", "2026-10-02-0000-ask.md", "2026-10-02T00:00Z", "open");
    const l = await ledger(
      { home: dir, week: "2026-10-05", rev: "main", repo: REPO, json: false },
      { run: fakeGh(100) },
    );
    expect(formatLedger(l).split("\n")[0]).toContain(
      " · PARTIAL the first ask reached main 2026-10-01;",
    );
  });
});

describe("GitHub lines", () => {
  it("names same-repo PRs from the title, and from the body only as the PR fixed", () => {
    expect(
      namedPrs(
        pr(9, "fix: a (#9) after #11", {
          body: [
            `Fixes #3, a follow-up to ${REPO}#4 and a regression from https://github.com/${REPO}/pull/5.`,
            "It fixes other/repo#6 and a/b#7; see #8, for context #12.",
          ].join("\n"),
        }),
        REPO,
      ).sort((a, b) => a - b),
    ).toEqual([3, 4, 5, 11]);
  });

  it("pages until a closed page reaches past `since`", async () => {
    const calls: string[] = [];
    const prs = await fetchPrs(REPO, T("2026-10-15T07:00:00Z"), fakeGh(3, calls), 3);
    expect(calls.filter((c) => c.includes("state=closed"))).toHaveLength(3);
    expect(prs.map((p) => p.number)).toContain(71);
    expect(prs.map((p) => p.number)).not.toContain(60);
    const one: string[] = [];
    const all = await fetchPrs(REPO, T("2026-10-18T07:00:00Z"), fakeGh(1, one), 1);
    expect(one.filter((c) => c.includes("state=open"))).toHaveLength(3);
    expect(all.map((p) => p.number)).toEqual(expect.arrayContaining([50, 70]));
  });

  it("matches the hand-computed PR lines", () => {
    const l = prLedger([...OPEN_PRS, ...CLOSED_PRS], { start: START, end: END }, REPO);
    expect(l).toEqual({
      releaseOpen: [
        { number: 50, waitMs: 3 * DAY },
        { number: 67, waitMs: 1 * DAY },
        { number: 75, waitMs: 2 * DAY },
      ],
      releaseMerged: [{ number: 63, waitMs: 5 * DAY }],
      fixOfFix: [
        { number: 60, of: [58] },
        { number: 73, of: [74] },
      ],
      reverts: [62, 69],
    });
  });

  it("an ask is stale when a ref PR merged after the ask and before the week's end", async () => {
    const s = await staleAsks(
      [
        { file: "a", asked: T("2026-10-01T12:00:00Z"), refs: [`${REPO}#10`] },
        { file: "b", asked: T("2026-10-16T00:00:00Z"), refs: [`${REPO}#11`] },
        { file: "c", asked: T("2026-10-16T00:00:00Z"), refs: [`${REPO}#10`] },
        { file: "d", asked: T("2026-10-16T00:00:00Z"), refs: [`${REPO}#999`] },
        { file: "e", asked: T("2026-10-01T00:00:00Z"), refs: [`${REPO}#12`, `${REPO}#999`] },
        { file: "f", asked: T("2026-10-01T00:00:00Z"), refs: [`${REPO}#13`] },
      ],
      END,
      fakeGh(100),
    );
    // e: a PR closed unmerged counts by closed_at; f: an issue never makes an ask stale.
    expect(s).toEqual({ stale: ["a", "e"], unchecked: [`${REPO}#999`] });
  });
});

describe("the ledger", () => {
  it("prints six lines with the hand-computed numbers", async () => {
    const home = buildHome();
    const l = await ledger(
      { home, week: WEEK, rev: "main", repo: REPO, json: false },
      { run: fakeGh(3), perPage: 3 },
    );
    const lines = formatLedger(l).trimEnd().split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatch(
      /^OPERATOR_LEDGER 2026-10-12 to 2026-10-18 PT \(ends 2026-10-19 12:00am PT\) · home base main @[0-9a-f]{7}$/,
    );
    expect(lines.slice(1)).toEqual([
      "open asks at week end: 3 · oldest 17.8d (2026-10-01-1200-old-open.md) · stale 1",
      "asks answered: 2 · repository latency (asked → answer committed on main, not response time) median 2.0d, p90 3.0d · 1 answered at birth, not counted",
      "asks born: 5 (other 4, review-round stop 1), a description, not a target",
      "release PRs: open at week end #50 3.0d, #67 1.0d, #75 2.0d · merged in the week #63 5.0d after opening",
      `fix-of-fix PRs within 7 days (a fix: PR naming the PR it fixes): 2 (#60 after #58; #73 after #74) · reverts: 2 (#62, #69) · ${REPO}`,
    ]);
  });

  it("marks a week that starts before the first ask reached main as PARTIAL", async () => {
    const home = buildHome();
    const head = async (week: string) =>
      formatLedger(
        await ledger({ home, week, rev: "main", repo: REPO, json: false }, { run: fakeGh(100) }),
      ).split("\n")[0];
    expect(await head("2026-10-05")).toContain(
      ` · PARTIAL the first ask reached main 2026-10-01; asks answered before then are in ${REPO} docs/BACKLOG.md, and only the asks migrated open are counted here (open, born)`,
    );
    expect(await head(WEEK)).not.toContain("PARTIAL");
  });

  it("the CLI refuses bad arguments with exit 2 and the usage", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--week", "x"], { encoding: "utf-8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^operator-ledger: --week needs YYYY-MM-DD: x\nusage: /);
  });
});
