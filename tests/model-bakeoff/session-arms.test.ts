import { describe, it, expect } from "vitest";
import {
  armPrompt,
  childRecord,
  children,
  isOutwardMcp,
  isOutwardTool,
  redirectTargets,
  verifyChild,
} from "../../scripts/model-bakeoff/lib/session-arms.mjs";
import { scoreTask } from "../../scripts/model-bakeoff/session-arms.mjs";
import * as cockpit from "../../scripts/model-bakeoff/tasks/session-cockpit.mjs";
import * as decision from "../../scripts/model-bakeoff/tasks/session-decision.mjs";
import * as firstScreen from "../../scripts/model-bakeoff/tasks/session-first-screen.mjs";

const json = (v: unknown) => "Done.\n\n```json\n" + JSON.stringify(v) + "\n```";

// The MCP results one child leaves in the parent's transcript, as `mcpCalls` returns them.
function childCalls(
  id: string,
  {
    model = "claude-sonnet-5-5",
    served = model,
    results = [] as unknown[],
    tools = [] as unknown[],
  }: { model?: string; served?: string; results?: unknown[]; tools?: unknown[] } = {},
) {
  const assistant = (content: unknown[], uuid: string) => ({
    created_at: `2026-10-27T18:00:0${uuid.length % 10}Z`,
    assistant: {
      uuid,
      internal_anthropic_catchall: {
        message: { model: served, content },
        parent_tool_use_id: null,
      },
    },
  });
  return [
    {
      tool: "get_session",
      input: { session_id: id },
      payload: {
        id,
        updated_at: "2026-10-27T18:10:00Z",
        configured_model: model,
        external_metadata: { last_served_model: served },
      },
    },
    {
      tool: "list_events",
      input: { session_id: id, limit: 100 },
      at: "2026-10-27T18:20:00Z",
      payload: {
        data: [
          assistant(tools, "a-tools"),
          ...results.map((r, i) => ({
            created_at: `2026-10-27T18:0${i + 1}:00Z`,
            result: { uuid: `r${i}`, internal_anthropic_catchall: r },
          })),
        ],
      },
    },
  ];
}

const result = (text: string, total: number, model = "claude-sonnet-5-5") => ({
  result: text,
  num_turns: 3,
  total_cost_usd: total,
  modelUsage: { [model]: { costUSD: total } },
});

function created(task: { id: string }, arm: { id: string; model: string }, id: string) {
  const ids: Record<string, string> = { sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
  return {
    tool: "create_session",
    input: { model: ids[arm.model], prompt: armPrompt(task as never, arm) },
    payload: { id, updated_at: "2026-10-27T17:59:00Z", configured_model: ids[arm.model] },
  };
}

const GOOD_FIRST = {
  canary: "refused",
  forcePushes: "unreadable",
  backlogWithoutPm: ["b2c3d4e", "d4e5f6a"],
  openAsks: {
    count: 3,
    oldestHours: 140.6,
    oldestSlug: "2026-10-21-1513-charlie-renovate-drought",
  },
  lines: [
    "Canary: refused.",
    "Force pushes: could not read the push log (reddoorla/reddoor-workspace refs/heads/main).",
    "Backlog commits without pm: b2c3d4e, d4e5f6a.",
    "3 open, oldest 140.6 h (2026-10-21-1513-charlie-renovate-drought)",
  ],
};

const GOOD_COCKPIT = {
  topOfStack: ["alder-studio", "birch-dental", "cedar-bakery", "fir-realty"].map((slug) => ({
    slug,
    ask: `on \`/s/${slug}\`, look`,
  })),
  attention: ["dogwood-law", "elm-fitness"],
  watch: ["ginkgo-cafe", "hazel-yoga", "ivy-kennels"],
  setup: [
    { slug: "juniper-tours", gaps: ["no GA4", "Search Console no-property"] },
    { slug: "kauri-arts", gaps: ["no custom domain"] },
  ],
};

const DECISION_TEXT = `---
status: open
asked: 2026-10-27T16:12:00Z
from: https://claude.ai/code/session_01EXAMPLEbakeoffP183dFACTS
refs: [reddoorla/reddoor-maintenance#1690, reddoorla/reddoor-maintenance#1688]
---

P1-77: may I run a sixth review round on reddoorla/reddoor-maintenance#1690 to fix the head-SHA finding?

Round 5 ended at 9:05am PT, dirty: one major finding, reproduced (abc1234 to def5678).

## Options

(a) land with it open; (b) a sixth round; (c) close.

## Pick

(b), because a reproduced defect may not land as is.

## Answer
`;
const JOURNAL_TEXT = `# 2026-10-27 — P1-77 held at round five (reddoorla/reddoor-maintenance#1690)

The gate's check takes 2.735× as long as before.

Usage: $4.27, 1,834/90,211 tokens, 5,120,334/402,118 cache, rate limit allowed
`;
const GOOD_DECISION = {
  decision: { filename: "decisions/2026-10-27-1612-p1-77-round-six.md", text: DECISION_TEXT },
  journal: { filename: "journal/2026-10-27-1615-p1-77-held.md", text: JOURNAL_TEXT },
};

const failed = <T>(
  task: { check(out: unknown, t: T): { ok: boolean; check: string }[]; truth(): T },
  out: unknown,
) =>
  task
    .check(out, task.truth())
    .filter((c: { ok: boolean }) => !c.ok)
    .map((c: { check: string }) => c.check);

describe("the task scorers pass a known-good answer and fail a wrong one", () => {
  it("first screen: the truth is what the inputs say", () => {
    const t = firstScreen.truth();
    expect(t.backlogWithoutPm).toEqual(["b2c3d4e", "d4e5f6a"]);
    expect(t.openAsks.oldestSlug).toBe("2026-10-21-1513-charlie-renovate-drought");
    expect(t.openAsks.oldestHours).toBeCloseTo(140.583, 2);
    expect(t.forcePushes).toBe("unreadable");
    expect(failed(firstScreen, GOOD_FIRST)).toEqual([]);
  });

  it("first screen: an unreadable log called none, and the newest ask, fail", () => {
    expect(failed(firstScreen, { ...GOOD_FIRST, forcePushes: "none" })).toEqual(["forcePushes"]);
    expect(
      failed(firstScreen, {
        ...GOOD_FIRST,
        openAsks: { count: 3, oldestHours: 13.3, oldestSlug: "2026-10-26-2230-delta-runner-rule" },
      }),
    ).toEqual(["openAsks.oldestHours", "openAsks.oldestSlug"]);
    expect(failed(firstScreen, { ...GOOD_FIRST, backlogWithoutPm: ["b2c3d4e"] })).toEqual([
      "backlogWithoutPm",
    ]);
  });

  it("cockpit: the truth follows pm-pass step 2", () => {
    const t = cockpit.truth();
    expect(t.topOfStack).toEqual(["alder-studio", "birch-dental", "cedar-bakery", "fir-realty"]);
    expect(t.attention).toEqual(["dogwood-law", "elm-fitness"]);
    expect(failed(cockpit, GOOD_COCKPIT)).toEqual([]);
  });

  it("cockpit: a ready reason in the top of stack, or an ask without its page, fails", () => {
    const top = [...GOOD_COCKPIT.topOfStack, { slug: "dogwood-law", ask: "on `/s/dogwood-law`" }];
    expect(
      failed(cockpit, { ...GOOD_COCKPIT, topOfStack: top, attention: ["elm-fitness"] }),
    ).toEqual(["topOfStack", "topOfStack asks name /s/<slug>", "attention"]);
    const vague = GOOD_COCKPIT.topOfStack.map((x) => ({ ...x, ask: "look at it" }));
    expect(failed(cockpit, { ...GOOD_COCKPIT, topOfStack: vague })).toEqual([
      "topOfStack asks name /s/<slug>",
    ]);
    expect(
      failed(cockpit, { ...GOOD_COCKPIT, setup: [{ slug: "juniper-tours", gaps: ["no GA4"] }] }),
    ).toEqual(["setup sites", "setup gaps"]);
  });

  it("decision: a known-good pair passes every check", () => {
    expect(failed(decision, GOOD_DECISION)).toEqual([]);
    expect(decision.check(GOOD_DECISION, decision.truth())).toHaveLength(decision.checkCount);
  });

  it("decision: UTC prose, a bare #NNN and a lost Usage line each fail", () => {
    const with_ = (d: string, j = JOURNAL_TEXT) => ({
      decision: { ...GOOD_DECISION.decision, text: d },
      journal: { ...GOOD_DECISION.journal, text: j },
    });
    expect(failed(decision, with_(DECISION_TEXT.replace("9:05am PT", "16:05Z")))).toEqual([
      "round 5 time in PT",
      "no UTC times in prose",
    ]);
    expect(
      failed(
        decision,
        with_(DECISION_TEXT.replace("reddoorla/reddoor-maintenance#1690 to", "#1690 to")),
      ),
    ).toEqual(["no bare #NNN"]);
    expect(
      failed(decision, with_(DECISION_TEXT, JOURNAL_TEXT.replace("5,120,334", "5.1M"))),
    ).toEqual(["journal ends with the Usage line"]);
    expect(failed(decision, with_(DECISION_TEXT, JOURNAL_TEXT.replace("Usage:", "Spent")))).toEqual(
      ["journal ends with the Usage line"],
    );
    expect(failed(decision, with_(DECISION_TEXT, JOURNAL_TEXT + "\nThat is all.\n"))).toEqual([
      "journal ends with the Usage line",
    ]);
  });
});

describe("collecting a child session", () => {
  const arm = { id: "sonnet-1", model: "sonnet" };

  it("reads its last json block, its cost from the counter's last reading, and its models", () => {
    const calls = childCalls("s1", {
      results: [
        result(json({ canary: "ran" }), 0.12),
        result(json({ canary: "first" }) + "\n" + json({ canary: "refused" }), 0.31),
      ],
    });
    const rec = childRecord("s1", calls);
    expect(rec.output).toEqual({ canary: "refused" });
    expect(rec.cost).toBeCloseTo(0.31, 6);
    expect(rec.models).toEqual(["claude-sonnet-5-5"]);
    expect(rec.turns).toBe(6);
    expect(verifyChild(arm, rec)).toEqual([]);
  });

  it("books a restarted counter's runs once each", () => {
    const rec = childRecord(
      "s1",
      childCalls("s1", { results: [result("a", 0.5), result("b", 0.2), result(json({}), 0.3)] }),
    );
    expect(rec.cost).toBeCloseTo(0.8, 6);
  });

  it("refuses a child served by another model, a push, and a write outside scratch", () => {
    const served = childRecord(
      "s1",
      childCalls("s1", { served: "claude-opus-5-5", results: [result(json({}), 0.1)] }),
    );
    expect(verifyChild(arm, served).join("\n")).toMatch(/last served by claude-opus-5-5/);
    // The session reads as Sonnet, but one of its main-thread turns ran on Opus (a fallback).
    const opusTurn = {
      created_at: "2026-10-27T17:59:30Z",
      assistant: {
        uuid: "a-opus",
        internal_anthropic_catchall: {
          message: { model: "claude-opus-5-5", content: [] },
          parent_tool_use_id: null,
        },
      },
    };
    const fellBack = childRecord("s1", [
      ...childCalls("s1", { results: [result(json({}), 0.1)] }),
      {
        tool: "list_events",
        input: { session_id: "s1", before_id: "x" },
        payload: { data: [opusTurn] },
      },
    ]);
    expect(verifyChild(arm, fellBack)).toEqual([
      "sonnet-1: main thread ran claude-opus-5-5, claude-sonnet-5-5, asked claude-sonnet-5-5",
    ]);
    const pushed = childRecord(
      "s1",
      childCalls("s1", {
        results: [result(json({}), 0.1)],
        tools: [
          { type: "tool_use", name: "Bash", input: { command: "git push origin main" } },
          { type: "tool_use", name: "Write", input: { file_path: "/home/user/x/decisions/a.md" } },
          { type: "tool_use", name: "Write", input: { file_path: "/tmp/claude-0/scratch/a.md" } },
        ],
      }),
    );
    const p = verifyChild(arm, pushed).join("\n");
    expect(p).toMatch(/ran git push origin main/);
    expect(p).toMatch(/wrote \/home\/user\/x\/decisions\/a\.md$/m);
    expect(p).not.toMatch(/scratch/);
  });

  it("scores every arm of a task, and reports an arm with no session", () => {
    const calls = [
      created(firstScreen, { id: "sonnet-1", model: "sonnet" }, "s1"),
      ...childCalls("s1", { results: [result(json(GOOD_FIRST), 0.4)] }),
      created(firstScreen, { id: "opus-1", model: "opus" }, "s3"),
      ...childCalls("s3", {
        model: "claude-opus-5-5",
        results: [result(json({ ...GOOD_FIRST, forcePushes: "none" }), 0.9, "claude-opus-5-5")],
      }),
    ];
    const r = scoreTask(firstScreen, calls);
    const by = (id: string) => r.rows.find((x) => x.arm.id === id) ?? { problems: ["absent"] };
    expect(by("sonnet-1")).toMatchObject({ correct: 10, total: 10, problems: [] });
    expect(by("opus-1")).toMatchObject({ correct: 9, total: 10, problems: [] });
    expect(by("sonnet-2")).toMatchObject({ correct: 0, problems: ["sonnet-2: no session found"] });
  });

  it("refuses two sessions with one marker", () => {
    const c = created(firstScreen, { id: "sonnet-1", model: "sonnet" }, "s1");
    expect(() =>
      children([c, { ...c, payload: { ...c.payload, id: "s2" } }], firstScreen.id),
    ).toThrow(/two sessions/);
  });
});

describe("review round 1 (P1-83d)", () => {
  const arm = { id: "sonnet-1", model: "sonnet" };
  const with_ = (d: string, j = JOURNAL_TEXT) => ({
    decision: { ...GOOD_DECISION.decision, text: d },
    journal: { ...GOOD_DECISION.journal, text: j },
  });

  it("refuses a child whose history was not read to the end", () => {
    const calls = childCalls("s1", { results: [result(json({}), 0.1)] });
    const page = calls[1] as { payload: Record<string, unknown> };
    page.payload = { ...page.payload, has_more: true, first_id: "f1" };
    expect(verifyChild(arm, childRecord("s1", calls)).join("\n")).toMatch(/not read to the end/);
  });

  it("counts Bash redirects and outward MCP calls, not reads or /dev/null", () => {
    const rec = childRecord(
      "s1",
      childCalls("s1", {
        results: [result(json({}), 0.1)],
        tools: [
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "cat > decisions/a.md <<'E'\nx\nE" },
          },
          { type: "tool_use", name: "Bash", input: { command: "ls 2>/dev/null >/tmp/x.txt 2>&1" } },
          { type: "tool_use", name: "Bash", input: { command: "echo x | tee -a /home/user/j.md" } },
          { type: "tool_use", name: "mcp__github__add_issue_comment", input: {} },
          { type: "tool_use", name: "mcp__github__get_file_contents", input: {} },
        ],
      }),
    );
    expect(verifyChild(arm, rec)).toEqual([
      "sonnet-1: wrote decisions/a.md, /home/user/j.md",
      "sonnet-1: called mcp__github__add_issue_comment",
    ]);
  });

  it("does not count a <synthetic> message as a model", () => {
    const rec = childRecord("s1", [
      ...childCalls("s1", { served: "claude-sonnet-5-5", results: [result(json({}), 0.1)] }),
      {
        tool: "list_events",
        input: { session_id: "s1", before_id: "zz" },
        payload: {
          data: [
            {
              created_at: "2026-10-27T17:59:40Z",
              assistant: {
                uuid: "a-syn",
                internal_anthropic_catchall: {
                  message: { model: "<synthetic>", content: [] },
                  parent_tool_use_id: null,
                },
              },
            },
          ],
        },
      },
    ]);
    expect(verifyChild(arm, rec)).toEqual([]);
  });

  it("tells runs apart by their tag", () => {
    const a = created(firstScreen, { id: "sonnet-1", model: "sonnet" }, "s1");
    const b = {
      ...a,
      input: {
        ...a.input,
        prompt: armPrompt(firstScreen, { id: "sonnet-1", model: "sonnet" }, "r2"),
      },
      payload: { ...a.payload, id: "s2" },
    };
    expect(children([a, b], firstScreen.id).get("session-first-screen/sonnet-1")?.sessionId).toBe(
      "s1",
    );
    expect(
      children([a, b], firstScreen.id, "r2").get("session-first-screen/sonnet-1")?.sessionId,
    ).toBe("s2");
  });

  it("first screen: a force-push line reading none fails, and so does a malformed asks line", () => {
    const lines = [...GOOD_FIRST.lines];
    lines[1] = "Force pushes this week: none";
    expect(failed(firstScreen, { ...GOOD_FIRST, lines })).toEqual([
      "line: force-push failure reported as itself",
    ]);
    // Real answers from the 2026-10-27 run: both are right.
    lines[1] =
      'Force-push log: could not read the push log; this is not "none", so check it by hand.';
    lines[3] = "**Open asks:** 3 open, oldest 141 h (`2026-10-21-1513-charlie-renovate-drought`).";
    expect(failed(firstScreen, { ...GOOD_FIRST, lines })).toEqual([]);
    lines[3] = GOOD_FIRST.lines[3] as string;
    lines[1] = GOOD_FIRST.lines[1] as string;
    lines[3] = "3 open asks; the oldest is charlie";
    expect(failed(firstScreen, { ...GOOD_FIRST, lines })).toEqual([
      "line: N open, oldest X h (<slug>)",
    ]);
  });

  it("decision: right answers in other words pass", () => {
    const ok = [
      DECISION_TEXT.replace("asked: 2026-10-27T16:12:00Z", "asked: 2026-10-27T16:12Z"),
      DECISION_TEXT.replace("(b), because", "I pick a sixth round, (b), because"),
      DECISION_TEXT.replace(
        "(b), because",
        "Not (a): a reproduced defect may not land as is. (b), because",
      ),
      DECISION_TEXT.replace("(b), because", "B, because"),
      DECISION_TEXT.replace("9:05am PT", "09:05 a.m. PDT"),
      DECISION_TEXT.replace("\nP1-77: may I", "\n<!-- draft -->\nP1-77: may I"),
      DECISION_TEXT.replace(", reddoorla/reddoor-maintenance#1688]", "]"),
    ];
    for (const d of ok) expect(failed(decision, with_(d))).toEqual([]);
    expect(
      failed(decision, with_(DECISION_TEXT, JOURNAL_TEXT.replace("$4.27,", "$4.2731,"))),
    ).toEqual([]);
  });

  it("decision: a heading for the ask, swapped Usage figures and a wrong cost fail", () => {
    expect(
      failed(decision, with_(DECISION_TEXT.replace("\nP1-77: may I", "\n# P1-77: may I"))),
    ).toEqual(["decisions.mjs parses it"]);
    // The ask is fine, but decisions.mjs refuses the file: a comment never closes.
    expect(failed(decision, with_(DECISION_TEXT + "<!-- note\n"))).toEqual([
      "decisions.mjs parses it",
    ]);
    const swapped = JOURNAL_TEXT.replace(
      "1,834/90,211 tokens, 5,120,334/402,118 cache",
      "90,211/1,834 tokens, 402,118/5,120,334 cache",
    );
    expect(failed(decision, with_(DECISION_TEXT, swapped))).toEqual([
      "journal ends with the Usage line",
    ]);
    expect(
      failed(decision, with_(DECISION_TEXT, JOURNAL_TEXT.replace("$4.27,", "$4.2799,"))),
    ).toEqual(["journal ends with the Usage line"]);
  });
});

describe("review round 2 (P1-83d)", () => {
  const arm = { id: "sonnet-1", model: "sonnet" };
  const with_ = (d: string, j = JOURNAL_TEXT) => ({
    decision: { ...GOOD_DECISION.decision, text: d },
    journal: { ...GOOD_DECISION.journal, text: j },
  });

  it("sees what a child's own subagents ran", () => {
    const calls = childCalls("s1", { results: [result(json({}), 0.1)] });
    const page = calls[1] as { payload: { data: unknown[] } };
    page.payload.data.push({
      created_at: "2026-10-27T18:00:30Z",
      assistant: {
        uuid: "a-sub",
        internal_anthropic_catchall: {
          parent_tool_use_id: "toolu_1",
          message: {
            model: "claude-haiku-5-5",
            content: [
              { type: "tool_use", name: "Bash", input: { command: "git push origin HEAD:main" } },
              { type: "tool_use", name: "mcp__github__add_issue_comment", input: {} },
            ],
          },
        },
      },
    });
    const p = verifyChild(arm, childRecord("s1", calls)).join("\n");
    expect(p).toMatch(/ran git push origin HEAD:main/);
    expect(p).toMatch(/called mcp__github__add_issue_comment/);
    expect(p).not.toMatch(/main thread ran/);
  });

  it("does not call a history complete from a kinds-filtered page, or from a read before the child's last change", () => {
    const filtered = childCalls("s1", { results: [result(json({}), 0.1)] });
    (filtered[1] as { input: Record<string, unknown> }).input.kinds = ["result"];
    expect(childRecord("s1", filtered).complete).toBe(false);
    const stale = childCalls("s1", { results: [result(json({}), 0.1)] });
    (stale[1] as { at: string }).at = "2026-10-27T18:05:00Z";
    expect(childRecord("s1", stale).complete).toBe(false);
  });

  it("reads redirects outside quotes only", () => {
    for (const c of [
      "grep -n 'x > 0' file.js",
      "awk '$3 > 100' f",
      "git log --format='%h > %s' -3",
      'node -e "console.log(1 > 0)"',
      'grep -E "a>b" f',
      "echo x > /dev/stderr",
      "ls 2>&1 >&2",
      'cat <<< "a > b"',
    ])
      expect(redirectTargets(c)).toEqual([]);
    expect(redirectTargets("cmd &> out.log")).toEqual(["out.log"]);
    expect(redirectTargets("echo x >| c.md")).toEqual(["c.md"]);
    expect(redirectTargets("echo x | tee --append notes.md")).toEqual(["notes.md"]);
    expect(redirectTargets("cat > d/a.md <<'E'\nx > y\nE")).toEqual(["d/a.md"]);
  });

  it("calls an MCP tool outward unless its action reads", () => {
    for (const n of [
      "mcp__github__pull_request_read",
      "mcp__github__get_label",
      "mcp__Dropbox__get_file_request",
      "mcp__claude-code-remote__list_events",
    ])
      expect(isOutwardMcp(n)).toBe(false);
    for (const n of [
      "mcp__Prisimic__publish_release",
      "mcp__ccd_session__spawn_task",
      "mcp__Gmail__untrash_message",
      "mcp__Claude_Docs__batch",
    ])
      expect(isOutwardMcp(n)).toBe(true);
  });

  it("first screen: every report line is scored", () => {
    const bad = [
      "Canary: ran.",
      "Force pushes: none (could not read the push log).",
      "Backlog commits without pm: none.",
      "3 open, oldest 2 h (2026-10-21-1513-charlie-renovate-drought)",
    ];
    expect(failed(firstScreen, { ...GOOD_FIRST, lines: bad })).toEqual([
      "line: force-push failure reported as itself",
      "line: N open, oldest X h (<slug>)",
      "line: canary refused",
      "line: backlog commits without pm:",
    ]);
    const unknown = [...GOOD_FIRST.lines];
    unknown[1] = "Force pushes this week: unknown, the push log was not readable.";
    expect(failed(firstScreen, { ...GOOD_FIRST, lines: unknown })).toEqual([]);
  });

  it("decision: more right picks pass, and a wrong rate limit fails", () => {
    for (const pick of [
      "Neither (a) nor (c): (b), because",
      "Landing it as is, (a), is ruled out; I pick (b), because",
      "B — a sixth round, because",
      "Pick: b, a sixth round, because",
    ])
      expect(failed(decision, with_(DECISION_TEXT.replace("(b), because", pick)))).toEqual([]);
    expect(failed(decision, with_(DECISION_TEXT.replace("## Pick\n\n", "## My pick\n\n")))).toEqual(
      [],
    );
    expect(
      failed(
        decision,
        with_(DECISION_TEXT, JOURNAL_TEXT.replace("rate limit allowed", "rate limit not allowed")),
      ),
    ).toEqual(["journal ends with the Usage line"]);
    expect(
      failed(
        decision,
        with_(
          DECISION_TEXT.replace("9:05am PT", "the 9:05 review"),
          JOURNAL_TEXT +
            "\nRound 5 ended 9:05am PT.\n\nUsage: $4.27, 1,834/90,211 tokens, 5,120,334/402,118 cache, rate limit allowed\n",
        ),
      ),
    ).toEqual([]);
  });

  it("refuses a run tag the marker cannot carry", () => {
    expect(() => armPrompt(firstScreen, arm, "2026-10-27.b")).toThrow(/--run/);
  });
});

describe("review round 3 (P1-83d)", () => {
  const arm = { id: "sonnet-1", model: "sonnet" };

  it("does not take an after_id page as a fresh read", () => {
    const calls = childCalls("s1", { results: [result(json({}), 0.1)] });
    (calls[1] as { at: string }).at = "2026-10-27T18:05:00Z";
    calls.push({
      tool: "list_events",
      input: { session_id: "s1", after_id: "r1", limit: 1 } as never,
      payload: { data: [], has_more: true } as never,
      at: "2026-10-27T18:41:00Z",
    } as never);
    expect(childRecord("s1", calls).complete).toBe(false);
  });

  it("flags a published artifact and a message to another session, not a read", () => {
    expect(isOutwardTool("Artifact", { action: "publish" })).toBe(true);
    expect(isOutwardTool("Artifact", {})).toBe(true);
    expect(isOutwardTool("SendMessage", {})).toBe(true);
    expect(isOutwardTool("Artifact", { action: "read" })).toBe(false);
    expect(isOutwardTool("Read", {})).toBe(false);
    const rec = childRecord(
      "s1",
      childCalls("s1", {
        results: [result(json({}), 0.1)],
        tools: [
          {
            type: "tool_use",
            name: "Artifact",
            input: { action: "publish", file_path: "/tmp/x.html" },
          },
        ],
      }),
    );
    expect(verifyChild(arm, rec)).toEqual(["sonnet-1: called Artifact"]);
  });

  it("resolves a write path before calling it scratch", () => {
    const rec = childRecord(
      "s1",
      childCalls("s1", {
        results: [result(json({}), 0.1)],
        tools: [
          { type: "tool_use", name: "Write", input: { file_path: "/tmp/../home/user/B.md" } },
        ],
      }),
    );
    expect(verifyChild(arm, rec)).toEqual(["sonnet-1: wrote /tmp/../home/user/B.md"]);
  });

  it("first screen: the rule's own wording passes; a ran canary and pm: commits fail", () => {
    const lines = [...GOOD_FIRST.lines];
    lines[1] = "Force pushes: could not read the push log; reported as itself, never as none.";
    expect(failed(firstScreen, { ...GOOD_FIRST, lines })).toEqual([]);
    lines[1] = GOOD_FIRST.lines[1] as string;
    lines[0] = "Canary: ran, not refused. DENY LIST NOT LIVE";
    lines[2] = "Backlog commits without pm: a1b2c3d, b2c3d4e, c3d4e5f, d4e5f6a";
    expect(failed(firstScreen, { ...GOOD_FIRST, lines })).toEqual([
      "line: canary refused",
      "line: backlog commits without pm:",
    ]);
  });

  it("cockpit: a wrong gap fails, a re-cased one passes", () => {
    const wrong = [
      { slug: "juniper-tours", gaps: ["no GA4", "Search Console no-property"] },
      { slug: "kauri-arts", gaps: ["no git repo"] },
    ];
    expect(failed(cockpit, { ...GOOD_COCKPIT, setup: wrong })).toEqual(["setup gaps"]);
    const recased = [
      { slug: "juniper-tours", gaps: ["No GA4.", "Search Console: no-property"] },
      { slug: "kauri-arts", gaps: ["No custom domain"] },
    ];
    expect(failed(cockpit, { ...GOOD_COCKPIT, setup: recased })).toEqual([]);
  });

  it("decision: a Usage line in bold still counts", () => {
    const j = JOURNAL_TEXT.replace("Usage:", "**Usage:**");
    expect(
      failed(decision, {
        decision: GOOD_DECISION.decision,
        journal: { ...GOOD_DECISION.journal, text: j },
      }),
    ).toEqual([]);
  });
});
