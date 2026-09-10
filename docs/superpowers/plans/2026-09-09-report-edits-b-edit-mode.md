# Report Edits B — Edit Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator open a prospect report at a private edit address, click any resolvable line, retype it, and have the change land on the live report.

**Architecture:** A separate `/audit/[token]/edit` route exchanges a key in the query string for a short-lived cookie, then renders the ordinary report with an editing layer on top. The layer runs only when that cookie is present, matches rendered text against the values the view knows are overridable, and saves through a website endpoint that forwards to maintenance with a shared token.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-09-prospect-report-operator-edits-design.md`, sections 4 and 5.

**Depends on:** `2026-09-09-report-edits-a-override-layer.md`, fully landed and deployed. Plan A's Task 5 endpoint is what this writes to.

---

## Why the path is separate, and not a query flag

The share address and the edit address must be different strings. If editing were `?edit=<key>` on the report URL, then the URL an operator has in their address bar while editing is one query string away from the URL they paste to a prospect. A single careless paste would hand a prospect the ability to rewrite their own audit.

With a separate path, the worst a careless paste does is share the read-only report. The key also leaves the URL immediately, exchanged for a cookie, so the address bar stops carrying it at all.

## The subtlety that will bite whoever implements this

**An override's `original` is the GENERATED text, never what is currently on screen.**

Editing a line twice must not record the first edit as the thing being replaced. If it did, the stale-original guard from plan A would start withholding overrides after a second edit, and the symptom would be "my edit silently did nothing".

The rule, implemented in Task 3:

- key already in `view.overrides` → `original` is `view.overrides[key].original`
- key not in the map → `original` is the text currently rendered, which is the generated text

## The second subtlety, found while building plan A

**Overrides compose into each other, so editing one line can silently revert another.**

Found 2026-09-09 while wiring the composed sentences. `healthRows` is not a leaf: its
output is consumed by three other composed sentences.

| Consumer          | What it builds from a health row                                |
| ----------------- | --------------------------------------------------------------- |
| `passes`          | its "Does it work" items, as `` `${row.label}: ${row.value}` `` |
| `healthFixes`     | each fix's `why`, as `` `${spec.what} ${row.detail}` ``         |
| `headlineFinding` | the `site-check` branch, printing `inline(r.label)`             |

So an override on a health row changes the GENERATED text of those downstream
sentences. That invalidates the stored `original` of any override already saved
against them, and plan A's stale-original guard then correctly withholds the
second edit. The operator sees their downstream edit quietly revert, and nothing
says why.

**It degrades better than the paragraph above first claimed**, and the
difference matters. Verified by execution on 2026-09-09: a withheld override
falls back to the REGENERATED sentence, which already embeds the operator's
upstream edit — not to the stale text from before that edit. Measured:

```text
fix.why BEFORE  "One viewport meta tag in the head of every page. Without the
                 one tag that tells a phone how wide the page is…"
fix.why AFTER   "One viewport meta tag in the head of every page. NEW DETAIL."
                 (the operator's row edit, carried through; their separate
                  edit to this sentence withheld)
```

So the report stays internally consistent rather than half-edited. What is lost
is the operator's second, downstream edit — never coherence. That is the good
version of this failure, and it is worth knowing before someone tries to
"fix" it by loosening the guard.

The guard is doing its job. The problem is only that the editing UI can create
this situation without noticing.

**What Task 3 and Task 5 must do about it:**

1. Capture originals in dependency order — health rows before anything derived
   from them — so a single save never records an original that its own sibling
   edit is about to invalidate.
2. After a save, the edit layer re-reads targets from the fresh view anyway
   (`invalidateAll` then re-wire), so a withheld override becomes visible as a
   line that reverted rather than one that silently disagrees.
3. Task 6's measurement should count withheld overrides, not just unresolvable
   lines. A withheld override is the failure mode this section describes, and it
   is invisible unless counted.

This is inherent to letting any line be edited when some lines are built from
others. It is not a defect in the override mechanism, and it is not fixable by
tightening the guard — the guard is what makes it detectable at all.

## File Structure

| File                                            | Responsibility                                                |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `src/lib/report/edit-auth.ts`                   | Create: the cookie name and the constant-time compare, shared |
| `src/routes/audit/[token]/edit/+page.server.ts` | Create: key check, cookie exchange, redirect                  |
| `src/routes/audit/[token]/edit/+page.svelte`    | Create: the report, plus the editing layer                    |
| `src/lib/report/editable.ts`                    | Create: enumerate overridable keys and their text             |
| `src/lib/report/EditLayer.svelte`               | Create: click-to-edit, save, resolve counts                   |
| `src/lib/report/load.ts`                        | Modify: declare an edit session upstream                      |
| `src/routes/api/audit-edit/+server.ts`          | Create: the save proxy                                        |
| `.env.example`                                  | Modify: document the two new variables                        |

---

## Task 1: The edit address, and the key-for-cookie exchange

**Files:**

- Create: `src/lib/report/edit-auth.ts`
- Create: `src/routes/audit/[token]/edit/+page.server.ts`
- Test: `src/routes/audit/[token]/edit/page.server.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/routes/audit/[token]/edit/page.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const env: Record<string, string | undefined> = {};
vi.mock("$env/dynamic/private", () => ({ env }));
vi.mock("$lib/report/load", () => ({
  loadReport: vi.fn(async () => ({
    report: { url: "https://acme.test/" },
    overrides: {},
    meta_referrer: "no-referrer",
  })),
}));

import { load } from "./+page.server";

const TOKEN = "aB3-_xY9zQ1rS2tU4vW6xY";

function evt(url: string, cookieValue?: string) {
  const set = vi.fn();
  return {
    params: { token: TOKEN },
    url: new URL(url),
    fetch: globalThis.fetch,
    setHeaders: vi.fn(),
    cookies: { get: vi.fn(() => cookieValue), set },
    _set: set,
  };
}

beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  env.REPORT_EDIT_KEY = "s3cret";
});

describe("the edit route", () => {
  it("fails closed when REPORT_EDIT_KEY is unset", async () => {
    delete env.REPORT_EDIT_KEY;
    await expect(
      load(evt(`https://reddoorla.com/audit/${TOKEN}/edit?k=s3cret`) as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("404s with no key and no cookie", async () => {
    await expect(
      load(evt(`https://reddoorla.com/audit/${TOKEN}/edit`) as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("404s a wrong key", async () => {
    await expect(
      load(evt(`https://reddoorla.com/audit/${TOKEN}/edit?k=wrong`) as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("sets an HttpOnly cookie and redirects the key out of the URL", async () => {
    const e = evt(`https://reddoorla.com/audit/${TOKEN}/edit?k=s3cret`);
    await expect(load(e as never)).rejects.toMatchObject({ status: 303 });
    expect(e._set).toHaveBeenCalledWith(
      "reddoor_report_edit",
      "s3cret",
      expect.objectContaining({ httpOnly: true, sameSite: "strict", path: "/audit" }),
    );
  });

  it("renders for a valid cookie with no key in the URL", async () => {
    const data = await load(evt(`https://reddoorla.com/audit/${TOKEN}/edit`, "s3cret") as never);
    expect(data.editing).toBe(true);
    expect(data.report).toEqual({ url: "https://acme.test/" });
  });

  it("never indexes and never leaks the URL as a referrer", async () => {
    const data = await load(evt(`https://reddoorla.com/audit/${TOKEN}/edit`, "s3cret") as never);
    expect(data.meta_robots).toBe("noindex, nofollow");
    expect(data.meta_referrer).toBe("no-referrer");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd ~/Documents/GitHub/reddoor-website && pnpm vitest run "src/routes/audit/[token]/edit/"
```

Expected: FAIL, cannot resolve `./+page.server`.

- [ ] **Step 3: Put the shared half in a lib module first**

Two files need the cookie name and the comparison. A route file is the wrong
home for either: importing a constant out of `+page.server.ts` couples an API
endpoint to a page's module graph, and a second copy of a constant-time compare
is a second place for it to be got wrong.

Create `src/lib/report/edit-auth.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

/** The operator's edit session. Scoped to /audit in the `set` call, so it is
 *  never sent with a request to any other part of the site. */
export const EDIT_COOKIE = "reddoor_report_edit";

/** Short by design. This grants the ability to rewrite what a prospect reads,
 *  and an operator who wants it back only has to follow the link again. */
export const EDIT_COOKIE_MAX_AGE = 60 * 60 * 8;

/**
 * Constant-time comparison of a supplied key against the configured one.
 *
 * Length-checked first, because `timingSafeEqual` throws on buffers of
 * different lengths rather than returning false. Mirrors the helper in
 * `/api/meeting-outcome`, which guards this site's other internal page.
 */
export function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Implement the route**

Create `src/routes/audit/[token]/edit/+page.server.ts`:

```ts
import { error, redirect } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { loadReport } from "$lib/report/load";
import { EDIT_COOKIE, EDIT_COOKIE_MAX_AGE, keyMatches } from "$lib/report/edit-auth";
import type { PageServerLoad } from "./$types";

export const prerender = false;

/**
 * The private address for editing one report.
 *
 * ── Why this is a separate path, not a flag on the report URL ───────────────
 *
 * The address an operator edits at must not be one query string away from the
 * address they paste to a prospect. With `/audit/{token}?edit=<key>`, a single
 * careless paste would hand the prospect the ability to rewrite their own
 * audit. With a separate path, that same slip shares the read-only report.
 *
 * The key is exchanged for a cookie on first arrival and then redirected out of
 * the URL, so it stops sitting in the address bar, in history, and in anything
 * that copies a URL.
 *
 * Guards match /meeting-outcome, this site's other internal page: never
 * prerendered, never indexed, and `no-referrer` so the address cannot travel
 * out in a Referer header. It FAILS CLOSED — no REPORT_EDIT_KEY in the
 * environment means the route refuses everything rather than falling back to
 * open.
 */
export const load: PageServerLoad = async (event) => {
  const expected = env.REPORT_EDIT_KEY;
  if (!expected) {
    console.error("[audit-edit] REPORT_EDIT_KEY not set — refusing");
    // Deliberately the same answer as a missing page. An authorised operator
    // always arrives with the key, so nobody legitimate sees this.
    throw error(404, "Not found");
  }

  const given = event.url.searchParams.get("k");
  if (given) {
    if (!keyMatches(given, expected)) throw error(404, "Not found");
    event.cookies.set(EDIT_COOKIE, given, {
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      path: "/audit",
      maxAge: EDIT_COOKIE_MAX_AGE,
    });
    // 303 so a refresh does not re-submit the key, and so the address bar stops
    // carrying it immediately.
    throw redirect(303, `/audit/${event.params.token}/edit`);
  }

  const cookie = event.cookies.get(EDIT_COOKIE);
  if (!cookie || !keyMatches(cookie, expected)) throw error(404, "Not found");

  return {
    ...(await loadReport(event)),
    editing: true,
    meta_robots: "noindex, nofollow",
  };
};
```

- [ ] **Step 5: Run and watch them pass**

```bash
pnpm vitest run "src/routes/audit/[token]/edit/"
```

Expected: PASS, six tests.

- [ ] **Step 6: Prove the fail-closed branch**

Mutation test. Change `if (!expected)` to `if (false)` and re-run. Expected: the "fails closed" test REDS. Restore, confirm green. Verify the mutation landed with `grep -n "if (false)"` before trusting the red.

- [ ] **Step 7: Commit**

```bash
git add "src/routes/audit/[token]/edit/"
git commit -m "feat(report): a private edit address, key exchanged for a cookie

Separate path rather than a flag on the report URL: the address you edit at
must not be one query string away from the address you paste to a prospect."
```

---

## Task 2: An edit session does not count as the prospect reading it

**Files:**

- Modify: `src/lib/report/load.ts`
- Test: `src/lib/report/load.test.ts`

Plan A's Task 4 skips the `opened_at` stamp when the request carries `x-reddoor-edit-session: 1`. Nothing sends it yet.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/report/load.test.ts`:

```ts
describe("loadReport — edit sessions are not readers", () => {
  it("declares an edit session upstream when the edit cookie is present", async () => {
    const seen: Record<string, string> = {};
    await loadReport({
      params: { token: "aB3-_xY9zQ1rS2tU4vW6xY" },
      fetch: (async (_url: string, init?: RequestInit) => {
        Object.assign(seen, Object.fromEntries(new Headers(init?.headers).entries()));
        return new Response(JSON.stringify({ report: {}, overrides: null }), { status: 200 });
      }) as unknown as typeof globalThis.fetch,
      setHeaders: () => {},
      cookies: { get: () => "s3cret" },
    } as never);
    expect(seen["x-reddoor-edit-session"]).toBe("1");
  });

  it("sends no such header for an ordinary reader", async () => {
    const seen: Record<string, string> = {};
    await loadReport({
      params: { token: "aB3-_xY9zQ1rS2tU4vW6xY" },
      fetch: (async (_url: string, init?: RequestInit) => {
        Object.assign(seen, Object.fromEntries(new Headers(init?.headers).entries()));
        return new Response(JSON.stringify({ report: {}, overrides: null }), { status: 200 });
      }) as unknown as typeof globalThis.fetch,
      setHeaders: () => {},
      cookies: { get: () => undefined },
    } as never);
    expect(seen["x-reddoor-edit-session"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm vitest run src/lib/report/load.test.ts
```

Expected: FAIL, the header is absent in the first case.

- [ ] **Step 3: Implement**

In `src/lib/report/load.ts`, widen `LoadLike` and pass the flag down:

```ts
type LoadLike = {
  params: { token: string };
  fetch: typeof globalThis.fetch;
  setHeaders: (headers: Record<string, string>) => void;
  /** Present on a real SvelteKit event. Optional so a caller in a test can omit
   *  it and get the ordinary-reader path. */
  cookies?: { get: (name: string) => string | undefined };
};
```

```ts
// An operator previewing their own edits is not the prospect reading the
// report. Saying so here is what keeps `opened_at` meaning "the person we
// sent this to has seen it" rather than "somebody loaded the page".
const editing = Boolean(cookies?.get("reddoor_report_edit"));

const fetched = await fetchReport(params.token, {
  baseUrl: env.PROSPECT_REPORT_URL ?? "",
  fetch,
  editSession: editing,
});
```

In `src/lib/report/fetch.ts`, add the option and send the header:

```ts
export type FetchReportOptions = {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  /** Marks this fetch as an operator preview, so maintenance does not record it
   *  as the report having been opened by its recipient. */
  editSession?: boolean;
};
```

```ts
const res = await opts.fetch(`${opts.baseUrl.replace(/\/$/, "")}/api/audit-report/${token}`, {
  headers: opts.editSession ? { "x-reddoor-edit-session": "1" } : {},
});
```

Destructure `cookies` in `loadReport`'s parameter list alongside the others.

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm vitest run src/lib/report/ && pnpm check
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/load.ts src/lib/report/fetch.ts src/lib/report/load.test.ts
git commit -m "feat(report): an operator preview is not a prospect opening the report"
```

---

## Task 3: Enumerate what can be edited

**Files:**

- Create: `src/lib/report/editable.ts`
- Test: `src/lib/report/editable.test.ts`

The edit layer needs a list of every overridable key with the text currently on screen, and the generated text that an override must record as its `original`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/report/editable.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { editableTargets } from "./editable";
import { toReportView } from "./model";

const RAW = {
  url: "https://acme.test/",
  siteChecks: {
    ok: true,
    data: [
      {
        key: "dead-links",
        label: "Links that go nowhere",
        status: "fail",
        evidence: "3 of 40",
        why: "Generated why.",
        scope: "quick",
      },
    ],
  },
  analyze: {
    ok: true,
    data: {
      fixes: [
        { title: "Fix one", why: "Because.", impact: "high", effort: "low", tier: "content" },
      ],
    },
  },
};

describe("editableTargets", () => {
  it("lists payload strings with their key and current text", () => {
    const targets = editableTargets(toReportView(RAW));
    expect(targets).toContainEqual({
      key: "siteChecks.data[0].why",
      text: "Generated why.",
      original: "Generated why.",
    });
    expect(targets).toContainEqual({
      key: "analyze.data.fixes[0].title",
      text: "Fix one",
      original: "Fix one",
    });
  });

  it("reports the GENERATED text as original for an already-edited line", () => {
    const view = toReportView(RAW, {
      "siteChecks.data[0].why": { original: "Generated why.", text: "Edited why." },
    });
    expect(editableTargets(view)).toContainEqual({
      key: "siteChecks.data[0].why",
      text: "Edited why.",
      original: "Generated why.",
    });
  });

  it("skips empty and whitespace-only strings", () => {
    const view = toReportView({
      ...RAW,
      siteChecks: { ok: true, data: [{ ...RAW.siteChecks.data[0], evidence: "   " }] },
    });
    expect(editableTargets(view).some((t) => t.key === "siteChecks.data[0].evidence")).toBe(false);
  });

  it("includes the composed sentences", () => {
    const keys = editableTargets(toReportView(RAW)).map((t) => t.key);
    expect(keys).toContain("composed:headlineFinding");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm vitest run src/lib/report/editable.test.ts
```

Expected: FAIL, cannot resolve `./editable`.

- [ ] **Step 3: Implement**

Create `src/lib/report/editable.ts`:

```ts
import type { AuditReport, OverrideMap } from "./fetch";
import type { ReportView } from "./model";
import { headlineFinding, passes, collisionFix, healthFixes } from "./narrative";
import { healthRows } from "./health";
import { openingSummary } from "./model";

/** One line an operator can rewrite. */
export type EditTarget = {
  /** The override key. */
  key: string;
  /** What is on screen right now — already an override, if one applies. */
  text: string;
  /**
   * The GENERATED text this key replaces.
   *
   * Never the same thing as `text` once a line has been edited. Recording the
   * displayed text as `original` on a second edit would make the override stop
   * matching the payload, and plan A's guard would then silently withhold it —
   * a bug whose symptom is "my edit did nothing".
   */
  original: string;
};

/** The payload fields an operator may rewrite, as `[stage path, field names]`.
 *  Verbatim quotes are absent on purpose: `engineQuote` and `siteQuote` are
 *  verified substrings of somebody else's words, and editing one forges a
 *  receipt rather than rewording an opinion. */
const PAYLOAD_FIELDS: { path: string; fields: string[] }[] = [
  { path: "siteChecks.data", fields: ["label", "why", "evidence"] },
  { path: "analyze.data.fixes", fields: ["title", "why"] },
  { path: "accuracy.data.assertions", fields: ["claim", "unverifiedReason"] },
  { path: "goalFit.data.requirements", fields: ["label", "why", "evidence"] },
];

function at(obj: unknown, path: string): unknown {
  let node: unknown = obj;
  for (const seg of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

function originalFor(map: OverrideMap, key: string, displayed: string): string {
  return map[key]?.original ?? displayed;
}

function push(out: EditTarget[], map: OverrideMap, key: string, text: unknown): void {
  if (typeof text !== "string" || text.trim() === "") return;
  out.push({ key, text, original: originalFor(map, key, text) });
}

/**
 * Every line on this report an operator can rewrite, with its override key.
 *
 * Built from the view rather than from the DOM, so the edit layer never has to
 * guess what a piece of text means. The layer matches these strings against
 * what is rendered and wires up the ones that resolve uniquely; anything
 * ambiguous is left alone and counted.
 *
 * `raw` is the payload BEFORE overrides, which the edit page passes through
 * untouched. Payload targets are read from it so their text is the generated
 * text when nothing overrides them.
 */
export function editableTargets(view: ReportView, raw?: AuditReport): EditTarget[] {
  const out: EditTarget[] = [];
  const map = view.overrides;
  const source = raw ?? ({} as AuditReport);

  for (const { path, fields } of PAYLOAD_FIELDS) {
    const list = at(source, path);
    if (!Array.isArray(list)) continue;
    list.forEach((row, i) => {
      for (const f of fields) {
        const key = `${path}[${i}].${f}`;
        const generated = (row as Record<string, unknown>)[f];
        if (typeof generated !== "string" || generated.trim() === "") continue;
        const displayed = map[key]?.original === generated ? map[key]!.text : generated;
        out.push({ key, text: displayed, original: generated });
      }
    });
  }

  // Composed sentences. Each is read through its own function, so the text here
  // is exactly what the page renders.
  push(out, map, "composed:headlineFinding", headlineFinding(view).text);
  push(out, map, "composed:openingSummary", openingSummary(view));

  passes(view).forEach((g, i) => {
    push(out, map, `composed:passes[${i}].title`, g.title);
    g.items.forEach((item, j) => push(out, map, `composed:passes[${i}].items[${j}]`, item));
  });

  const collision = collisionFix(view);
  if (collision) {
    push(out, map, "composed:collisionFix.title", collision.title);
    push(out, map, "composed:collisionFix.why", collision.why);
  }

  healthFixes(view).forEach((f, i) => {
    push(out, map, `composed:healthFix[${i}].title`, f.title);
    push(out, map, `composed:healthFix[${i}].why`, f.why);
  });

  healthRows(view).forEach((r) => {
    push(out, map, `composed:health[${r.key}].label`, r.label);
    push(out, map, `composed:health[${r.key}].value`, r.value);
    push(out, map, `composed:health[${r.key}].detail`, r.detail);
  });

  return out;
}
```

Note the test passes only `view`, so `raw` defaults and the payload loop finds nothing. Update the first two tests to pass `RAW` as the second argument:

```ts
const targets = editableTargets(toReportView(RAW), RAW);
```

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm vitest run src/lib/report/editable.test.ts && pnpm check
```

Expected: PASS, four tests.

- [ ] **Step 5: Prove the original-vs-displayed rule**

Mutation test, because this is the subtlety that causes a silent failure. In the payload loop, change `out.push({ key, text: displayed, original: generated })` to `original: displayed`. Re-run. Expected: "reports the GENERATED text as original for an already-edited line" REDS. Restore and confirm green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/report/editable.ts src/lib/report/editable.test.ts
git commit -m "feat(report): enumerate the lines an operator can rewrite

An override's original is always the generated text, never what is on screen:
recording a previous edit as the original makes the next one silently vanish."
```

---

## Task 4: The save proxy

**Files:**

- Create: `src/routes/api/audit-edit/+server.ts`
- Test: `src/routes/api/audit-edit/server.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing tests**

Create `src/routes/api/audit-edit/server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const env: Record<string, string | undefined> = {};
vi.mock("$env/dynamic/private", () => ({ env }));

import { POST } from "./+server";

const TOKEN = "aB3-_xY9zQ1rS2tU4vW6xY";
const MAP = { "composed:headlineFinding": { original: "a", text: "b" } };

function evt(opts: { cookie?: string; body?: unknown; fetch?: typeof globalThis.fetch }) {
  return {
    request: new Request("https://reddoorla.com/api/audit-edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts.body ?? { token: TOKEN, overrides: MAP }),
    }),
    cookies: { get: vi.fn(() => opts.cookie) },
    fetch: opts.fetch ?? ((async () => new Response("{}", { status: 200 })) as never),
  };
}

beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  env.REPORT_EDIT_KEY = "s3cret";
  env.PROSPECT_REPORT_URL = "https://ops.test";
  env.PROSPECT_EDIT_TOKEN = "shared";
});

describe("POST /api/audit-edit", () => {
  it("forwards to maintenance with the shared token", async () => {
    let seenUrl = "";
    let seenAuth = "";
    let seenBody = "";
    const res = await POST(
      evt({
        cookie: "s3cret",
        fetch: (async (url: string, init: RequestInit) => {
          seenUrl = url;
          seenAuth = new Headers(init.headers).get("authorization") ?? "";
          seenBody = String(init.body);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }) as never,
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(seenUrl).toBe(`https://ops.test/api/audit-report/${TOKEN}/overrides`);
    expect(seenAuth).toBe("Bearer shared");
    expect(JSON.parse(seenBody)).toEqual({ overrides: MAP });
  });

  it("refuses without the edit cookie, and does not call upstream", async () => {
    const upstream = vi.fn();
    const res = await POST(evt({ fetch: upstream as never }) as never);
    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a wrong cookie", async () => {
    const res = await POST(evt({ cookie: "wrong" }) as never);
    expect(res.status).toBe(404);
  });

  it("fails closed when PROSPECT_EDIT_TOKEN is unset", async () => {
    delete env.PROSPECT_EDIT_TOKEN;
    const res = await POST(evt({ cookie: "s3cret" }) as never);
    expect(res.status).toBe(503);
  });

  it("rejects a malformed report token before calling upstream", async () => {
    const upstream = vi.fn();
    const res = await POST(
      evt({
        cookie: "s3cret",
        body: { token: "../etc", overrides: MAP },
        fetch: upstream as never,
      }) as never,
    );
    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("surfaces an upstream refusal rather than reporting success", async () => {
    const res = await POST(
      evt({
        cookie: "s3cret",
        fetch: (async () => new Response('{"ok":false}', { status: 400 })) as never,
      }) as never,
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm vitest run src/routes/api/audit-edit/
```

Expected: FAIL, cannot resolve `./+server`.

- [ ] **Step 3: Implement**

Create `src/routes/api/audit-edit/+server.ts`:

```ts
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { REPORT_TOKEN_PATTERN } from "$lib/report/fetch";
import { EDIT_COOKIE, keyMatches } from "$lib/report/edit-auth";
import type { RequestHandler } from "./$types";

/**
 * Save an operator's edits to one prospect report.
 *
 * Two credentials, doing two different jobs. The edit COOKIE proves the caller
 * is an operator in a browser; it never leaves this site. The shared TOKEN
 * proves to maintenance that the request came from this server rather than from
 * anyone who guessed a report URL, and it never reaches a browser. Neither
 * alone would be enough: the cookie cannot authenticate a cross-service call,
 * and a token in client-side code is not a secret.
 *
 * Fails closed on both. An unset key or an unset token refuses everything.
 */
export const POST: RequestHandler = async ({ request, cookies, fetch }) => {
  const expected = env.REPORT_EDIT_KEY;
  const cookie = cookies.get(EDIT_COOKIE);
  // The same answer as a missing page, exactly as the edit route gives.
  if (!expected || !cookie || !keyMatches(cookie, expected)) {
    return json({ ok: false, error: "not-found" }, { status: 404 });
  }

  if (!env.PROSPECT_EDIT_TOKEN || !env.PROSPECT_REPORT_URL) {
    console.error("[audit-edit] PROSPECT_EDIT_TOKEN / PROSPECT_REPORT_URL not set — refusing");
    return json({ ok: false, error: "unconfigured" }, { status: 503 });
  }

  let body: { token?: unknown; overrides?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad-json" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  // Validated here because the value is interpolated into an outbound URL.
  if (!REPORT_TOKEN_PATTERN.test(token)) {
    return json({ ok: false, error: "bad-token" }, { status: 400 });
  }

  const base = env.PROSPECT_REPORT_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/api/audit-report/${token}/overrides`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.PROSPECT_EDIT_TOKEN}`,
    },
    body: JSON.stringify({ overrides: body.overrides }),
  });

  // Pass the upstream verdict through. Reporting success on a refusal would
  // leave the operator believing an edit landed when it did not.
  if (!res.ok) return json({ ok: false, error: "upstream" }, { status: res.status });
  return json({ ok: true }, { status: 200 });
};
```

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm vitest run src/routes/api/audit-edit/ && pnpm check
```

Expected: PASS, six tests.

- [ ] **Step 5: Document the two variables**

Append to `.env.example`, in the same voice as the entries around it:

```
# REPORT_EDIT_KEY
#       Unlocks /audit/{token}/edit, the operator's in-place editor for a
#       generated prospect report. Exchanged for a short-lived HttpOnly cookie
#       on arrival and then redirected out of the URL, so it does not sit in an
#       address bar next to a link that gets pasted to prospects.
#
#       Unset, the edit route and /api/audit-edit both refuse everything. They
#       fail CLOSED: this grants the ability to rewrite what a prospect reads.
#
# PROSPECT_EDIT_TOKEN
#       Shared secret this server presents to the maintenance app when saving
#       those edits. Server-side only, and deliberately NOT the same value as
#       REPORT_EDIT_KEY: one proves an operator to us, the other proves us to
#       maintenance, and they are revoked independently.
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/audit-edit/ .env.example
git commit -m "feat(report): proxy operator edits through to maintenance

Two credentials doing two jobs: the cookie proves an operator to us, the
shared token proves us to maintenance. Both fail closed."
```

---

## Task 5: Click a line, change it

**Files:**

- Create: `src/lib/report/EditLayer.svelte`
- Create: `src/routes/audit/[token]/edit/+page.svelte`
- Test: `src/routes/audit/edit-mode.spec.ts` (Playwright)

- [ ] **Step 1: Build the edit page**

Create `src/routes/audit/[token]/edit/+page.svelte`:

```svelte
<script lang="ts">
  import { toReportView } from "$lib/report/model";
  import Report from "$lib/report/Report.svelte";
  import EditLayer from "$lib/report/EditLayer.svelte";
  import { editableTargets } from "$lib/report/editable";

  let { data } = $props();
  const view = $derived(toReportView(data.report, data.overrides));
  const targets = $derived(editableTargets(view, data.report));
</script>

<svelte:head>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<!-- The report renders exactly as a prospect sees it. Everything about editing
     lives in the layer on top, so nothing in the components can behave one way
     for an operator and another way for a reader. -->
<Report {view} />
<EditLayer {targets} token={data.token} overrides={data.overrides} />
```

Return `token` from the edit route's load, alongside `editing`:

```ts
    token: event.params.token,
```

- [ ] **Step 2: Build the layer**

Create `src/lib/report/EditLayer.svelte`:

```svelte
<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import type { EditTarget } from "./editable";
  import type { OverrideMap } from "./fetch";

  let {
    targets,
    token,
    overrides,
  }: { targets: EditTarget[]; token: string; overrides: OverrideMap } = $props();

  let resolved = $state(0);
  let ambiguous = $state(0);
  let saving = $state(false);
  let failed = $state("");

  /**
   * Wire each target to the element that renders it.
   *
   * Matching by text rather than by an id attribute on every render site, on
   * purpose: it keeps the report's own components identical for a prospect and
   * an operator, and it means this whole mechanism can only ever misbehave
   * behind the edit cookie.
   *
   * A target whose text appears more than once is SKIPPED. Guessing between two
   * candidates would let an edit land on a line the operator was not looking
   * at, and a wrong edit is worse than a missing one. The counts are shown so a
   * gap is visible rather than silent.
   */
  function wire(): void {
    const byText = new Map<string, EditTarget[]>();
    for (const t of targets) {
      const list = byText.get(t.text) ?? [];
      list.push(t);
      byText.set(t.text, list);
    }

    let ok = 0;
    let skipped = 0;
    const seen = new Set<Element>();

    for (const el of document.querySelectorAll<HTMLElement>("main :is(p,li,h2,h3,h4,td,dd,span)")) {
      if (el.querySelector("p,li,h2,h3,h4,td,dd,span")) continue; // leaves only
      const text = (el.textContent ?? "").trim();
      const matches = byText.get(text);
      if (!matches || seen.has(el)) continue;
      if (matches.length > 1) {
        skipped++;
        continue;
      }
      const nodes = document.evaluate(
        `count(//main//*[normalize-space(text())=${JSON.stringify(text)}])`,
        document,
        null,
        XPathResult.NUMBER_TYPE,
        null,
      ).numberValue;
      if (nodes > 1) {
        skipped++;
        continue;
      }
      seen.add(el);
      el.dataset.editKey = matches[0]!.key;
      el.dataset.editOriginal = matches[0]!.original;
      el.contentEditable = "true";
      el.spellcheck = true;
      el.classList.add("rd-editable");
      el.addEventListener("blur", onBlur);
      ok++;
    }
    resolved = ok;
    ambiguous = skipped;
  }

  async function onBlur(ev: FocusEvent): Promise<void> {
    const el = ev.currentTarget as HTMLElement;
    const key = el.dataset.editKey;
    const original = el.dataset.editOriginal;
    if (!key || original === undefined) return;

    const text = (el.textContent ?? "").trim();
    const next: OverrideMap = { ...overrides };
    // Typing the generated text back in REMOVES the override rather than
    // storing a no-op, so a report can always be returned to what was measured.
    if (text === original) delete next[key];
    else next[key] = { original, text };

    saving = true;
    failed = "";
    try {
      const res = await fetch("/api/audit-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, overrides: next }),
      });
      if (!res.ok) failed = `Save failed (${res.status}). Your change is not stored.`;
      else await invalidateAll();
    } catch {
      failed = "Save failed. Your change is not stored.";
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    // Re-wire whenever targets change, which is after every successful save.
    void targets;
    wire();
  });
</script>

<aside class="rd-edit-bar">
  <strong>Editing.</strong>
  {resolved} lines editable{ambiguous > 0 ? `, ${ambiguous} skipped as ambiguous` : ""}.
  {#if saving}<span>Saving…</span>{/if}
  {#if failed}<span class="rd-edit-failed">{failed}</span>{/if}
</aside>

<style>
  .rd-edit-bar {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 100;
    padding: 0.6rem 1rem;
    background: #1a1a1a;
    color: #fff;
    font: 14px/1.4 system-ui, sans-serif;
  }
  .rd-edit-failed {
    color: #ff9a9a;
  }
  :global(.rd-editable:focus) {
    outline: 2px solid #d71920;
    outline-offset: 2px;
  }
  :global(.rd-editable:hover) {
    background: rgba(215, 25, 32, 0.06);
  }
</style>
```

- [ ] **Step 3: Write the browser test**

Create `src/routes/audit/edit-mode.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

// A report token seeded by the dev fixture route. Edit mode is exercised
// against the real page, because the whole mechanism is DOM matching and a
// unit test would prove nothing about it.
const TOKEN = process.env.E2E_AUDIT_TOKEN ?? "";

test.skip(!TOKEN, "set E2E_AUDIT_TOKEN to run edit-mode tests");

test("the report is not editable without the cookie", async ({ page }) => {
  await page.goto(`/audit/${TOKEN}`);
  await expect(page.locator(".rd-edit-bar")).toHaveCount(0);
  await expect(page.locator("[contenteditable=true]")).toHaveCount(0);
});

test("the edit address 404s without a key", async ({ page }) => {
  const res = await page.goto(`/audit/${TOKEN}/edit`);
  expect(res?.status()).toBe(404);
});

test("with the key, lines become editable and the count is shown", async ({ page }) => {
  await page.goto(`/audit/${TOKEN}/edit?k=${process.env.E2E_REPORT_EDIT_KEY}`);
  await expect(page).toHaveURL(new RegExp(`/audit/${TOKEN}/edit$`));
  await expect(page.locator(".rd-edit-bar")).toContainText("lines editable");
  expect(await page.locator("[contenteditable=true]").count()).toBeGreaterThan(0);
});
```

- [ ] **Step 4: Run the gates**

```bash
pnpm vitest run && pnpm check && pnpm lint
```

- [ ] **Step 5: Prove edit mode is inert for a reader, on rendered markup**

```bash
E2E_AUDIT_TOKEN=<a real token> pnpm test:smoke -- edit-mode
```

Then assert it server-side too, stripping the hydration payload first, because SvelteKit embeds load data in the HTML and a naive substring check passes on data that is never displayed:

```bash
curl -s "https://<preview>/audit/$TOKEN" \
  | perl -0pe 's/<script\b.*?<\/script>//gis' \
  | grep -c 'contenteditable\|rd-edit-bar'
```

Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/report/EditLayer.svelte "src/routes/audit/[token]/edit/+page.svelte" src/routes/audit/edit-mode.spec.ts
git commit -m "feat(report): click any resolvable line and rewrite it

Ambiguous text is skipped and counted rather than guessed: an edit landing
on a line the operator was not looking at is worse than one that never lands."
```

---

## Task 6: End-to-end, on a real report

- [ ] **Step 1: Set both secrets on the two Netlify sites**

`REPORT_EDIT_KEY` and `PROSPECT_EDIT_TOKEN` on the website; `PROSPECT_EDIT_TOKEN` on maintenance, the same value as the website's. Generate each with `openssl rand -base64 32`. They are different secrets and must not be set to the same value.

- [ ] **Step 2: Walk it**

1. Open `/audit/<token>/edit?k=<REPORT_EDIT_KEY>` and confirm the URL loses the key.
2. Confirm the bar reports a plausible editable count, and note the ambiguous count.
3. Edit the headline finding. Confirm it persists across a reload.
4. Open `/audit/<token>` in a private window. Confirm the edit shows and no edit affordance does.
5. Open `/audit/<token>/print` and confirm the same text.
6. Check the cockpit's audits list shows Edited, and Opened after step 4.
7. Type the generated text back in. Confirm the override disappears rather than being stored as a no-op.

- [ ] **Step 3: Record the ambiguous count in the work journal**

The number of lines the layer could not resolve is the honest measure of what this delivers against "any rendered line". Write it down, with the report it was measured on. If it is high, that is the next piece of work, and it is a real finding rather than a disappointment.

---

## Self-review notes

**Spec coverage.** Spec section 4 is Tasks 1, 2 and 5; section 5 is Task 4. The `opened_at` exclusion for edit sessions is Task 2. The `.env.example` documentation is Task 4, step 5.

**Deliberately not built:** any lock on editing, per the operator's decision that a report stays editable after the link goes out. The cockpit's edited/opened display from plan A Task 6 is what stands in for one.

**Known limit, stated rather than hidden.** Matching rendered text to override keys resolves most lines but not all. A string that appears twice on the page is skipped by design. Task 6 step 3 requires measuring and recording how many, because "any rendered line" is the goal and this is the gap between the goal and what ships.
