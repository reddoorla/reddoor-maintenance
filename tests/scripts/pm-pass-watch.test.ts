import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  parseArgs,
  parseSchedule,
  scheduleLine,
  zonedToUtc,
  localDate,
  dueAt,
  realGit,
  watch,
  type Options,
  type FetchLike,
  type WatchResult,
} from "../../scripts/pm-pass-watch.mjs";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function sh(cwd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

type Commit = { at: string; files: Record<string, string> };

function fixture(commits: Commit[]): string {
  const dir = mkdtempSync(join(tmpdir(), "pm-watch-"));
  roots.push(dir);
  sh(dir, ["init", "-q", "--initial-branch=main"]);
  for (const c of commits) {
    for (const [path, body] of Object.entries(c.files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), body);
    }
    sh(dir, ["add", "-A"]);
    sh(
      dir,
      ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", `at ${c.at}`],
      {
        GIT_AUTHOR_DATE: c.at,
        GIT_COMMITTER_DATE: c.at,
      },
    );
  }
  return dir;
}

const pmPass = (cronOrLine: string) =>
  [
    "# PM pass",
    "",
    "- **Schedule:** `CRON_TZ=America/Los_Angeles 99 99 * * 1-4` (a decoy outside the block)",
    "",
    "### The Routine's stored prompt (both passes)",
    "",
    '- **Name:** "Reddoor Project Manager".',
    cronOrLine.startsWith("- ")
      ? cronOrLine
      : `- **Schedule:** \`CRON_TZ=America/Los_Angeles ${cronOrLine}\`. The zone is written into the cron.`,
    "- **Session:** a fresh session for each fire.",
    "",
  ].join("\n");

const PM = "docs/pm-pass.md";
const report = (date: string) => `docs/morning-reports/MORNING_REPORT_${date}.md`;
const MORNING = "# Morning report\n\n## One-line verdict\n\nAll fine.\n\n## Top of stack\n";
const EVENING = "\n## Evening\n\nNothing needs you tonight.\n";

const BASE: Commit = { at: "2026-10-05T23:00:00Z", files: { [PM]: pmPass("48 4,17 * * 1-4") } };

const OPTS: Options = {
  ref: "main",
  date: undefined,
  pass: "both",
  now: undefined,
  dryRun: false,
  testSend: false,
};

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function sender(status = 200, text = '{"id":"e_1"}') {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      headers: init.headers,
      body: JSON.parse(init.body) as Record<string, unknown>,
    });
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { calls, fetchImpl };
}

const ENV = { OPERATOR_EMAIL: "operator@example.com", RESEND_API_KEY: "re_test" };

async function run(
  dir: string,
  o: Partial<Options>,
  now: string,
  extra: { env?: Record<string, string>; status?: number; text?: string } = {},
): Promise<WatchResult & { calls: Call[] }> {
  const s = sender(extra.status, extra.text);
  const r = await watch(
    { ...OPTS, ...o },
    { git: realGit(dir), now: Date.parse(now), env: { ...ENV, ...extra.env }, fetch: s.fetchImpl },
  );
  return { ...r, calls: s.calls };
}

const verdicts = (r: WatchResult) => r.slots.map((s) => `${s.date} ${s.pass} ${s.verdict}`);

describe("parseSchedule — the two-pass cron in the stored-prompt block", () => {
  it("reads the current line and the 10-06 line", () => {
    const now = parseSchedule(scheduleLine(pmPass("48 4,12 * * 1-4")));
    expect(now?.cron).toBe("48 4,12 * * 1-4");
    expect(now?.zone).toBe("America/Los_Angeles");
    expect([...now!.days].sort()).toEqual([1, 2, 3, 4]);
    expect(parseSchedule(scheduleLine(pmPass("48 4,17 * * 1-4")))?.hours).toEqual([4, 17]);
  });

  it("reads only the line under the stored-prompt heading, never the decoy above it", () => {
    expect(scheduleLine(pmPass("48 4,12 * * 1-4"))).toContain("48 4,12");
    expect(
      scheduleLine("- **Schedule:** `CRON_TZ=America/Los_Angeles 48 4,12 * * 1-4`"),
    ).toBeNull();
  });

  it("refuses a one-hour cron, a bad zone and junk", () => {
    expect(parseSchedule(scheduleLine(pmPass("18 17 * * 1-4")))).toBeNull();
    expect(parseSchedule("- **Schedule:** `CRON_TZ=Not/AZone 48 4,12 * * 1-4`")).toBeNull();
    expect(parseSchedule("- **Schedule:** TBD")).toBeNull();
    expect(parseSchedule(null)).toBeNull();
  });
});

describe("time — the zone's real offset on D", () => {
  it("is −7 before 11-01 and −8 after", () => {
    expect(new Date(zonedToUtc("2026-10-06", 4, 48, "America/Los_Angeles")).toISOString()).toBe(
      "2026-10-06T11:48:00.000Z",
    );
    expect(new Date(zonedToUtc("2026-11-02", 4, 48, "America/Los_Angeles")).toISOString()).toBe(
      "2026-11-02T12:48:00.000Z",
    );
  });

  it("gives Monday's morning 120 minutes and the others 90 and 60", () => {
    const s = parseSchedule(scheduleLine(pmPass("48 4,12 * * 1-4")))!;
    expect(new Date(dueAt("2026-11-02", "morning", s)).toISOString()).toBe(
      "2026-11-02T14:48:00.000Z",
    );
    expect(new Date(dueAt("2026-10-07", "morning", s)).toISOString()).toBe(
      "2026-10-07T13:18:00.000Z",
    );
    expect(new Date(dueAt("2026-10-07", "second", s)).toISOString()).toBe(
      "2026-10-07T20:48:00.000Z",
    );
  });

  it("names today by the Los Angeles date", () => {
    expect(localDate(Date.parse("2026-10-09T00:30:00Z"))).toBe("2026-10-08");
  });
});

describe("parseArgs", () => {
  it("validates its inputs", () => {
    expect(parseArgs(["--date", "2026-10-06", "--pass", "second", "--dry-run"])).toMatchObject({
      date: "2026-10-06",
      pass: "second",
      dryRun: true,
    });
    expect(() => parseArgs(["--date", "10/06"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(["--date", "2026-11-31"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(["--pass", "evening"])).toThrow(/--pass/);
    expect(() => parseArgs(["--now", "2026-10-06T00:00:00"])).toThrow(/Z/);
  });
});

describe("watch — the positive control: on-time reports read ran and send nothing", () => {
  it("2026-10-06 under 48 4,17, both reports on time", async () => {
    const dir = fixture([
      BASE,
      { at: "2026-10-06T12:05:00Z", files: { [report("2026-10-06")]: MORNING } },
      { at: "2026-10-07T01:00:00Z", files: { [report("2026-10-06")]: MORNING + EVENING } },
    ]);
    const r = await run(dir, { date: "2026-10-06" }, "2026-10-07T12:00:00Z");
    expect(verdicts(r)).toEqual(["2026-10-06 morning ran", "2026-10-06 second ran"]);
    expect(r.lines[0]).toMatch(
      /^PM_WATCH date=2026-10-06 pass=morning schedule="48 4,17 \* \* 1-4" read=[0-9a-f]{8} due=2026-10-06T13:18:00Z verdict=ran$/,
    );
    expect(r.lines[1]).toContain("due=2026-10-07T01:48:00Z verdict=ran");
    expect(r.calls).toEqual([]);
    expect(r.code).toBe(0);
  });
});

describe("watch — misses", () => {
  it("a date with no report misses both passes and sends one email each", async () => {
    const dir = fixture([BASE, { at: "2026-10-07T03:00:00Z", files: { "other.md": "x" } }]);
    const r = await run(dir, { date: "2026-10-06" }, "2026-10-07T12:00:00Z");
    expect(verdicts(r)).toEqual(["2026-10-06 morning missed", "2026-10-06 second missed"]);
    expect(r.calls.map((c) => c.body.subject)).toEqual([
      "PM pass missed: 2026-10-06 morning",
      "PM pass missed: 2026-10-06 second",
    ]);
    expect(r.calls.map((c) => c.headers["Idempotency-Key"])).toEqual([
      "pm-pass-missed-2026-10-06-morning",
      "pm-pass-missed-2026-10-06-second",
    ]);
    expect(r.calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(r.calls[0]!.body.to).toEqual(["operator@example.com"]);
    expect(r.calls[0]!.body.from).toBe("Reddoor Reports <reports@reddoorla.com>");
    expect(r.code).toBe(0);
  });

  it("an evening-only stub is not a morning", async () => {
    const dir = fixture([
      BASE,
      { at: "2026-10-06T12:00:00Z", files: { [report("2026-10-06")]: "# 2026-10-06" + EVENING } },
    ]);
    const r = await run(dir, { date: "2026-10-06" }, "2026-10-07T12:00:00Z");
    expect(verdicts(r)).toEqual(["2026-10-06 morning missed", "2026-10-06 second ran"]);
  });

  it("`## Evenin` is not `## Evening`", async () => {
    const dir = fixture([
      BASE,
      {
        at: "2026-10-06T12:00:00Z",
        files: { [report("2026-10-06")]: MORNING + "\n## Evenin\n\nTypo.\n" },
      },
    ]);
    const r = await run(dir, { date: "2026-10-06" }, "2026-10-07T12:00:00Z");
    expect(verdicts(r)).toEqual(["2026-10-06 morning ran", "2026-10-06 second missed"]);
  });

  it("a report that lands after the due time is still a miss", async () => {
    const dir = fixture([
      BASE,
      { at: "2026-10-06T13:30:00Z", files: { [report("2026-10-06")]: MORNING } },
    ]);
    const r = await run(dir, { date: "2026-10-06", pass: "morning" }, "2026-10-07T12:00:00Z");
    expect(verdicts(r)).toEqual(["2026-10-06 morning missed"]);
  });

  it("a slot that is not yet due prints not-due and sends nothing", async () => {
    const dir = fixture([BASE]);
    const r = await run(dir, { date: "2026-10-06" }, "2026-10-06T13:00:00Z");
    expect(verdicts(r)).toEqual(["2026-10-06 morning not-due", "2026-10-06 second not-due"]);
    expect(r.calls).toEqual([]);
  });
});

describe("watch — a second pass due after midnight", () => {
  it("is still checked once now − window has crossed into D+1", async () => {
    const dir = fixture([
      BASE,
      { at: "2026-10-06T08:00:00Z", files: { [PM]: pmPass("30 4,23 * * 1-4") } },
      { at: "2026-10-07T12:00:00Z", files: { [report("2026-10-07")]: MORNING } },
    ]);
    const r = await run(dir, {}, "2026-10-09T03:10:00Z");
    expect(r.lines).toContain(
      `PM_WATCH date=2026-10-07 pass=second schedule="30 4,23 * * 1-4" read=${r.slots.find((x) => x.date === "2026-10-07")!.read} due=2026-10-08T07:30:00Z verdict=missed`,
    );
    expect(r.calls.map((c) => c.body.subject)).toContain("PM pass missed: 2026-10-07 second");
  });
});

describe("watch — Thursday 17:30 PT is 00:30Z Friday", () => {
  const dir = () =>
    fixture([
      BASE,
      { at: "2026-10-07T01:44:00Z", files: { [PM]: pmPass("48 4,12 * * 1-4") } },
      { at: "2026-10-08T12:00:00Z", files: { [report("2026-10-08")]: MORNING } },
    ]);

  it("the scheduled scan alarms on Thursday's missing second pass", async () => {
    const r = await run(dir(), {}, "2026-10-09T00:30:00Z");
    expect(verdicts(r)).toContain("2026-10-08 second missed");
    expect(r.calls.map((c) => c.body.subject)).toEqual(["PM pass missed: 2026-10-08 second"]);
  });

  it("a dispatch with pass=second and no date checks the Los Angeles today", async () => {
    const r = await run(dir(), { pass: "second" }, "2026-10-09T00:30:00Z");
    expect(verdicts(r)).toEqual(["2026-10-08 second missed"]);
    expect(r.calls).toHaveLength(1);
  });
});

describe("watch — non-pass days and the look-back window", () => {
  it("a Friday stays silent", async () => {
    const dir = fixture([BASE]);
    const r = await run(dir, { date: "2026-10-09" }, "2026-10-10T12:00:00Z");
    expect(r.slots).toEqual([]);
    expect(r.calls).toEqual([]);
    expect(r.code).toBe(0);
  });

  it("the Saturday scheduled scan finds nothing to check", async () => {
    const dir = fixture([BASE]);
    const r = await run(dir, {}, "2026-10-10T18:00:00Z");
    expect(r.slots).toEqual([]);
    expect(r.calls).toEqual([]);
  });

  it("drops a slot due more than the window ago", async () => {
    const dir = fixture([BASE]);
    const r = await run(dir, {}, "2026-10-07T12:00:00Z");
    expect(verdicts(r)).toEqual([
      "2026-10-06 second missed",
      "2026-10-07 morning not-due",
      "2026-10-07 second not-due",
    ]);
  });
});

describe("watch — which Schedule line counts", () => {
  it("a retime during D takes effect the next day", async () => {
    const dir = fixture([
      BASE,
      { at: "2026-10-06T12:05:00Z", files: { [report("2026-10-06")]: MORNING } },
      { at: "2026-10-06T21:00:00Z", files: { [PM]: pmPass("48 4,12 * * 1-4") } },
      { at: "2026-10-07T01:00:00Z", files: { [report("2026-10-06")]: MORNING + EVENING } },
    ]);
    const r = await run(dir, { date: "2026-10-06" }, "2026-10-07T12:00:00Z");
    expect(verdicts(r)).toEqual(["2026-10-06 morning ran", "2026-10-06 second ran"]);
    expect(r.lines[1]).toContain('schedule="48 4,17 * * 1-4"');
    const next = await run(dir, { date: "2026-10-07", pass: "second" }, "2026-10-08T12:00:00Z");
    expect(next.lines[0]).toContain('schedule="48 4,12 * * 1-4"');
    expect(next.lines[0]).toContain("due=2026-10-07T20:48:00Z");
  });

  it("a one-hour cron before 10-06 is not covered", async () => {
    const dir = fixture([
      { at: "2026-10-04T18:00:00Z", files: { [PM]: pmPass("18 17 * * 1-4") } },
      BASE,
    ]);
    const r = await run(dir, { date: "2026-10-05" }, "2026-10-06T12:00:00Z");
    expect(verdicts(r)).toEqual([
      "2026-10-05 morning not-covered",
      "2026-10-05 second not-covered",
    ]);
    expect(r.lines[0]).toContain("schedule=none");
    expect(r.calls).toEqual([]);
    expect(r.code).toBe(0);
  });
});

describe("watch — daylight saving ends 11-01", () => {
  const at = (landed: string) =>
    fixture([BASE, { at: landed, files: { [report("2026-11-02")]: MORNING } }]);

  it("Monday 11-02's morning is due 14:48Z; a 14:40Z report ran", async () => {
    const r = await run(
      at("2026-11-02T14:40:00Z"),
      { date: "2026-11-02", pass: "morning" },
      "2026-11-03T00:00:00Z",
    );
    expect(r.lines[0]).toContain("due=2026-11-02T14:48:00Z verdict=ran");
  });

  it("a 14:50Z report missed", async () => {
    const r = await run(
      at("2026-11-02T14:50:00Z"),
      { date: "2026-11-02", pass: "morning" },
      "2026-11-03T00:00:00Z",
    );
    expect(r.lines[0]).toContain("due=2026-11-02T14:48:00Z verdict=missed");
  });
});

describe("watch — blind, never silent", () => {
  it("a depth-1 clone is blind, even for a date it would call not-covered", async () => {
    const src = fixture([
      BASE,
      { at: "2026-10-07T03:00:00Z", files: { [report("2026-10-06")]: MORNING + EVENING } },
    ]);
    const shallow = mkdtempSync(join(tmpdir(), "pm-watch-shallow-"));
    roots.push(shallow);
    spawnSync("git", ["clone", "-q", "--depth", "1", `file://${src}`, shallow], {
      encoding: "utf-8",
    });
    expect(sh(shallow, ["rev-parse", "--is-shallow-repository"]).trim()).toBe("true");
    const r = await run(shallow, { date: "2026-10-05" }, "2026-10-07T12:00:00Z");
    expect(verdicts(r)).toEqual(["2026-10-05 morning blind", "2026-10-05 second blind"]);
    expect(r.code).toBe(1);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.headers["Idempotency-Key"]).toBe("pm-pass-watch-blind-2026-10-07");
    expect(String(r.calls[0]!.body.subject)).toMatch(
      /^PM pass watch is blind: no commit on main before/,
    );
  });

  it("a known-good line that does not read 48 4,17 is blind", async () => {
    const dir = fixture([
      { at: "2026-10-05T23:00:00Z", files: { [PM]: pmPass("48 4,12 * * 1-4") } },
      { at: "2026-10-06T12:05:00Z", files: { [report("2026-10-06")]: MORNING } },
    ]);
    const r = await run(dir, { date: "2026-10-06", pass: "morning" }, "2026-10-07T12:00:00Z");
    expect(verdicts(r)).toEqual(["2026-10-06 morning blind"]);
    expect(r.code).toBe(1);
    expect(String(r.calls[0]!.body.subject)).toMatch(/does not read 48 4,17$/);
  });

  it("a covered date whose line does not parse is blind, not not-covered", async () => {
    const dir = fixture([
      BASE,
      { at: "2026-10-06T20:00:00Z", files: { [PM]: pmPass("- **Schedule:** TBD") } },
    ]);
    const r = await run(dir, { date: "2026-10-07" }, "2026-10-08T12:00:00Z");
    expect(verdicts(r)).toEqual(["2026-10-07 morning blind", "2026-10-07 second blind"]);
    expect(r.code).toBe(1);
    expect(r.calls.map((c) => c.headers["Idempotency-Key"])).toEqual([
      "pm-pass-watch-blind-2026-10-08",
    ]);
  });
});

describe("watch — sending", () => {
  const missedDir = () => fixture([BASE]);

  it("a 409 invalid_idempotent_request counts as sent and leaves the run green", async () => {
    const r = await run(
      missedDir(),
      { date: "2026-10-06", pass: "morning" },
      "2026-10-07T12:00:00Z",
      {
        status: 409,
        text: '{"statusCode":409,"name":"invalid_idempotent_request","message":"This idempotency key has been used"}',
      },
    );
    expect(r.code).toBe(0);
    expect(r.sent.map((s) => s.status)).toEqual(["already-sent"]);
  });

  it("any other failure reds the run", async () => {
    const r = await run(
      missedDir(),
      { date: "2026-10-06", pass: "morning" },
      "2026-10-07T12:00:00Z",
      {
        status: 500,
        text: '{"name":"internal_server_error"}',
      },
    );
    expect(r.code).toBe(1);
    expect(r.lines.at(-1)).toMatch(/Resend answered 500/);
  });

  it("a repeat send is byte-identical", async () => {
    const a = await run(
      missedDir(),
      { date: "2026-10-06", pass: "morning" },
      "2026-10-07T12:00:00Z",
    );
    const b = await run(
      missedDir(),
      { date: "2026-10-06", pass: "morning" },
      "2026-10-07T18:00:00Z",
    );
    expect(a.calls[0]!.body.text).toBe(b.calls[0]!.body.text);
  });

  it("dry run sends nothing", async () => {
    const r = await run(missedDir(), { date: "2026-10-06", dryRun: true }, "2026-10-07T12:00:00Z", {
      env: { OPERATOR_EMAIL: "", RESEND_API_KEY: "" },
    });
    expect(verdicts(r)).toEqual(["2026-10-06 morning missed", "2026-10-06 second missed"]);
    expect(r.calls).toEqual([]);
    expect(r.code).toBe(0);
  });

  it("test_send sends exactly one [TEST] email, even with a slot missed", async () => {
    const r = await run(
      missedDir(),
      { date: "2026-10-06", testSend: true },
      "2026-10-07T12:00:00Z",
    );
    expect(r.calls.map((c) => c.body.subject)).toEqual([
      "[TEST] PM pass watch: the send path works",
    ]);
  });

  it("dry_run wins over test_send", async () => {
    const r = await run(
      missedDir(),
      { date: "2026-10-06", testSend: true, dryRun: true },
      "2026-10-07T12:00:00Z",
    );
    expect(r.calls).toEqual([]);
  });

  it("each test_send carries its run id in the key, so a second one is not replayed", async () => {
    const r = await run(
      missedDir(),
      { date: "2026-10-06", testSend: true },
      "2026-10-07T12:00:00Z",
      {
        env: { GITHUB_RUN_ID: "123" },
      },
    );
    expect(r.calls[0]!.headers["Idempotency-Key"]).toBe("pm-pass-watch-test-2026-10-07-123");
  });

  it("only a live run that finished is verified, so only it may close the failure issue", async () => {
    const live = await run(missedDir(), { date: "2026-10-06" }, "2026-10-07T12:00:00Z");
    const dry = await run(
      missedDir(),
      { date: "2026-10-06", dryRun: true },
      "2026-10-07T12:00:00Z",
    );
    const test = await run(
      missedDir(),
      { date: "2026-10-06", testSend: true },
      "2026-10-07T12:00:00Z",
    );
    const off = await run(missedDir(), { date: "2026-10-06" }, "2026-10-07T12:00:00Z", {
      env: { PM_WATCH: "off" },
    });
    expect([live, dry, test, off].map((r) => r.verified === true)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it("an empty OPERATOR_EMAIL fails the run rather than guessing", async () => {
    const r = await run(missedDir(), { date: "2026-10-06" }, "2026-10-07T12:00:00Z", {
      env: { OPERATOR_EMAIL: " " },
    });
    expect(r.code).toBe(1);
    expect(r.calls).toEqual([]);
  });

  it("PM_WATCH=off skips the run", async () => {
    const r = await run(missedDir(), { date: "2026-10-06" }, "2026-10-07T12:00:00Z", {
      env: { PM_WATCH: "off" },
    });
    expect(r.lines).toEqual(["PM_WATCH=off: skipped"]);
    expect(r.calls).toEqual([]);
    expect(r.code).toBe(0);
  });
});

describe("the workflow reads what the CLI writes to GITHUB_OUTPUT", () => {
  const script = join(__dirname, "../../scripts/pm-pass-watch.mjs");
  const workflow = readFileSync(
    join(__dirname, "../../.github/workflows/pm-pass-watch.yml"),
    "utf-8",
  );
  const onTime = () =>
    fixture([
      BASE,
      { at: "2026-10-06T12:05:00Z", files: { [report("2026-10-06")]: MORNING } },
      { at: "2026-10-07T01:00:00Z", files: { [report("2026-10-06")]: MORNING + EVENING } },
    ]);

  function cli(dir: string, args: string[], env: Record<string, string>) {
    const out = join(dir, "github-output");
    writeFileSync(out, "");
    const r = spawnSync(
      process.execPath,
      [script, "--ref", "main", "--date", "2026-10-06", "--now", "2026-10-07T12:00:00Z", ...args],
      {
        cwd: dir,
        encoding: "utf-8",
        env: { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: out, ...env },
      },
    );
    return { code: r.status, output: readFileSync(out, "utf-8") };
  }

  it("a live run that sent nothing and finished writes unverified=no", () => {
    expect(cli(onTime(), [], ENV)).toEqual({ code: 0, output: "unverified=no\n" });
  });

  it("a dry run and a PM_WATCH=off run write unverified=yes", () => {
    const dir = onTime();
    expect(cli(dir, ["--dry-run"], {}).output).toBe("unverified=yes\n");
    expect(cli(dir, [], { ...ENV, PM_WATCH: "off" }).output).toBe("unverified=yes\n");
  });

  it("the close step gates on that output of the step with id watch", () => {
    expect(workflow).toMatch(/- name: Watch the PM pass\n\s+id: watch\n/);
    expect(workflow).toContain(
      "if: success() && steps.watch.outputs.unverified != 'yes' && github.ref == 'refs/heads/main'",
    );
  });
});
