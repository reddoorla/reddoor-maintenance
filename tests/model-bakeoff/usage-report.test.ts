import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  COLUMNS,
  SESSION_COLUMNS,
  formatReport,
  toCsv,
  weeklyReport,
} from "../../scripts/model-bakeoff/lib/usage.mjs";
import type { LedgerRow } from "../../scripts/model-bakeoff/lib/usage.mjs";

// Every fixture here is synthetic: maintenance is public, so no real session ID, title or cost.
const since = "2026-01-08T00:00:00Z";
const until = "2026-01-15T00:00:00Z";

const sessions: LedgerRow[] = [
  { session_id: "sA", created_at: "2026-01-10T00:00:00Z", title: "Alpha" },
  // Created before the window, with rows inside it: a row's as_of decides, not the session's age.
  { session_id: "sB", created_at: "2026-01-01T00:00:00Z", title: "Beta" },
  // Created inside the window, with every row after it.
  { session_id: "sC", created_at: "2026-01-12T00:00:00Z", title: "Gamma" },
  { session_id: "sD", created_at: "2026-01-12T00:00:00Z", title: "Delta" },
  { session_id: "sE", created_at: "2026-01-12T00:00:00Z", title: "Epsilon" },
  { session_id: "sF", created_at: "2026-01-12T00:00:00Z", title: "Zeta" },
  { session_id: "sG", created_at: "2026-01-12T00:00:00Z", title: "Eta" },
];

const tokens = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_5m_tokens: 0,
  cache_write_1h_tokens: 0,
  cache_write_unsplit_tokens: "",
};
const row = (
  session_id: string,
  source: string,
  model: string,
  cost_usd: number,
  as_of: string,
  extra: Record<string, unknown> = {},
): LedgerRow => ({
  session_id,
  session_created_at: sessions.find((s) => s.session_id === session_id)?.created_at ?? "",
  environment: "anthropic_cloud",
  source,
  agent_id: source === "transcript" ? "main" : "(all)",
  model,
  ...tokens,
  cost_usd,
  as_of,
  ...extra,
});

const OPUS = "claude-opus-5-5";
const rows: LedgerRow[] = [
  // sA: two runs of its counter, $12 and $4 in all; the newest run alone is $4.
  row("sA", "modelUsage", OPUS, 10, "2026-01-10T06:00:00Z", {
    run_from: "2026-01-10T01:00:00Z",
    // $4 input, $2 output, $2 cache read, $1 + $1 + $1 cache write (the unsplit at the 5m rate).
    input_tokens: 1_000_000,
    output_tokens: 100_000,
    cache_read_tokens: 10_000_000,
    cache_write_5m_tokens: 200_000,
    cache_write_1h_tokens: 125_000,
    cache_write_unsplit_tokens: 200_000,
  }),
  row("sA", "modelUsage", "claude-sonnet-5-5", 2, "2026-01-10T06:00:00Z", {
    run_from: "2026-01-10T01:00:00Z",
    input_tokens: 9_000_000,
  }),
  row("sA", "modelUsage", OPUS, 4, "2026-01-11T00:00:00Z", { run_from: "2026-01-10T20:00:00Z" }),
  // After the window: neither its cost nor its as_of reaches sA's figures.
  row("sA", "modelUsage", OPUS, 100, "2026-01-16T00:00:00Z", { run_from: "2026-01-16T00:00:00Z" }),
  // sB: one run in the window, one before it, and a residual.
  row("sB", "modelUsage", OPUS, 50, "2026-01-05T00:00:00Z", {
    run_from: "2026-01-02T00:00:00Z",
    output_tokens: 1_000_000,
  }),
  row("sB", "modelUsage", OPUS, 12, "2026-01-09T00:00:00Z", { run_from: "2026-01-08T12:00:00Z" }),
  row("sB", "get_session-residual", "(unattributed)", 1, "2026-01-09T00:00:00Z"),
  // sC: after the window.
  row("sC", "modelUsage", OPUS, 100, "2026-01-16T00:00:00Z"),
  row("sD", "modelUsage", OPUS, 5, "2026-01-13T00:00:00Z"),
  row("sE", "modelUsage", OPUS, 6, "2026-01-13T00:00:00Z"),
  row("sF", "modelUsage", OPUS, 7, "2026-01-13T00:00:00Z"),
  row("sG", "modelUsage", OPUS, 3, "2026-01-13T00:00:00Z"),
  // Transcript rows split sA's cloud total by agent; they are inside it, never added to it.
  // Its tokens would add $4 of input to the Opus token classes if transcript rows were priced too.
  row("sA", "transcript", OPUS, 3, "2026-01-10T06:00:00Z", { input_tokens: 1_000_000 }),
  row("sA", "transcript", OPUS, 6, "2026-01-10T06:00:00Z", { agent_id: "agent-a1" }),
  row("sA", "transcript", "claude-sonnet-5-5", 2, "2026-01-10T06:00:00Z", {
    agent_id: "agent-a2",
  }),
  row("sA", "transcript", "claude-haiku-5-5", 2, "2026-01-10T06:00:00Z", {
    agent_id: "agent-a3",
  }),
  row("sC", "transcript", OPUS, 100, "2026-01-16T00:00:00Z", { agent_id: "agent-c1" }),
];

const r = weeklyReport({ rows, sessions }, { since, until });

describe("weeklyReport: cloud spend by model", () => {
  it("adds modelUsage and residual rows in the window, and no transcript row", () => {
    expect(r.cloud.total).toBeCloseTo(50, 9);
    expect(r.cloud.byModel).toEqual([
      { model: OPUS, cost_usd: 47, share: 0.94 },
      { model: "claude-sonnet-5-5", cost_usd: 2, share: 0.04 },
      { model: "(unattributed)", cost_usd: 1, share: 0.02 },
    ]);
    expect(r.cloud.opusShare).toBeCloseTo(0.94, 9);
  });
});

describe("weeklyReport: the top sessions", () => {
  it("ranks the five costliest sessions by the sum of their runs in the window", () => {
    expect(r.top).toEqual([
      { session_id: "sA", title: "Alpha", hours: 24, cost_usd: 16 },
      { session_id: "sB", title: "Beta", hours: 192, cost_usd: 13 },
      { session_id: "sF", title: "Zeta", hours: 24, cost_usd: 7 },
      { session_id: "sE", title: "Epsilon", hours: 24, cost_usd: 6 },
      { session_id: "sD", title: "Delta", hours: 24, cost_usd: 5 },
    ]);
  });
});

describe("weeklyReport: main thread against subagents", () => {
  it("splits transcript rows in the window by model", () => {
    expect(r.agents.byModel).toEqual([
      { model: OPUS, main: 3, subagent: 6 },
      { model: "claude-haiku-5-5", main: 0, subagent: 2 },
      { model: "claude-sonnet-5-5", main: 0, subagent: 2 },
    ]);
  });

  it("prints main and subagent in their own columns", () => {
    const text = formatReport(r);
    expect(text).toContain(
      [
        "| claude-opus-5-5 | $3.00 | $6.00 |",
        "| claude-haiku-5-5 | $0.00 | $2.00 |",
        "| claude-sonnet-5-5 | $0.00 | $2.00 |",
      ].join("\n"),
    );
    expect(text).toContain("| **total** | $50.00 | |");
    expect(text).toContain("Opus share of subagent spend: 60% ($6.00 of $10.00).");
    const none = formatReport(weeklyReport({ rows: [], sessions }, { since, until }));
    expect(none).toContain("Opus share of subagent spend: no subagent rows.");
    expect(text).toContain("| claude-opus-5-5 | $3.00 | $6.00 |");
    expect(text).toContain("| claude-opus-5-5 | $47.00 | 94% |");
  });

  it("gives Opus's share of subagent spend over subagent rows only", () => {
    expect(r.agents.subagentTotal).toBe(10);
    expect(r.agents.opusSubagent).toBe(6);
    expect(r.agents.opusSubagentShare).toBeCloseTo(0.6, 9);
  });
});

describe("weeklyReport: Opus cost by token class", () => {
  it("prices the Opus cloud rows in the window by class, unsplit writes at the 5-minute rate", () => {
    expect(r.opusTokens.input).toBeCloseTo(4, 9);
    expect(r.opusTokens.output).toBeCloseTo(2, 9);
    expect(r.opusTokens.cache_read).toBeCloseTo(2, 9);
    expect(r.opusTokens.cache_write).toBeCloseTo(3, 9);
    expect(r.opusTokens.total).toBeCloseTo(11, 9);
    expect(r.opusTokens.unpriced).toEqual([]);
  });

  it("prices a write with no TTL from the row's server cost, within the 5-minute and 1-hour rates", () => {
    // $4 + $2 + $2 + $1 + $1 known; 200k unsplit tokens cost $1 at 5m and $1.60 at 1h.
    const priced = { ...rows[0], cost_usd: 11.3 };
    const above = { ...rows[0], session_id: "sD", cost_usd: 12 };
    const plain = { ...rows[0], session_id: "sE", cache_write_unsplit_tokens: "", cost_usd: 10.5 };
    const at = (rs: LedgerRow[]) =>
      weeklyReport({ rows: rs, sessions }, { since, until }).opusTokens;
    expect(at([priced]).cache_write).toBeCloseTo(3.3, 9);
    expect(at([priced]).serverCost).toBeCloseTo(11.3, 9);
    // Above the 1-hour rate: the write stops at $1.60 and the rest shows as the gap.
    expect(at([above]).cache_write).toBeCloseTo(3.6, 9);
    expect(at([above]).serverCost - at([above]).total).toBeCloseTo(0.4, 9);
    // With no unsplit tokens the classes are priced as they are.
    expect(at([plain]).cache_write).toBeCloseTo(2, 9);
    expect(at([plain]).total).toBeCloseTo(10, 9);
  });

  it("prints the token classes against the rows' server cost", () => {
    const text = formatReport(r);
    expect(text).toContain(
      [
        "| input | $4.00 | 36% |",
        "| output | $2.00 | 18% |",
        "| cache read | $2.00 | 18% |",
        "| cache write | $3.00 | 27% |",
      ].join("\n"),
    );
    expect(text).toContain(
      "The classes total $11.00 against $47.00 of server cost on the same rows.",
    );
  });

  it("names an Opus model with no price card instead of pricing it", () => {
    const out = weeklyReport(
      { rows: [row("sD", "modelUsage", "claude-opus-0", 1, "2026-01-13T00:00:00Z")], sessions },
      { since, until },
    );
    expect(out.opusTokens.unpriced).toEqual(["claude-opus-0"]);
    expect(out.opusTokens.total).toBe(0);
    expect(formatReport(out)).toContain("Unpriced Opus models, left out: claude-opus-0.");
  });
});

describe("weeklyReport: rows the ledger leaves undated", () => {
  it("dates a residual with no as_of by its session's get_session reading", () => {
    const undated = [
      row("sD", "get_session-residual", "(unattributed)", 5, ""),
      row("sE", "get_session-residual", "(unattributed)", 7, ""),
    ];
    const read: LedgerRow[] = [
      {
        session_id: "sD",
        created_at: "2026-01-12T00:00:00Z",
        cost_read_at: "2026-01-13T00:00:00Z",
        // Both dates: cost_read_at, the reading the residual came from, decides.
        read_updated_at: "2026-01-20T00:00:00Z",
      },
      // No cost_read_at: the listing's updated_at it was read at is the fallback.
      {
        session_id: "sE",
        created_at: "2026-01-12T00:00:00Z",
        read_updated_at: "2026-01-14T00:00:00Z",
      },
    ];
    const out = weeklyReport({ rows: undated, sessions: read }, { since, until });
    expect(out.cloud.total).toBe(12);
    expect(out.top).toEqual([
      { session_id: "sE", title: "", hours: 48, cost_usd: 7 },
      { session_id: "sD", title: "", hours: 24, cost_usd: 5 },
    ]);
  });

  it("takes a session missing from sessions.csv from its rows, and gives no hours without a start", () => {
    const out = weeklyReport(
      {
        rows: [
          row("sX", "modelUsage", OPUS, 2, "2026-01-13T00:00:00Z", {
            session_created_at: "2026-01-12T12:00:00Z",
          }),
          row("sY", "modelUsage", OPUS, 1, "2026-01-13T00:00:00Z"),
        ],
        sessions: [],
      },
      { since, until },
    );
    expect(out.top).toEqual([
      { session_id: "sX", title: "", hours: 12, cost_usd: 2 },
      { session_id: "sY", title: "", hours: null, cost_usd: 1 },
    ]);
  });
});

describe("weeklyReport: the window", () => {
  it("defaults to the seven days before until", () => {
    const out = weeklyReport({ rows, sessions }, { until });
    expect(out.since).toBe(since);
  });

  it("includes since and excludes until", () => {
    const edge = [row("sD", "modelUsage", OPUS, 1, since), row("sE", "modelUsage", OPUS, 2, until)];
    expect(weeklyReport({ rows: edge, sessions }, { since, until }).cloud.total).toBe(1);
  });
});

describe("formatReport", () => {
  it("opens with one summary line, its times in Pacific", () => {
    const [first] = formatReport(r).split("\n");
    expect(first).toBe(
      "Usage, Jan 7 4:00pm PT to Jan 14 4:00pm PT: $50.00 cloud list price, Opus 94%; top session $16.00 over 24h; Opus 60% of subagent spend ($6.00 of $10.00).",
    );
  });
});

describe("formatReport: titles", () => {
  it("keeps a title with a pipe or a line break on its own table row", () => {
    const out = weeklyReport(
      {
        rows: [row("sD", "modelUsage", OPUS, 1, "2026-01-13T00:00:00Z")],
        sessions: [{ session_id: "sD", created_at: "2026-01-12T00:00:00Z", title: "a\nb | c\\" }],
      },
      { since, until },
    );
    expect(formatReport(out).split("\n")).toContain("| sD | a b \\| c\\\\ | 24.0 | $1.00 |");
  });
});

describe("usage-ledger.mjs report", () => {
  const script = fileURLToPath(
    new URL("../../scripts/model-bakeoff/usage-ledger.mjs", import.meta.url),
  );
  const out = mkdtempSync(join(tmpdir(), "usage-report-"));
  writeFileSync(join(out, "ledger.csv"), toCsv(rows, COLUMNS));
  writeFileSync(join(out, "sessions.csv"), toCsv(sessions, SESSION_COLUMNS));
  afterAll(() => rmSync(out, { recursive: true, force: true }));
  const run = (...args: string[]) =>
    spawnSync("node", [script, "report", "--out", out, ...args], { encoding: "utf8" });

  it("prints the report for the window read from --out", () => {
    const text = execFileSync(
      "node",
      [script, "report", "--out", out, "--since", since, "--until", until],
      { encoding: "utf8" },
    );
    expect(text.split("\n")[0]).toMatch(/^Usage, .*: \$50\.00 cloud list price, Opus 94%;/);
    expect(text).toContain("| Alpha | 24.0 | $16.00 |");
  });

  it("refuses a --since that is not a time", () => {
    const p = run("--since", "monday");
    expect(p.status).toBe(2);
    expect(p.stderr).toContain("--since");
  });

  it("refuses a time with no zone, which would read as the machine's local time", () => {
    const p = run("--since", "2026-01-08T00:00:00");
    expect(p.status).toBe(2);
    expect(p.stderr).toContain("--since");
  });

  it("refuses a date that does not exist", () => {
    const p = run("--since", "2026-02-30");
    expect(p.status).toBe(2);
    expect(p.stderr).toContain("--since");
  });

  it("refuses a --since after now when --until is left out", () => {
    const p = run("--since", "2999-01-01");
    expect(p.status).toBe(2);
    expect(p.stderr).toContain("before");
  });

  it("refuses a --since that is not before --until", () => {
    const p = run("--since", until, "--until", since);
    expect(p.status).toBe(2);
    expect(p.stderr).toContain("before");
  });
});
