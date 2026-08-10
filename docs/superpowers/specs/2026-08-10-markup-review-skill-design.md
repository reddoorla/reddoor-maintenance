# MarkUp.io review skill — design

**Date:** 2026-08-10
**Status:** approved in conversation (Tucker), spec for review
**Home:** this doc lives in reddoor-maintenance because workflow specs live here;
the tool itself deliberately does NOT — see Non-goals.

## Purpose

Designers leave visual feedback as pinned comments on MarkUp.io boards
(internal use — designers, not clients). Feedback arrives in **discrete review
rounds**, not a trickle. Tucker fixes a round by opening a Claude session in
the site's repo and working through the pins.

Today the session cannot see the pins. The deliverable is a way for any
LLM-driven session to **read a board's unresolved threads and resolve them as
fixes land** — nothing more.

## Non-goals

- No fleet plumbing: no webhooks, no Zapier, no Airtable columns, no digest
  lines, no dashboard tiles, no polling jobs. Nothing runs unattended.
- No new package, repo, or dependency. Not part of `@reddoorla/maintenance`.
- No client-facing behavior of any kind.

## Context: MarkUp.io's API (researched 2026-08-10)

MarkUp.io (Ceros) ships an official public API — `https://api.markup.io/api/v2`,
date-versioned via a `Markup-API-Version` header (current: `2023-02-22`; pin
it). Auth is a **workspace-scoped API key** created by a workspace owner/admin
in the web app (Workspace settings → Developer Settings), sent as
`Authorization: Bearer <key>`, with scopes (`threads:read`, `threads:write`).
Per the docs, a key grants access across the whole workspace — treat it as a
server-side secret.

Resources used here:

| Need                       | Endpoint                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------- |
| Find a site's board        | `GET /markups` (cursor-paginated), `GET /markups/search`                              |
| Unresolved-count per board | `GET /markups/:id/view-modes` (thread counts)                                         |
| The pins                   | `GET /threads` (filter by markup; id, number, resolved, user, createdAt, pin offsets) |
| Pin screenshot             | `GET` thread screenshot endpoint                                                      |
| Close the loop             | `POST /threads/:id/resolve`, `/unresolve`; `POST /threads/:threadId/messages` (reply) |

Deep-link format: `https://app.markup.io/markup/{markupId}/#thread/{threadId}`.

**Implementation caveat (from the research pass):** exact request/response
schemas were summarized from developer.markup.io, not exercised. The
implementation plan's first task is reading the reference pages for the five
endpoint groups above and confirming field names against one live call each.

## Architecture

A self-contained **user-level skill**:

```text
~/.claude/skills/markup-review/
  SKILL.md      # the workflow the session follows
  markup.mjs    # dependency-free CLI (Node ≥ 18, native fetch)
```

- No npm install; no package.json. One file of plain JS.
- Credentials: `MARKUP_API_KEY` read from
  `~/Documents/GitHub/reddoor-maintenance/.env` (where Tucker keeps it, next
  to `CLOUDFLARE_PAT` — a storage location, not a fleet coupling). The script
  loads that file itself (simple parse-the-env-file), so it works from any
  cwd. The key is sent in headers only and never printed;
  error output includes status codes, never the key.
- Workspace id, if any call requires one, is discovered via the API
  (`GET /workspace`-family) rather than configured.

## CLI contract

`node ~/.claude/skills/markup-review/markup.mjs <verb> …`

| Verb                                           | Behavior                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list [--query <text>]`                        | Boards in the workspace: id, name, source URL, unresolved-thread count. `--query` filters by name/URL substring (client-side).                                                                                                                                                                                                                                                |
| `threads <markup-id-or-name> [--all] [--json]` | Default: **unresolved only**, rendered as a fix-list grouped by page/source: thread id + number, pin position (x%/y%), author, date, comment text, replies, screenshot URL, deep link. `--all` includes resolved. `--json` emits the raw structured data instead. A bare name that matches exactly one board resolves to it; multiple matches list the candidates and exit 1. |
| `resolve <thread-id> [--reply "<text>"]`       | Optionally posts the reply message first, then resolves the thread.                                                                                                                                                                                                                                                                                                           |
| `unresolve <thread-id>`                        | The undo.                                                                                                                                                                                                                                                                                                                                                                     |
| `--help` / no args                             | Usage.                                                                                                                                                                                                                                                                                                                                                                        |

Exit codes: 0 success; 1 usage/ambiguity; 2 auth (missing key, 401/403 —
message names the likely missing scope); 3 not-found; 4 API/network error.

## Skill workflow (SKILL.md outline)

Triggers: "markup review", "work through the markup/design feedback",
`/markup-review [site]`.

1. Run `list` (with the repo/site name as query) to find the board; ask the
   operator if zero or multiple candidates.
2. `threads <board>` — present the round as a checklist (one item per pin,
   with page + position + text). TodoWrite mirrors it.
3. Work each fix **in the site repo under that repo's own rules** — for
   beachfront-dentistry that means the CLAUDE.md matching discipline applies
   exactly as it would to any other change (source-cited fixes, gates, tests).
   The pin's screenshot is fetched when the comment alone is ambiguous.
4. Repo checks green → commit (repo's own conventions).
5. `resolve <thread> --reply "fixed in <sha> — <one-line what changed>"` per
   completed item. Designers who disagree unresolve the pin — that is the
   whole feedback loop; nothing else is built.
6. Round report: fixed / skipped-with-reason / needs-designer-input.

The skill never resolves a pin whose fix was not actually applied and
verified; a pin the session declines (out of scope, disagrees, needs input)
gets a reply explaining why and stays unresolved.

## Error handling

- Missing/blank `MARKUP_API_KEY`: exit 2 with the one-line fix (where to
  create the key, which scopes, where to put it).
- 401/403: exit 2, note the key's scopes may lack `threads:read`/`write`.
- Ambiguous board name: exit 1 listing candidates (never guesses).
- Network/5xx: exit 4 with status + endpoint; no retries (interactive tool —
  the operator just reruns).

## Security notes

- The API key is workspace-wide by MarkUp's design. It stays in
  `~/Documents/GitHub/reddoor-maintenance/.env`, loaded per-run,
  headers only.
- The script only ever calls `api.markup.io`. Thread text/screenshots are
  designer-authored internal content and safe to print into the session.

## Verification

- First-run live smoke, in this order: `list` → `threads` on a real board →
  `resolve`/`unresolve` round-trip on a **throwaway test pin** (created by
  hand in the UI for the purpose) → confirm the reply + resolve state in the
  MarkUp UI.
- The SKILL.md gets the superpowers `writing-skills` check (trigger clarity,
  no dead instructions).
- No unit-test harness: single-user internal tool, no CI surface; the smoke
  above is the bar.

## Out of scope, explicitly

Webhook registrations (the API supports them; nothing here registers one),
posting new threads, the embed SDK, any fleet/Airtable/digest integration,
and any scheduled or unattended execution.
