import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  SESSION_COLUMNS,
  assistantEventRows,
  ccrPayload,
  cmpTime,
  harvestSessions,
  historyComplete,
  ingest,
  listedSessions,
  mcpCalls,
  mergeRows,
  mergeSessions,
  modelUsageRows,
  parseCsv,
  reconcile,
  sessionUsage,
  staleSessions,
  toCsv,
  transcriptId,
  transcriptMessages,
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

  it("does not take a drop of less than half a cent for a restart", () => {
    const s = sessionUsage([rev(T(1), 10.000000000000002, {}), rev(T(2), 10, {})])!;
    expect([s.segments, s.total]).toEqual([1, 10]);
  });

  it("orders results with the same time by uuid, whatever order they were read in", () => {
    const [x, y, z] = [rev(T(1), 10, {}, "x"), rev(T(2), 3, {}, "y"), rev(T(2), 12, {}, "z")];
    const a = sessionUsage([x, y, z])!;
    const b = sessionUsage([z, x, y])!;
    expect([a.segments, a.total]).toEqual([b.segments, b.total]);
    expect(a.runs.map((r) => r.end.created_at)).toEqual(b.runs.map((r) => r.end.created_at));
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

let clock = 0;
// A list_events call as mcpCalls returns it; `at` is when its result arrived, in call order.
const listEvents = (sid: string, data: object[], payload: object = {}, input: object = {}) => ({
  tool: "list_events",
  input: { session_id: sid, kinds: ["result"], limit: 100, ...input },
  payload: { data, ...payload },
  file: "f",
  at: `2026-02-01T00:${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock++ % 60).padStart(2, "0")}Z`,
});
const getSession = (sid: string, cost: number, updated_at = T(9), extra: object = {}) => ({
  tool: "get_session",
  input: { session_id: sid },
  payload: { id: sid, updated_at, external_metadata: { usage: { cost_usd: cost } }, ...extra },
  file: "f",
  at: "",
});
type Store = { results: object[]; rows: LedgerRow[]; sessions: LedgerRow[] };
const empty: Store = { results: [], rows: [], sessions: [] };
// Through CSV and JSON on every step, as the CLI stores it.
const roundTrip = (st: Store): Store => ({
  results: JSON.parse(JSON.stringify(st.results)),
  rows: parseCsv(toCsv(st.rows, COLUMNS)),
  sessions: parseCsv(toCsv(st.sessions, SESSION_COLUMNS)),
});
const harvest = (calls: object[], stored: Store = empty): Store =>
  roundTrip(ingest(stored as never, { calls: calls as never }));
const sources = (rows: LedgerRow[]) => rows.map((r) => [r.source, r.cost_usd]);
const total = (st: Store) =>
  Math.round(st.rows.reduce((n, r) => n + Number(r.cost_usd), 0) * 100) / 100;

describe("ingest: server rows", () => {
  it("writes one row per run per model, each run with its own total", () => {
    const { rows } = harvest([
      listEvents("s1", [rev(T(1), 10, { a: mu(9), b: mu(1) }), rev(T(5), 3, { a: mu(3) })]),
    ]);
    expect(rows.map((r) => [r.model, r.cost_usd, r.run_from, r.run_total_usd])).toEqual([
      ["a", 9, T(1), 10],
      ["b", 1, T(1), 10],
      ["a", 3, T(5), 3],
    ]);
  });

  it("stores the cumulative modelUsage, never the turn's model_usage_since_last_result", () => {
    const ev = {
      created_at: T(1),
      result: {
        uuid: "u1",
        internal_anthropic_catchall: {
          total_cost_usd: 9,
          modelUsage: { a: mu(9) },
          model_usage_since_last_result: { a: mu(1) },
        },
      },
    };
    const st = harvest([listEvents("s1", [ev])]);
    expect(st.rows.map((r) => r.cost_usd)).toEqual([9]);
    expect(JSON.stringify(st.results)).not.toContain("since_last");
  });

  it("treats a zero-total result with no usage as carrying no total", () => {
    const { rows } = harvest([
      listEvents("s1", [
        rev(T(1), 10, { a: mu(10) }),
        rev(T(2), 0, {}),
        rev(T(3), 12, { a: mu(12) }),
      ]),
    ]);
    expect(rows.map((r) => r.cost_usd)).toEqual([12]);
  });
});

// Each scenario's harvests, applied in every order, must give the same, true total.
describe("ingest: any order of harvests", () => {
  const orders = <X>(xs: X[]): X[][] =>
    xs.length <= 1
      ? [xs]
      : xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map((o) => [x, ...o]));
  const ev = (h: number, t: number) => rev(T(h), t, { a: mu(t) });
  const scenarios: [string, object[][], number][] = [
    [
      // Runs of 2, 10 and 3 read whole; later only the newest page: the last run, now at 4.
      "an earlier run before a kept one",
      [
        [listEvents("s1", [ev(1, 2), ev(2, 1), ev(3, 10), ev(4, 1), ev(5, 3)])],
        [listEvents("s1", [ev(7, 4)], { has_more: true })],
      ],
      16,
    ],
    [
      "a fuller as-new page read after a partial one",
      [
        [listEvents("s1", [ev(1, 1), ev(2, 10)])],
        [listEvents("s1", [ev(6, 4)], { has_more: true })],
        [
          listEvents("s1", [ev(6, 4)], { has_more: true, first_id: "p1" }),
          listEvents("s1", [ev(3, 1), ev(4, 8), ev(5, 2)], { has_more: true }, { before_id: "p1" }),
        ],
      ],
      22,
    ],
    [
      "a complete reading after a newer partial one",
      [
        [listEvents("s1", [ev(1, 4), ev(2, 10), ev(4, 3), ev(5, 5)])],
        [listEvents("s1", [ev(6, 6)], { has_more: true })],
      ],
      16,
    ],
    [
      "the same newest page read twice",
      [
        [listEvents("s1", [ev(1, 2), ev(2, 1), ev(3, 10), ev(4, 1), ev(5, 4)], { has_more: true })],
        [listEvents("s1", [ev(5, 4)], { has_more: true })],
      ],
      16,
    ],
  ];
  for (const [name, harvests, want] of scenarios)
    it(name, () => {
      for (const order of orders(harvests))
        expect(total(order.reduce((st, h) => harvest(h, st), empty))).toBe(want);
    });
});

describe("ingest: history", () => {
  it("stays complete only while no stored result is newer than the complete read", () => {
    const whole = harvest([
      listEvents("s1", [rev(T(1), 1, {}), rev(T(2), 2, {}), rev(T(3), 10, {})]),
    ]);
    expect(whole.sessions[0]).toMatchObject({ history: "complete" });
    const again = harvest([listEvents("s1", [rev(T(3), 10, {})], { has_more: true })], whole);
    expect(again.sessions[0]).toMatchObject({ history: "complete" });
    const gap = harvest([listEvents("s1", [rev(T(9), 12, {})], { has_more: true })], whole);
    expect(gap.sessions[0]).toMatchObject({ history: "newest-page" });
  });
});

describe("ingest: a harvest that read no events", () => {
  const listing = {
    tool: "list_sessions",
    input: {},
    payload: { data: [{ id: "s1", updated_at: T(9), title: "t" }] },
    file: "f",
    at: "",
  };
  const page = listEvents("s1", [rev(T(6), 4, { a: mu(4) })], { has_more: true });

  it("keeps the stored history, in either order", () => {
    for (const order of [
      [[page], [listing]],
      [[listing], [page]],
    ]) {
      const st = order.reduce((acc, h) => harvest(h, acc), empty);
      expect(st.sessions[0]).toMatchObject({ history: "newest-page" });
      expect(st.rows.map((r) => r.history)).toEqual(["newest-page"]);
    }
  });

  it("labels rows by the finalized history when an older complete read arrives late", () => {
    const newer = harvest([listEvents("s1", [rev(T(7), 5, { a: mu(5) })], { has_more: true })]);
    const olderWhole = listEvents("s1", [rev(T(1), 1, { a: mu(1) }), rev(T(3), 3, { a: mu(3) })]);
    const after = harvest([olderWhole], newer);
    expect(after.sessions[0]!.history).toBe("newest-page");
    expect(new Set(after.rows.map((r) => r.history))).toEqual(new Set(["newest-page"]));
  });

  it("gives server rows their session's finalized history", () => {
    const whole = listEvents("s1", [rev(T(6), 4, { a: mu(4) })]);
    const first = harvest([whole, getSession("s1", 30)]);
    const later = harvest(
      [listEvents("s1", [rev(T(7), 5, { a: mu(5) })], { has_more: true })],
      first,
    );
    expect(later.sessions[0]!.history).toBe("newest-page");
    expect(new Set(later.rows.map((r) => r.history))).toEqual(new Set(["newest-page"]));
  });
});

describe("ingest: a complete history with no results", () => {
  it("stays complete", () => {
    const empty1 = listEvents("s1", [{ created_at: T(1), user: {} }]);
    expect(harvest([empty1]).sessions[0]).toMatchObject({ history: "complete" });
  });
});

describe("cmpTime", () => {
  it("orders fractional seconds within one millisecond", () => {
    expect(cmpTime("2026-01-01T00:00:29.5Z", "2026-01-01T00:00:29.500001Z")).toBe(-1);
    expect(cmpTime("2026-01-01T00:00:29Z", "2026-01-01T00:00:29.000Z")).toBe(0);
  });
});

describe("historyComplete", () => {
  it("follows the backwards chain from the newest cursorless page", () => {
    const head = listEvents("s1", [rev(T(4), 4, {})], { has_more: true, first_id: "p1" });
    const cases: [object, boolean][] = [
      // An after_id page holding a result is never the head, however late it arrived.
      [listEvents("s1", [rev(T(9), 9, {})], {}, { after_id: "x" }), false],
      [listEvents("s1", [], {}, { kinds: ["assistant"], before_id: "p1" }), false],
      [listEvents("s1", [], {}, { before_id: "elsewhere" }), false],
      [listEvents("s1", [], {}, { before_id: "p1" }), true],
    ];
    for (const [extra, want] of cases) expect(historyComplete([head, extra] as never)).toBe(want);
  });

  it("dates a complete read by the chain's newest result, not by other pages", () => {
    const head = listEvents("s1", [rev(T(1), 1, {}), rev(T(3), 3, {})]);
    const after = listEvents("s1", [rev(T(6), 6, {})], { has_more: true }, { after_id: "x" });
    expect(harvestSessions([head, after] as never)[0]).toMatchObject({
      history: "complete",
      complete_through: T(3),
    });
  });

  it("ignores an older poll that looked whole, in either order of files", () => {
    const old = listEvents("s1", [rev(T(1), 2, {}), rev(T(2), 5, {})]);
    const head = listEvents("s1", [], { has_more: true, first_id: "p1" });
    expect(historyComplete([old, head] as never)).toBe(false);
    expect(historyComplete([head, old] as never)).toBe(false);
  });
});

describe("harvestSessions", () => {
  it("keeps the newest get_session reading, in either order of files", () => {
    const [a, b] = [getSession("s1", 7, T(5)), getSession("s1", 3, T(1))];
    for (const calls of [
      [a, b],
      [b, a],
    ])
      expect(harvestSessions(calls as never)[0]).toMatchObject({
        get_session_cost_usd: 7,
        read_updated_at: T(5),
      });
  });

  it("takes each field from the newer of the listing and get_session", () => {
    const listing = {
      tool: "list_sessions",
      input: {},
      payload: {
        data: [
          {
            id: "s1",
            updated_at: T(10),
            title: "Renamed",
            session_status: "SESSION_STATUS_ARCHIVED",
          },
        ],
      },
      file: "f",
      at: "",
    };
    const got = getSession("s1", 3, T(5), {
      title: "Old",
      session_status: "SESSION_STATUS_RUNNING",
    });
    for (const calls of [
      [listing, got],
      [got, listing],
    ])
      expect(harvestSessions(calls as never)[0]).toMatchObject({
        title: "Renamed",
        status: "SESSION_STATUS_ARCHIVED",
        updated_at: T(10),
        get_session_cost_usd: 3,
      });
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

  it("is idempotent through CSV", () => {
    const once = harvest([page, getSession("s1", 30)]);
    expect(harvest([page, getSession("s1", 30)], once)).toEqual(once);
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
    coverage: "no-result",
    history: "complete",
    get_session_cost_usd: 20,
    read_updated_at: T(9),
    cost_read_at: T(9),
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
    expect(mergeSessions([full], [bare])[0]).toMatchObject(full);
    // A newer reading that lacks a group keeps that group whole, its clock included.
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
      updated_at: T(9),
    });
  });

  it("takes newer listing fields and newer get_session figures, each on its own clock", () => {
    const listing = {
      session_id: "s1",
      updated_at: T(10),
      title: "Renamed",
      status: "SESSION_STATUS_ARCHIVED",
      read_updated_at: "",
    };
    expect(mergeSessions([full], [listing])[0]).toMatchObject({
      title: "Renamed",
      status: "SESSION_STATUS_ARCHIVED",
      get_session_cost_usd: 20,
    });
    expect(
      mergeSessions([full], [{ ...listing, updated_at: T(1), title: "Older" }])[0],
    ).toMatchObject({
      title: "T",
    });
    const reading = {
      session_id: "s1",
      read_updated_at: T(10),
      cost_read_at: T(10),
      get_session_cost_usd: 25,
      updated_at: "",
    };
    expect(mergeSessions([full], [reading])[0]).toMatchObject({
      get_session_cost_usd: 25,
      title: "T",
    });
    const staleReading = {
      ...reading,
      read_updated_at: T(1),
      cost_read_at: T(1),
      get_session_cost_usd: 5,
    };
    expect(mergeSessions([full], [staleReading])[0]).toMatchObject({ get_session_cost_usd: 20 });
  });

  it("gives the same answer for three readings in any order", () => {
    const A = {
      session_id: "s1",
      updated_at: T(5),
      title: "X",
      read_updated_at: T(5),
      cost_read_at: T(5),
      get_session_cost_usd: 10,
    };
    const B = {
      session_id: "s1",
      updated_at: T(3),
      title: "Y",
      read_updated_at: T(3),
      cost_read_at: T(3),
      get_session_cost_usd: 5,
    };
    const C = {
      session_id: "s1",
      updated_at: T(7),
      title: "",
      read_updated_at: T(7),
      get_session_cost_usd: "",
    };
    const orders = [
      [A, B, C],
      [A, C, B],
      [B, A, C],
      [B, C, A],
      [C, A, B],
      [C, B, A],
    ];
    const outs = orders.map((o) => {
      const [first, ...rest] = o;
      return rest.reduce(
        (st: LedgerRow[], x) => mergeSessions(st, [x as LedgerRow]),
        [first as LedgerRow],
      )[0];
    });
    for (const out of outs) expect(out).toMatchObject({ title: "X", get_session_cost_usd: 10 });
  });

  it("moves read_updated_at on a reading with no cost, and keeps the stored cost", () => {
    const noCost = {
      session_id: "s1",
      read_updated_at: T(12),
      cost_read_at: "",
      get_session_cost_usd: "",
    };
    expect(mergeSessions([full], [noCost])[0]).toMatchObject({
      read_updated_at: T(12),
      get_session_cost_usd: 20,
      cost_read_at: T(9),
    });
  });

  it("keeps the fullest coverage once seen", () => {
    const later = { session_id: "s1", coverage: "" };
    expect(mergeSessions([full], [later])[0]).toMatchObject({ coverage: "no-result" });
  });
});

describe("transcriptId", () => {
  const env = { CLAUDE_CODE_SESSION_ID: "aaaa", CLAUDE_CODE_REMOTE_SESSION_ID: "cse_XYZ" };
  it("names this container's own session by its cloud ID, and any other by its uuid", () => {
    expect(transcriptId("aaaa", env)).toBe("session_XYZ");
    expect(transcriptId("bbbb", env)).toBe("bbbb");
    expect(transcriptId("bbbb", env, { id: "given" })).toBe("given");
    expect(transcriptId("aaaa", {})).toBe("aaaa");
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

  it("dates each row by its newest message and counts thinking and web searches", () => {
    const line = (id: string, ts: string, extra: object) =>
      JSON.stringify({
        type: "assistant",
        timestamp: ts,
        message: {
          id,
          model: "claude-opus-5-5",
          role: "assistant",
          stop_reason: "end_turn",
          content: [],
          usage: { input_tokens: 1, output_tokens: 10, ...extra },
        },
      });
    const rows = transcriptRows(S, {
      main: [
        line("a", T(3), { output_tokens_details: { thinking_tokens: 4 } }),
        line("b", T(1), { server_tool_use: { web_search_requests: 2 } }),
      ].join("\n"),
      agents: [],
    });
    expect(rows[0]).toMatchObject({ as_of: T(3), thinking_tokens: 4, web_search_requests: 2 });
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

  it("counts a message once across sessions when they share a seen set", () => {
    const seen = new Set<string>();
    const a = transcriptRows(S, { main: tline("m1", "claude-opus-5-5", 1), agents: [] }, "", seen);
    const b = transcriptRows(
      { ...S, id: "other" },
      {
        main: [tline("m1", "claude-opus-5-5", 1), tline("m2", "claude-opus-5-5", 1)].join("\n"),
        agents: [],
      },
      "",
      seen,
    );
    expect([a, b].map((rows) => rows.reduce((n, r) => n + Number(r.requests), 0))).toEqual([1, 1]);
  });

  it("keeps a sidechain line with no agent file, under agent sidechain", () => {
    const rows = transcriptRows(S, {
      main: [
        tline("a", "claude-opus-5-5", 1),
        tline("b", "claude-haiku-5-5", 1, { isSidechain: true }),
      ].join("\n"),
      agents: [],
    });
    expect(rows.map((r) => [r.agent_id, r.model]).sort()).toEqual([
      ["main", "claude-opus-5-5"],
      ["sidechain", "claude-haiku-5-5"],
    ]);
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

  it("reads a file saved with a byte-order mark", () => {
    expect(parseCsv("\ufeffa,b\n1,2\n")).toEqual([{ a: "1", b: "2" }]);
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

describe("transcript messages", () => {
  // Opus messages with 1M input tokens each: $4 apiece at list price.
  const m = (id: string) =>
    JSON.stringify({
      type: "assistant",
      timestamp: T(1),
      message: {
        id,
        model: "claude-opus-5-5",
        role: "assistant",
        stop_reason: "end_turn",
        content: [],
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    });
  type Agent = { id: string; meta: Record<string, string>; text: string };
  const file = (...ids: string[]) => ({ main: ids.map(m).join("\n"), agents: [] as Agent[] });
  const sess = (id: string) => ({ ...S, id });
  type MStore = { results: object[]; messages: object[]; rows: LedgerRow[]; sessions: LedgerRow[] };
  const none: MStore = { results: [], messages: [], rows: [], sessions: [] };
  const run = (files: [string, ReturnType<typeof file>][], st: MStore = none): MStore => {
    const messages = files.flatMap(([id, t]) => transcriptMessages(sess(id), t));
    const out = ingest(st as never, { messages: messages as never });
    return JSON.parse(JSON.stringify(out));
  };
  const cost = (st: MStore) =>
    Math.round(
      st.rows.filter((r) => r.source === "transcript").reduce((n, r) => n + Number(r.cost_usd), 0),
    );

  it("counts a message copied into another session once, across harvests in any order", () => {
    // A fork: bbbb carries aaaa's first two messages. The truth is five messages, $20.
    const a1 = file("m1", "m2");
    const a2 = file("m1", "m2", "m4", "m5");
    const b = file("m1", "m2", "m3");
    const harvests: [string, ReturnType<typeof file>][][] = [
      [
        ["bbbb", b],
        ["aaaa", a1],
      ],
      [
        ["aaaa", a2],
        ["bbbb", b],
      ],
      [["aaaa", a2]],
    ];
    for (const order of [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
      [2, 0, 1],
    ])
      expect(cost(order.reduce((st, i) => run(harvests[i]!, st), none))).toBe(20);
  });

  it("keeps an earlier agent's messages when a later reading lacks its file", () => {
    const first = run([
      ["aaaa", { main: m("m1"), agents: [{ id: "agent-x", meta: {}, text: m("m2") }] }],
    ]);
    const later = run([["aaaa", file("m1", "m3")]], first);
    expect(later.rows.map((r) => [r.agent_id, r.cost_usd]).sort()).toEqual([
      ["agent-x", 4],
      ["main", 8],
    ]);
  });

  it("keeps a message with the session that first stored it", () => {
    const first = run([["aaaa", file("m1")]]);
    const later = run([["bbbb", file("m1", "m2")]], first);
    expect(
      later.rows.filter((r) => r.source === "transcript").map((r) => [r.session_id, r.cost_usd]),
    ).toEqual([
      ["aaaa", 4],
      ["bbbb", 4],
    ]);
  });

  it("lets a finished copy replace an unfinished one, keeping the owner", () => {
    const start = JSON.stringify({
      type: "assistant",
      timestamp: T(1),
      message: {
        id: "m1",
        model: "claude-opus-5-5",
        role: "assistant",
        stop_reason: null,
        content: [],
        usage: { input_tokens: 1, output_tokens: 8 },
      },
    });
    const first = run([["aaaa", { main: start, agents: [] }]]);
    const later = run([["bbbb", file("m1")]], first);
    expect(
      later.rows
        .filter((r) => r.source === "transcript")
        .map((r) => [r.session_id, r.unfinished_requests]),
    ).toEqual([["aaaa", 0]]);
  });
});

describe("mergeRows", () => {
  it("drops stored server and transcript rows: those are rebuilt from the stored records", () => {
    const row = (source: string) => ({
      session_id: "s1",
      source,
      agent_id: "(all)",
      as_of: T(1),
      cost_usd: 5,
    });
    expect(mergeRows([row("modelUsage"), row("transcript")], [])).toEqual([]);
    expect(mergeRows([row("assistant-events")], []).length).toBe(1);
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

  it("builds rows and a sessions table, with get_session beside the results", () => {
    const { rows, sessions } = ingest(
      { results: [], rows: [], sessions: [] },
      { calls: mcpCalls(fixtureTree()) },
    );
    // Sorted by session, source, agent, run, then model.
    expect(rows.map((r) => [r.session_id, r.model, r.cost_usd])).toEqual([
      ["session_A", "claude-haiku-5-5", 0.003],
      ["session_A", "claude-opus-5-5", 2.004],
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
      history: "newest-page",
      as_of: "2026-01-01T08:00:00Z",
    });
    const b = sessions.find((s) => s.session_id === "session_B")!;
    expect(b.coverage).toBe("no-server-usage");
  });
});

describe("ccrPayload", () => {
  it("reads an inline payload before a quoted pointer, and the pointer when inline is cut short", () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-ptr-"));
    const f = join(dir, "x.txt");
    writeFileSync(f, JSON.stringify({ ccr: { data: [], from: "file" } }));
    const inline = `${JSON.stringify({ ccr: { data: [{ text: `Output has been saved to ${f}. Done.` }], from: "inline" } })}`;
    expect(ccrPayload(inline)).toMatchObject({ from: "inline" });
    expect(ccrPayload(`Output saved to: ${f}\nPreview: {"ccr":{"data":[{"a":`)).toMatchObject({
      from: "file",
    });
  });

  it("reports a persisted-output pointer it cannot follow, rather than returning nothing", () => {
    expect(() => ccrPayload("Output has been saved to somewhere unreadable.")).toThrow(/pointer/);
    expect(ccrPayload("no payload here")).toBeNull();
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

  it("names a run with no total", () => {
    const out = reconcile([r(1, T(1), "")], session);
    expect(out.mismatches.map((m) => m.run)).toEqual([T(1)]);
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
    expect(listedSessions(calls as never).map((s) => s.updated_at)).toEqual([
      "2026-01-03T00:00:00Z",
    ]);
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
