import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const METER = fileURLToPath(new URL("../../scripts/meta-week/token-meter.mjs", import.meta.url));

/**
 * The meter is tested as a subprocess against a generated transcript tree, so the
 * exact entry point that runs on the real corpus is the thing under test.
 *
 * Fixture shape (all timestamps UTC):
 *   alpha/sess-1.jsonl          main lane, repo alpha via cwd
 *     r1 partial (out 5) then r1 final (out 50, in 10, cc 1000, cr 20000, effort xhigh,
 *        skill superpowers:brainstorming)          -> one request, final snapshot wins
 *     r2 (out 20, in 10, cc 500, cr 30000)          2026-09-02T12:00Z
 *     r3 model <synthetic> (out 999)                must be ignored
 *     compact_boundary manual preTokens 123456      2026-09-02T13:00Z
 *     limit block "You've hit your session limit"   2026-09-02T14:00Z (no usage)
 *   alpha/sess-1-resumed.jsonl  replays r1 final and r2 verbatim -> must not double count
 *   alpha/sess-1/subagents/agent-1.jsonl
 *     r4 sidechain, general-purpose, claude-sonnet-5 (out 7, in 2, cc 100, cr 5000)
 *                                                   2026-09-02T11:00Z
 *   beta/sess-2.jsonl           cwd is a worktree path under beta
 *     r5 (out 3)                                    2026-09-01T10:00Z
 *     r6 (out 4)                                    2026-09-04T03:30Z  (= 2026-09-03 20:30 PDT)
 *     r7 (out 6)                                    2026-09-03T10:00Z
 *
 * Expected totals, all lanes: requests 6, in 25, out 90, cacheCreate 1600, cacheRead 55000.
 */

const ALPHA = "/Users/x/Documents/GitHub/alpha";
const BETA_WT = "/Users/x/Documents/GitHub/beta/.claude/worktrees/w1";

type Usage = { inp?: number; out: number; cc?: number; cr?: number };
type AssistantOpts = Usage & {
  ts: string;
  requestId: string;
  uuid?: string;
  model?: string;
  sidechain?: boolean;
  agent?: string;
  effort?: string;
  skill?: string;
  text?: string;
  cwd?: string;
  sessionId?: string;
  noUsage?: boolean;
};

function assistant(o: AssistantOpts): string {
  const rec: Record<string, unknown> = {
    type: "assistant",
    uuid: o.uuid ?? `u-${o.requestId}-${o.out}`,
    requestId: o.requestId,
    timestamp: o.ts,
    sessionId: o.sessionId ?? "sess-1",
    isSidechain: o.sidechain ?? false,
    cwd: o.cwd ?? ALPHA,
    message: {
      role: "assistant",
      model: o.model ?? "claude-opus-5",
      content: [{ type: "text", text: o.text ?? "hi" }],
      ...(o.noUsage
        ? {}
        : {
            usage: {
              input_tokens: o.inp ?? 1,
              output_tokens: o.out,
              cache_creation_input_tokens: o.cc ?? 0,
              cache_read_input_tokens: o.cr ?? 0,
            },
          }),
    },
  };
  if (o.agent) rec.attributionAgent = o.agent;
  if (o.effort) rec.effort = o.effort;
  if (o.skill) rec.attributionSkill = o.skill;
  if (o.sidechain) rec.agentId = "agent-1";
  return JSON.stringify(rec);
}

function compaction(ts: string, trigger: string, preTokens: number): string {
  return JSON.stringify({
    type: "system",
    subtype: "compact_boundary",
    uuid: `c-${ts}`,
    timestamp: ts,
    sessionId: "sess-1",
    isSidechain: false,
    cwd: ALPHA,
    content: "Conversation compacted",
    compactMetadata: { trigger, preTokens },
  });
}

const USER_LINE = JSON.stringify({
  type: "user",
  uuid: "u0",
  timestamp: "2026-09-02T10:00:00Z",
  sessionId: "sess-1",
  isSidechain: false,
  cwd: ALPHA,
  message: { role: "user", content: "go" },
});

const R1_FINAL = assistant({
  ts: "2026-09-02T10:00:02Z",
  requestId: "r1",
  uuid: "a2",
  out: 50,
  inp: 10,
  cc: 1000,
  cr: 20000,
  effort: "xhigh",
  skill: "superpowers:brainstorming",
});
const R2 = assistant({
  ts: "2026-09-02T12:00:00Z",
  requestId: "r2",
  uuid: "a3",
  out: 20,
  inp: 10,
  cc: 500,
  cr: 30000,
});
const COMPACTION = compaction("2026-09-02T13:00:00Z", "manual", 123456);
const BLOCK = assistant({
  ts: "2026-09-02T14:00:00Z",
  requestId: "rb",
  uuid: "ab",
  out: 0,
  noUsage: true,
  text: "You've hit your session limit · resets 2pm (America/Los_Angeles)",
});

const STATS_PASS = {
  dailyModelTokens: [
    { date: "2026-09-01", tokensByModel: { "claude-opus-5": 4 } },
    { date: "2026-09-02", tokensByModel: { "claude-opus-5": 90, "claude-sonnet-5": 9 } },
    { date: "2026-09-04", tokensByModel: { "claude-opus-5": 5 } },
  ],
};
const STATS_FAIL = {
  dailyModelTokens: [
    { date: "2026-09-01", tokensByModel: { "claude-opus-5": 4 } },
    { date: "2026-09-02", tokensByModel: { "claude-opus-5": 180, "claude-sonnet-5": 9 } },
    { date: "2026-09-04", tokensByModel: { "claude-opus-5": 5 } },
  ],
};

let root: string;
let statsPass: string;
let statsFail: string;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "token-meter-"));
  root = join(dir, "projects");
  const alpha = join(root, "-Users-x-Documents-GitHub-alpha");
  const beta = join(root, "-Users-x-Documents-GitHub-beta");
  await mkdir(join(alpha, "sess-1", "subagents"), { recursive: true });
  await mkdir(beta, { recursive: true });

  await writeFile(
    join(alpha, "sess-1.jsonl"),
    [
      USER_LINE,
      assistant({ ts: "2026-09-02T10:00:01Z", requestId: "r1", uuid: "a1", out: 5, inp: 10 }),
      R1_FINAL,
      R2,
      assistant({ ts: "2026-09-02T12:30:00Z", requestId: "r3", out: 999, model: "<synthetic>" }),
      COMPACTION,
      BLOCK,
      "",
    ].join("\n"),
  );
  // A resumed session replays its history verbatim: usage, the compaction marker AND the
  // block message all appear again. None of them may count twice.
  await writeFile(
    join(alpha, "sess-1-resumed.jsonl"),
    [R1_FINAL, R2, COMPACTION, BLOCK, ""].join("\n"),
  );
  await writeFile(
    join(alpha, "sess-1", "subagents", "agent-1.jsonl"),
    [
      assistant({
        ts: "2026-09-02T11:00:00Z",
        requestId: "r4",
        out: 7,
        inp: 2,
        cc: 100,
        cr: 5000,
        sidechain: true,
        agent: "general-purpose",
        model: "claude-sonnet-5",
      }),
      "",
    ].join("\n"),
  );
  await writeFile(
    join(beta, "sess-2.jsonl"),
    [
      assistant({
        ts: "2026-09-01T10:00:00Z",
        requestId: "r5",
        out: 3,
        cwd: BETA_WT,
        sessionId: "sess-2",
      }),
      assistant({
        ts: "2026-09-04T03:30:00Z",
        requestId: "r6",
        out: 4,
        cwd: BETA_WT,
        sessionId: "sess-2",
      }),
      assistant({
        ts: "2026-09-03T10:00:00Z",
        requestId: "r7",
        out: 6,
        cwd: BETA_WT,
        sessionId: "sess-2",
      }),
      "",
    ].join("\n"),
  );
  statsPass = join(dir, "stats-pass.json");
  statsFail = join(dir, "stats-fail.json");
  await writeFile(statsPass, JSON.stringify(STATS_PASS));
  await writeFile(statsFail, JSON.stringify(STATS_FAIL));
});

async function meter(args: string[]): Promise<{ out: string; json: Record<string, unknown> }> {
  const jsonPath = join(root, "..", `out-${Math.random().toString(36).slice(2)}.json`);
  const { stdout } = await execFileAsync("node", [
    METER,
    "--root",
    root,
    "--json",
    jsonPath,
    ...args,
  ]);
  return { out: stdout, json: JSON.parse(await readFile(jsonPath, "utf-8")) };
}

type Sum = { requests: number; in: number; out: number; cacheCreate: number; cacheRead: number };
type Group = Sum & { key: string };

describe("token-meter: totals", () => {
  it("dedupes by requestId keeping the final snapshot, ignores <synthetic> and usage-less records, and survives replay", async () => {
    const { json } = await meter([]);
    expect(json.total).toEqual({
      requests: 6,
      in: 25,
      out: 90,
      cacheCreate: 1600,
      cacheRead: 55000,
    });
  });

  it("splits lanes: main vs subagent", async () => {
    const main = await meter(["--lane", "main"]);
    const sub = await meter(["--lane", "subagent"]);
    expect((main.json.total as Sum).out).toBe(83);
    expect((sub.json.total as Sum).out).toBe(7);
  });
});

function group(json: Record<string, unknown>, key: string): Group | undefined {
  return (json.groups as Group[]).find((g) => g.key === key);
}

describe("token-meter: dimensions", () => {
  it("attributes repo from cwd, including worktree paths", async () => {
    const { json } = await meter(["--by", "repo"]);
    expect(group(json, "alpha")?.out).toBe(77);
    expect(group(json, "beta")?.out).toBe(13);
  });

  it("buckets days in the requested timezone", async () => {
    const utc = await meter(["--by", "day", "--tz", "UTC"]);
    expect((utc.json.groups as Group[]).map((g) => [g.key, g.out])).toEqual([
      ["2026-09-01", 3],
      ["2026-09-02", 77],
      ["2026-09-03", 6],
      ["2026-09-04", 4],
    ]);
    const la = await meter(["--by", "day", "--tz", "America/Los_Angeles"]);
    expect((la.json.groups as Group[]).map((g) => [g.key, g.out])).toEqual([
      ["2026-09-01", 3],
      ["2026-09-02", 77],
      ["2026-09-03", 10],
    ]);
  });

  it("reports ISO weeks", async () => {
    const { json } = await meter(["--by", "week", "--tz", "UTC"]);
    expect((json.groups as Group[]).map((g) => g.key)).toEqual(["2026-W36"]);
  });

  it("groups by lane, model, effort, agent and skill, and by two dims at once", async () => {
    expect(group((await meter(["--by", "lane"])).json, "subagent")?.out).toBe(7);
    expect(group((await meter(["--by", "model"])).json, "claude-sonnet-5")?.out).toBe(7);
    expect(group((await meter(["--by", "effort"])).json, "xhigh")?.out).toBe(50);
    expect(group((await meter(["--by", "agent"])).json, "general-purpose")?.out).toBe(7);
    expect(group((await meter(["--by", "skill"])).json, "superpowers:brainstorming")?.out).toBe(50);
    expect(group((await meter(["--by", "session"])).json, "sess-2")?.out).toBe(13);
    expect(group((await meter(["--by", "repo,lane"])).json, "alpha | subagent")?.out).toBe(7);
  });

  it("filters --from/--to on local dates", async () => {
    const { json } = await meter(["--from", "2026-09-02", "--to", "2026-09-02", "--tz", "UTC"]);
    expect((json.total as Sum).out).toBe(77);
  });
});

describe("token-meter: windows", () => {
  it("sums spend inside [start, end) and splits it by model", async () => {
    const { json, out } = await meter(["--window", "2026-09-02T09:30:00Z", "2026-09-02T11:30:00Z"]);
    const w = json.window as { total: Sum; byModel: Group[] };
    expect(w.total.out).toBe(57);
    expect(w.byModel.map((g) => [g.key, g.out])).toEqual([
      ["claude-opus-5", 50],
      ["claude-sonnet-5", 7],
    ]);
    expect(out).toMatch(/^WINDOW\t/m);
  });

  it("rejects a malformed window", async () => {
    await expect(meter(["--window", "yesterday", "today"])).rejects.toThrow(/--window/);
  });
});

describe("token-meter: calibration", () => {
  it("PASS control: reconciles when the cache equals in+out, and names days the cache is missing", async () => {
    const { json, out } = await meter(["--calibrate", "--stats", statsPass, "--tz", "UTC"]);
    const c = json.calibration as {
      best: { unit: string; medianRelErr: number };
      reconciled: boolean;
      missingFromStats: string[];
      coverage: { oldest: string; newest: string };
    };
    expect(c.coverage).toEqual({ oldest: "2026-09-01", newest: "2026-09-04" });
    expect(c.best.unit).toBe("in+out");
    expect(c.best.medianRelErr).toBe(0);
    expect(c.reconciled).toBe(true);
    expect(c.missingFromStats).toEqual(["2026-09-03"]);
    expect(out).toMatch(/^VERDICT RECONCILED best=in\+out/m);
  });

  it("FAIL control: reports NOT RECONCILED when the cache disagrees", async () => {
    const { json, out } = await meter(["--calibrate", "--stats", statsFail, "--tz", "UTC"]);
    const c = json.calibration as { reconciled: boolean; best: { medianRelErr: number } };
    expect(c.reconciled).toBe(false);
    expect(c.best.medianRelErr).toBeGreaterThan(0.05);
    expect(out).toMatch(/^VERDICT NOT RECONCILED/m);
  });
});

describe("token-meter: compactions and blocks", () => {
  it("counts compactions by trigger with preTokens percentiles, once each despite replay", async () => {
    const { json } = await meter(["--compactions"]);
    const c = json.compactions as {
      count: number;
      byTrigger: Record<string, number>;
      preTokens: { p50: number };
      events: { trigger: string; repo: string }[];
    };
    expect(c.count).toBe(1);
    expect(c.byTrigger).toEqual({ manual: 1 });
    expect(c.preTokens.p50).toBe(123456);
    expect(c.events[0]).toMatchObject({ trigger: "manual", repo: "alpha" });
  });

  it("lists limit blocks once each despite replay, with the spend in the five hours before each", async () => {
    const { json, out } = await meter(["--blocks"]);
    const b = json.blocks as { kind: string; repo: string; lane: string; spend5h: Sum }[];
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ kind: "session", repo: "alpha", lane: "main" });
    expect(b[0]!.spend5h.out).toBe(77);
    expect(out).toMatch(/^BLOCKS\t1/m);
  });
});

/**
 * The three limit-block shapes, as the client writes them (model "<synthetic>", zero
 * usage, error "rate_limit"). The model record is the one recorded 2026-09-17T16:07:31Z,
 * trimmed to the fields the walker reads; before the fix it was not a block at all.
 */
function limitRecord(ts: string, uuid: string, text: string): string {
  return JSON.stringify({
    type: "assistant",
    uuid,
    requestId: `req-${uuid}`,
    timestamp: ts,
    sessionId: "sess-limits",
    isSidechain: false,
    cwd: ALPHA,
    error: "rate_limit",
    isApiErrorMessage: true,
    apiErrorStatus: 429,
    message: {
      model: "<synthetic>",
      role: "assistant",
      stop_reason: "stop_sequence",
      type: "message",
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [{ type: "text", text }],
    },
  });
}

describe("token-meter: limit-block kinds", () => {
  let limitsRoot: string;
  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "token-meter-limits-"));
    limitsRoot = join(dir, "projects");
    const alpha = join(limitsRoot, "-Users-x-Documents-GitHub-alpha");
    await mkdir(alpha, { recursive: true });
    const lines = [
      limitRecord(
        "2026-08-27T21:00:17.075Z",
        "lw",
        "You've hit your weekly limit · resets Aug 30 at 2am (America/Los_Angeles)",
      ),
      limitRecord(
        "2026-09-02T18:29:35.856Z",
        "ls",
        "You've hit your session limit · resets 2pm (America/Los_Angeles)",
      ),
      limitRecord(
        "2026-09-10T09:00:00.000Z",
        "lm5",
        "You've reached your Fable 5 limit. Switch to another model, or manage usage credits at claude.ai/settings/usage?from=cc_cli_limit_message, to continue.",
      ),
      limitRecord(
        "2026-09-17T16:07:31.326Z",
        "lm",
        "You've reached your Fable limit. Switch to another model, or manage usage credits at claude.ai/settings/usage?from=cc_cli_limit_message, to continue.",
      ),
      "",
    ];
    await writeFile(join(alpha, "sess-limits.jsonl"), lines.join("\n"));
    // Replay: the model block must dedupe by uuid like the other two.
    await writeFile(join(alpha, "sess-limits-resumed.jsonl"), lines.join("\n"));
  });

  it("keeps session and weekly, and classifies a model limit as its own kind with the model named", async () => {
    const jsonPath = join(limitsRoot, "..", "out.json");
    const { stdout } = await execFileAsync("node", [
      METER,
      "--root",
      limitsRoot,
      "--json",
      jsonPath,
      "--blocks",
    ]);
    const json = JSON.parse(await readFile(jsonPath, "utf-8")) as {
      blocks: { ts: string; kind: string; model?: string }[];
    };
    expect(json.blocks.map((b) => [b.ts, b.kind, b.model])).toEqual([
      ["2026-08-27T21:00:17.075Z", "weekly", undefined],
      ["2026-09-02T18:29:35.856Z", "session", undefined],
      ["2026-09-10T09:00:00.000Z", "model", "Fable 5"],
      ["2026-09-17T16:07:31.326Z", "model", "Fable"],
    ]);
    const lines = stdout.split("\n");
    expect(lines.find((l) => l.startsWith("BLOCKS\t"))).toBe(
      'BLOCKS\t4\tbyKind={"weekly":1,"session":1,"model:Fable 5":1,"model:Fable":1}',
    );
    expect(lines).toContain(
      "2026-09-17T16:07:31.326Z\tmodel:Fable\talpha\tmain\tspend5h out=0 cacheCreate=0 cacheRead=0",
    );
    expect(lines.some((l) => l.startsWith("2026-08-27T21:00:17.075Z\tweekly\t"))).toBe(true);
    expect(lines.some((l) => l.startsWith("2026-09-02T18:29:35.856Z\tsession\t"))).toBe(true);
  });
});

describe("token-meter: arguments", () => {
  it("exits 1 with a message on an unknown argument", async () => {
    await expect(meter(["--bogus"])).rejects.toMatchObject({ code: 1 });
  });

  it("exits 1 on an unknown dimension", async () => {
    await expect(meter(["--by", "colour"])).rejects.toThrow(/unknown dimension/);
  });
});

describe("token-meter: startup cost", () => {
  it("reports the first call's in+cacheCreate+cacheRead per session, by repo and lane, and per agent type", async () => {
    const { json, out } = await meter(["--startup"]);
    const s = json.startup as {
      byRepoLane: { key: string; sessions: number; p50: number; p90: number; max: number }[];
      byAgent: { key: string; sessions: number; p50: number; p90: number; max: number }[];
    };
    // sess-1 main: r1 final is the earliest deduped event → 10 + 1000 + 20000 = 21010
    expect(s.byRepoLane.find((r) => r.key === "alpha | main")).toMatchObject({
      sessions: 1,
      p50: 21010,
      max: 21010,
    });
    // sess-2 main (beta): r5 → 1 + 0 + 0 = 1
    expect(s.byRepoLane.find((r) => r.key === "beta | main")).toMatchObject({
      sessions: 1,
      p50: 1,
    });
    // agent-1 (sess-1 subagent): r4 → 2 + 100 + 5000 = 5102
    expect(s.byRepoLane.find((r) => r.key === "alpha | subagent")).toMatchObject({
      sessions: 1,
      p50: 5102,
    });
    expect(s.byAgent.find((r) => r.key === "general-purpose")).toMatchObject({
      sessions: 1,
      p50: 5102,
    });
    expect(out).toMatch(/^STARTUP/m);
  });
});
