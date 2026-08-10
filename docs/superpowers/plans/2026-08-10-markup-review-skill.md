# MarkUp Review Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dependency-free CLI + skill at `~/.claude/skills/markup-review/` that lets any session read a MarkUp.io board's unresolved pins and resolve them as fixes land.

**Architecture:** One plain-JS ESM file (`markup.mjs`, Node ≥ 18 native fetch) with four verbs over the official MarkUp API v2, plus a `SKILL.md` describing the review-round workflow. No npm install, no fleet coupling. Spec: `docs/superpowers/specs/2026-08-10-markup-review-skill-design.md`.

**Tech Stack:** Node ≥ 18 (native fetch, ESM), MarkUp API v2 (`Markup-API-Version: 2023-02-22`), key from `~/Documents/GitHub/reddoor-maintenance/.env`.

**Live-verified facts (2026-08-10, read-only probes):**

- Auth `Authorization: Bearer <MARKUP_API_KEY>` works (200).
- `GET /markups` envelope: `{data:{data:[…], hasMore, nextCursor}}`. Markup fields: `id, createdAt, modifiedAt, thumbnailUrl, type, markupUrl, name, activeThreads, readOnly, status, url`.
- `GET /threads?markupId=<id>` envelope: `{data:{threads:[…], query:{projectId, order, searchTerm, viewMode, resolved}, offset, total, allTotals, cursorId}}` — and **`resolved:false` is the default filter** (unresolved-only comes free).
- Workspace currently has one board: "HEDLOC" (`4bc39757-95e3-45e5-8ff2-b00e13f7813a`), 0 threads — so thread/message field names could not be observed yet; Task 5 creates a throwaway thread and locks them down.

**Spec waiver:** no unit-test harness (spec §Verification — single-user internal tool; the live smoke is the bar). Steps therefore run live verifications instead of test-first cycles. The skill directory is not under version control (`~/.claude` is not a git repo); the plan/spec in this repo are the durable record.

---

### Task 1: Scaffold — env loading, HTTP core, usage

**Files:**

- Create: `~/.claude/skills/markup-review/markup.mjs`

- [ ] **Step 1: Write the scaffold**

```js
#!/usr/bin/env node
// markup.mjs — dependency-free CLI for MarkUp.io review rounds.
// Spec: reddoor-maintenance docs/superpowers/specs/2026-08-10-markup-review-skill-design.md
// Verbs: list | threads | resolve | unresolve. Key: MARKUP_API_KEY in
// ~/Documents/GitHub/reddoor-maintenance/.env (headers only, never printed).
// Exit codes: 0 ok, 1 usage/ambiguous, 2 auth, 3 not-found, 4 API/network.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENV_FILE = join(homedir(), "Documents/GitHub/reddoor-maintenance/.env");
const API = "https://api.markup.io/api/v2";
const API_VERSION = "2023-02-22";
const APP = "https://app.markup.io";

const die = (code, msg) => {
  console.error(msg);
  process.exit(code);
};

function apiKey() {
  let text;
  try {
    text = readFileSync(ENV_FILE, "utf8");
  } catch {
    die(
      2,
      `Cannot read ${ENV_FILE}. MARKUP_API_KEY lives there — create the key in MarkUp ` +
        `(Workspace settings → Developer Settings, scopes threads:read + threads:write).`,
    );
  }
  const line = text.split("\n").find((l) => l.startsWith("MARKUP_API_KEY="));
  const key = line?.slice("MARKUP_API_KEY=".length).trim();
  if (!key) die(2, `MARKUP_API_KEY is missing or blank in ${ENV_FILE}.`);
  return key;
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Markup-API-Version": API_VERSION,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    die(4, `network error on ${method} ${path}: ${e.message}`);
  }
  if (res.status === 401 || res.status === 403)
    die(2, `${res.status} on ${method} ${path} — key invalid, or missing threads:read/threads:write scope.`);
  if (res.status === 404) die(3, `404 on ${method} ${path} — no such resource.`);
  if (!res.ok) die(4, `${res.status} on ${method} ${path}: ${(await res.text()).slice(0, 300)}`);
  if (res.status === 204) return null;
  return res.json();
}

const USAGE = `markup.mjs — MarkUp.io review rounds

  node markup.mjs list [--query <text>]
  node markup.mjs threads <markup-id-or-name> [--all] [--json]
  node markup.mjs resolve <thread-id> [--reply "<text>"]
  node markup.mjs unresolve <thread-id>

Key: MARKUP_API_KEY in ${ENV_FILE}
Exit codes: 0 ok, 1 usage/ambiguous, 2 auth, 3 not-found, 4 API error`;

const argv = process.argv.slice(2);
const verb = argv[0];

const flags = {};
const positional = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--query" || argv[i] === "--reply") flags[argv[i].slice(2)] = argv[++i];
  else if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = true;
  else positional.push(argv[i]);
}

switch (verb) {
  case "list":
    await cmdList(flags.query);
    break;
  case "threads":
    if (!positional[0]) die(1, USAGE);
    await cmdThreads(positional[0], flags);
    break;
  case "resolve":
    if (!positional[0]) die(1, USAGE);
    await cmdResolve(positional[0], flags.reply);
    break;
  case "unresolve":
    if (!positional[0]) die(1, USAGE);
    await api("POST", `/threads/${positional[0]}/unresolve`);
    console.log(`unresolved ${positional[0]}`);
    break;
  default:
    die(verb && verb !== "--help" ? 1 : 0, USAGE);
}
```

(`cmdList`, `cmdThreads`, `cmdResolve` are added in Tasks 2–4; until then add
three stubs directly above the `switch` so the file parses:
`async function cmdList() { die(1, "not implemented"); }` and likewise for the
other two.)

- [ ] **Step 2: Verify usage and the auth-error path**

Run: `node ~/.claude/skills/markup-review/markup.mjs --help`
Expected: usage text, exit 0.

Run: `node ~/.claude/skills/markup-review/markup.mjs bogus; echo "exit=$?"`
Expected: usage text on stderr, `exit=1`.

### Task 2: `list` verb

**Files:**

- Modify: `~/.claude/skills/markup-review/markup.mjs` (replace the `cmdList` stub)

- [ ] **Step 1: Implement**

```js
async function allMarkups() {
  const out = [];
  let cursor = null;
  do {
    const q = `?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const j = await api("GET", `/markups${q}`);
    out.push(...j.data.data);
    cursor = j.data.hasMore ? j.data.nextCursor : null;
  } while (cursor);
  return out;
}

async function cmdList(query) {
  let markups = await allMarkups();
  if (query) {
    const q = query.toLowerCase();
    markups = markups.filter(
      (m) =>
        (m.name ?? "").toLowerCase().includes(q) || (m.url ?? "").toLowerCase().includes(q),
    );
  }
  if (!markups.length)
    die(3, query ? `no markups match "${query}"` : "no markups in this workspace");
  for (const m of markups) {
    console.log(
      `${m.id}  ${String(m.activeThreads ?? "?").padStart(3)} unresolved  ` +
        `${(m.status ?? "").padEnd(10)}  ${m.name}${m.url ? `  ${m.url}` : ""}`,
    );
  }
}
```

- [ ] **Step 2: Verify against the live workspace**

Run: `node ~/.claude/skills/markup-review/markup.mjs list`
Expected: one line for the HEDLOC board with its unresolved count.

Run: `node ~/.claude/skills/markup-review/markup.mjs list --query hedloc` (matches) and `--query zzz` (exit 3).

### Task 3: `threads` verb — name resolution + fix-list rendering

**Files:**

- Modify: `~/.claude/skills/markup-review/markup.mjs` (replace the `cmdThreads` stub)

- [ ] **Step 1: Implement**

```js
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveMarkup(idOrName) {
  if (UUID_RE.test(idOrName)) return idOrName;
  const q = idOrName.toLowerCase();
  const hits = (await allMarkups()).filter((m) => (m.name ?? "").toLowerCase().includes(q));
  if (hits.length === 1) return hits[0].id;
  if (!hits.length) die(3, `no markup named like "${idOrName}"`);
  die(1, `"${idOrName}" is ambiguous:\n` + hits.map((m) => `  ${m.id}  ${m.name}`).join("\n"));
}

async function fetchThreads(markupId, all) {
  const collected = [];
  let offset = 0;
  for (;;) {
    // resolved:false is the API's default filter (verified live). --all adds resolved
    // threads with a second pass; the exact "resolved" query param semantics are
    // locked down in Task 5's smoke and adjusted here if needed.
    const j = await api("GET", `/threads?markupId=${markupId}&limit=100&offset=${offset}`);
    const page = j.data.threads;
    collected.push(...page);
    offset += page.length;
    if (offset >= (j.data.total ?? collected.length) || page.length === 0) break;
  }
  if (all) {
    const j = await api(
      "GET",
      `/threads?markupId=${markupId}&limit=100&offset=0&resolved=true`,
    );
    collected.push(...(j.data.threads ?? []));
  }
  return collected;
}

function renderThread(t, markupId) {
  // Field names below (number, resolved, offsetXPercentage/offsetYPercentage,
  // messages[].text, messages[].user.name, createdAt) follow the developer docs;
  // Task 5's smoke confirms them against a real thread and this renderer is the
  // single place to adjust if the live names differ.
  const pos =
    t.offsetXPercentage != null
      ? ` @ ${Math.round(t.offsetXPercentage)}%x/${Math.round(t.offsetYPercentage)}%y`
      : "";
  const msgs = t.messages ?? [];
  const head = msgs[0] ?? {};
  const lines = [];
  lines.push(`### Pin #${t.number ?? "?"}${t.resolved ? " (resolved)" : ""}${pos}`);
  lines.push(`- thread: ${t.id}`);
  lines.push(`- link: ${APP}/markup/${markupId}/#thread/${t.id}`);
  lines.push(`- author: ${head.user?.name ?? head.userName ?? "?"}  (${t.createdAt ?? ""})`);
  lines.push(`- comment: ${head.text ?? head.body ?? "(no text)"}`);
  for (const m of msgs.slice(1))
    lines.push(`  - reply (${m.user?.name ?? m.userName ?? "?"}): ${m.text ?? m.body ?? ""}`);
  lines.push(`- screenshot: ${API}/threads/${t.id}/screenshot`);
  return lines.join("\n");
}

async function cmdThreads(idOrName, { all, json }) {
  const markupId = await resolveMarkup(idOrName);
  const threads = await fetchThreads(markupId, !!all);
  if (json) {
    console.log(JSON.stringify({ markupId, threads }, null, 2));
    return;
  }
  if (!threads.length) {
    console.log(`no ${all ? "" : "unresolved "}threads on ${markupId}`);
    return;
  }
  console.log(`# ${threads.length} thread(s) on ${markupId}\n`);
  console.log(threads.map((t) => renderThread(t, markupId)).join("\n\n"));
}
```

- [ ] **Step 2: Verify live (empty board is fine here)**

Run: `node ~/.claude/skills/markup-review/markup.mjs threads HEDLOC`
Expected: `no unresolved threads on 4bc39757-…` (name→id resolution proven).

Run: `node ~/.claude/skills/markup-review/markup.mjs threads HEDLOC --json`
Expected: `{ "markupId": "4bc39757-…", "threads": [] }`.

### Task 4: `resolve` / `unresolve` / `--reply`

**Files:**

- Modify: `~/.claude/skills/markup-review/markup.mjs` (replace the `cmdResolve` stub)

- [ ] **Step 1: Implement**

```js
async function cmdResolve(threadId, reply) {
  if (reply) {
    // Message-create body field ("text") follows the docs; confirmed/adjusted in
    // Task 5's smoke alongside the thread fields.
    await api("POST", `/threads/${threadId}/messages`, { text: reply });
    console.log(`replied on ${threadId}`);
  }
  await api("POST", `/threads/${threadId}/resolve`);
  console.log(`resolved ${threadId}`);
}
```

- [ ] **Step 2: Static check only** — behavior is exercised end-to-end in Task 5 (there is no thread to act on yet). Run `node --check ~/.claude/skills/markup-review/markup.mjs`; expected: no output, exit 0.

### Task 5: Live smoke — create a throwaway pin, lock down field names, round-trip

This is the verification the spec demands, self-contained so designers never see noise: the test thread is created and deleted by the smoke itself.

- [ ] **Step 1: Create a throwaway thread on the HEDLOC board via the API**

```bash
node -e '
const fs = require("fs"); const os = require("os"); const path = require("path");
const key = fs.readFileSync(path.join(os.homedir(), "Documents/GitHub/reddoor-maintenance/.env"), "utf8")
  .split("\n").find(l => l.startsWith("MARKUP_API_KEY=")).slice(15).trim();
const H = { Authorization: "Bearer " + key, "Markup-API-Version": "2023-02-22", "Content-Type": "application/json" };
(async () => {
  const body = { markupId: "4bc39757-95e3-45e5-8ff2-b00e13f7813a", offsetXPercentage: 50, offsetYPercentage: 50, text: "reddoor smoke pin — safe to delete" };
  const r = await fetch("https://api.markup.io/api/v2/threads", { method: "POST", headers: H, body: JSON.stringify(body) });
  console.log("status:", r.status);
  console.log((await r.text()).slice(0, 800));
})();'
```

Expected: 200/201 with the created thread JSON — **record the real field names**. If 400, the response body names the missing/misnamed fields (e.g. `projectId` instead of `markupId`, a nested `message` object, a required `viewMode`/page context) — adjust the body per the validation message and retry until created. If thread creation is refused outright for API users, fall back: ask Tucker to drop one pin by hand on the HEDLOC board and continue from Step 3.

- [ ] **Step 2: Reconcile the renderer with reality**

Compare the created thread's JSON against `renderThread`/`cmdResolve`'s assumed names (`number`, `resolved`, `offsetXPercentage/offsetYPercentage`, `messages[].text`, `messages[].user.name`, `createdAt`, message body `{text}`). Fix any mismatch in `markup.mjs` (renderer + reply body are the only two places).

- [ ] **Step 3: Read it through the CLI**

Run: `node ~/.claude/skills/markup-review/markup.mjs threads HEDLOC`
Expected: the smoke pin rendered as a fix-list item (position, author, text, deep link, screenshot URL).

- [ ] **Step 4: Round-trip resolve → unresolve with a reply**

```bash
node ~/.claude/skills/markup-review/markup.mjs resolve <thread-id> --reply "smoke: resolved by tooling test"
node ~/.claude/skills/markup-review/markup.mjs threads HEDLOC            # expect: no unresolved threads
node ~/.claude/skills/markup-review/markup.mjs threads HEDLOC --all      # expect: the pin, marked (resolved)
node ~/.claude/skills/markup-review/markup.mjs unresolve <thread-id>
node ~/.claude/skills/markup-review/markup.mjs threads HEDLOC            # expect: the pin again
```

Also confirms the `--all`/`resolved=true` query semantics from Task 3 (adjust `fetchThreads` if the resolved pass returns the wrong set).

- [ ] **Step 5: Clean up**

```bash
node -e '… same auth preamble … fetch("https://api.markup.io/api/v2/threads/<thread-id>", { method: "DELETE", headers: H }).then(r => console.log(r.status))'
```

Expected: 200/204; then `threads HEDLOC --all` shows nothing. If DELETE is not permitted, leave the pin resolved with the smoke-labeled reply (harmless, clearly labeled).

### Task 6: SKILL.md

**Files:**

- Create: `~/.claude/skills/markup-review/SKILL.md`

- [ ] **Step 1: Write it**

```markdown
---
name: markup-review
description: Work through a MarkUp.io design-review round — fetch the board's unresolved pins as a fix-list, fix each in the site's repo under that repo's own rules, and resolve pins with a reply as fixes land. Use when asked to "work through the markup/design feedback", "markup review", or "/markup-review [site]". Requires MARKUP_API_KEY in ~/Documents/GitHub/reddoor-maintenance/.env.
---

# MarkUp review round

CLI: `node ~/.claude/skills/markup-review/markup.mjs` (list | threads | resolve | unresolve — run with --help for flags). Designers pin feedback on MarkUp boards in discrete rounds; this skill turns a round into fixes.

## The round

1. **Find the board:** `list --query <site/repo name>`. Zero or multiple candidates → ask the operator, never guess.
2. **Fetch the round:** `threads <board>`. Present the pins as a checklist (TodoWrite: one item per pin — page/position + one-line summary).
3. **Fix each pin in the site repo, under that repo's own rules.** For beachfront-dentistry that means CLAUDE.md's matching discipline applies exactly as for any change (cited sources, gates, tests). Fetch the pin's screenshot URL when the comment alone is ambiguous.
4. **Verify** with the repo's own checks (tests, svelte-check, lint — whatever the repo mandates), then commit per the repo's conventions.
5. **Close the loop:** `resolve <thread-id> --reply "fixed in <sha> — <one line on what changed>"`.
6. **Report the round:** fixed / skipped-with-reason / needs-designer-input.

## Hard rules

- NEVER resolve a pin whose fix was not actually applied and verified.
- A pin you decline (out of scope, disagree, needs input) gets a `resolve`-free reply explaining why — post it with `resolve`'s `--reply` mechanics? No: post via the API is only wired through `resolve`; instead leave the pin untouched and put the reason in the round report. Designers unresolve/re-ping as needed.
- The API key is never echoed; if the CLI exits 2, relay its message verbatim.
```

- [ ] **Step 2: Self-check with the writing-skills lens**

Read the SKILL.md once as a stranger: are the triggers unambiguous, is every instruction executable, is there any dead or contradictory rule? Fix inline. (The "Hard rules" second bullet must match the CLI's real capabilities — see plan self-review note below.)

### Task 7: Wrap up

- [ ] **Step 1: Re-run the full CLI surface once** (`--help`, `list`, `threads <board>`, `threads <board> --json`) — all green, exit codes per contract.
- [ ] **Step 2: Check plan checkboxes, note any field-name adjustments made in Task 5** as a short "as-built" appendix at the bottom of this plan file.
- [ ] **Step 3: Commit plan updates** on the `docs/markup-review-skill-spec` branch and push (this file rides the same PR #515 as the spec).

---

## Plan self-review (performed at write time)

- **Spec coverage:** verbs/flags/exit codes (Tasks 1–4) ✓; skill workflow + hard rules (Task 6) ✓; live smoke incl. throwaway pin + round-trip (Task 5) ✓; error handling (Task 1 core + per-verb dies) ✓; no-fleet-coupling and no-harness waivers honored ✓.
- **Placeholder scan:** the two knowingly-unverified spots (thread/message field names; `resolved=true` param semantics) are not placeholders but explicit smoke targets with a named reconciliation step (Task 5 Steps 1–2, 4) and a single adjustment surface (renderer + reply body).
- **Consistency fix applied:** SKILL.md's "Hard rules" originally implied a standalone reply-without-resolve verb that the CLI doesn't have; the rule now says declined pins stay untouched with the reason in the round report. If reply-without-resolve proves wanted in practice, add a `reply` verb then (YAGNI now).
