# Wasted-Work Census Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A script that scans every Claude Code transcript and emits **candidate** episodes of wasted work in three classes — fan-out overload, redo, and building on an unread mechanism — each with a token cost, plus a second script that prints the transcript window around any candidate so a refuter (human or agent) can confirm or reject it without reading the raw file.

**Architecture:** `scripts/meta-week/lib/walk.mjs` (the token meter's walker) gains an opt-in `full` mode that also collects operator prompts, tool calls, subagent results and interrupts, deduplicated by uuid / tool-use id. `scripts/meta-week/lib/census.mjs` holds the three pure candidate finders. `scripts/meta-week/census.mjs` is the CLI: summary table per class and kind, top-N list, `--jsonl` of every candidate. `scripts/meta-week/transcript-window.mjs` prints one session's window as a compact chronological script. Tests drive both CLIs as subprocesses against generated fixtures; **each heuristic has a PASS control (a seeded episode it must find) and a FAIL control (a clean fixture on which it must find nothing).**

**Tech Stack:** Node ≥ 20 built-ins only. Vitest. Prettier + ESLint as configured in the repo.

**Spec:** `docs/superpowers/specs/2026-09-14-meta-week-operating-model-design.md` §2.1.2. Depends on the token meter (`docs/superpowers/plans/2026-09-14-token-meter.md`) being merged or present on the branch: `collectEvents`, `add`, `emptySum`, `COUNTERS` come from there.

---

## Facts about the data the code depends on (measured 2026-09-14)

1. **Operator prompts** are `type: "user"` records in the main transcript (`isSidechain: false`, no `isMeta`) whose `message.content` is a string or a list of `{type:"text"}` blocks. Records whose content list contains `tool_result` blocks are tool results, not prompts. Some prompts are system-shaped and must be excluded: text starting `<task-notification>`, `<system-reminder>`, `<local-command-stdout>`, or `[Request interrupted` (the last is an **interrupt** marker, 24 in three large files). Slash commands appear as `<command-name>/compact</command-name>` inside the text; keep them, flagged.
2. **Tool calls** are `{type:"tool_use", id, name, input}` blocks inside assistant records' `message.content`. `Read`/`Edit`/`Write` carry `input.file_path`; `Agent` carries `input.subagent_type`, `input.model` (often `"sonnet"`), `input.run_in_background`, `input.prompt`; `Bash` carries `input.command`.
3. **Subagent results** come back to the parent as a `type: "user"` record with `toolUseResult: { agentId, status, totalTokens, totalToolUseCount, usage }` (217 seen with all keys; 87 with only `agentId, status`) and `message.content[0].tool_use_id` linking to the `Agent` tool_use.
4. **Subagent usage events** (from the meter's walker) carry the PARENT `sessionId` — subagent files live under `<sessionId>/subagents/` and their records carry that id — so "this session's subagent spend after time T" is a filter on `sessionId` + `lane === "subagent"`.
5. **Compactions** (`compact_boundary`) and **limit blocks** are already collected by the meter's walker.
6. In the busiest reddoor-website session, subagent file spans overlapped up to **7 at once**.
7. Prompt-intent regex families from `docs/meta-week/05-metrics-appendix.md` (upper bounds, used here only to nominate candidates): corrections `that's wrong|you didn't|you missed|not what i`; evidence demands `prove|show me|are you sure|verify|did you actually|check that`; stops `stop|kill|hold on|wait,|no more`.

---

## File structure

| file                                      | responsibility                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/meta-week/lib/walk.mjs`          | Modify: `collectEvents(root, { full })` also returns `prompts`, `tools`, `agentResults`, `interrupts`                                              |
| `scripts/meta-week/lib/census.mjs`        | Pure: `fanoutCandidates`, `redoCandidates`, `unreadCandidates`, `jaccard`, `sumBetween`, `addSum`, `summarize`                                     |
| `scripts/meta-week/census.mjs`            | CLI: `--class`, `--top`, `--json`, `--jsonl`; summary tables                                                                                       |
| `scripts/meta-week/transcript-window.mjs` | CLI: `--session --from --to`; prints the window as a compact script for a refuter                                                                  |
| `tests/meta-week/census.test.ts`          | Fixtures with one seeded episode per kind + a clean control; subprocess tests for both CLIs                                                        |
| `docs/meta-week/11-wasted-work-census.md` | The write-up (Task 7)                                                                                                                              |
| `docs/meta-week/_data/census-*.json(l)`   | Committed candidates and summary (Task 7). Evidence text fields are capped at 200 chars and are operator prompts — see the privacy note in Task 7. |

---

## Task 1: `full` mode on the walker

**Files:**

- Modify: `scripts/meta-week/lib/walk.mjs`
- Create: `tests/meta-week/census.test.ts` (fixture builder + first tests)

- [ ] **Step 1: Write the fixture builder and the failing test**

Create `tests/meta-week/census.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CENSUS = fileURLToPath(new URL("../../scripts/meta-week/census.mjs", import.meta.url));
const WINDOW = fileURLToPath(
  new URL("../../scripts/meta-week/transcript-window.mjs", import.meta.url),
);

/**
 * Two fixture roots. SEEDED carries exactly one episode of every kind the census can
 * nominate; CLEAN carries the same session shapes with none of them. Every heuristic
 * must find its seed in SEEDED (PASS control) and nothing in CLEAN (FAIL control).
 *
 * Session "s1" (repo alpha), all times UTC on 2026-09-02:
 *   10:00 USER  "build the thing"
 *   10:00:05 ASSISTANT tool_use Read a.ts, Read b.ts, Read c.ts, Edit a.ts       (r1, out 40)
 *   10:05 ASSISTANT tool_use Agent(general-purpose, "audit the forms module for X") (r2, out 10)
 *   10:06 USER  tool_result for r2's Agent → toolUseResult agentId g1 totalTokens 5000
 *   10:10 ASSISTANT tool_use Agent(general-purpose, "audit the forms module for X please") (r3, out 10)  <- duplicate prompt (redo)
 *   10:11 USER  tool_result agentId g2 totalTokens 7000
 *   10:20 system compact_boundary manual preTokens 200000
 *   10:21 ASSISTANT tool_use Read a.ts, Read b.ts, Read c.ts                      (r4, out 30) <- re-read after compaction (redo)
 *   10:30 USER  "stop, kill them"                                                  <- stop request (fanout)
 *   10:31 subagent g3 usage (out 25)                                               <- spend after stop
 *   10:40 USER  "that's wrong, did you actually run it?"                            <- correction (unread); costed from 10:30 prompt
 *   10:35 ASSISTANT text "It is fixed."                                            (r5, out 15) — inside (10:30, 10:40)
 *   11:00 ASSISTANT text "You've hit your session limit · resets 2pm"              <- block
 *   11:03 USER  "hit a session limit continue"                                     <- continue-after-block (fanout)
 *   11:05 ASSISTANT text "continuing"                                              (r6, out 12)
 * Sessions "s2" (repo beta) and "s3" (repo gamma): USER "continue" at 11:03:20 and 11:03:40 → same-turn-many-sessions (fanout)
 *
 * CLEAN: s1 with the reads, one Agent call, no compaction, a polite USER "thanks, looks good", no block.
 */

const CWD = (repo: string) => `/Users/x/Documents/GitHub/${repo}`;
let n = 0;
const uid = (p: string) => `${p}-${++n}`;

function user(o: { ts: string; text: string; sessionId?: string; repo?: string }): string {
  return JSON.stringify({
    type: "user",
    uuid: uid("u"),
    timestamp: o.ts,
    sessionId: o.sessionId ?? "s1",
    isSidechain: false,
    cwd: CWD(o.repo ?? "alpha"),
    message: { role: "user", content: o.text },
  });
}

function toolResult(o: {
  ts: string;
  toolUseId: string;
  agentId: string;
  totalTokens: number;
}): string {
  return JSON.stringify({
    type: "user",
    uuid: uid("u"),
    timestamp: o.ts,
    sessionId: "s1",
    isSidechain: false,
    cwd: CWD("alpha"),
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: o.toolUseId, content: "done" }],
    },
    toolUseResult: { agentId: o.agentId, status: "completed", totalTokens: o.totalTokens },
  });
}

type Block = Record<string, unknown>;
function assistant(o: {
  ts: string;
  requestId: string;
  out: number;
  blocks: Block[];
  sidechain?: boolean;
  agentId?: string;
  sessionId?: string;
  repo?: string;
}): string {
  const rec: Record<string, unknown> = {
    type: "assistant",
    uuid: uid("a"),
    requestId: o.requestId,
    timestamp: o.ts,
    sessionId: o.sessionId ?? "s1",
    isSidechain: o.sidechain ?? false,
    cwd: CWD(o.repo ?? "alpha"),
    message: {
      role: "assistant",
      model: "claude-opus-5",
      content: o.blocks,
      usage: {
        input_tokens: 1,
        output_tokens: o.out,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
  if (o.sidechain) {
    rec.agentId = o.agentId;
    rec.attributionAgent = "general-purpose";
  }
  return rec && JSON.stringify(rec);
}

const text = (t: string): Block => ({ type: "text", text: t });
const read = (id: string, file: string): Block => ({
  type: "tool_use",
  id,
  name: "Read",
  input: { file_path: file },
});
const edit = (id: string, file: string): Block => ({
  type: "tool_use",
  id,
  name: "Edit",
  input: { file_path: file, old_string: "a", new_string: "b" },
});
const agent = (id: string, prompt: string): Block => ({
  type: "tool_use",
  id,
  name: "Agent",
  input: { subagent_type: "general-purpose", model: "sonnet", prompt },
});

function compaction(ts: string): string {
  return JSON.stringify({
    type: "system",
    subtype: "compact_boundary",
    uuid: uid("c"),
    timestamp: ts,
    sessionId: "s1",
    isSidechain: false,
    cwd: CWD("alpha"),
    content: "Conversation compacted",
    compactMetadata: { trigger: "manual", preTokens: 200000 },
  });
}

const T = (hms: string) => `2026-09-02T${hms}Z`;

let seeded: string;
let clean: string;

async function writeRoot(
  dir: string,
  s1Lines: string[],
  extra: Record<string, string[]>,
  subagents: Record<string, string[]>,
) {
  const alpha = join(dir, "-Users-x-Documents-GitHub-alpha");
  await mkdir(join(alpha, "s1", "subagents"), { recursive: true });
  await writeFile(join(alpha, "s1.jsonl"), s1Lines.join("\n") + "\n");
  for (const [name, lines] of Object.entries(subagents)) {
    await writeFile(join(alpha, "s1", "subagents", `agent-${name}.jsonl`), lines.join("\n") + "\n");
  }
  for (const [repo, lines] of Object.entries(extra)) {
    const d = join(dir, `-Users-x-Documents-GitHub-${repo}`);
    await mkdir(d, { recursive: true });
    await writeFile(join(d, `s-${repo}.jsonl`), lines.join("\n") + "\n");
  }
}

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), "census-"));
  seeded = join(base, "seeded");
  clean = join(base, "clean");

  await writeRoot(
    seeded,
    [
      user({ ts: T("10:00:00"), text: "build the thing" }),
      assistant({
        ts: T("10:00:05"),
        requestId: "r1",
        out: 40,
        blocks: [
          read("t1", "/p/a.ts"),
          read("t2", "/p/b.ts"),
          read("t3", "/p/c.ts"),
          edit("t4", "/p/a.ts"),
        ],
      }),
      assistant({
        ts: T("10:05:00"),
        requestId: "r2",
        out: 10,
        blocks: [agent("t5", "audit the forms module for X")],
      }),
      toolResult({ ts: T("10:06:00"), toolUseId: "t5", agentId: "g1", totalTokens: 5000 }),
      assistant({
        ts: T("10:10:00"),
        requestId: "r3",
        out: 10,
        blocks: [agent("t6", "audit the forms module for X please")],
      }),
      toolResult({ ts: T("10:11:00"), toolUseId: "t6", agentId: "g2", totalTokens: 7000 }),
      compaction(T("10:20:00")),
      assistant({
        ts: T("10:21:00"),
        requestId: "r4",
        out: 30,
        blocks: [read("t7", "/p/a.ts"), read("t8", "/p/b.ts"), read("t9", "/p/c.ts")],
      }),
      user({ ts: T("10:30:00"), text: "stop, kill them" }),
      assistant({ ts: T("10:35:00"), requestId: "r5", out: 15, blocks: [text("It is fixed.")] }),
      user({ ts: T("10:40:00"), text: "that's wrong, did you actually run it?" }),
      assistant({
        ts: T("11:00:00"),
        requestId: "rb",
        out: 0,
        blocks: [text("You've hit your session limit · resets 2pm (America/Los_Angeles)")],
      }),
      user({ ts: T("11:03:00"), text: "hit a session limit continue" }),
      assistant({ ts: T("11:05:00"), requestId: "r6", out: 12, blocks: [text("continuing")] }),
    ],
    {
      beta: [
        user({
          ts: T("11:03:20"),
          text: "hit a session limit continue",
          sessionId: "s2",
          repo: "beta",
        }),
      ],
      gamma: [
        user({
          ts: T("11:03:40"),
          text: "hit a session limit continue",
          sessionId: "s3",
          repo: "gamma",
        }),
      ],
    },
    {
      g3: [
        assistant({
          ts: T("10:31:00"),
          requestId: "rs1",
          out: 25,
          blocks: [text("still going")],
          sidechain: true,
          agentId: "g3",
        }),
      ],
    },
  );

  await writeRoot(
    clean,
    [
      user({ ts: T("10:00:00"), text: "build the thing" }),
      assistant({
        ts: T("10:00:05"),
        requestId: "c1",
        out: 40,
        blocks: [read("k1", "/p/a.ts"), read("k2", "/p/b.ts"), edit("k3", "/p/a.ts")],
      }),
      assistant({
        ts: T("10:05:00"),
        requestId: "c2",
        out: 10,
        blocks: [agent("k4", "audit the forms module for X")],
      }),
      toolResult({ ts: T("10:06:00"), toolUseId: "k4", agentId: "h1", totalTokens: 5000 }),
      user({ ts: T("10:30:00"), text: "thanks, looks good" }),
      assistant({ ts: T("10:35:00"), requestId: "c3", out: 15, blocks: [text("Done.")] }),
    ],
    {},
    {},
  );
});

async function census(
  root: string,
  args: string[],
): Promise<{ out: string; json: Record<string, unknown> }> {
  const jsonPath = join(root, "..", `census-${Math.random().toString(36).slice(2)}.json`);
  const { stdout } = await execFileAsync("node", [
    CENSUS,
    "--root",
    root,
    "--json",
    jsonPath,
    ...args,
  ]);
  return { out: stdout, json: JSON.parse(await readFile(jsonPath, "utf-8")) };
}

type Cand = {
  class: string;
  kind: string;
  sessionId: string;
  repo: string;
  ts: string;
  cost: { requests: number; out: number; agentTotal?: number };
  evidence: Record<string, unknown>;
};
function kinds(json: Record<string, unknown>, cls: string): Cand[] {
  return ((json.classes as Record<string, { candidates: Cand[] }>)[cls]?.candidates ??
    []) as Cand[];
}

describe("census: walker full mode (via the CLI's counts)", () => {
  it("counts operator prompts, tool calls and agent results, excluding tool results and system-shaped text", async () => {
    const { json } = await census(seeded, ["--class", "all"]);
    expect(json.prompts).toBe(7); // s1: 5 operator prompts; s2, s3: 1 each
    expect(json.tools).toBe(9); // t1..t9
    expect(json.agentResults).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
./node_modules/.bin/vitest run tests/meta-week/census.test.ts
```

Expected: FAIL — `Cannot find module …/census.mjs`.

- [ ] **Step 3: Extend the walker**

In `scripts/meta-week/lib/walk.mjs`, add after `const num = …`:

```js
const SYSTEM_SHAPED = /^\s*(<task-notification>|<system-reminder>|<local-command-stdout>)/;
const INTERRUPT_RE = /^\s*\[Request interrupted/;

function promptText(message) {
  const c = message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    if (c.some((b) => b && b.type === "tool_result")) return null;
    return c
      .filter((b) => b && b.type === "text")
      .map((b) => String(b.text))
      .join("\n");
  }
  return null;
}
```

Change the signature and body of `collectEvents`:

```js
export async function collectEvents(root, opts = {}) {
  const full = !!opts.full;
  const byKey = new Map();
  const seenMarkers = new Set(); // uuids of compaction/block records already counted (replay)
  const seenTools = new Set();
  const seenResults = new Set();
  const compactions = [];
  const blocks = [];
  const prompts = [];
  const tools = [];
  const agentResults = [];
  const interrupts = [];
  let files = 0;
  let lines = 0;
```

Replace the prefilter `if (…) continue;` with:

```js
      const interesting =
        line.includes('"usage"') ||
        line.includes("compact_boundary") ||
        line.includes("hit your") ||
        (full && line.includes('"type":"user"'));
      if (!interesting) continue;
```

After the `compact_boundary` branch and before `if (rec.type !== "assistant" …)`, add:

```js
      if (full && rec.type === "user" && rec.message) {
        const base = {
          uuid: rec.uuid,
          ts: rec.timestamp,
          sessionId: rec.sessionId || "",
          repo: repoOf(rec, projectDir),
          lane: rec.isSidechain ? "subagent" : "main",
        };
        const tr = rec.toolUseResult;
        if (tr && typeof tr === "object" && tr.agentId) {
          const c = rec.message.content;
          const toolUseId = Array.isArray(c) && c[0] && c[0].tool_use_id ? c[0].tool_use_id : "";
          const rkey = toolUseId || tr.agentId;
          if (!seenResults.has(rkey)) {
            seenResults.add(rkey);
            agentResults.push({
              ...base,
              toolUseId,
              agentId: tr.agentId,
              status: tr.status || "",
              totalTokens: num(tr.totalTokens),
            });
          }
          continue;
        }
        if (rec.isMeta) continue;
        const text = promptText(rec.message);
        if (text === null || !text.trim()) continue;
        if (rec.uuid && seenMarkers.has(rec.uuid)) continue;
        if (rec.uuid) seenMarkers.add(rec.uuid);
        if (INTERRUPT_RE.test(text)) {
          interrupts.push({ ...base, text: text.slice(0, 200) });
          continue;
        }
        if (SYSTEM_SHAPED.test(text)) continue;
        prompts.push({ ...base, text: text.slice(0, 500), command: text.includes("<command-name>") });
        continue;
      }
```

Inside the assistant branch, after `const text = firstText(rec.message);` and the block push, add (before `const u = rec.message.usage;`):

```js
if (full && Array.isArray(rec.message.content)) {
  for (const b of rec.message.content) {
    if (!b || b.type !== "tool_use" || !b.id || seenTools.has(b.id)) continue;
    seenTools.add(b.id);
    const input = b.input || {};
    tools.push({
      id: b.id,
      name: b.name || "",
      ts: rec.timestamp,
      sessionId: rec.sessionId || "",
      repo: repoOf(rec, projectDir),
      lane: rec.isSidechain ? "subagent" : "main",
      requestId: rec.requestId || "",
      file: typeof input.file_path === "string" ? input.file_path : "",
      agentType: typeof input.subagent_type === "string" ? input.subagent_type : "",
      agentModel: typeof input.model === "string" ? input.model : "",
      background: !!input.run_in_background,
      prompt: typeof input.prompt === "string" ? input.prompt.slice(0, 300) : "",
      command: typeof input.command === "string" ? input.command.slice(0, 120) : "",
    });
  }
}
```

Change the return:

```js
return {
  usage: [...byKey.values()],
  compactions,
  blocks,
  prompts,
  tools,
  agentResults,
  interrupts,
  files,
  lines,
};
```

- [ ] **Step 4: Write the minimal census CLI (counts only)**

Create `scripts/meta-week/census.mjs`:

```js
#!/usr/bin/env node
// Wasted-work census: heuristics nominate CANDIDATE episodes with a token cost; a
// refuter confirms or rejects each from its transcript window
// (scripts/meta-week/transcript-window.mjs). See docs/meta-week/11-wasted-work-census.md.
//
//   node scripts/meta-week/census.mjs [--root DIR] [--class fanout|redo|unread|all]
//     [--top N] [--json FILE] [--jsonl FILE]
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { collectEvents } from "./lib/walk.mjs";

function parseArgs(argv) {
  const o = {
    root: join(homedir(), ".claude", "projects"),
    class: "all",
    top: 10,
    json: null,
    jsonl: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case "--root":
        o.root = next();
        break;
      case "--class":
        o.class = next();
        break;
      case "--top":
        o.top = Number(next());
        break;
      case "--json":
        o.json = next();
        break;
      case "--jsonl":
        o.jsonl = next();
        break;
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!["fanout", "redo", "unread", "all"].includes(o.class)) {
    throw new Error("--class must be fanout|redo|unread|all");
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const all = await collectEvents(o.root, { full: true });
  const result = {
    root: o.root,
    files: all.files,
    prompts: all.prompts.length,
    tools: all.tools.length,
    agentResults: all.agentResults.length,
    interrupts: all.interrupts.length,
    classes: {},
  };
  process.stdout.write(
    `files=${all.files} prompts=${all.prompts.length} tools=${all.tools.length} agentResults=${all.agentResults.length} interrupts=${all.interrupts.length}\n`,
  );
  if (o.json) await writeFile(o.json, JSON.stringify(result, null, 2));
}

main().catch((e) => {
  process.stderr.write(`census: ${e.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 5: Run both test files**

```bash
./node_modules/.bin/vitest run tests/meta-week
```

Expected: `Tests  16 passed` (15 meter tests still green — the walker's default mode is unchanged — plus the new one).

- [ ] **Step 6: Commit**

```bash
./node_modules/.bin/prettier --write scripts/meta-week tests/meta-week
./node_modules/.bin/eslint scripts/meta-week tests/meta-week
git add scripts/meta-week tests/meta-week
git commit -m "feat(meta-week): walker full mode collects prompts, tool calls, agent results and interrupts

Opt-in; the token meter's default mode is byte-for-byte unchanged and its
15 tests still pass. Operator prompts exclude tool results, meta records,
task notifications and system reminders; interrupts are kept separately.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: Fan-out candidates

**Files:**

- Create: `scripts/meta-week/lib/census.mjs`
- Modify: `scripts/meta-week/census.mjs`
- Modify: `tests/meta-week/census.test.ts`

- [ ] **Step 1: Add the failing tests**

Append:

```ts
describe("census: fan-out", () => {
  it("PASS: finds spend after a stop request, continue after a block, and one turn across three sessions", async () => {
    const { json } = await census(seeded, ["--class", "fanout"]);
    const c = kinds(json, "fanout");
    const stop = c.find((x) => x.kind === "spend-after-stop");
    expect(stop).toMatchObject({ sessionId: "s1", repo: "alpha" });
    expect(stop?.cost.out).toBe(25);
    const cont = c.find((x) => x.kind === "continue-after-block");
    expect(cont).toMatchObject({ sessionId: "s1" });
    expect(cont?.evidence.lagMin).toBe(3);
    expect(cont?.cost.out).toBe(12);
    const same = c.find((x) => x.kind === "same-turn-many-sessions");
    expect(same?.evidence.sessions).toBe(3);
    expect(same?.evidence.repos).toEqual(["alpha", "beta", "gamma"]);
  });

  it("FAIL control: nominates nothing on the clean fixture", async () => {
    const { json } = await census(clean, ["--class", "fanout"]);
    expect(kinds(json, "fanout")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Expected: 2 FAIL (`json.classes.fanout` undefined → `kinds` returns `[]` for the PASS case; the FAIL control passes vacuously — that is fine, it is there to catch a future over-eager heuristic).

- [ ] **Step 3: Write the pure library**

Create `scripts/meta-week/lib/census.mjs`:

```js
// Pure candidate finders over the walker's full collection. Every finder nominates;
// none confirms. Costs are the meter's counters summed over a stated window.
import { COUNTERS, add, emptySum } from "./aggregate.mjs";

export const MIN = 60000;
export const STOP_RE = /\b(stop|kill (them|it|the agents|all)|halt|no more|hold on|wait,)\b/i;
export const CONTINUE_RE = /\bcontin/i;
export const CORRECTION_RE =
  /\b(that'?s wrong|you didn'?t|you missed|not what i|are you sure|did you actually|prove|show me|verify|check that|doesn'?t scan|is wrong)\b/i;

export function addSum(a, b) {
  a.requests += b.requests;
  for (const c of COUNTERS) a[c] += b[c];
  if (b.agentTotal) a.agentTotal = (a.agentTotal || 0) + b.agentTotal;
  return a;
}

/** Sum usage events with startMs < ts <= endMs that satisfy pred. */
export function sumBetween(events, pred, startMs, endMs) {
  const s = emptySum();
  for (const ev of events) {
    const t = Date.parse(ev.ts);
    if (t > startMs && t <= endMs && pred(ev)) add(s, ev);
  }
  return s;
}

export function bySession(items) {
  const m = new Map();
  for (const it of items) {
    if (!m.has(it.sessionId)) m.set(it.sessionId, []);
    m.get(it.sessionId).push(it);
  }
  for (const arr of m.values()) arr.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return m;
}

const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function fanoutCandidates(all) {
  const out = [];
  const mainPrompts = all.prompts.filter((p) => p.lane === "main");
  const promptsBy = bySession(mainPrompts);

  // 1. A stop request, then this session's subagents kept spending.
  for (const [sessionId, prompts] of promptsBy) {
    for (let i = 0; i < prompts.length; i++) {
      const p = prompts[i];
      if (!STOP_RE.test(p.text)) continue;
      const start = Date.parse(p.ts);
      const end = prompts[i + 1] ? Date.parse(prompts[i + 1].ts) : start + 60 * MIN;
      const cost = sumBetween(
        all.usage,
        (ev) => ev.sessionId === sessionId && ev.lane === "subagent",
        start,
        end,
      );
      if (cost.requests === 0) continue;
      out.push({
        class: "fanout",
        kind: "spend-after-stop",
        sessionId,
        repo: p.repo,
        ts: p.ts,
        window: { from: p.ts, to: new Date(end).toISOString() },
        cost,
        evidence: { prompt: p.text.slice(0, 200), subagentRequestsAfter: cost.requests },
      });
    }
  }

  // 2. A limit block, then a "continue" within ten minutes: the re-orientation cost is the
  //    session's spend in the thirty minutes after the continue.
  for (const b of all.blocks) {
    const prompts = promptsBy.get(b.sessionId) || [];
    const t = Date.parse(b.ts);
    const c = prompts.find((p) => {
      const pt = Date.parse(p.ts);
      return pt > t && pt - t <= 10 * MIN && CONTINUE_RE.test(p.text);
    });
    if (!c) continue;
    const ct = Date.parse(c.ts);
    const cost = sumBetween(all.usage, (ev) => ev.sessionId === b.sessionId, ct, ct + 30 * MIN);
    out.push({
      class: "fanout",
      kind: "continue-after-block",
      sessionId: b.sessionId,
      repo: b.repo,
      ts: b.ts,
      window: { from: b.ts, to: new Date(ct + 30 * MIN).toISOString() },
      cost,
      evidence: { block: b.kind, prompt: c.text.slice(0, 120), lagMin: Math.round((ct - t) / MIN) },
    });
  }

  // 3. The same operator turn typed into three or more sessions inside two minutes.
  //    No token cost; the cost is operator attention, reported as a count.
  const sorted = mainPrompts
    .filter((p) => p.text.length >= 8)
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const used = new Set();
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (used.has(p.uuid)) continue;
    const key = normalize(p.text);
    const group = [p];
    const sessions = new Set([p.sessionId]);
    for (let j = i + 1; j < sorted.length; j++) {
      const q = sorted[j];
      if (Date.parse(q.ts) - Date.parse(p.ts) > 2 * MIN) break;
      if (used.has(q.uuid) || sessions.has(q.sessionId) || normalize(q.text) !== key) continue;
      group.push(q);
      sessions.add(q.sessionId);
    }
    if (group.length < 3) continue;
    for (const g of group) used.add(g.uuid);
    out.push({
      class: "fanout",
      kind: "same-turn-many-sessions",
      sessionId: p.sessionId,
      repo: p.repo,
      ts: p.ts,
      window: { from: p.ts, to: group[group.length - 1].ts },
      cost: emptySum(),
      evidence: {
        sessions: group.length,
        prompt: p.text.slice(0, 120),
        repos: [...new Set(group.map((g) => g.repo))].sort(),
      },
    });
  }
  return out;
}
```

- [ ] **Step 4: Wire the CLI**

In `scripts/meta-week/census.mjs`, add imports:

```js
import { addSum, fanoutCandidates } from "./lib/census.mjs";
import { emptySum } from "./lib/aggregate.mjs";
```

Add above `main()`:

```js
const FINDERS = { fanout: fanoutCandidates };
const fmt = (n) => Number(n).toLocaleString("en-US");

function summarize(cands) {
  const byKind = {};
  for (const c of cands) {
    const k = byKind[c.kind] || (byKind[c.kind] = { candidates: 0, cost: emptySum() });
    k.candidates += 1;
    addSum(k.cost, c.cost);
  }
  return byKind;
}

function printClass(name, byKind, cands, top) {
  process.stdout.write(
    `\n== ${name} ==\nkind\tcandidates\tout\tcacheCreate\tcacheRead\tagentTotal\n`,
  );
  for (const [kind, k] of Object.entries(byKind)) {
    process.stdout.write(
      `${kind}\t${k.candidates}\t${fmt(k.cost.out)}\t${fmt(k.cost.cacheCreate)}\t${fmt(k.cost.cacheRead)}\t${fmt(k.cost.agentTotal || 0)}\n`,
    );
  }
  for (const c of cands.slice(0, top)) {
    const ev = Object.entries(c.evidence)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ")
      .slice(0, 160);
    process.stdout.write(
      `  ${c.kind}\t${c.ts}\t${c.repo}\t${c.sessionId.slice(0, 8)}\tout=${fmt(c.cost.out)}\t${ev}\n`,
    );
  }
}
```

In `main()`, after `result` is built and the `files=…` line is printed, add:

```js
const wanted = o.class === "all" ? Object.keys(FINDERS) : [o.class].filter((c) => FINDERS[c]);
const allCands = [];
for (const name of wanted) {
  const cands = FINDERS[name](all).sort(
    (a, b) => b.cost.out - a.cost.out || b.cost.cacheCreate - a.cost.cacheCreate,
  );
  const byKind = summarize(cands);
  result.classes[name] = { byKind, candidates: cands };
  printClass(name, byKind, cands, o.top);
  allCands.push(...cands);
}
if (o.jsonl) await writeFile(o.jsonl, allCands.map((c) => JSON.stringify(c)).join("\n") + "\n");
```

(Candidates sort by `out` then `cacheCreate` — the two counters that are not cache hits. No invented weighting.)

- [ ] **Step 5: Run**

```bash
./node_modules/.bin/vitest run tests/meta-week/census.test.ts
```

Expected: `Tests  3 passed`.

- [ ] **Step 6: Commit**

```bash
./node_modules/.bin/prettier --write scripts/meta-week tests/meta-week
./node_modules/.bin/eslint scripts/meta-week tests/meta-week
git add scripts/meta-week tests/meta-week
git commit -m "feat(meta-week): census nominates fan-out episodes — spend after stop, continue after block, one turn in many sessions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: Redo candidates

**Files:**

- Modify: `scripts/meta-week/lib/census.mjs`
- Modify: `scripts/meta-week/census.mjs`
- Modify: `tests/meta-week/census.test.ts`

- [ ] **Step 1: Add the failing tests**

Append:

```ts
describe("census: redo", () => {
  it("PASS: finds files re-read after a compaction and a near-duplicate Agent prompt", async () => {
    const { json } = await census(seeded, ["--class", "redo"]);
    const c = kinds(json, "redo");
    const reread = c.find((x) => x.kind === "reread-after-compaction");
    expect(reread?.evidence.filesReReadCount).toBe(3);
    expect(reread?.cost.out).toBe(30);
    const dup = c.find((x) => x.kind === "duplicate-agent-prompt");
    expect(dup?.evidence.similarity as number).toBeGreaterThanOrEqual(0.7);
    expect(dup?.cost.agentTotal).toBe(7000);
  });

  it("FAIL control: nominates nothing on the clean fixture", async () => {
    const { json } = await census(clean, ["--class", "redo"]);
    expect(kinds(json, "redo")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Expected: the PASS case fails (`reread` undefined); the control passes vacuously.

- [ ] **Step 3: Implement**

Append to `scripts/meta-week/lib/census.mjs`:

```js
const words = (s) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

export function jaccard(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

const FILE_TOOLS = new Set(["Read", "Edit", "Write"]);

export function redoCandidates(all) {
  const out = [];
  const toolsBy = bySession(all.tools.filter((t) => t.lane === "main"));

  // 1. After a compaction, the same session re-reads three or more files it had already
  //    read or edited. Cost: the main lane's spend in the hour after the compaction.
  for (const c of all.compactions) {
    const tools = toolsBy.get(c.sessionId) || [];
    const ct = Date.parse(c.ts);
    const before = new Set(
      tools
        .filter((t) => t.file && FILE_TOOLS.has(t.name) && Date.parse(t.ts) < ct)
        .map((t) => t.file),
    );
    const after = tools.filter(
      (t) =>
        t.file && t.name === "Read" && Date.parse(t.ts) >= ct && Date.parse(t.ts) - ct <= 60 * MIN,
    );
    const overlap = [...new Set(after.map((t) => t.file))].filter((f) => before.has(f));
    if (overlap.length < 3) continue;
    const cost = sumBetween(
      all.usage,
      (ev) => ev.sessionId === c.sessionId && ev.lane === "main",
      ct,
      ct + 60 * MIN,
    );
    out.push({
      class: "redo",
      kind: "reread-after-compaction",
      sessionId: c.sessionId,
      repo: c.repo,
      ts: c.ts,
      window: { from: c.ts, to: new Date(ct + 60 * MIN).toISOString() },
      cost,
      evidence: {
        trigger: c.trigger,
        preTokens: c.preTokens,
        filesReReadCount: overlap.length,
        files: overlap.slice(0, 8),
      },
    });
  }

  // 2. Two Agent dispatches in one session with near-identical prompts. Cost: the later
  //    agent's reported totalTokens (the parent's toolUseResult), kept as agentTotal.
  const resultByToolUse = new Map(all.agentResults.map((r) => [r.toolUseId, r]));
  for (const [sessionId, tools] of toolsBy) {
    const agents = tools.filter((t) => t.name === "Agent" && t.prompt);
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const sim = jaccard(agents[i].prompt, agents[j].prompt);
        if (sim < 0.7) continue;
        const r = resultByToolUse.get(agents[j].id);
        const cost = { ...emptySum(), agentTotal: r ? r.totalTokens : 0 };
        out.push({
          class: "redo",
          kind: "duplicate-agent-prompt",
          sessionId,
          repo: agents[j].repo,
          ts: agents[j].ts,
          window: { from: agents[i].ts, to: agents[j].ts },
          cost,
          evidence: {
            similarity: Number(sim.toFixed(2)),
            first: agents[i].prompt.slice(0, 120),
            second: agents[j].prompt.slice(0, 120),
            agentType: agents[j].agentType,
            agentModel: agents[j].agentModel,
          },
        });
      }
    }
  }
  return out;
}
```

In `scripts/meta-week/census.mjs`, import `redoCandidates` and add `redo: redoCandidates` to `FINDERS`.

- [ ] **Step 4: Run**

Expected: `Tests  5 passed`.

- [ ] **Step 5: Commit**

```bash
./node_modules/.bin/prettier --write scripts/meta-week tests/meta-week
./node_modules/.bin/eslint scripts/meta-week tests/meta-week
git add scripts/meta-week tests/meta-week
git commit -m "feat(meta-week): census nominates redo episodes — re-reads after compaction, duplicate agent prompts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: Unread-mechanism candidates

**Files:**

- Modify: `scripts/meta-week/lib/census.mjs`
- Modify: `scripts/meta-week/census.mjs`
- Modify: `tests/meta-week/census.test.ts`

- [ ] **Step 1: Add the failing tests**

Append:

```ts
describe("census: unread mechanism", () => {
  it("PASS: costs the turn that a correction prompt corrects, from the previous prompt to the correction", async () => {
    const { json } = await census(seeded, ["--class", "unread"]);
    const c = kinds(json, "unread");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "corrected-turn", sessionId: "s1" });
    expect(c[0].cost.out).toBe(40); // r5 (15) in the main lane + the g3 subagent (25), both inside (10:30, 10:40]
    expect(c[0].evidence.minutes).toBe(10);
  });

  it("FAIL control: nominates nothing on the clean fixture", async () => {
    const { json } = await census(clean, ["--class", "unread"]);
    expect(kinds(json, "unread")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Expected: PASS case fails (`c` is `[]`).

- [ ] **Step 3: Implement**

Append to `scripts/meta-week/lib/census.mjs`:

```js
export function unreadCandidates(all) {
  const out = [];
  const promptsBy = bySession(all.prompts.filter((p) => p.lane === "main"));
  for (const [sessionId, prompts] of promptsBy) {
    for (let i = 1; i < prompts.length; i++) {
      const p = prompts[i];
      if (!CORRECTION_RE.test(p.text)) continue;
      const prev = prompts[i - 1];
      const from = Date.parse(prev.ts);
      const to = Date.parse(p.ts);
      const cost = sumBetween(all.usage, (ev) => ev.sessionId === sessionId, from, to);
      if (cost.requests === 0) continue;
      out.push({
        class: "unread",
        kind: "corrected-turn",
        sessionId,
        repo: p.repo,
        ts: p.ts,
        window: { from: prev.ts, to: p.ts },
        cost,
        evidence: {
          correction: p.text.slice(0, 200),
          precedingPrompt: prev.text.slice(0, 120),
          minutes: Math.round((to - from) / MIN),
        },
      });
    }
  }
  return out;
}
```

Import it in `census.mjs` and add `unread: unreadCandidates` to `FINDERS`.

- [ ] **Step 4: Run**

Expected: `Tests  7 passed`.

- [ ] **Step 5: Commit**

```bash
./node_modules/.bin/prettier --write scripts/meta-week tests/meta-week
./node_modules/.bin/eslint scripts/meta-week tests/meta-week
git add scripts/meta-week tests/meta-week
git commit -m "feat(meta-week): census nominates corrected turns as unread-mechanism episodes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: The transcript window printer

**Files:**

- Create: `scripts/meta-week/transcript-window.mjs`
- Modify: `tests/meta-week/census.test.ts`

- [ ] **Step 1: Add the failing test**

Append:

```ts
describe("transcript-window", () => {
  it("prints the session's prompts, assistant text, tool calls and subagent activity inside the window, in order", async () => {
    const { stdout } = await execFileAsync("node", [
      WINDOW,
      "--root",
      seeded,
      "--session",
      "s1",
      "--from",
      T("10:29:00"),
      "--to",
      T("10:41:00"),
    ]);
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toMatch(/^10:30:00 USER stop, kill them/);
    expect(lines[1]).toMatch(/^10:31:00 \[agent general-purpose g3\] out=25/);
    expect(lines[2]).toMatch(/^10:35:00 ASSISTANT It is fixed\./);
    expect(lines[3]).toMatch(/^10:40:00 USER that's wrong/);
    expect(lines).toHaveLength(4);
  });

  it("prints tool calls as one-liners", async () => {
    const { stdout } = await execFileAsync("node", [
      WINDOW,
      "--root",
      seeded,
      "--session",
      "s1",
      "--from",
      T("09:59:00"),
      "--to",
      T("10:01:00"),
    ]);
    expect(stdout).toMatch(/^10:00:05 \[Read\] \/p\/a\.ts$/m);
    expect(stdout).toMatch(/^10:00:05 \[Edit\] \/p\/a\.ts$/m);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Expected: `Cannot find module …/transcript-window.mjs`.

- [ ] **Step 3: Implement**

Create `scripts/meta-week/transcript-window.mjs`:

```js
#!/usr/bin/env node
// Prints one session's transcript window as a compact chronological script, so a
// refuter can judge a census candidate without opening the raw file.
//
//   node scripts/meta-week/transcript-window.mjs --session ID --from ISO --to ISO
//     [--root DIR] [--max 400]
import { homedir } from "node:os";
import { join } from "node:path";
import { collectEvents } from "./lib/walk.mjs";
import { bySession } from "./lib/census.mjs";

function parseArgs(argv) {
  const o = {
    root: join(homedir(), ".claude", "projects"),
    session: "",
    from: "",
    to: "",
    max: 400,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case "--root":
        o.root = next();
        break;
      case "--session":
        o.session = next();
        break;
      case "--from":
        o.from = next();
        break;
      case "--to":
        o.to = next();
        break;
      case "--max":
        o.max = Number(next());
        break;
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!o.session || Number.isNaN(Date.parse(o.from)) || Number.isNaN(Date.parse(o.to))) {
    throw new Error("--session, --from and --to (ISO) are required");
  }
  return o;
}

const hms = (ts) => ts.slice(11, 19);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s).replace(/\s+/g, " ");

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const all = await collectEvents(o.root, { full: true });
  const from = Date.parse(o.from);
  const to = Date.parse(o.to);
  const inWin = (x) => {
    const t = Date.parse(x.ts);
    return t >= from && t <= to;
  };
  const lines = [];
  for (const p of (bySession(all.prompts).get(o.session) || []).filter(inWin)) {
    if (p.lane !== "main") continue;
    lines.push({ ts: p.ts, text: `USER ${clip(p.text, o.max)}` });
  }
  for (const t of all.tools.filter(
    (x) => x.sessionId === o.session && x.lane === "main" && inWin(x),
  )) {
    const what =
      t.file || t.command || (t.name === "Agent" ? `${t.agentType} ${clip(t.prompt, 80)}` : "");
    lines.push({ ts: t.ts, text: `[${t.name}] ${clip(what, o.max)}` });
  }
  // Assistant text needs the raw records: re-walk only this session's main files cheaply
  // by using the usage events' file list.
  const mainFiles = [
    ...new Set(
      all.usage.filter((e) => e.sessionId === o.session && e.lane === "main").map((e) => e.file),
    ),
  ];
  const { createReadStream } = await import("node:fs");
  const { createInterface } = await import("node:readline");
  const seen = new Set();
  for (const file of mainFiles) {
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"type":"assistant"')) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec.type !== "assistant" || !inWin({ ts: rec.timestamp }) || seen.has(rec.uuid)) continue;
      seen.add(rec.uuid);
      const c = rec.message?.content;
      const text = Array.isArray(c)
        ? c
            .filter((b) => b && b.type === "text")
            .map((b) => String(b.text))
            .join(" ")
        : typeof c === "string"
          ? c
          : "";
      if (text.trim()) lines.push({ ts: rec.timestamp, text: `ASSISTANT ${clip(text, o.max)}` });
    }
  }
  // Subagent activity, one line per agent per window: its type, id and spend.
  const byAgent = new Map();
  for (const e of all.usage.filter(
    (x) => x.sessionId === o.session && x.lane === "subagent" && inWin(x),
  )) {
    const k = e.agentId || e.agent;
    const a = byAgent.get(k) || { ts: e.ts, agent: e.agent, id: e.agentId, out: 0, requests: 0 };
    a.out += e.out;
    a.requests += 1;
    if (e.ts < a.ts) a.ts = e.ts;
    byAgent.set(k, a);
  }
  for (const a of byAgent.values()) {
    lines.push({
      ts: a.ts,
      text: `[agent ${a.agent} ${a.id}] out=${a.out} requests=${a.requests}`,
    });
  }
  lines.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  for (const l of lines) process.stdout.write(`${hms(l.ts)} ${l.text}\n`);
}

main().catch((e) => {
  process.stderr.write(`transcript-window: ${e.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 4: Run**

Expected: `Tests  9 passed`. If the first test's line order differs only because two records share a timestamp, the fixture is at fault, not the code; adjust the fixture's seconds, not the assertion's order.

- [ ] **Step 5: Commit**

```bash
./node_modules/.bin/prettier --write scripts/meta-week tests/meta-week
./node_modules/.bin/eslint scripts/meta-week tests/meta-week
git add scripts/meta-week tests/meta-week
git commit -m "feat(meta-week): transcript-window prints a session's window as a compact script for refuters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: Reverts from git (counts, uncosted)

**Files:**

- Modify: `scripts/meta-week/census.mjs`

Reverts cannot be costed from transcripts without linking a commit to the session that wrote it, so this pass reports **counts only** and says so.

- [ ] **Step 1: Add `--git` to the CLI**

In `census.mjs`, add `import { execFile } from "node:child_process"; import { promisify } from "node:util"; import { readdir, stat } from "node:fs/promises";` and `const execFileAsync = promisify(execFile);`. Add `git: null` to the options and a `case "--git": o.git = next(); break;` (value: a directory of repos, e.g. `~/Documents/GitHub`), plus `since: "2026-08-16"` with `case "--since"`.

After the classes loop in `main()`:

```js
if (o.git) {
  const reverts = [];
  for (const name of await readdir(o.git)) {
    const dir = join(o.git, name);
    try {
      await stat(join(dir, ".git"));
    } catch {
      continue;
    }
    try {
      const { stdout } = await execFileAsync("git", [
        "-C",
        dir,
        "log",
        "--all",
        `--since=${o.since}`,
        "-i",
        "--grep=revert",
        "--format=%h|%aI|%s",
      ]);
      for (const line of stdout.trim().split("\n").filter(Boolean)) {
        const [sha, ts, ...subject] = line.split("|");
        reverts.push({ repo: name, sha, ts, subject: subject.join("|").slice(0, 120) });
      }
    } catch {
      // a repo git cannot read is reported by name, not silently skipped
      reverts.push({ repo: name, sha: "", ts: "", subject: "GIT LOG FAILED" });
    }
  }
  result.reverts = { since: o.since, count: reverts.length, byRepo: {}, items: reverts };
  for (const r of reverts) result.reverts.byRepo[r.repo] = (result.reverts.byRepo[r.repo] || 0) + 1;
  process.stdout.write(`\n== reverts (git, since ${o.since}, uncosted) ==\n`);
  for (const [repo, c] of Object.entries(result.reverts.byRepo))
    process.stdout.write(`${repo}\t${c}\n`);
}
```

- [ ] **Step 2: Run it once against the real repos and read the output**

```bash
node scripts/meta-week/census.mjs --root "$TMPDIR" --git ~/Documents/GitHub --since 2026-08-16 | sed -n '/== reverts/,$p'
```

(`--root "$TMPDIR"` points the transcript walk at an empty-ish dir so this runs fast.) Expected: a table of repo → revert-commit count. Record it for Task 7.

- [ ] **Step 3: Commit**

```bash
./node_modules/.bin/prettier --write scripts/meta-week
./node_modules/.bin/eslint scripts/meta-week
git add scripts/meta-week
git commit -m "feat(meta-week): census counts revert commits per repo (uncosted)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: Run on the real corpus and write `11-wasted-work-census.md`

- [ ] **Step 1: Run the census**

```bash
D=docs/meta-week/_data
node scripts/meta-week/census.mjs --class all --top 15 --git ~/Documents/GitHub \
  --json $D/census-summary.json --jsonl $D/census-candidates.jsonl | tee $TMPDIR/census.out
```

Read `$TMPDIR/census.out`. Record: candidates and summed cost per kind; the top 15 per class.

**Privacy check before committing `_data/`.** The evidence fields carry operator prompt text (≤200 chars). The package's policy is that raw operator prompts are not committed. So: commit `census-summary.json` with the `candidates` arrays STRIPPED to `{kind, sessionId, repo, ts, window, cost}` (write a small `node -e` that rewrites it), and do NOT commit `census-candidates.jsonl`; leave it in `$TMPDIR` for the refuters and say so in the doc.

- [ ] **Step 2: The refuter round (coordinator-run, not this task)**

The coordinator dispatches refuters over the top 10 per class using `transcript-window.mjs`. This task stops at producing the candidates and the summary. Leave the doc's "Confirmed" section with the heading and the sentence "Filled after the refuter round." — the one placeholder this plan allows, because the round is a separate agent workflow.

- [ ] **Step 3: Write the document**

`docs/meta-week/11-wasted-work-census.md`, sections:

```markdown
# 11 — Wasted-work census

## What a candidate is, and is not

(the three classes, the kinds, the exact heuristic for each in one sentence, the cost window
for each, and the statement that a candidate is a nomination until the refuter confirms it)

## Controls

(the seeded fixture found every kind; the clean fixture found nothing — cite the test file)

## Candidates

(per class: the kind table with candidates / out / cacheCreate / cacheRead / agentTotal, from
census-summary.json; the top 10 per class with session id, repo, timestamp, cost and the
non-prompt evidence fields)

## Reverts (uncosted)

(the per-repo table from --git)

## Confirmed

Filled after the refuter round.

## What the heuristics cannot see

(re-derived components; work abandoned without a revert; corrections that were not phrased
as corrections; anything before the retention boundary; subagent files without agentId)
```

- [ ] **Step 4: Format, lint, commit**

```bash
./node_modules/.bin/prettier --write docs/meta-week/11-wasted-work-census.md
pnpm lint
git add docs/meta-week/11-wasted-work-census.md docs/meta-week/_data/census-summary.json
git commit -m "docs(meta-week): wasted-work census — candidates by class, costed, awaiting the refuter round

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review against the spec (§2.1.2)

| spec requirement                                                                          | task                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fan-out: concurrency, blocks, continue-after-block, failed stops, same turn many repos    | 2 (concurrency per session is reported by the meter's `--by session,lane`; not repeated here)                                                                    |
| redo: re-reads across compaction, duplicate agent prompts, reverts, re-derived components | 3, 6 (re-derived components: seeded from the package, refuter-only — stated in "cannot see")                                                                     |
| unread: correction prompts walked back to the claim, costed                               | 4                                                                                                                                                                |
| each heuristic proven on a known instance first                                           | every task's PASS control + Task 7's run against the package's named episodes (08-24 continue storm, 09-11 slider) — the refuter round checks those specifically |
| refuter reads the raw window before a candidate counts                                    | 5 (the tool), 7 step 2 (the round)                                                                                                                               |
| output doc + `_data/`                                                                     | 7                                                                                                                                                                |
| "not found" section so absence reads as measured                                          | 7 ("What the heuristics cannot see" + zero-count kinds in the tables)                                                                                            |
