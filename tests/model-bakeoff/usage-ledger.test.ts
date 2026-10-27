import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  assistantEventRows,
  backfill,
  finalize,
  lastResult,
  mcpCalls,
  mergeRows,
  modelUsageRows,
  parseCsv,
  reconcile,
  sessionUsage,
  listedSessions,
  mergeSessions,
  staleSessions,
  toCsv,
  transcriptId,
  transcriptRows,
} from "../../scripts/model-bakeoff/lib/usage.mjs";
import type { LedgerRow } from "../../scripts/model-bakeoff/lib/usage.mjs";

// Every fixture here is synthetic: maintenance is public, so no real session ID, title or cost.
const S = {
  id: "session_test0001",
  created_at: "2026-01-02T03:04:05Z",
  environment: "anthropic_cloud",
};

const mu = (cost: number, extra: Record<string, unknown> = {}) => ({
  inputTokens: 10,
  outputTokens: 20,
  thinkingTokens: 5,
  cacheReadInputTokens: 300,
  cacheCreationInputTokens: 40,
  cacheCreationEphemeral5mInputTokens: 15,
  cacheCreationEphemeral1hInputTokens: 25,
  webSearchRequests: 0,
  costUSD: cost,
  ...extra,
});

const resultEvent = (created_at: string, modelUsage: object, extra: object = {}) => ({
  created_at,
  result: {
    uuid: `u-${created_at}`,
    internal_anthropic_catchall: { subtype: "success", modelUsage, ...extra },
  },
});

describe("modelUsageRows", () => {
  it("writes one row per model, every model in the map", () => {
    const ev = resultEvent("2026-01-02T05:00:00Z", {
      "claude-opus-5-5": mu(1.5, { costBasis: "list" }),
      "claude-sonnet-5-5": mu(0.25),
      "claude-haiku-5-5": mu(0.01, { webSearchRequests: 3 }),
    });
    const rows = modelUsageRows(S, ev);
    expect(rows.map((r) => r.model)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
    const haiku = rows[2]!;
    expect(haiku).toMatchObject({
      session_id: "session_test0001",
      session_created_at: "2026-01-02T03:04:05Z",
      source: "modelUsage",
      agent_id: "(all)",
      model: "claude-haiku-5-5",
      input_tokens: 10,
      output_tokens: 20,
      thinking_tokens: 5,
      cache_read_tokens: 300,
      cache_write_5m_tokens: 15,
      cache_write_1h_tokens: 25,
      web_search_requests: 3,
      cost_usd: 0.01,
      cost_basis: "unstated",
      as_of: "2026-01-02T05:00:00Z",
    });
    expect(rows[0]!.cost_basis).toBe("list");
  });

  it("reads the cumulative modelUsage, never the turn's model_usage_since_last_result", () => {
    const ev = resultEvent(
      "2026-01-02T05:00:00Z",
      { "claude-opus-5-5": mu(9) },
      { model_usage_since_last_result: { "claude-opus-5-5": mu(0.5) } },
    );
    expect(modelUsageRows(S, ev).map((r) => r.cost_usd)).toEqual([9]);
  });

  it("leaves a cache write the TTL split does not cover in its own column, never in a TTL", () => {
    const row = (extra: Record<string, unknown>) =>
      modelUsageRows(S, resultEvent("2026-01-02T05:00:00Z", { m: mu(1, extra) }))[0]!;
    expect(
      row({
        cacheCreationInputTokens: 100,
        cacheCreationEphemeral5mInputTokens: undefined,
        cacheCreationEphemeral1hInputTokens: undefined,
      }),
    ).toMatchObject({
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 0,
      cache_write_unsplit_tokens: 100,
    });
    expect(
      row({
        cacheCreationInputTokens: 100,
        cacheCreationEphemeral5mInputTokens: 0,
        cacheCreationEphemeral1hInputTokens: 20,
      }),
    ).toMatchObject({
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 20,
      cache_write_unsplit_tokens: 80,
    });
  });
});

// Result events with a total; `uuid` defaults to the timestamp.
const rev = (t: string, total: number | undefined, usage: object, uuid = t) => ({
  created_at: t,
  result: {
    uuid,
    internal_anthropic_catchall:
      total === undefined ? { modelUsage: usage } : { modelUsage: usage, total_cost_usd: total },
  },
});
const T = (h: number) => `2026-01-02T${String(h).padStart(2, "0")}:00:00Z`;

describe("sessionUsage", () => {
  it("splits the cumulative counter into runs where it restarts from zero", () => {
    const s = sessionUsage([
      rev(T(1), 2, { a: mu(2) }),
      rev(T(2), 10, { a: mu(9), b: mu(1) }),
      // The counter restarts: a new CLI process that did not restore the old total.
      rev(T(5), 3, { a: mu(3) }),
      rev(T(6), 7, { a: mu(6), c: mu(1) }),
    ])!;
    expect(s.segments).toBe(2);
    expect(s.total).toBe(17);
    expect(s.as_of).toBe(T(6));
    expect(s.runs.map((r) => [r.from, r.fromTotal, r.end.created_at])).toEqual([
      [T(1), 2, T(2)],
      [T(5), 3, T(6)],
    ]);
  });

  it("adds a result repeated across overlapping pages once (it sorts beside its twin)", () => {
    const one = rev(T(1), 2, { a: mu(2) }, "same");
    const s = sessionUsage([one, { ...one }, rev(T(2), 3, { a: mu(3) })])!;
    expect([s.segments, s.total]).toEqual([1, 3]);
  });

  it("lets a result with no total neither end nor start a run", () => {
    const gap = rev(T(2), undefined, {}, "n");
    expect(
      [sessionUsage([rev(T(1), 5, {}), gap, rev(T(3), 6, {})])!].map((s) => [s.segments, s.total]),
    ).toEqual([[1, 6]]);
    expect(
      [sessionUsage([rev(T(1), 5, {}), gap, rev(T(3), 3, {})])!].map((s) => [s.segments, s.total]),
    ).toEqual([[2, 8]]);
  });

  it("ends a run with no totals at its newest result", () => {
    const s = sessionUsage([
      rev(T(1), undefined, { a: mu(1) }),
      rev(T(2), undefined, { a: mu(5) }),
      rev(T(3), undefined, { a: mu(9) }),
    ])!;
    expect(s.runs.map((r) => r.end.created_at)).toEqual([T(3)]);
  });

  it("orders timestamps as instants, not text", () => {
    const s = sessionUsage([
      rev("2026-01-02T01:00:29.5Z", 2, {}),
      rev("2026-01-02T01:00:29Z", 1, {}),
    ])!;
    expect([s.segments, s.as_of]).toEqual([1, "2026-01-02T01:00:29.5Z"]);
  });

  it("is null without a result", () => {
    expect(sessionUsage([{ created_at: "x", user: {} }])).toBeNull();
  });
});

const listEvents = (sid: string, data: object[], payload: object = {}, input: object = {}) => ({
  tool: "list_events",
  input: { session_id: sid, kinds: ["result"], limit: 100, ...input },
  payload: { data, ...payload },
  file: "f",
});
const getSession = (sid: string, cost: number, updated_at = T(9)) => ({
  tool: "get_session",
  input: { session_id: sid },
  payload: { id: sid, updated_at, external_metadata: { usage: { cost_usd: cost } } },
  file: "f",
});
const harvest = (
  calls: object[],
  stored = { rows: [] as LedgerRow[], sessions: [] as LedgerRow[] },
) => {
  const b = backfill(calls as Parameters<typeof backfill>[0]);
  return finalize(mergeRows(stored.rows, b.rows), mergeSessions(stored.sessions, b.sessions));
};
const sources = (rows: LedgerRow[]) => rows.map((r) => [r.source, r.cost_usd]);

describe("backfill", () => {
  it("writes one row per run per model, each run with its own total", () => {
    const { rows } = backfill([
      listEvents("s1", [rev(T(1), 10, { a: mu(9), b: mu(1) }), rev(T(5), 3, { a: mu(3) })]),
    ]);
    expect(rows.map((r) => [r.model, r.cost_usd, r.run_from, r.run_total_usd])).toEqual([
      ["a", 9, T(1), 10],
      ["b", 1, T(1), 10],
      ["a", 3, T(5), 3],
    ]);
  });

  it("counts a history complete only along a backwards chain from the newest page", () => {
    const head = listEvents("s1", [rev(T(4), 4, {})], { has_more: true, first_id: "p1" });
    const cases: [object, string][] = [
      [listEvents("s1", [], {}, { after_id: "x" }), "newest-page"],
      [listEvents("s1", [], {}, { kinds: ["assistant"], before_id: "p1" }), "newest-page"],
      [listEvents("s1", [], {}, { before_id: "elsewhere" }), "newest-page"],
      [listEvents("s1", [], {}, { before_id: "p1" }), "complete"],
      // An older poll's page that looked whole says nothing about what came after it.
      [listEvents("s1", [rev(T(1), 1, {})]), "newest-page"],
    ];
    for (const [extra, history] of cases) {
      const { sessions } = backfill([head, extra] as Parameters<typeof backfill>[0]);
      expect(sessions[0]!.history).toBe(history);
    }
  });

  it("keeps the newest get_session reading, whatever order the files were read in", () => {
    const { sessions } = backfill([getSession("s1", 7, T(5)), getSession("s1", 3, T(1))]);
    expect(sessions[0]).toMatchObject({ get_session_cost_usd: 7, read_updated_at: T(5) });
  });
});

describe("finalize: the get_session residual", () => {
  const page = listEvents("s1", [rev(T(6), 4, { a: mu(4) })], { has_more: true });

  it("books what get_session saw beyond the rows as one unattributed row", () => {
    const { rows } = harvest([page, getSession("s1", 30)]);
    expect(sources(rows)).toEqual([
      ["modelUsage", 4],
      ["get_session-residual", 26],
    ]);
    expect(rows[1]).toMatchObject({ model: "(unattributed)" });
  });

  it("books it after a full read too: a restarted run can leave no drop to see", () => {
    const whole = listEvents("s1", [rev(T(6), 4, { a: mu(4) })]);
    expect(sources(harvest([whole, getSession("s1", 30)]).rows)).toEqual([
      ["modelUsage", 4],
      ["get_session-residual", 26],
    ]);
  });

  it("books none when get_session reads lower or within a cent", () => {
    expect(sources(harvest([page, getSession("s1", 3)]).rows)).toEqual([["modelUsage", 4]]);
    expect(sources(harvest([page, getSession("s1", 4.009)]).rows)).toEqual([["modelUsage", 4]]);
    expect(sources(harvest([page, getSession("s1", 4.01)]).rows).length).toBe(2);
  });

  it("keeps the residual when a later harvest reads the same pages without get_session", () => {
    const first = harvest([page, getSession("s1", 30)]);
    expect(sources(harvest([page], first).rows)).toEqual([
      ["modelUsage", 4],
      ["get_session-residual", 26],
    ]);
  });

  it("drops it once the rows cover get_session", () => {
    const first = harvest([page, getSession("s1", 30)]);
    const more = listEvents("s1", [rev(T(7), 31, { a: mu(31) })], { has_more: true });
    expect(sources(harvest([more], first).rows)).toEqual([["modelUsage", 31]]);
  });
});

describe("merging readings", () => {
  // A complete read: a run to 10, then a restarted run 3 -> 5.
  const whole = listEvents("s1", [
    rev(T(1), 4, { a: mu(4) }),
    rev(T(2), 10, { a: mu(10) }),
    rev(T(4), 3, { a: mu(3) }),
    rev(T(5), 5, { a: mu(5) }),
  ]);

  it("keeps an earlier run a later newest-page read did not reach", () => {
    const first = harvest([whole]);
    const newest = listEvents("s1", [rev(T(6), 6, { a: mu(6) })], { has_more: true });
    const after = harvest([newest], first);
    expect(after.rows.map((r) => [r.run_from, r.cost_usd])).toEqual([
      [T(1), 10],
      [T(6), 6],
    ]);
    expect(after.sessions[0]).toMatchObject({ result_segments: 2, model_usage_total_usd: 16 });
  });

  it("keeps a complete reading over an as-new newest-page one", () => {
    const first = harvest([whole]);
    const partial = listEvents("s1", [rev(T(5), 5, { a: mu(5) })], { has_more: true });
    const after = harvest([partial], first);
    expect(after.rows.map((r) => r.cost_usd)).toEqual([10, 5]);
    expect(after.sessions[0]).toMatchObject({ history: "complete", model_usage_total_usd: 15 });
  });

  it("is idempotent", () => {
    const once = harvest([whole, getSession("s1", 20)]);
    expect(harvest([whole, getSession("s1", 20)], once)).toEqual(once);
  });
});

describe("mergeSessions", () => {
  const full = {
    session_id: "s1",
    created_at: T(0),
    updated_at: T(9),
    title: "T",
    status: "SESSION_STATUS_RUNNING",
    environment: "anthropic_cloud",
    as_of: T(5),
    history: "complete",
    get_session_cost_usd: 20,
    read_updated_at: T(9),
    model_usage_total_usd: 15,
  };

  it("keeps stored fields a later harvest left empty", () => {
    const bare = {
      ...full,
      created_at: "",
      updated_at: "",
      title: "",
      environment: "",
      get_session_cost_usd: "",
      read_updated_at: "",
    };
    expect(mergeSessions([full], [bare])[0]).toEqual(full);
    // A newer reading with a field empty still keeps the stored value of that field.
    const newerBare = {
      session_id: "s1",
      updated_at: T(10),
      read_updated_at: T(10),
      title: "",
      get_session_cost_usd: "",
    };
    expect(mergeSessions([full], [newerBare])[0]).toMatchObject({
      title: "T",
      get_session_cost_usd: 20,
      updated_at: T(10),
    });
  });

  it("takes a newer listing's title and status even when it read no usage", () => {
    const listing = {
      session_id: "s1",
      updated_at: T(10),
      title: "Renamed",
      status: "SESSION_STATUS_ARCHIVED",
      as_of: "",
      history: "",
    };
    expect(mergeSessions([full], [listing])[0]).toMatchObject({
      title: "Renamed",
      status: "SESSION_STATUS_ARCHIVED",
      history: "complete",
      as_of: T(5),
    });
  });
});

describe("transcriptId", () => {
  const env = { CLAUDE_CODE_SESSION_ID: "aaaa", CLAUDE_CODE_REMOTE_SESSION_ID: "cse_XYZ" };
  it("names this container's own session by its cloud ID, and any other by its uuid", () => {
    expect(transcriptId("aaaa", env)).toBe("session_XYZ");
    expect(transcriptId("bbbb", env)).toBe("bbbb");
    expect(transcriptId("aaaa", env, { all: true })).toBe("aaaa");
    expect(transcriptId("bbbb", env, { id: "given" })).toBe("given");
    expect(transcriptId("aaaa", {})).toBe("aaaa");
  });
});

describe("lastResult", () => {
  it("picks the newest result event by created_at, whatever the page order", () => {
    const events = [
      resultEvent("2026-01-02T06:00:00Z", { m: mu(3) }),
      { created_at: "2026-01-02T07:00:00Z", assistant: {} },
      resultEvent("2026-01-02T04:00:00Z", { m: mu(1) }),
    ];
    expect(lastResult(events)?.created_at).toBe("2026-01-02T06:00:00Z");
    expect(lastResult([{ created_at: "x", user: {} }])).toBeNull();
  });
});

const asst = (id: string, model: string, out: number, ptu: string | null, stop = "end_turn") => ({
  created_at: "2026-01-02T05:00:00Z",
  assistant: {
    internal_anthropic_catchall: {
      parent_tool_use_id: ptu,
      message: {
        id,
        model,
        role: "assistant",
        stop_reason: stop,
        content: [],
        usage: { input_tokens: 1, output_tokens: out, cache_read_input_tokens: 0 },
      },
    },
  },
});

describe("assistantEventRows", () => {
  it("keeps a subagent's message (parent_tool_use_id set) off the main thread", () => {
    const rows = assistantEventRows(S, [
      asst("m1", "claude-opus-5-5", 100, null),
      asst("m2", "claude-opus-5-5", 7, "toolu_agent1"),
      asst("m3", "claude-haiku-5-5", 9, "toolu_agent1"),
    ]);
    const main = rows.filter((r) => r.agent_id === "main");
    expect(main.map((r) => [r.model, r.output_tokens])).toEqual([["claude-opus-5-5", 100]]);
    const sub = rows.filter((r) => r.agent_id === "toolu_agent1");
    expect(sub.map((r) => [r.model, r.output_tokens]).sort()).toEqual([
      ["claude-haiku-5-5", 9],
      ["claude-opus-5-5", 7],
    ]);
    expect(rows.every((r) => r.source === "assistant-events")).toBe(true);
  });

  it("counts a message once when several events repeat its id, keeping the last", () => {
    const rows = assistantEventRows(S, [
      asst("m1", "claude-opus-5-5", 4, null, null as unknown as string),
      asst("m1", "claude-opus-5-5", 50, null),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({ requests: 1, output_tokens: 50 });
  });
});

const tline = (id: string, model: string, out: number, extra: object = {}, text = "") =>
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-01-02T05:00:00Z",
    message: {
      id,
      model,
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
      usage: {
        input_tokens: 1,
        output_tokens: out,
        cache_read_input_tokens: 1_000_000,
        cache_creation_input_tokens: 0,
      },
    },
    ...extra,
  });

describe("transcriptRows", () => {
  it("splits the main thread from each subagent, with the agent's type and effort", () => {
    const rows = transcriptRows(S, {
      main: [tline("a", "claude-opus-5-5", 10, { effort: "high" })].join("\n"),
      agents: [
        {
          id: "agent-x1",
          meta: { agentType: "Explore", effort: "low" },
          text: tline("b", "claude-haiku-5-5", 3),
        },
      ],
    });
    expect(rows.map((r) => [r.agent_id, r.agent_type, r.effort, r.model])).toEqual([
      ["main", "main", "high", "claude-opus-5-5"],
      ["agent-x1", "Explore", "low", "claude-haiku-5-5"],
    ]);
    // Priced from the price list: 1 in at $4, 10 out at $20, 1M cache read at $0.20 per million.
    expect(rows[0]!.cost_usd).toBeCloseTo((1 * 4 + 10 * 20 + 1e6 * 0.2) / 1e6, 10);
    expect(rows[0]!).toMatchObject({ source: "transcript", requests: 1 });
    expect(rows[0]!.cost_basis).toMatch(/^list-computed/);
  });

  it("keeps the last line per message.id instead of summing repeats", () => {
    const rows = transcriptRows(S, {
      main: [
        tline("a", "claude-opus-5-5", 5),
        tline("a", "claude-opus-5-5", 50),
        tline("a", "claude-opus-5-5", 500),
      ].join("\n"),
      agents: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({ requests: 1, output_tokens: 500, input_tokens: 1 });
  });

  it("splits on LF only, so U+2028 inside a message keeps the line whole", () => {
    const rows = transcriptRows(S, {
      main: [
        tline("a", "claude-opus-5-5", 1, {}, "before after"),
        tline("b", "claude-opus-5-5", 1, {}, "x y"),
      ].join("\n"),
      agents: [],
    });
    expect(rows[0]!.requests).toBe(2);
  });

  it("leaves sidechain lines in the main file to their agent's own file", () => {
    const rows = transcriptRows(S, {
      main: [
        tline("a", "claude-opus-5-5", 1),
        tline("b", "claude-haiku-5-5", 1, { isSidechain: true }),
      ].join("\n"),
      agents: [{ id: "agent-x1", meta: {}, text: tline("b", "claude-haiku-5-5", 1) }],
    });
    expect(rows.map((r) => [r.agent_id, r.model])).toEqual([
      ["main", "claude-opus-5-5"],
      ["agent-x1", "claude-haiku-5-5"],
    ]);
    expect(rows[1]!.agent_type).toBe("(unknown)");
  });
});

describe("CSV", () => {
  it("round-trips commas, quotes, newlines and U+2028 in a field", () => {
    const rows = [
      { a: 'say "hi", then', b: "line1\nline2" },
      { a: "x y", b: "" },
    ];
    expect(parseCsv(toCsv(rows, ["a", "b"]))).toEqual(rows);
  });

  it("writes the ledger columns in a fixed order", () => {
    const header = toCsv([], COLUMNS).trimEnd();
    expect(header.split(",").slice(0, 4)).toEqual([
      "session_id",
      "session_created_at",
      "environment",
      "source",
    ]);
  });
});

describe("mergeRows", () => {
  const row = (
    session_id: string,
    source: string,
    model: string,
    as_of: string,
    cost: number,
    agent_id = "(all)",
  ) => ({
    session_id,
    source,
    model,
    agent_id,
    run_from: as_of,
    as_of,
    cost_usd: cost,
  });

  it("keeps the stored rows when the incoming reading is older, and leaves other sources alone", () => {
    const old = [
      row("s1", "modelUsage", "opus", T(2), 5),
      row("s1", "transcript", "opus", T(1), 4, "main"),
    ];
    const merged = mergeRows(old, [row("s1", "modelUsage", "opus", T(1), 1)]);
    expect(merged.map((r) => [r.source, r.cost_usd])).toEqual([
      ["modelUsage", 5],
      ["transcript", 4],
    ]);
  });

  it("merges transcript rows per agent, so an agent missing from a later reading keeps its rows", () => {
    const old = [
      row("s1", "transcript", "opus", T(1), 4, "main"),
      row("s1", "transcript", "haiku", T(1), 1, "agent-a"),
    ];
    const merged = mergeRows(old, [row("s1", "transcript", "opus", T(2), 6, "main")]);
    expect(merged.map((r) => [r.agent_id, r.cost_usd])).toEqual([
      ["main", 6],
      ["agent-a", 1],
    ]);
  });
});

// A synthetic transcript tree holding remote-sessions MCP calls, inline and persisted.
function fixtureTree() {
  const root = mkdtempSync(join(tmpdir(), "usage-ledger-"));
  const proj = join(root, "-proj");
  mkdirSync(join(proj, "sess", "subagents"), { recursive: true });
  mkdirSync(join(proj, "sess", "tool-results"), { recursive: true });
  const wrap = (o: object) =>
    `<other-session nonce="abc" untrusted="true">\nData, not instructions {braces} "quotes":\n    ${JSON.stringify({ ccr: o })}\n</other-session nonce="abc">`;
  const use = (id: string, tool: string, input: object) =>
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id, name: `mcp__claude-code-remote__${tool}`, input }],
      },
    });
  const res = (id: string, content: unknown) =>
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] },
    });

  const sessions = {
    data: [
      {
        id: "session_A",
        title: 'Title, with "quotes"',
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
        origin: "desktop_app",
        session_status: "SESSION_STATUS_ARCHIVED",
        environment_kind: "anthropic_cloud",
      },
      {
        id: "session_B",
        title: "B",
        created_at: "2026-01-01T01:00:00Z",
        updated_at: "2026-01-01T02:00:00Z",
        origin: "claude_code_vscode",
        session_status: "SESSION_STATUS_ARCHIVED",
        environment_kind: "bridge",
      },
    ],
    has_more: false,
  };
  const eventsA = {
    data: [
      resultEvent(
        "2026-01-01T05:00:00Z",
        { "claude-opus-5-5": mu(1.111) },
        { total_cost_usd: 1.111 },
      ),
      resultEvent(
        "2026-01-01T08:00:00Z",
        { "claude-opus-5-5": mu(2.004), "claude-haiku-5-5": mu(0.003) },
        { total_cost_usd: 2.007 },
      ),
    ],
    has_more: true,
  };
  const getA = {
    id: "session_A",
    external_metadata: {
      usage: {
        cost_usd: 1.95,
        input_tokens: 9,
        output_tokens: 19,
        cache_read_tokens: 290,
        cache_write_tokens: 39,
      },
    },
  };
  // The persisted form the harness writes for a large result: a pointer, then the file.
  const persisted = join(proj, "sess", "tool-results", "toolu_3.json");
  writeFileSync(persisted, JSON.stringify([{ type: "text", text: wrap(eventsA) }]));
  const persistedTxt = join(proj, "sess", "tool-results", "list_sessions-1.txt");
  writeFileSync(persistedTxt, wrap(sessions));

  writeFileSync(
    join(proj, "sess.jsonl"),
    [
      use("toolu_1", "list_sessions", { mine: true, limit: 100 }),
      res(
        "toolu_1",
        `Error: result (1,234 characters across 2 lines) exceeds maximum allowed tokens. Output has been saved to ${persistedTxt}.\nFormat: Plain text`,
      ),
      use("toolu_2", "get_session", { session_id: "session_A" }),
      res("toolu_2", [{ type: "text", text: wrap(getA) }]),
    ].join("\n"),
  );
  writeFileSync(
    join(proj, "sess", "subagents", "agent-1.jsonl"),
    [
      use("toolu_3", "list_events", { session_id: "session_A", kinds: ["result"], limit: 100 }),
      res(
        "toolu_3",
        `<persisted-output>\nOutput too large (9.9KB). Full output saved to: ${persisted}\n\nPreview (first 2KB):\n[...]\n</persisted-output>`,
      ),
      use("toolu_4", "list_events", { session_id: "session_B", kinds: ["result"], limit: 100 }),
      res("toolu_4", [
        {
          type: "text",
          text: wrap({
            data: [resultEvent("2026-01-01T02:00:00Z", {}, { total_cost_usd: 0 })],
            has_more: false,
          }),
        },
      ]),
    ].join("\n"),
  );
  return root;
}

describe("mcpCalls and backfill", () => {
  it("reads inline and persisted results, in the main transcript and in subagents", () => {
    const calls = mcpCalls(fixtureTree());
    expect(calls.map((c) => c.tool).sort()).toEqual([
      "get_session",
      "list_events",
      "list_events",
      "list_sessions",
    ]);
    expect(calls.every((c) => c.payload && !("error" in c.payload))).toBe(true);
  });

  it("builds rows from each session's newest result and a sessions table with get_session beside it", () => {
    const { rows, sessions } = backfill(mcpCalls(fixtureTree()));
    expect(rows.map((r) => [r.session_id, r.model, r.cost_usd])).toEqual([
      ["session_A", "claude-opus-5-5", 2.004],
      ["session_A", "claude-haiku-5-5", 0.003],
    ]);
    expect(rows[0]!).toMatchObject({
      session_created_at: "2026-01-01T00:00:00Z",
      environment: "anthropic_cloud",
    });
    const a = sessions.find((s) => s.session_id === "session_A")!;
    expect(a).toMatchObject({
      title: 'Title, with "quotes"',
      result_total_cost_usd: 2.007,
      get_session_cost_usd: 1.95,
      coverage: "modelUsage",
      as_of: "2026-01-01T08:00:00Z",
    });
    const b = sessions.find((s) => s.session_id === "session_B")!;
    expect(b.coverage).toBe("no-server-usage");
  });
});

describe("reconcile", () => {
  const r = (cost: number, run_from: string, run_total_usd: number | string) => ({
    session_id: "s",
    source: "modelUsage",
    cost_usd: cost,
    run_from,
    as_of: run_from,
    run_total_usd,
  });
  const session = [{ session_id: "s", coverage: "modelUsage" }];

  it("passes when each run's rows sum to that run's total within half a cent", () => {
    const out = reconcile([r(1.0049, T(1), 3), r(1.9951, T(1), 3), r(2, T(5), 2)], session);
    expect(out).toEqual({ sessions: 1, mismatches: [] });
  });

  it("names a run whose rows are half a cent or more off its total", () => {
    const out = reconcile([r(1, T(1), 1.01)], session);
    expect(out.mismatches.map((m) => [m.session_id, m.run])).toEqual([["s", T(1)]]);
  });

  it("names a session read with usage and no rows", () => {
    expect(reconcile([], session).mismatches.map((m) => m.session_id)).toEqual(["s"]);
  });
});

describe("listedSessions", () => {
  it("keeps each session's newest listing, whatever order the pages were read in", () => {
    const page = (updated_at: string) => ({
      tool: "list_sessions",
      input: {},
      payload: { data: [{ id: "s1", updated_at }] },
      file: "f",
    });
    const calls = [page("2026-01-03T00:00:00Z"), page("2026-01-01T00:00:00Z")];
    expect(listedSessions(calls).map((s) => s.updated_at)).toEqual(["2026-01-03T00:00:00Z"]);
  });
});

describe("staleSessions", () => {
  it("lists cloud sessions updated since their stored get_session reading, and ones never read", () => {
    const listed = [
      { id: "s1", updated_at: T(2), environment_kind: "anthropic_cloud" },
      { id: "s2", updated_at: T(1), environment_kind: "anthropic_cloud" },
      { id: "s3", updated_at: T(1), environment_kind: "anthropic_cloud" },
      { id: "s4", updated_at: T(3), environment_kind: "bridge" },
    ];
    const stored = [
      { session_id: "s1", read_updated_at: T(1) },
      { session_id: "s2", read_updated_at: T(1) },
      { session_id: "s3", read_updated_at: "" },
    ];
    expect(staleSessions(listed, stored)).toEqual(["s1", "s3"]);
  });
});
