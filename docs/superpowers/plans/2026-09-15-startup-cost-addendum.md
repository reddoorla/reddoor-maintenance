# Startup-Cost Census — addendum plan to the token meter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure what every session pays before the operator types: the size of the first API call per session (system prompt + CLAUDE.md files + memory index + skill listing + MCP instructions + the first message), per repo and per lane, and the same for each subagent spawn per agent type. Plus an inventory of what is configured to load.

**Architecture:** A `--startup` flag on `scripts/meta-week/token-meter.mjs`. The measurement is the earliest deduplicated usage event per (sessionId, lane) — its `in + cacheCreate + cacheRead` is exactly what that first call carried in, whether or not the prefix was already cached by a sibling session. One pure function in `aggregate.mjs`, one test on the existing fixture, then a run and a document.

**Spec:** `docs/superpowers/specs/2026-09-14-meta-week-operating-model-design.md` §2.1.3.

---

## Task 1: `--startup`

**Files:**

- Modify: `scripts/meta-week/lib/aggregate.mjs`
- Modify: `scripts/meta-week/token-meter.mjs`
- Modify: `tests/meta-week/token-meter.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `tests/meta-week/token-meter.test.ts` (the fixture already has two main sessions and one subagent; see the file header comment):

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

```bash
./node_modules/.bin/vitest run tests/meta-week/token-meter.test.ts
```

Expected: 1 FAIL (`json.startup` undefined).

- [ ] **Step 3: Implement**

Append to `scripts/meta-week/lib/aggregate.mjs`:

```js
/**
 * The first deduplicated call of every (session, lane) — and of every subagent by agentId —
 * carries the whole injected context: in + cacheCreate + cacheRead. That sum is the startup
 * cost, whether the prefix was freshly written or already cached by a sibling session.
 */
export function startupCosts(events) {
  const firstBySession = new Map(); // `${sessionId}|${lane}|${agentId}` -> event
  for (const ev of events) {
    const k = `${ev.sessionId}|${ev.lane}|${ev.lane === "subagent" ? ev.agentId : ""}`;
    const prev = firstBySession.get(k);
    if (!prev || ev.ts < prev.ts) firstBySession.set(k, ev);
  }
  const firsts = [...firstBySession.values()].map((ev) => ({
    ...ev,
    startup: ev.in + ev.cacheCreate + ev.cacheRead,
  }));
  const stats = (items) => {
    const v = items.map((x) => x.startup).sort((a, b) => a - b);
    return {
      sessions: v.length,
      p50: quantile(v, 0.5),
      p90: quantile(v, 0.9),
      max: v[v.length - 1] ?? NaN,
    };
  };
  const group = (keyFn) => {
    const m = new Map();
    for (const f of firsts) {
      const k = keyFn(f);
      if (k === null) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(f);
    }
    return [...m.entries()]
      .map(([key, items]) => ({ key, ...stats(items) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  };
  return {
    byRepoLane: group((f) => `${f.repo} | ${f.lane}`),
    byAgent: group((f) => (f.lane === "subagent" ? f.agent : null)),
    byModel: group((f) => `${f.lane} | ${f.model}`),
  };
}
```

In `token-meter.mjs`: add `startup: false` to the options and `case "--startup": o.startup = true; break;`; import `startupCosts`; after the blocks block add `if (o.startup) result.startup = startupCosts(laneEvents);` (note: `laneEvents`, not the date-filtered `events`, so a session's true first call is found even when `--from` is set); and print:

```js
if (result.startup) {
  process.stdout.write(`\nSTARTUP\tkey\tsessions\tp50\tp90\tmax\n`);
  for (const r of result.startup.byRepoLane) {
    process.stdout.write(`${r.key}\t${r.sessions}\t${fmt(r.p50)}\t${fmt(r.p90)}\t${fmt(r.max)}\n`);
  }
  process.stdout.write(`STARTUP by agent\n`);
  for (const r of result.startup.byAgent) {
    process.stdout.write(`${r.key}\t${r.sessions}\t${fmt(r.p50)}\t${fmt(r.p90)}\t${fmt(r.max)}\n`);
  }
}
```

- [ ] **Step 4: Run**

Expected: `Tests  16 passed`.

- [ ] **Step 5: Commit**

```bash
./node_modules/.bin/prettier --write scripts/meta-week tests/meta-week
./node_modules/.bin/eslint scripts/meta-week tests/meta-week
git add scripts/meta-week tests/meta-week
git commit -m "feat(meta-week): token meter reports startup cost — the first call per session and per subagent

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: Run it, inventory what loads, write `12-startup-cost.md`

- [ ] **Step 1: Measure**

```bash
node scripts/meta-week/token-meter.mjs --startup --json docs/meta-week/_data/tokens-startup.json | sed -n '/^STARTUP/,$p'
```

- [ ] **Step 2: Inventory what is configured to load (read-only)**

```bash
# CLAUDE.md size per repo
for r in /Users/tuckerlemos/Documents/GitHub/*/; do f="$r/CLAUDE.md"; [ -f "$f" ] && printf "%6d %6d %s\n" "$(wc -l < "$f")" "$(wc -c < "$f")" "$(basename $r)"; done | sort -rn
# global
wc -l -c ~/.claude/CLAUDE.md
# memory index (loaded every session) and memory files
wc -l -c ~/.claude/projects/-Users-tuckerlemos-Documents-GitHub-reddoor-maintenance/memory/MEMORY.md; ls ~/.claude/projects/*/memory/*.md | wc -l
# MCP servers configured (names only — do not print any env or auth values)
node -e 'const c=require(process.env.HOME+"/.claude.json"); const s=c.mcpServers||{}; console.log("global mcpServers:", Object.keys(s)); for (const [p,v] of Object.entries(c.projects||{})) if (v.mcpServers&&Object.keys(v.mcpServers).length) console.log(p, Object.keys(v.mcpServers));'
for r in /Users/tuckerlemos/Documents/GitHub/*/; do [ -f "$r/.mcp.json" ] && echo "$(basename $r): $(node -e 'console.log(Object.keys(require(process.argv[1]).mcpServers||{}).join(","))' "$r/.mcp.json")"; done
# plugins enabled and skills exposed
node -e 'const s=require(process.env.HOME+"/.claude/settings.json"); console.log("enabledPlugins:", Object.keys(s.enabledPlugins||{})); console.log("model:", s.model, "effortLevel:", s.effortLevel);'
ls ~/.claude/skills; ls ~/.claude/plugins/cache/*/*/*/skills 2>/dev/null | wc -l
```

Record every number. Names only for MCP servers; never print credentials.

- [ ] **Step 3: Write `docs/meta-week/12-startup-cost.md`**

Sections: "What the first call carries" (the definition and why `in + cacheCreate + cacheRead`); "Per repo, main lane" (table from `tokens-startup.json` `byRepoLane`, main rows, sorted by p50 desc); "Per subagent type" (`byAgent`); "Per model" (`byModel`); "What is configured to load" (the inventory tables: CLAUDE.md sizes, global CLAUDE.md, memory index, MCP servers by name and count, plugins, skills, default model and effort); "The fixed cost of a spawn" (p50 subagent startup × spawns per week from `tokens-by-agent.json`'s request counts is NOT valid — say why: requests ≠ spawns — and instead multiply p50 by the number of subagent sessions in `byAgent`); "Caveats" (a warm cache makes the first call cheap to bill but not small; the measure is size, not price).

- [ ] **Step 4: Format, lint, commit**

```bash
./node_modules/.bin/prettier --write docs/meta-week/12-startup-cost.md
pnpm lint
git add docs/meta-week/12-startup-cost.md docs/meta-week/_data/tokens-startup.json
git commit -m "docs(meta-week): startup cost — what every session and every subagent pays before the first word

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
