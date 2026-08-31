import { describe, expect, it } from "vitest";
import {
  childEnv,
  claudeCodeAnalyzeDeps,
  claudeCodeEngine,
  llmAuthMode,
  makeClaudeCodeRun,
  type ClaudeCodeRun,
} from "../../src/prospect/claude-code.js";
import { envAnalyzeDeps, envEngines } from "../../src/prospect/pipeline.js";
import { PROBE_MODEL } from "../../src/prospect/probes.js";

/** A fake `claude -p` subprocess that records what it was asked to run and
 *  replies with a canned transcript. Every stdout fixture in this file is
 *  copied from a REAL `claude -p` run captured on 2026-08-31 (CLI 2.1.92) —
 *  the envelope keys, the hook/init noise, the string-typed WebSearch
 *  tool_result with its embedded `Links:` JSON. If the CLI's output contract
 *  drifts, these fixtures are the record of what we built against. */
function fakeRun(reply: { stdout?: string; stderr?: string; code?: number }) {
  const calls: Array<{ args: string[]; stdin: string; env: NodeJS.ProcessEnv }> = [];
  const run: ClaudeCodeRun = async (input) => {
    calls.push({ args: input.args, stdin: input.stdin, env: input.env });
    return { stdout: reply.stdout ?? "", stderr: reply.stderr ?? "", code: reply.code ?? 0 };
  };
  return { run, calls };
}

/** Argument that follows `flag` in an argv array, or undefined. */
function argAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** The single recorded call, thrown (not undefined) when the runner never ran
 *  — keeps noUncheckedIndexedAccess honest without non-null assertions. */
function onlyCall<T>(calls: T[]): T {
  const call = calls[0];
  if (!call) throw new Error("the runner was never called");
  return call;
}

const ANALYZE_ENVELOPE = {
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 12029,
  num_turns: 2,
  result: "Reddoor Creative, based in Los Angeles.",
  stop_reason: "end_turn",
  session_id: "5eb8e3a2-36b7-4d32-85e1-e411a30c5615",
  total_cost_usd: 0.19884125,
  structured_output: { businessName: "Reddoor Creative", business: "a branding agency" },
};

describe("llmAuthMode", () => {
  it('defaults to "api" when the toggle is unset or blank', () => {
    expect(llmAuthMode({})).toBe("api");
    expect(llmAuthMode({ PROSPECT_LLM_AUTH: "" })).toBe("api");
    expect(llmAuthMode({ PROSPECT_LLM_AUTH: "  " })).toBe("api");
  });

  it("accepts the two spelled-out modes", () => {
    expect(llmAuthMode({ PROSPECT_LLM_AUTH: "api" })).toBe("api");
    expect(llmAuthMode({ PROSPECT_LLM_AUTH: "subscription" })).toBe("subscription");
  });

  it("throws on an unrecognised value rather than silently picking a biller", () => {
    expect(() => llmAuthMode({ PROSPECT_LLM_AUTH: "subscripton" })).toThrow(/PROSPECT_LLM_AUTH/);
  });
});

describe("childEnv", () => {
  it("strips API-key auth so the subprocess cannot silently bill the metered API", () => {
    const env = childEnv({
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-ant-real",
      ANTHROPIC_AUTH_TOKEN: "tok",
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("strips the third-party billing routes, not just the API key", () => {
    const env = childEnv({
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
      ANTHROPIC_BASE_URL: "https://proxy.example",
    });
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it("maps CLAUDE_OAUTH into the variable the claude CLI actually reads", () => {
    const env = childEnv({ CLAUDE_OAUTH: "oauth-tok" });
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-tok");
  });

  it("leaves an explicit CLAUDE_CODE_OAUTH_TOKEN alone", () => {
    const env = childEnv({ CLAUDE_CODE_OAUTH_TOKEN: "explicit", CLAUDE_OAUTH: "other" });
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("explicit");
  });
});

describe("claudeCodeAnalyzeDeps", () => {
  it("runs claude -p with the analyze contract: our system prompt, opus, a schema, no tools", async () => {
    const { run, calls } = fakeRun({ stdout: JSON.stringify(ANALYZE_ENVELOPE) });
    const out = await claudeCodeAnalyzeDeps(run).run({ system: "SYSTEM TEXT", user: "USER TEXT" });

    expect(out).toEqual(ANALYZE_ENVELOPE.structured_output);
    expect(calls).toHaveLength(1);
    const { args, stdin } = onlyCall(calls);
    expect(stdin).toBe("USER TEXT");
    expect(args[0]).toBe("-p");
    expect(argAfter(args, "--model")).toBe("claude-opus-5");
    expect(argAfter(args, "--output-format")).toBe("json");
    expect(argAfter(args, "--system-prompt")).toBe("SYSTEM TEXT");
    expect(args).toContain("--no-session-persistence");
    // The analyze pass must not touch the machine or the web — it judges only
    // the text we hand it, same as the API path.
    const disallowed = argAfter(args, "--disallowedTools") ?? "";
    for (const tool of [
      "Bash",
      "Edit",
      "Write",
      "WebSearch",
      "WebFetch",
      "Skill",
      "SlashCommand",
    ]) {
      expect(disallowed).toContain(tool);
    }
    // The subprocess must not inherit the developer's Claude Code config —
    // user hooks, plugins, and MCP servers have no place inside an audit.
    // "project" sources + a temp-dir cwd resolve to nothing at all.
    expect(argAfter(args, "--setting-sources")).toBe("project");
    expect(args).toContain("--strict-mcp-config");
    // A runaway loop is bounded by computed spend, not just the wall clock.
    expect(argAfter(args, "--max-budget-usd")).toBe("5");
    // The schema is the real AnalyzeSchema, not a hand-copied twin.
    const schema = JSON.parse(argAfter(args, "--json-schema") ?? "{}");
    expect(schema.properties).toHaveProperty("businessName");
    expect(schema.properties).toHaveProperty("buyerQuestions");
    // Reproduced live 2026-08-31 (CLI 2.1.92): a schema carrying the
    // "$schema" meta key makes the CLI report success while silently omitting
    // structured_output — and z.toJSONSchema emits that key by default.
    expect(schema).not.toHaveProperty("$schema");
  });

  it("hands the subprocess an env with no metered credentials", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-leak";
    try {
      const { run, calls } = fakeRun({ stdout: JSON.stringify(ANALYZE_ENVELOPE) });
      await claudeCodeAnalyzeDeps(run).run({ system: "s", user: "u" });
      expect(onlyCall(calls).env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("throws on a non-zero exit, carrying the stderr head", async () => {
    const { run } = fakeRun({ stdout: "", stderr: "Invalid API key · please run /login", code: 1 });
    await expect(claudeCodeAnalyzeDeps(run).run({ system: "s", user: "u" })).rejects.toThrow(
      /Invalid API key/,
    );
  });

  it("throws when the envelope reports an error instead of returning junk", async () => {
    const envelope = { ...ANALYZE_ENVELOPE, subtype: "error_during_execution", is_error: true };
    const { run } = fakeRun({ stdout: JSON.stringify(envelope) });
    await expect(claudeCodeAnalyzeDeps(run).run({ system: "s", user: "u" })).rejects.toThrow(
      /error_during_execution/,
    );
  });

  it("throws when stdout is not JSON", async () => {
    const { run } = fakeRun({ stdout: "Execution error" });
    await expect(claudeCodeAnalyzeDeps(run).run({ system: "s", user: "u" })).rejects.toThrow(
      /claude -p/,
    );
  });

  it("throws when the envelope has no structured_output — never inventing an analysis", async () => {
    const { structured_output: _dropped, ...withoutStructured } = ANALYZE_ENVELOPE;
    const { run } = fakeRun({ stdout: JSON.stringify(withoutStructured) });
    await expect(claudeCodeAnalyzeDeps(run).run({ system: "s", user: "u" })).rejects.toThrow(
      /structured_output/,
    );
  });
});

/** Verbatim shapes from the real capture: hook noise, an init event, a
 *  thinking block with empty text, the deferred-tools ToolSearch round trip
 *  (whose tool_result content is an ARRAY, not a string), then the WebSearch
 *  call whose tool_result is a STRING with the `Links:` JSON inside it. */
const STREAM_LINES = [
  { type: "system", subtype: "hook_started", hook: "SessionStart" },
  { type: "system", subtype: "init", session_id: "abc", tools: [] },
  {
    type: "assistant",
    message: {
      content: [
        { type: "thinking", thinking: "", signature: "ErcPCqgBCBEYAipA" },
        { type: "tool_use", id: "t1", name: "ToolSearch", input: { query: "WebSearch" } },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: [{ type: "tool_reference", tool_name: "WebSearch" }],
        },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "t2",
          name: "WebSearch",
          input: { query: "best branding agencies" },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t2",
          content:
            'Web search results for query: "best branding agencies"\n\nLinks: [{"title":"Seven Best","url":"https://www.thedigitalelevator.com/blog/best-medical-device-marketing-agencies/"},{"title":"Top for 2026","url":"https://wantbranding.com/best-healthcare-branding-agencies/"}]\n\nDetailed results follow.',
        },
      ],
    },
  },
  // A failed second search: its error prose carries a URL that must NOT be
  // mined (the API engine's typed narrowing can't make this mistake; ours has
  // to check is_error explicitly).
  {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "t3", name: "WebSearch", input: { query: "second search" } },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t3",
          is_error: true,
          content: "Error: rate limited — see https://support.claude.com/rate-limits for details",
        },
      ],
    },
  },
  // A non-WebSearch tool's string result: whatever URLs it carries are not
  // search retrievals and must not become citations.
  {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "t4", name: "SomethingElse", input: {} }],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t4",
          content: "docs at https://not-a-citation.example/page",
        },
      ],
    },
  },
  { type: "assistant", message: { content: [{ type: "text", text: "Here are some agencies." }] } },
  { type: "rate_limit_event", info: { unified_rate_limit: "ok" } },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 3,
    result: "Here are some agencies: WANT Branding and The Digital Elevator's picks.",
    total_cost_usd: 0.407,
  },
];

const streamStdout = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

describe("claudeCodeEngine", () => {
  it('is its own engine name — "claude-code" rows must never mix with API-path "claude" rows', () => {
    expect(claudeCodeEngine().name).toBe("claude-code");
  });

  it("asks via claude -p with WebSearch as the only tool and the probe model", async () => {
    const { run, calls } = fakeRun({ stdout: streamStdout(STREAM_LINES) });
    await claudeCodeEngine(run).ask("who fixes teeth in redondo beach");

    const { args, stdin } = onlyCall(calls);
    expect(stdin).toBe("who fixes teeth in redondo beach");
    expect(argAfter(args, "--model")).toBe(PROBE_MODEL);
    expect(argAfter(args, "--output-format")).toBe("stream-json");
    // stream-json is refused in print mode without --verbose (verified live).
    expect(args).toContain("--verbose");
    expect(argAfter(args, "--allowedTools")).toBe("WebSearch");
    expect(argAfter(args, "--disallowedTools")).not.toContain("WebSearch");
    expect(args).toContain("--no-session-persistence");
    // A minimal replacement system prompt: the default one makes the probe a
    // coding assistant, which is even further from "an answer engine".
    expect(argAfter(args, "--system-prompt")).toMatch(/answer engine/i);
    expect(argAfter(args, "--setting-sources")).toBe("project");
    expect(args).toContain("--strict-mcp-config");
    expect(argAfter(args, "--max-budget-usd")).toBe("2");
  });

  it("returns the final answer and ONLY the domains a successful WebSearch retrieved", async () => {
    const { run } = fakeRun({ stdout: streamStdout(STREAM_LINES) });
    const reply = await claudeCodeEngine(run).ask("q");

    expect(reply.answer).toBe(
      "Here are some agencies: WANT Branding and The Digital Elevator's picks.",
    );
    // The fixture also carries an is_error WebSearch result (support.claude.com
    // in its prose) and a non-WebSearch tool result with a URL — neither may
    // appear here, or the report's competitor table lists our own error pages.
    expect(reply.citedDomains).toEqual(["thedigitalelevator.com", "wantbranding.com"]);
  });

  it("falls back to bare URL extraction when the Links JSON is malformed", async () => {
    const lines = STREAM_LINES.map((l) => structuredClone(l)) as typeof STREAM_LINES;
    const searchEvent = lines[5];
    if (!searchEvent)
      throw new Error("fixture shape changed: expected the WebSearch tool_result at index 5");
    const toolResult = (searchEvent.message as { content: Array<{ content: unknown }> }).content[0];
    if (!toolResult) throw new Error("fixture shape changed: tool_result block missing");
    toolResult.content =
      "Links: [{broken json here] see https://icovy.com/medical-device-marketing instead";
    const { run } = fakeRun({ stdout: streamStdout(lines) });
    const reply = await claudeCodeEngine(run).ask("q");
    expect(reply.citedDomains).toEqual(["icovy.com"]);
  });

  it("tolerates unparseable stream lines without losing the rest", async () => {
    const { run } = fakeRun({ stdout: "not json at all\n" + streamStdout(STREAM_LINES) });
    const reply = await claudeCodeEngine(run).ask("q");
    expect(reply.citedDomains).toContain("wantbranding.com");
  });

  it("throws when the run ends in an error result", async () => {
    const lines = [
      ...STREAM_LINES.slice(0, -1),
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        result: "usage limit reached",
      },
    ];
    const { run } = fakeRun({ stdout: streamStdout(lines) });
    await expect(claudeCodeEngine(run).ask("q")).rejects.toThrow(/usage limit reached/);
  });

  it("throws on a non-zero exit, carrying stderr", async () => {
    const { run } = fakeRun({ stdout: "", stderr: "boom", code: 1 });
    await expect(claudeCodeEngine(run).ask("q")).rejects.toThrow(/boom/);
  });

  it("throws when no result event ever arrives — silence is not an answer", async () => {
    const { run } = fakeRun({ stdout: streamStdout(STREAM_LINES.slice(0, 3)) });
    await expect(claudeCodeEngine(run).ask("q")).rejects.toThrow(/result/);
  });
});

describe("makeClaudeCodeRun (the real subprocess)", () => {
  const PATH_ONLY = { PATH: process.env.PATH };

  it("settles instead of crashing when the child exits without reading a large stdin", async () => {
    // `false` exits immediately, never reading stdin. A 300KB payload does not
    // fit the ~64KB pipe buffer, so the pending write EPIPEs after exit — with
    // no stdin error listener that is an uncaught exception that killed the
    // WHOLE audit process (reproduced live, Node 24). The analyze stdin
    // realistically exceeds 64KB on heading-heavy sites.
    const run = makeClaudeCodeRun("false");
    const res = await run({
      args: [],
      stdin: "x".repeat(300_000),
      env: PATH_ONLY,
      timeoutMs: 30_000,
    });
    expect(res.code).not.toBe(0);
  });

  it("rejects cleanly when the binary does not exist", async () => {
    const run = makeClaudeCodeRun("definitely-not-a-real-binary-9x7");
    await expect(
      run({ args: [], stdin: "x".repeat(300_000), env: PATH_ONLY, timeoutMs: 30_000 }),
    ).rejects.toThrow(/ENOENT/);
  });

  it("does not corrupt a multibyte character split across pipe chunks", async () => {
    // 65535 ASCII bytes push the following em dash (3 bytes) across the 64KB
    // pipe-chunk boundary; per-chunk Buffer.toString would decode both halves
    // to U+FFFD. (A platform with different chunking passes vacuously — on the
    // 64KB-pipe platforms this suite runs on, it is a real regression canary.)
    const run = makeClaudeCodeRun("node");
    const script =
      "process.stdout.write(Buffer.concat([Buffer.alloc(65535, 97), Buffer.from([0xe2, 0x80, 0x94])]))";
    const res = await run({ args: ["-e", script], stdin: "", env: PATH_ONLY, timeoutMs: 30_000 });
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("�");
    expect(res.stdout.endsWith("—")).toBe(true);
  });
});

describe("env-driven selection (the production toggle)", () => {
  const withEnv = async (
    vars: Record<string, string | undefined>,
    fn: () => void | Promise<void>,
  ) => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  it("api mode (the default, what the production runner sees) probes with the API engine", () =>
    withEnv({ PROSPECT_LLM_AUTH: undefined, PERPLEXITY_API_KEY: undefined }, () => {
      expect(envEngines().map((e) => e.name)).toEqual(["claude"]);
    }));

  it("subscription mode swaps the claude engine for claude-code and keeps the perplexity gate", () =>
    withEnv({ PROSPECT_LLM_AUTH: "subscription", PERPLEXITY_API_KEY: "pk" }, () => {
      expect(envEngines().map((e) => e.name)).toEqual(["perplexity", "claude-code"]);
    }));

  it("envAnalyzeDeps picks the subscription deps only when toggled", () =>
    withEnv({ PROSPECT_LLM_AUTH: "subscription" }, () => {
      const marker: ClaudeCodeRun = async () => ({ stdout: "", stderr: "", code: 0 });
      const picked = envAnalyzeDeps({
        api: () => ({ run: async () => "api" }),
        subscription: () => claudeCodeAnalyzeDeps(marker),
      });
      // The subscription deps are the ones built around our runner; the api
      // factory must not have been consulted.
      expect(picked).not.toBeNull();
      return expect(picked.run({ system: "s", user: "u" })).rejects.toThrow(/claude -p/);
    }));

  it("envAnalyzeDeps defaults to the api factory when the toggle is off", () =>
    withEnv({ PROSPECT_LLM_AUTH: undefined }, async () => {
      const picked = envAnalyzeDeps({
        api: () => ({ run: async () => "api-ran" }),
        subscription: () => {
          throw new Error("subscription factory must not run in api mode");
        },
      });
      await expect(picked.run({ system: "s", user: "u" })).resolves.toBe("api-ran");
    }));
});
