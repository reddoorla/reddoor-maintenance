# Token Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dependency-free Node script that reads every Claude Code transcript on this machine and reports token spend by day, week, repo, session, lane (main vs subagent), model, effort, agent type and skill — deduplicated correctly, calibrated against `~/.claude/stats-cache.json`, and able to state the spend inside any time window (the empirical weekly ceiling) and before any account-limit block (the session ceiling).

**Architecture:** Two small ESM libraries and one CLI. `scripts/meta-week/lib/walk.mjs` streams every `.jsonl` under a root and yields deduplicated usage events plus compaction and limit-block markers. `scripts/meta-week/lib/aggregate.mjs` holds pure functions: timezone day bucketing, ISO weeks, grouping, windows, and the stats-cache reconciliation. `scripts/meta-week/token-meter.mjs` parses arguments, composes the two, prints tab-separated tables, and optionally writes one JSON result. Tests drive the CLI as a subprocess against a generated fixture tree, so the entry point that will run on the real corpus is the thing under test.

**Tech Stack:** Node ≥ 20 built-ins only (`node:fs`, `node:readline`, `Intl`). Vitest for tests (already in the repo; `tests/**/*.test.ts`). Prettier + ESLint as configured in the repo (`printWidth: 100`, double quotes, trailing commas).

**Spec:** `docs/superpowers/specs/2026-09-14-meta-week-operating-model-design.md` §2.1.1.

---

## Facts about the data the code depends on (measured 2026-09-14)

Read these before writing anything. Each shaped a design decision below.

1. **One API response produces several `assistant` records that share a `requestId`** — one per content block (thinking, text, tool_use), each carrying a `message.usage` snapshot with a _partial_ `output_tokens`. A file with 5 assistant records had 3 distinct `requestId`s. **Dedupe key is `requestId`, keeping the record with the largest `output_tokens`.** Deduping by `uuid` (correct for operator _prompts_, see memory `transcript-replay-inflates-prompt-counts`) over-counts usage. Fall back to `uuid` only when `requestId` is absent.
2. Resumed and compacted sessions replay history into new files with the same `requestId`s, so the same key handles replay.
3. Subagent transcripts live at `<project>/<sessionId>/subagents/agent-*.jsonl` (some nested one level deeper). Their records carry `isSidechain: true`, `agentId`, and `attributionAgent` (values seen: `general-purpose`, `superpowers:code-reviewer`, `Explore`, `episodic-memory:search-conversations`, `claude-code-guide`).
4. Record-level fields on assistant records: `uuid`, `requestId`, `timestamp` (ISO, UTC), `sessionId`, `cwd`, `isSidechain`, `effort` (e.g. `xhigh`), `attributionSkill`, `attributionPlugin`, `attributionAgent`. Message-level: `message.model`, `message.usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`.
5. A model value of `<synthetic>` marks records that made no API call. Skip them.
6. **Compaction markers** are `{"type":"system","subtype":"compact_boundary","compactMetadata":{"trigger":"manual"|"auto","preTokens":N,...}}`. 254 exist. `trigger` answers the package's open question directly.
7. **Account-limit blocks** are `assistant` records whose first text block starts `You've hit your session limit · resets …` or `You've hit your weekly limit · …`. 286 seen (217 in subagent files, 69 in main).
8. `cwd` is the reliable repo attribution: it includes worktree paths like `/Documents/GitHub/reddoor-maintenance/.claude/worktrees/x`. The project directory name is the fallback (`-Users-…-GitHub-<repo>` with `--claude-worktrees-…` / `--worktrees-…` suffixes).
9. `~/.claude/stats-cache.json` has `dailyModelTokens: [{date, tokensByModel:{model: n}}]` since 2026-03-11 but is **missing 2026-08-22, 2026-08-27 and 2026-09-11**, all days with real activity. Its unit is undocumented. Dates are presumably local (America/Los_Angeles); the calibration must test that rather than assume it.
10. The corpus is ~2.7 GB across ~3,300 files. Stream line by line; only `JSON.parse` lines that contain `"usage"`, `compact_boundary` or `hit your`.

---

## File structure

| file                                  | responsibility                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `scripts/meta-week/lib/walk.mjs`      | I/O: find `.jsonl` files, stream lines, parse the three record kinds, dedupe usage by `requestId`  |
| `scripts/meta-week/lib/aggregate.mjs` | Pure: day/week bucketing in a timezone, grouping, window sums, rolling spend, stats reconciliation |
| `scripts/meta-week/token-meter.mjs`   | CLI: arguments, composition, tables to stdout, `--json` result file                                |
| `tests/meta-week/token-meter.test.ts` | Subprocess tests against a generated fixture; the PASS and FAIL calibration controls live here     |
| `docs/meta-week/10-token-meter.md`    | The instrument's write-up: method, calibration, ceilings, series (Task 8)                          |
| `docs/meta-week/_data/tokens-*.json`  | Committed aggregates from the real run (Task 8)                                                    |

---

## Task 0: Worktree setup

The worktree `.claude/worktrees/meta-week-plan` (branch `docs/meta-week-plan`) has no `node_modules`.

- [ ] **Step 1: Install dependencies in the worktree**

Run from the worktree root:

```bash
pnpm install --frozen-lockfile
```

Expected: ends with `Done in …s` and `node_modules/.bin/vitest` exists.

- [ ] **Step 2: Confirm the existing suite's harness runs**

```bash
./node_modules/.bin/vitest run tests/types.test.ts
```

Expected: `Test Files  1 passed`.

---

## Task 1: Walker with dedupe, and the CLI's `--json` totals

**Files:**

- Create: `scripts/meta-week/lib/walk.mjs`
- Create: `scripts/meta-week/token-meter.mjs`
- Create: `tests/meta-week/token-meter.test.ts`

- [ ] **Step 1: Write the fixture builder and the first failing test**

Create `tests/meta-week/token-meter.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
./node_modules/.bin/vitest run tests/meta-week/token-meter.test.ts
```

Expected: FAIL — `ENOENT` or `Cannot find module …/scripts/meta-week/token-meter.mjs`.

- [ ] **Step 3: Write the walker**

Create `scripts/meta-week/lib/walk.mjs`:

```js
// Streams every .jsonl under a Claude Code projects root and yields three kinds of
// event: deduplicated API usage, compaction boundaries, and account-limit blocks.
//
// Dedupe is by requestId, NOT uuid: one API response is written as several assistant
// records (one per content block), each carrying a partial output_tokens snapshot.
// The record with the largest output_tokens is the final one. Replayed history in
// resumed/compacted sessions repeats the same requestIds, so the same key covers it.
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { createInterface } from "node:readline";

const GITHUB_RE = /\/Documents\/GitHub\/([^/]+)/;
const BLOCK_RE = /^You've hit your (session|weekly) limit/i;

export async function* jsonlFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === "memory") continue;
      yield* jsonlFiles(p);
    } else if (e.isFile() && e.name.endsWith(".jsonl")) {
      yield p;
    }
  }
}

/** Repo name from cwd; falls back to the project directory name with worktree suffixes stripped. */
export function repoOf(rec, projectDir) {
  const m = typeof rec.cwd === "string" ? GITHUB_RE.exec(rec.cwd) : null;
  if (m) return m[1];
  return projectDir.replace(/^.*-GitHub-/, "").replace(/--(claude-)?worktrees-.*$/, "");
}

function projectDirOf(root, file) {
  return file.slice(root.length + 1).split(sep)[0];
}

function firstText(message) {
  const c = message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    const t = c.find((b) => b && b.type === "text");
    return t ? String(t.text) : "";
  }
  return "";
}

const num = (v) => (Number.isFinite(v) ? v : 0);

export async function collectEvents(root) {
  const byKey = new Map();
  const seenMarkers = new Set(); // uuids of compaction/block records already counted (replay)
  const compactions = [];
  const blocks = [];
  let files = 0;
  let lines = 0;
  for await (const file of jsonlFiles(root)) {
    files++;
    const projectDir = projectDirOf(root, file);
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      lines++;
      if (
        !line.includes('"usage"') &&
        !line.includes("compact_boundary") &&
        !line.includes("hit your")
      ) {
        continue;
      }
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec.type === "system" && rec.subtype === "compact_boundary") {
        if (rec.uuid && seenMarkers.has(rec.uuid)) continue;
        if (rec.uuid) seenMarkers.add(rec.uuid);
        const meta = rec.compactMetadata || {};
        compactions.push({
          ts: rec.timestamp,
          sessionId: rec.sessionId || "",
          repo: repoOf(rec, projectDir),
          lane: rec.isSidechain ? "subagent" : "main",
          trigger: meta.trigger || "unknown",
          preTokens: num(meta.preTokens),
        });
        continue;
      }
      if (rec.type !== "assistant" || !rec.message) continue;
      const text = firstText(rec.message);
      if (BLOCK_RE.test(text) && !(rec.uuid && seenMarkers.has(rec.uuid))) {
        if (rec.uuid) seenMarkers.add(rec.uuid);
        blocks.push({
          ts: rec.timestamp,
          sessionId: rec.sessionId || "",
          repo: repoOf(rec, projectDir),
          lane: rec.isSidechain ? "subagent" : "main",
          kind: /weekly/i.test(text) ? "weekly" : "session",
          text,
        });
      }
      const u = rec.message.usage;
      if (!u) continue;
      const model = rec.message.model || "";
      if (!model || model === "<synthetic>") continue;
      const key = rec.requestId || rec.uuid;
      if (!key) continue;
      const ev = {
        key,
        uuid: rec.uuid,
        ts: rec.timestamp,
        repo: repoOf(rec, projectDir),
        sessionId: rec.sessionId || "",
        lane: rec.isSidechain ? "subagent" : "main",
        agentId: rec.agentId || "",
        agent: rec.attributionAgent || (rec.isSidechain ? "subagent:unknown" : "main"),
        model,
        effort: rec.effort || "",
        skill: rec.attributionSkill || "",
        in: num(u.input_tokens),
        out: num(u.output_tokens),
        cacheCreate: num(u.cache_creation_input_tokens),
        cacheRead: num(u.cache_read_input_tokens),
        file,
      };
      if (ev.in + ev.out + ev.cacheCreate + ev.cacheRead === 0) continue;
      const prev = byKey.get(key);
      if (!prev || ev.out > prev.out || (ev.out === prev.out && ev.ts > prev.ts))
        byKey.set(key, ev);
    }
  }
  return { usage: [...byKey.values()], compactions, blocks, files, lines };
}
```

- [ ] **Step 4: Write the minimal CLI**

Create `scripts/meta-week/token-meter.mjs`:

```js
#!/usr/bin/env node
// Token meter over Claude Code transcripts. Method, calibration and caveats are in
// docs/meta-week/10-token-meter.md. No dependencies: runs from any checkout.
//
//   node scripts/meta-week/token-meter.mjs [--root DIR] [--stats FILE] [--tz IANA]
//     [--lane main|subagent|all] [--by day,week,repo,session,lane,model,effort,agent,skill]
//     [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--window ISO ISO]
//     [--calibrate] [--blocks] [--compactions] [--json FILE]
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { collectEvents } from "./lib/walk.mjs";

export const COUNTERS = ["in", "out", "cacheCreate", "cacheRead"];

export function emptySum() {
  return { requests: 0, in: 0, out: 0, cacheCreate: 0, cacheRead: 0 };
}

export function add(sum, ev) {
  sum.requests += 1;
  for (const c of COUNTERS) sum[c] += ev[c];
  return sum;
}

function parseArgs(argv) {
  const o = {
    root: join(homedir(), ".claude", "projects"),
    stats: join(homedir(), ".claude", "stats-cache.json"),
    tz: "America/Los_Angeles",
    lane: "all",
    by: null,
    from: null,
    to: null,
    window: null,
    calibrate: false,
    blocks: false,
    compactions: false,
    json: null,
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
      case "--stats":
        o.stats = next();
        break;
      case "--tz":
        o.tz = next();
        break;
      case "--lane":
        o.lane = next();
        break;
      case "--by":
        o.by = next().split(",");
        break;
      case "--from":
        o.from = next();
        break;
      case "--to":
        o.to = next();
        break;
      case "--window":
        o.window = [next(), next()];
        break;
      case "--calibrate":
        o.calibrate = true;
        break;
      case "--blocks":
        o.blocks = true;
        break;
      case "--compactions":
        o.compactions = true;
        break;
      case "--json":
        o.json = next();
        break;
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!["main", "subagent", "all"].includes(o.lane))
    throw new Error(`--lane must be main|subagent|all`);
  return o;
}

const fmt = (n) => Number(n).toLocaleString("en-US");

function printTotal(label, s) {
  process.stdout.write(
    `${label}\t${fmt(s.requests)}\t${COUNTERS.map((c) => fmt(s[c])).join("\t")}\n`,
  );
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const all = await collectEvents(o.root);
  const events = o.lane === "all" ? all.usage : all.usage.filter((e) => e.lane === o.lane);
  const result = {
    root: o.root,
    tz: o.tz,
    lane: o.lane,
    files: all.files,
    lines: all.lines,
    total: events.reduce(add, emptySum()),
  };
  process.stdout.write(
    `files=${all.files} lines=${fmt(all.lines)} requests=${fmt(events.length)} lane=${o.lane} tz=${o.tz}\n`,
  );
  process.stdout.write(["key", "requests", ...COUNTERS].join("\t") + "\n");
  printTotal("TOTAL", result.total);
  if (o.json) await writeFile(o.json, JSON.stringify(result, null, 2));
}

main().catch((e) => {
  process.stderr.write(`token-meter: ${e.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
./node_modules/.bin/vitest run tests/meta-week/token-meter.test.ts
```

Expected: `Tests  2 passed`.

- [ ] **Step 6: Lint and format, then commit**

```bash
./node_modules/.bin/prettier --write scripts/meta-week tests/meta-week
./node_modules/.bin/eslint scripts/meta-week tests/meta-week
git add scripts/meta-week tests/meta-week
git commit -m "feat(meta-week): token meter walks transcripts and dedupes usage by requestId

One API response is written as several assistant records sharing a
requestId, each with a partial output_tokens snapshot; the final one
wins. Replayed history in resumed sessions repeats the same ids, so the
same key handles both. <synthetic> and usage-less records are skipped.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: Dimensions and timezone bucketing (`--by`, `--tz`)

**Files:**

- Create: `scripts/meta-week/lib/aggregate.mjs`
- Modify: `scripts/meta-week/token-meter.mjs`
- Modify: `tests/meta-week/token-meter.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `tests/meta-week/token-meter.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify they fail**

```bash
./node_modules/.bin/vitest run tests/meta-week/token-meter.test.ts
```

Expected: the five new tests FAIL (`groups` undefined / `--by` is an unknown argument path not yet wired).

- [ ] **Step 3: Write the pure aggregation library**

Create `scripts/meta-week/lib/aggregate.mjs`:

```js
// Pure aggregation over usage events. No I/O.
export const COUNTERS = ["in", "out", "cacheCreate", "cacheRead"];

export function emptySum() {
  return { requests: 0, in: 0, out: 0, cacheCreate: 0, cacheRead: 0 };
}

export function add(sum, ev) {
  sum.requests += 1;
  for (const c of COUNTERS) sum[c] += ev[c];
  return sum;
}

/** YYYY-MM-DD of an ISO timestamp in an IANA timezone. */
export function localDate(ts, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** ISO-8601 week label (YYYY-Www) for a YYYY-MM-DD string. */
export function isoWeek(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function dimKey(ev, dims, tz) {
  return dims
    .map((d) => {
      if (d === "day") return localDate(ev.ts, tz);
      if (d === "week") return isoWeek(localDate(ev.ts, tz));
      if (d === "session") return ev.sessionId;
      return String(ev[d] ?? "");
    })
    .join(" | ");
}

export function groupBy(events, keyFn) {
  const m = new Map();
  for (const ev of events) {
    const k = keyFn(ev);
    if (!m.has(k)) m.set(k, emptySum());
    add(m.get(k), ev);
  }
  return [...m.entries()]
    .map(([key, sum]) => ({ key, ...sum }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function filterDates(events, tz, from, to) {
  if (!from && !to) return events;
  return events.filter((ev) => {
    const d = localDate(ev.ts, tz);
    return (!from || d >= from) && (!to || d <= to);
  });
}
```

- [ ] **Step 4: Wire the CLI to it**

In `scripts/meta-week/token-meter.mjs`:

Replace the local `COUNTERS`, `emptySum` and `add` definitions with an import:

```js
import { COUNTERS, add, dimKey, emptySum, filterDates, groupBy } from "./lib/aggregate.mjs";
```

(remove the three `export const COUNTERS…` / `export function emptySum…` / `export function add…` blocks.)

In `main()`, replace the body from `const events = …` through the `printTotal` call with:

```js
const laneEvents = o.lane === "all" ? all.usage : all.usage.filter((e) => e.lane === o.lane);
const events = filterDates(laneEvents, o.tz, o.from, o.to);
const dims = o.by || ["day"];
const result = {
  root: o.root,
  tz: o.tz,
  lane: o.lane,
  from: o.from,
  to: o.to,
  files: all.files,
  lines: all.lines,
  by: dims,
  total: events.reduce(add, emptySum()),
  groups: groupBy(events, (ev) => dimKey(ev, dims, o.tz)),
};
process.stdout.write(
  `files=${all.files} lines=${fmt(all.lines)} requests=${fmt(events.length)} lane=${o.lane} tz=${o.tz} by=${dims.join(",")}\n`,
);
process.stdout.write(["key", "requests", ...COUNTERS].join("\t") + "\n");
for (const g of result.groups) printTotal(g.key, g);
printTotal("TOTAL", result.total);
```

Add validation to `parseArgs` after the loop:

```js
const DIMS = ["day", "week", "repo", "session", "lane", "model", "effort", "agent", "skill"];
for (const d of o.by || []) if (!DIMS.includes(d)) throw new Error(`--by: unknown dimension ${d}`);
```

- [ ] **Step 5: Run to verify all pass**

```bash
./node_modules/.bin/vitest run tests/meta-week/token-meter.test.ts
```

Expected: `Tests  7 passed`.

- [ ] **Step 6: Lint, format, commit**

```bash
./node_modules/.bin/prettier --write scripts/meta-week tests/meta-week
./node_modules/.bin/eslint scripts/meta-week tests/meta-week
git add scripts/meta-week tests/meta-week
git commit -m "feat(meta-week): token meter groups by day/week/repo/lane/model/effort/agent/skill in a timezone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: Windows (`--window`)

**Files:**

- Modify: `scripts/meta-week/lib/aggregate.mjs`
- Modify: `scripts/meta-week/token-meter.mjs`
- Modify: `tests/meta-week/token-meter.test.ts`

- [ ] **Step 1: Add the failing test**

Append:

```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Expected: 2 new FAIL (`json.window` undefined; second resolves instead of rejecting).

- [ ] **Step 3: Implement**

Append to `scripts/meta-week/lib/aggregate.mjs`:

```js
export function inWindow(ev, startMs, endMs) {
  const t = Date.parse(ev.ts);
  return t >= startMs && t < endMs;
}
```

In `token-meter.mjs`, add `inWindow` to the import, and after `groups:` is computed (before the printing), add:

```js
if (o.window) {
  const [s, e] = o.window.map((x) => Date.parse(x));
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) {
    throw new Error("--window needs two ISO timestamps, start before end");
  }
  const inW = events.filter((ev) => inWindow(ev, s, e));
  result.window = {
    start: o.window[0],
    end: o.window[1],
    total: inW.reduce(add, emptySum()),
    byModel: groupBy(inW, (ev) => ev.model),
  };
}
```

and after `printTotal("TOTAL", …)`:

```js
if (result.window) {
  process.stdout.write(`\nWINDOW\t${result.window.start} → ${result.window.end}\n`);
  for (const g of result.window.byModel) printTotal(g.key, g);
  printTotal("WINDOW TOTAL", result.window.total);
}
```

- [ ] **Step 4: Run to verify all pass**

Expected: `Tests  9 passed`.

- [ ] **Step 5: Commit**

```bash
./node_modules/.bin/prettier --write scripts/meta-week tests/meta-week
./node_modules/.bin/eslint scripts/meta-week tests/meta-week
git add scripts/meta-week tests/meta-week
git commit -m "feat(meta-week): token meter sums spend inside a time window, by model

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: Calibration against the stats cache (`--calibrate`) — PASS and FAIL controls

**Files:**

- Modify: `scripts/meta-week/lib/aggregate.mjs`
- Modify: `scripts/meta-week/token-meter.mjs`
- Modify: `tests/meta-week/token-meter.test.ts`

The stats cache's unit is undocumented. The calibration tries five candidate units and reports the one with the smallest median relative error over every (day, model) pair the cache has inside the transcripts' full-coverage days. **It must say RECONCILED on a fixture built to match, and NOT RECONCILED on one built not to** — the instrument has to be seen to fail before its verdict on the real corpus means anything.

- [ ] **Step 1: Add the failing tests**

Append:

```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Expected: 2 new FAIL (`json.calibration` undefined).

- [ ] **Step 3: Implement**

Append to `scripts/meta-week/lib/aggregate.mjs`:

```js
export const UNITS = {
  out: (s) => s.out,
  "in+out": (s) => s.in + s.out,
  "in+out+cacheCreate": (s) => s.in + s.out + s.cacheCreate,
  "in+out+cacheCreate+cacheRead": (s) => s.in + s.out + s.cacheCreate + s.cacheRead,
  "out+cacheCreate": (s) => s.out + s.cacheCreate,
};

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/**
 * Compare per-(day, model) transcript sums with stats-cache.json's dailyModelTokens.
 * Only days strictly inside the transcripts' coverage are compared, so a partially
 * retained first day or a still-running last day cannot fake a mismatch.
 */
export function reconcile(events, statsCache, tz) {
  const byDayModel = new Map();
  const days = new Set();
  for (const ev of events) {
    const day = localDate(ev.ts, tz);
    days.add(day);
    const k = `${day}|${ev.model}`;
    if (!byDayModel.has(k)) byDayModel.set(k, emptySum());
    add(byDayModel.get(k), ev);
  }
  const sortedDays = [...days].sort();
  const oldest = sortedDays[0] ?? null;
  const newest = sortedDays[sortedDays.length - 1] ?? null;
  const inside = (d) => oldest !== null && d > oldest && d < newest;
  const daily = statsCache.dailyModelTokens || [];
  const rows = [];
  for (const r of daily) {
    if (!inside(r.date)) continue;
    for (const [model, stats] of Object.entries(r.tokensByModel || {})) {
      const sum = byDayModel.get(`${r.date}|${model}`) || emptySum();
      const row = { date: r.date, model, stats };
      for (const [name, fn] of Object.entries(UNITS)) {
        const t = fn(sum);
        row[name] = t;
        row[`err:${name}`] = Math.abs(t - stats) / Math.max(stats, 1);
      }
      rows.push(row);
    }
  }
  const verdicts = Object.keys(UNITS)
    .map((unit) => {
      const errs = rows.map((r) => r[`err:${unit}`]).sort((a, b) => a - b);
      return {
        unit,
        rows: errs.length,
        medianRelErr: quantile(errs, 0.5),
        p90RelErr: quantile(errs, 0.9),
      };
    })
    .sort((a, b) => a.medianRelErr - b.medianRelErr);
  const statsDays = new Set(daily.map((r) => r.date));
  const missingFromStats = sortedDays.filter((d) => inside(d) && !statsDays.has(d));
  const best = verdicts[0] ?? null;
  return {
    coverage: { oldest, newest },
    rows,
    verdicts,
    best,
    reconciled: !!best && best.rows > 0 && best.medianRelErr <= 0.05,
    missingFromStats,
  };
}
```

In `token-meter.mjs`: add `readFile` to the `node:fs/promises` import and `reconcile` to the aggregate import. After the window block:

```js
if (o.calibrate) {
  const stats = JSON.parse(await readFile(o.stats, "utf-8"));
  result.calibration = reconcile(events, stats, o.tz);
}
```

After the window printing:

```js
if (result.calibration) {
  const c = result.calibration;
  process.stdout.write(
    `\nCALIBRATION coverage=${c.coverage.oldest}..${c.coverage.newest} rows=${c.rows.length} tz=${o.tz} lane=${o.lane}\n`,
  );
  for (const v of c.verdicts) {
    process.stdout.write(
      `  unit=${v.unit}\tmedianRelErr=${v.medianRelErr.toFixed(3)}\tp90RelErr=${v.p90RelErr.toFixed(3)}\n`,
    );
  }
  process.stdout.write(
    `VERDICT ${c.reconciled ? "RECONCILED" : "NOT RECONCILED"} best=${c.best ? c.best.unit : "none"} missingFromStats=${c.missingFromStats.join(",") || "none"}\n`,
  );
}
```

- [ ] **Step 4: Run to verify all pass**

Expected: `Tests  11 passed`.

- [ ] **Step 5: Commit**

```bash
./node_modules/.bin/prettier --write scripts/meta-week tests/meta-week
./node_modules/.bin/eslint scripts/meta-week tests/meta-week
git add scripts/meta-week tests/meta-week
git commit -m "feat(meta-week): token meter calibrates against stats-cache with PASS and FAIL controls

The cache's unit is undocumented; five candidate units are tried and the
best median relative error is reported. The fixture proves the verdict
can say NOT RECONCILED before it is trusted on the real corpus.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: Compactions and limit blocks (`--compactions`, `--blocks`)

**Files:**

- Modify: `scripts/meta-week/lib/aggregate.mjs`
- Modify: `scripts/meta-week/token-meter.mjs`
- Modify: `tests/meta-week/token-meter.test.ts`

- [ ] **Step 1: Add the failing tests**

Append:

```ts
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
    expect(b[0].spend5h.out).toBe(77);
    expect(out).toMatch(/^BLOCKS\t1/m);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Expected: 2 new FAIL.

- [ ] **Step 3: Implement**

Append to `scripts/meta-week/lib/aggregate.mjs`:

```js
export function spendBefore(events, tsIso, hours) {
  const end = Date.parse(tsIso);
  const start = end - hours * 3600000;
  const s = emptySum();
  for (const ev of events) {
    const t = Date.parse(ev.ts);
    if (t >= start && t < end) add(s, ev);
  }
  return s;
}

export function summarizeCompactions(compactions) {
  const byTrigger = {};
  const pre = [];
  for (const c of compactions) {
    byTrigger[c.trigger] = (byTrigger[c.trigger] || 0) + 1;
    if (c.preTokens > 0) pre.push(c.preTokens);
  }
  pre.sort((a, b) => a - b);
  return {
    count: compactions.length,
    byTrigger,
    preTokens: {
      p50: quantile(pre, 0.5),
      p90: quantile(pre, 0.9),
      max: pre.length ? pre[pre.length - 1] : NaN,
    },
    events: compactions,
  };
}
```

In `token-meter.mjs`, add `spendBefore` and `summarizeCompactions` to the import. After the calibrate block:

```js
if (o.compactions) result.compactions = summarizeCompactions(all.compactions);
if (o.blocks) {
  result.blocks = all.blocks.map((b) => ({ ...b, spend5h: spendBefore(all.usage, b.ts, 5) }));
}
```

After the calibration printing:

```js
if (result.compactions) {
  const c = result.compactions;
  process.stdout.write(
    `\nCOMPACTIONS\t${c.count}\tbyTrigger=${JSON.stringify(c.byTrigger)}\tpreTokens p50=${fmt(c.preTokens.p50)} p90=${fmt(c.preTokens.p90)} max=${fmt(c.preTokens.max)}\n`,
  );
}
if (result.blocks) {
  process.stdout.write(`\nBLOCKS\t${result.blocks.length}\n`);
  for (const b of result.blocks) {
    process.stdout.write(
      `${b.ts}\t${b.kind}\t${b.repo}\t${b.lane}\tspend5h out=${fmt(b.spend5h.out)} cacheCreate=${fmt(b.spend5h.cacheCreate)} cacheRead=${fmt(b.spend5h.cacheRead)}\n`,
    );
  }
}
```

Note: `spendBefore` deliberately uses `all.usage` (every lane, no date filter) — a block is caused by everything the account did in the window, not by the lane being reported.

- [ ] **Step 4: Run to verify all pass**

Expected: `Tests  13 passed`.

- [ ] **Step 5: Commit**

```bash
./node_modules/.bin/prettier --write scripts/meta-week tests/meta-week
./node_modules/.bin/eslint scripts/meta-week tests/meta-week
git add scripts/meta-week tests/meta-week
git commit -m "feat(meta-week): token meter reports compactions by trigger and spend before each limit block

compact_boundary records carry compactMetadata.trigger (manual|auto) and
preTokens, which answers the evidence package's open question directly.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: Argument errors and the daily one-liner

**Files:**

- Modify: `tests/meta-week/token-meter.test.ts`

- [ ] **Step 1: Add the failing test**

Append:

```ts
describe("token-meter: arguments", () => {
  it("exits 1 with a message on an unknown argument", async () => {
    await expect(meter(["--bogus"])).rejects.toMatchObject({ code: 1 });
  });

  it("exits 1 on an unknown dimension", async () => {
    await expect(meter(["--by", "colour"])).rejects.toThrow(/unknown dimension/);
  });
});
```

- [ ] **Step 2: Run**

```bash
./node_modules/.bin/vitest run tests/meta-week/token-meter.test.ts
```

Expected: `Tests  15 passed` — both already hold from Tasks 1 and 2. If either fails, the `default:` branch or the `DIMS` check is missing; fix it and re-run.

- [ ] **Step 3: Run the whole suite once, lint the whole tree, commit**

```bash
pnpm test 2>&1 | tail -5
pnpm lint
git add tests/meta-week
git commit -m "test(meta-week): token meter rejects unknown arguments and dimensions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: the full suite green; `pnpm lint` prints `All matched files use Prettier code style!` and no ESLint errors.

---

## Task 7: Run on the real corpus — calibration first

The meter has passed on a fixture. Now it runs on the real corpus, calibration first. **Nothing else from the meter is quoted until the calibration verdict is read.**

- [ ] **Step 1: Snapshot the retention boundary**

```bash
ls -t ~/.claude/projects/*/*.jsonl | tail -1 | xargs stat -f '%Sm %N' -t '%Y-%m-%d'
```

Record the date printed (the oldest transcript today). Retention moves daily.

- [ ] **Step 2: Calibrate in every (tz, lane) combination and read the verdicts**

```bash
mkdir -p docs/meta-week/_data
for tz in America/Los_Angeles UTC; do
  for lane in main subagent all; do
    node scripts/meta-week/token-meter.mjs --calibrate --tz "$tz" --lane "$lane" \
      --json "docs/meta-week/_data/tokens-calibration-$(echo $tz | tr / -)-$lane.json" \
      | grep -E '^(CALIBRATION|  unit=|VERDICT)'
  done
done
```

Expected: six blocks. Write down which (tz, lane, unit) triple gives the lowest median error and whether any says `RECONCILED`. The first real run on a two-gigabyte corpus takes a minute or two; if it takes more than ten, something is wrong (a directory loop or a file that is not line-delimited) — stop and look.

**Interpretation rules, decided in advance:**

- If one triple says `RECONCILED`: the cache's unit and scope are now known; say so in the write-up and use the cache as the long-window cross-check it was meant to be.
- If none does but the best median error is under 20%: report the best triple, the error, and call the cache "roughly comparable, not a control". Every figure in the write-up then comes from the transcripts alone.
- If the best is worse than that: the cache is dropped as a source, and the write-up says why, with the table.

- [ ] **Step 3: Commit the calibration data**

```bash
git add docs/meta-week/_data/tokens-calibration-*.json
git commit -m "docs(meta-week): token meter calibration runs against stats-cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: Run the series and write `10-token-meter.md`

**Files:**

- Create: `docs/meta-week/10-token-meter.md`
- Create: `docs/meta-week/_data/tokens-*.json` (several)

- [ ] **Step 1: Find the weekly block and derive the ceiling window**

```bash
node scripts/meta-week/token-meter.mjs --blocks --json docs/meta-week/_data/tokens-blocks.json | grep weekly
```

Expected: at least one line with `weekly`, dated 2026-08-27 (the package quotes 21:00 local). Take its exact timestamp as `END`. The window starts at the previous reset: Sunday 2026-08-23 02:00 America/Los_Angeles = `2026-08-23T09:00:00Z`.

```bash
node scripts/meta-week/token-meter.mjs --window 2026-08-23T09:00:00Z "$END" --by model \
  --json docs/meta-week/_data/tokens-ceiling-window.json | sed -n '/^WINDOW/,$p'
```

The `WINDOW TOTAL` line is the empirical weekly ceiling, in each counter. The week's soft cap (spec §4) is 60% of it.

- [ ] **Step 2: Produce the series**

```bash
D=docs/meta-week/_data
M="node scripts/meta-week/token-meter.mjs"
$M --by day     --json $D/tokens-by-day.json    > /dev/null
$M --by week    --json $D/tokens-by-week.json   > /dev/null
$M --by repo    --json $D/tokens-by-repo.json   > /dev/null
$M --by lane    --json $D/tokens-by-lane.json   > /dev/null
$M --by model   --json $D/tokens-by-model.json  > /dev/null
$M --by effort  --json $D/tokens-by-effort.json > /dev/null
$M --by agent   --json $D/tokens-by-agent.json  > /dev/null
$M --by skill   --json $D/tokens-by-skill.json  > /dev/null
$M --by repo,lane --json $D/tokens-by-repo-lane.json > /dev/null
$M --compactions --json $D/tokens-compactions.json | grep '^COMPACTIONS'
$M --by day --from "$(date +%F)" | tail -3
```

The last command is the daily one-liner for the write-up. The `COMPACTIONS` line gives manual vs auto — quote it against the operator's "compact is mostly me clicking it".

- [ ] **Step 3: Characterise the session ceiling**

From `tokens-blocks.json`, for the blocks on 2026-09-02, 2026-09-05 and 2026-09-06: list `spend5h.out`, `spend5h.cacheCreate`, `spend5h.cacheRead` for the first block of each day and the distribution across all blocks that day (min, median, max of `spend5h.out`). Use the JSON, not the stdout, so the numbers are exact:

```bash
node -e '
const b=require("./docs/meta-week/_data/tokens-blocks.json").blocks;
for (const day of ["2026-09-02","2026-09-05","2026-09-06"]) {
  const rows=b.filter(x=>x.ts.startsWith(day)).sort((x,y)=>x.ts<y.ts?-1:1);
  const outs=rows.map(x=>x.spend5h.out).sort((x,y)=>x-y);
  console.log(day, "blocks", rows.length, "first", rows[0]?.ts, "first.out", rows[0]?.spend5h.out,
    "out min/median/max", outs[0], outs[Math.floor(outs.length/2)], outs[outs.length-1]);
}'
```

Note: block timestamps are UTC; 2026-09-02 local evening may land on 09-03 UTC. Check the local dates in the package's table (`09-operator-answers.md`) and adjust the prefixes if the counts do not match 67 / 73 / 53.

- [ ] **Step 4: Write the document**

Create `docs/meta-week/10-token-meter.md` with exactly these sections, filled from the JSON files (quote numbers from the files, not from memory of the terminal):

```markdown
# 10 — The token meter

Built 2026-09-15 (Task 8 of `docs/superpowers/plans/2026-09-14-token-meter.md`).
Reads every Claude Code transcript on this machine; `scripts/meta-week/token-meter.mjs`.

## What it measures, and how

- Sources, dedupe rule (requestId, final snapshot), lanes, repo attribution from cwd.
- What is skipped: `<synthetic>`, usage-less records, memory dirs.
- Retention boundary on the day of the run (from Task 7 step 1).
- Counters are reported raw; nothing is cost-weighted, because the plan's
  weighting is not public.

## Calibration against stats-cache.json

- The six-run table (tz × lane): best unit, median and p90 relative error.
- The verdict, in the words of the interpretation rules in Task 7.
- Days with transcript activity absent from the cache.

## The weekly ceiling

- The window used (start = reset, end = the weekly block's timestamp) and the
  WINDOW TOTAL per counter, per model.
- The week's soft cap: 60% of that, per counter.

## The session ceiling

- The three days, blocks per day, spend in the five hours before the first
  block and the distribution.

## Where the tokens go

Tables from `_data/`: by week; by repo (top 12); by lane; by model; by effort;
by agent type; by skill. Each table: key, requests, in, out, cacheCreate,
cacheRead.

## Compactions

- Count by trigger (manual / auto), preTokens p50/p90/max, against the
  operator's answer in `09-operator-answers.md`.

## One line a day

    node scripts/meta-week/token-meter.mjs --by day --from $(date +%F)

## Caveats, stated next to the numbers they affect

- Retention (~30 days) — anything older is gone, not zero.
- `attributionAgent` is absent on some subagent records → `subagent:unknown`.
- Sibling worktree checkouts (`reddoor-maintenance-e2ebudget`) are their own
  repo key; the in-repo worktrees fold into their repo.
- The five-hour session window is an assumption about the plan's rolling
  window; the measured spend-before-block distribution is the evidence for
  or against it.
```

Every bullet becomes prose or a table with the actual numbers. No bullet may survive as a placeholder.

- [ ] **Step 5: Format, lint, commit**

```bash
./node_modules/.bin/prettier --write docs/meta-week/10-token-meter.md
pnpm lint
git add docs/meta-week/10-token-meter.md docs/meta-week/_data/tokens-*.json
git commit -m "docs(meta-week): the token meter — calibration, the weekly and session ceilings, where the tokens go

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Open the PR**

```bash
git push -u origin docs/meta-week-plan
gh pr create --title "feat(meta-week): token meter over Claude Code transcripts, with calibration" --body "$(cat <<'EOF'
## What

A dependency-free meter over `~/.claude/projects/**/*.jsonl` reporting token spend by day, week, repo, session, lane, model, effort, agent and skill; spend inside a window; spend before each limit block; compactions by trigger. Plus the meta-week spec and this plan.

## Proof

- Fixture-driven subprocess tests: dedupe by requestId (final snapshot wins; replay ignored), `<synthetic>` skipped, timezone bucketing (a 03:30Z event lands on the previous local day), windows, compactions, blocks.
- Calibration has a PASS control (fixture built to match → `RECONCILED`) and a FAIL control (fixture built to disagree → `NOT RECONCILED`).
- Real-corpus calibration verdicts, all six (tz × lane) runs, are in `docs/meta-week/_data/tokens-calibration-*.json` and summarised in `10-token-meter.md`.

## Numbers that matter

(the weekly ceiling WINDOW TOTAL, the soft cap, manual vs auto compactions — copied from `10-token-meter.md`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review against the spec (§2.1.1)

| spec requirement                                                        | task |
| ----------------------------------------------------------------------- | ---- |
| sources: transcripts incl. subagents; stats-cache                       | 1, 4 |
| dedupe rule (corrected from uuid to requestId — see Facts)              | 1    |
| dimensions: day, week, repo, session, lane, model, effort, agent, skill | 2    |
| four counters reported separately, unweighted                           | 1, 2 |
| calibration table + verdict, PASS control                               | 4, 7 |
| weekly ceiling window from reset to the weekly block                    | 3, 8 |
| session ceiling from the three block days                               | 5, 8 |
| output doc `10-token-meter.md` + `_data/tokens-*.json`                  | 8    |
| daily one-line command                                                  | 8    |
| snapshot the retention boundary                                         | 7    |

One deviation from the spec, recorded here so the spec can be corrected by forward pointer rather than silently: the spec says dedupe by `uuid`; the data says usage must dedupe by `requestId` (Facts §1). The uuid rule stays correct for operator prompts.
