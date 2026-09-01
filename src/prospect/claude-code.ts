import { spawn } from "node:child_process";
import os from "node:os";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import { AccuracySchema } from "./accuracy.js";
import { AnalyzeSchema, type AnalyzeDeps } from "./analyze.js";
import { domainOf, PROBE_MODEL, type VisibilityEngine } from "./probes.js";

/**
 * The subscription-auth path: every model call is a `claude -p` subprocess
 * instead of a metered `@anthropic-ai/sdk` request, so development audits ride
 * the Claude Max plan's included usage. This is the officially supported
 * surface for that plan (a `claude setup-token` OAuth token, or the local
 * keychain login); pointing the raw SDK at a subscription token is not.
 *
 * PRODUCTION STAYS ON THE API. The private runner sets no PROSPECT_LLM_AUTH,
 * so `llmAuthMode()` resolves to "api" and nothing in this file runs. The
 * toggle exists because a Claude Code harness is measurably NOT the same
 * instrument as a bare API call — see `claudeCodeEngine` on why its rows are
 * labelled as a separate engine.
 *
 * Output contracts (envelope keys, the string-typed WebSearch tool_result
 * with embedded `Links:` JSON, stream-json requiring --verbose) were captured
 * from a real CLI 2.1.92 run on 2026-08-31 and are pinned by the fixtures in
 * tests/prospect/claude-code.test.ts.
 */

/** Seam over the `claude` subprocess, injected by tests the same way probes.ts
 *  injects `fetch` and analyze.ts injects `run`. */
export type ClaudeCodeRun = (input: {
  args: string[];
  stdin: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}) => Promise<{ stdout: string; stderr: string; code: number | null }>;

/** Which credential pays for model calls. Unset means the metered API — the
 *  production runner must never depend on remembering to set a variable. An
 *  unrecognised value throws rather than quietly picking a biller. */
export function llmAuthMode(env: NodeJS.ProcessEnv = process.env): "api" | "subscription" {
  const raw = (env.PROSPECT_LLM_AUTH ?? "").trim();
  if (raw === "" || raw === "api") return "api";
  if (raw === "subscription") return "subscription";
  throw new Error(`PROSPECT_LLM_AUTH must be "api" or "subscription", got "${raw}"`);
}

/** The subprocess env: metered credentials are STRIPPED, because the claude
 *  CLI resolves ANTHROPIC_API_KEY ahead of OAuth — leave it in place and
 *  subscription mode would silently bill the API while claiming not to.
 *  CLAUDE_OAUTH (the name in our env files) is mapped onto the variable the
 *  CLI actually reads; with neither set, a local keychain login still works. */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  delete out.ANTHROPIC_API_KEY;
  delete out.ANTHROPIC_AUTH_TOKEN;
  // The CLI can also be routed to metered billers that are not the Anthropic
  // API key: Bedrock/Vertex switches and a base-URL override. A dev shell
  // exporting CLAUDE_CODE_USE_BEDROCK=1 for another project must not turn
  // "subscription mode" into silent AWS billing.
  delete out.CLAUDE_CODE_USE_BEDROCK;
  delete out.CLAUDE_CODE_USE_VERTEX;
  delete out.ANTHROPIC_BASE_URL;
  if (!out.CLAUDE_CODE_OAUTH_TOKEN && env.CLAUDE_OAUTH) {
    out.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_OAUTH;
  }
  return out;
}

/** Tools the subprocess must never reach for. The audit judges text we hand
 *  it; a probe searches the web and nothing else. Everything filesystem- or
 *  shell-shaped is off the table in both modes. */
const BASE_DISALLOWED =
  "Bash,Edit,Write,Read,Glob,Grep,Task,TodoWrite,NotebookEdit,WebFetch,Skill,SlashCommand";
const ANALYZE_DISALLOWED = `${BASE_DISALLOWED},WebSearch`;

/** The subprocess must not inherit this machine's Claude Code config: user
 *  hooks are arbitrary shell commands that would fire on every audit call,
 *  plugins and MCP servers add tools no deny-list can enumerate, and a user
 *  CLAUDE.md folds somebody's project instructions into an audit prompt.
 *  "project" sources plus the temp-dir cwd resolve to no settings at all. */
const ISOLATION_ARGS = ["--setting-sources", "project", "--strict-mcp-config"];

/** An answer-engine probe should not introduce itself as a coding assistant.
 *  Replacing the harness system prompt narrows (never closes) the gap between
 *  this engine and a bare API call. Deliberately silent about citing: telling
 *  the model to cite sources would inflate the very signal we measure. */
const PROBE_SYSTEM_PROMPT =
  "You are an answer engine. Answer the user's question directly and concisely, searching the web when it helps.";

/** A cold analyze call on Opus with a big page bundle can legitimately run
 *  minutes; a probe is one search-and-answer round. Both get a hard stop so a
 *  wedged subprocess cannot pin an audit forever (the runner's own
 *  timeout-minutes backstop sits above this). */
const ANALYZE_TIMEOUT_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 4 * 60_000;

/** Cap on accumulated subprocess output. stream-json for one probe measured
 *  ~100KB; this is three orders of magnitude of headroom, not a limit anyone
 *  should meet. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** The real runner, parameterized on the binary only so tests can prove the
 *  subprocess plumbing against real processes without needing `claude`. */
export function makeClaudeCodeRun(binary = "claude"): ClaudeCodeRun {
  return ({ args, stdin, env, timeoutMs }) =>
    new Promise((resolve, reject) => {
      // cwd is the OS temp dir so the CLI cannot pick up a repo's CLAUDE.md and
      // fold somebody's project instructions into an audit prompt.
      const child = spawn(binary, args, { env, cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
      // Per-chunk Buffer.toString would decode a multibyte character split
      // across pipe chunks into two U+FFFDs; the decoders carry the partial
      // sequence across chunks.
      const outDecoder = new StringDecoder("utf8");
      const errDecoder = new StringDecoder("utf8");
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        child.kill("SIGKILL");
        reject(new Error(`claude -p timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const guard = () => {
        if (stdout.length + stderr.length <= MAX_OUTPUT_BYTES) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(new Error("claude -p produced more output than any real run should"));
      };
      child.stdout.on("data", (d: Buffer) => {
        stdout += outDecoder.write(d);
        guard();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += errDecoder.write(d);
        guard();
      });
      // A child that dies before draining stdin (bad flag after a CLI update,
      // instant auth failure, our own SIGKILL) EPIPEs the pending write; with
      // no listener that is an UNCAUGHT exception that kills the whole audit
      // process, bypassing the pipeline's stage containment (reproduced live).
      // The exit code from 'close' is the truth about the run — swallow here.
      child.stdin.on("error", () => {});
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout: stdout + outDecoder.end(), stderr: stderr + errDecoder.end(), code });
      });
      child.stdin.end(stdin);
    });
}

const defaultClaudeCodeRun: ClaudeCodeRun = makeClaudeCodeRun();

/** The single-JSON envelope `--output-format json` prints. Only the fields
 *  this module reads; the CLI emits many more. */
type ResultEnvelope = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  structured_output?: unknown;
};

/** One line of `--output-format stream-json`. Assistant/user events wrap an
 *  API-shaped message whose content blocks this module picks through. */
type StreamEvent = ResultEnvelope & {
  message?: { content?: unknown };
};

function contentBlocks(ev: StreamEvent): Array<Record<string, unknown>> {
  const content = ev.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null);
}

/** AnalyzeSchema serialized for the CLI's `--json-schema`, so there is no
 *  hand-copied twin to drift. The "$schema" meta key is stripped: fed a schema
 *  carrying it, the CLI reports success while silently omitting
 *  structured_output (reproduced live, CLI 2.1.92, 2026-08-31). */
function analyzeJsonSchema(): string {
  const { $schema: _meta, ...schema } = z.toJSONSchema(AnalyzeSchema);
  return JSON.stringify(schema);
}

/** The analyze pass over `claude -p`: same system prompt, same user prompt,
 *  same model, and the same AnalyzeSchema. `analyzeSite` re-parses and
 *  evidence-verifies the result exactly as it does for the API path. */
export function claudeCodeAnalyzeDeps(run: ClaudeCodeRun = defaultClaudeCodeRun): AnalyzeDeps {
  return {
    async run({ system, user }) {
      const args = [
        "-p",
        "--output-format",
        "json",
        "--json-schema",
        analyzeJsonSchema(),
        "--system-prompt",
        system,
        "--model",
        "claude-opus-5",
        "--no-session-persistence",
        "--disallowedTools",
        ANALYZE_DISALLOWED,
        ...ISOLATION_ARGS,
        // Spend bound: a real analyze measured ~$0.20-equivalent; this is a
        // runaway backstop, not a working ceiling.
        "--max-budget-usd",
        "5",
      ];
      const res = await run({ args, stdin: user, env: childEnv(), timeoutMs: ANALYZE_TIMEOUT_MS });
      if (res.code !== 0) {
        throw new Error(`claude -p (analyze) exited ${res.code}: ${res.stderr.slice(0, 400)}`);
      }
      let envelope: ResultEnvelope;
      try {
        envelope = JSON.parse(res.stdout) as ResultEnvelope;
      } catch {
        throw new Error(
          `claude -p (analyze) printed something other than the JSON envelope: ${res.stdout.slice(0, 200)}`,
        );
      }
      if (envelope.is_error || envelope.subtype !== "success") {
        throw new Error(
          `claude -p (analyze) failed (${envelope.subtype ?? "unknown"}): ${String(envelope.result ?? "").slice(0, 400)}`,
        );
      }
      if (envelope.structured_output === undefined) {
        throw new Error("claude -p (analyze) returned no structured_output");
      }
      return envelope.structured_output;
    },
  };
}

/** The `Links: [{"title":…,"url":…}]` array a WebSearch tool_result embeds in
 *  its text, located by a bracket scan that respects JSON strings (titles can
 *  contain `]`). Null when absent or unparseable — the caller falls back to
 *  bare URL extraction rather than dropping the whole result. */
function extractLinksArray(text: string): Array<{ url?: unknown }> | null {
  const at = text.indexOf("Links:");
  if (at < 0) return null;
  const start = text.indexOf("[", at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) {
      try {
        const parsed: unknown = JSON.parse(text.slice(start, i + 1));
        return Array.isArray(parsed) ? (parsed as Array<{ url?: unknown }>) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function urlsFromSearchResult(text: string): string[] {
  const links = extractLinksArray(text);
  if (links) {
    return links.map((l) => l.url).filter((u): u is string => typeof u === "string");
  }
  return [...text.matchAll(/https?:\/\/[^\s"'<>\])]+/g)].map((m) => m[0]);
}

/**
 * The subscription visibility probe. Named "claude-code", NOT "claude",
 * because it is a different instrument: the Claude Code harness wraps the
 * query in its own scaffolding and its WebSearch plumbing differs from the
 * API's `web_search` server tool, so its citations are not comparable with
 * API-engine rows and must never be aggregated with them. Domains are read
 * from what the search actually retrieved (the tool_result `Links:` payload),
 * the closest analogue of the API path reading `web_search_tool_result`
 * blocks; final-answer prose is deliberately not mined for URLs.
 */
/** The accuracy prompt's schema, minus the `$schema` meta key — see
 *  `analyzeJsonSchema` for why that key silently costs you the structured
 *  output. */
function accuracyJsonSchema(): string {
  const schema = z.toJSONSchema(AccuracySchema) as Record<string, unknown>;
  delete schema["$schema"];
  return JSON.stringify(schema);
}

/**
 * The subscription twin of `apiAccuracyDeps`.
 *
 * Accuracy re-reads the whole site against what an engine said about the
 * business, so its prompt is the largest in the pipeline; the budget bound is
 * correspondingly higher than analyze's and is still only a runaway backstop.
 * `ownership` is left to the caller because it makes no model call — it fetches
 * cited domains — and so does not belong to either auth mode.
 */
export function claudeCodeAccuracyRun(run: ClaudeCodeRun = defaultClaudeCodeRun) {
  return async ({ system, user }: { system: string; user: string }): Promise<unknown> => {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      accuracyJsonSchema(),
      "--system-prompt",
      system,
      "--model",
      "claude-opus-5",
      "--no-session-persistence",
      "--disallowedTools",
      ANALYZE_DISALLOWED,
      ...ISOLATION_ARGS,
      "--max-budget-usd",
      "8",
    ];
    const res = await run({ args, stdin: user, env: childEnv(), timeoutMs: ANALYZE_TIMEOUT_MS });
    if (res.code !== 0) {
      throw new Error(`claude -p (accuracy) exited ${res.code}: ${res.stderr.slice(0, 400)}`);
    }
    let envelope: ResultEnvelope;
    try {
      envelope = JSON.parse(res.stdout) as ResultEnvelope;
    } catch {
      throw new Error(
        `claude -p (accuracy) printed something other than the JSON envelope: ${res.stdout.slice(0, 200)}`,
      );
    }
    if (envelope.is_error || envelope.subtype !== "success") {
      throw new Error(
        `claude -p (accuracy) failed (${envelope.subtype ?? "unknown"}): ${String(envelope.result ?? "").slice(0, 400)}`,
      );
    }
    if (envelope.structured_output === undefined) {
      throw new Error("claude -p (accuracy) returned no structured_output");
    }
    return envelope.structured_output;
  };
}

export function claudeCodeEngine(run: ClaudeCodeRun = defaultClaudeCodeRun): VisibilityEngine {
  return {
    name: "claude-code",
    async ask(query) {
      const args = [
        "-p",
        // stream-json is refused in print mode without --verbose.
        "--verbose",
        "--output-format",
        "stream-json",
        "--allowedTools",
        "WebSearch",
        "--disallowedTools",
        BASE_DISALLOWED,
        "--model",
        PROBE_MODEL,
        "--no-session-persistence",
        "--system-prompt",
        PROBE_SYSTEM_PROMPT,
        ...ISOLATION_ARGS,
        // The API engine bounds its loop (4 turns, 4 searches); the CLI has no
        // turn flag on this build, so bound by computed spend instead — a real
        // probe measured ~$0.40-equivalent.
        "--max-budget-usd",
        "2",
      ];
      const res = await run({ args, stdin: query, env: childEnv(), timeoutMs: PROBE_TIMEOUT_MS });
      if (res.code !== 0) {
        throw new Error(`claude -p (probe) exited ${res.code}: ${res.stderr.slice(0, 400)}`);
      }
      const events: StreamEvent[] = res.stdout
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as StreamEvent];
          } catch {
            // Hook and wrapper noise can interleave non-JSON lines; losing one
            // line must not lose the probe.
            return [];
          }
        });

      // Only results of actual WebSearch calls count, and only successful
      // ones: a failed search's error prose can carry URLs (support pages,
      // docs links), and other tools' string results are not retrievals —
      // mining either would put our own plumbing into the competitor table.
      // The API engine gets this for free from typed block narrowing.
      const searchIds = new Set<unknown>();
      for (const ev of events) {
        if (ev.type !== "assistant") continue;
        for (const block of contentBlocks(ev)) {
          if (block.type === "tool_use" && block.name === "WebSearch") searchIds.add(block.id);
        }
      }
      const citedDomains: string[] = [];
      for (const ev of events) {
        if (ev.type !== "user") continue;
        for (const block of contentBlocks(ev)) {
          if (block.type !== "tool_result" || typeof block.content !== "string") continue;
          if (!searchIds.has(block.tool_use_id) || block.is_error === true) continue;
          citedDomains.push(...urlsFromSearchResult(block.content).map(domainOf));
        }
      }

      const result = events.find((ev) => ev.type === "result");
      if (!result) {
        throw new Error("claude -p (probe) produced no result event");
      }
      if (result.is_error || result.subtype !== "success") {
        throw new Error(
          `claude -p (probe) failed (${result.subtype ?? "unknown"}): ${String(result.result ?? "").slice(0, 400)}`,
        );
      }
      return { answer: typeof result.result === "string" ? result.result : "", citedDomains };
    },
  };
}
