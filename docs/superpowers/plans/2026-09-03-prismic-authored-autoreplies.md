# Prismic-Authored Auto-Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a client author their form confirmation emails in Prismic — per form type site-wide, and per exhibition for RSVPs — with an Add-to-Calendar invite on RSVPs.

**Architecture:** The site resolves copy from its own CMS server-side at submit time and forwards it in a reserved `_reply` envelope. The shared package renders whatever it is handed and falls back to today's behavior when handed nothing. Nothing in `src/forms/` knows what Prismic is except one optional entry point, which is structurally typed so the package takes no CMS dependency.

**Tech Stack:** TypeScript, vitest, tsup (shared package); SvelteKit 5, Prismic (site).

**Spec:** `docs/superpowers/specs/2026-09-03-prismic-authored-autoreplies-design.md`

---

## Worktrees

| Repo | Path | Branch |
| --- | --- | --- |
| reddoor-maintenance | `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/prismic-reply-copy` | `feat/prismic-reply-copy` |
| gallerysonder | `/Users/tuckerlemos/Documents/GitHub/gallerysonder/.worktrees/prismic-reply-copy` | `feat/prismic-reply-copy` |

Tasks 1–9 run in the maintenance worktree, 10–14 in the gallerysonder worktree.
Referred to below as `$MAINT` and `$SITE`.

**Phase gate:** Task 14 (the site's dependency bump) cannot complete until the
maintenance change is released. Tasks 10–13 are verified locally against a
linked build; see Task 14 for the exact procedure.

## File structure

**reddoor-maintenance**

| File | Responsibility |
| --- | --- |
| `src/forms/reply-copy.ts` *(new)* | The `ReplyCopy` type and `parseReplyCopy`, the one validator for untrusted envelope data |
| `src/forms/ics.ts` *(new)* | `buildIcs` + `googleCalendarUrl` — calendar formats, no knowledge of email |
| `src/forms/prismic.ts` *(new)* | `resolveReplyCopy` — the only Prismic-shaped module, its own entry point |
| `src/forms/payload.ts` | Accepts `_reply`, rejects every other underscore key |
| `src/forms/notify.ts` | Renders `ReplyCopy` into the autoresponder; hides underscore keys from the POC table |
| `src/forms/endpoint.ts` | `buildPayload` may return a promise |
| `package.json`, `tsup.config.ts` | Publish `./forms/prismic` |

**gallerysonder**

| File | Responsibility |
| --- | --- |
| `customtypes/form_replies/index.json` *(new)* | Site-level defaults, one entry per form type. Identical on every fleet site |
| `customtypes/rsvp/index.json` | Per-event override fields + calendar timestamps |
| `src/lib/server/reply-copy.ts` *(new)* | Wires the site's Prismic client to `resolveReplyCopy` |
| `src/routes/api/forms/+server.ts` | Strips underscore keys, awaits the resolver |
| `src/routes/+layout.svelte` | `event_uid` hidden input |
| `src/routes/[[preview=preview]]/rsvp/[uid]/+page.svelte` | Populates `event_uid` |
| `src/lib/site.ts` | Exports the gallery address for the calendar fallback |

---

## Task 1: `ReplyCopy` type and its validator

**Files:**

- Create: `$MAINT/src/forms/reply-copy.ts`
- Test: `$MAINT/tests/forms/reply-copy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/forms/reply-copy.test.ts
import { describe, it, expect } from "vitest";
import { parseReplyCopy } from "../../src/forms/reply-copy.js";

describe("parseReplyCopy", () => {
  it("keeps usable fields and drops blank ones", () => {
    expect(
      parseReplyCopy({
        subject: "  You're on the list  ",
        paragraphs: ["Thanks!", "  ", "See you there."],
        signature: "Gallery Sonder",
      }),
    ).toEqual({
      subject: "You're on the list",
      paragraphs: ["Thanks!", "See you there."],
      signature: "Gallery Sonder",
    });
  });

  it("returns undefined when nothing usable survives", () => {
    expect(parseReplyCopy(undefined)).toBeUndefined();
    expect(parseReplyCopy("a string")).toBeUndefined();
    expect(parseReplyCopy([])).toBeUndefined();
    expect(parseReplyCopy({ subject: "   ", paragraphs: [] })).toBeUndefined();
  });

  it("keeps a calendar only with a title and a parseable start", () => {
    const ok = parseReplyCopy({
      calendar: { title: "Euphorbia", start: "2026-09-12T18:00:00-07:00" },
    });
    expect(ok?.calendar?.title).toBe("Euphorbia");
    expect(parseReplyCopy({ calendar: { title: "X", start: "not a date" } })).toBeUndefined();
    expect(parseReplyCopy({ calendar: { start: "2026-09-12T18:00:00-07:00" } })).toBeUndefined();
  });

  it("drops an unparseable end and a non-https url, keeping the rest", () => {
    const c = parseReplyCopy({
      calendar: {
        title: "Euphorbia",
        start: "2026-09-12T18:00:00-07:00",
        end: "garbage",
        url: "javascript:alert(1)",
        location: "3435 E Coast Highway",
      },
    })!.calendar!;
    expect(c.end).toBeUndefined();
    expect(c.url).toBeUndefined();
    expect(c.location).toBe("3435 E Coast Highway");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd $MAINT && pnpm vitest run tests/forms/reply-copy.test.ts`
Expected: FAIL — cannot resolve `../../src/forms/reply-copy.js`.

- [ ] **Step 3: Implement**

```ts
// src/forms/reply-copy.ts
/**
 * Copy for the submitter's confirmation email, resolved by the SITE from its own
 * CMS and forwarded in the reserved `_reply` envelope.
 *
 * Everything here arrives over an untrusted boundary twice — once off the wire,
 * once back out of the persisted `extraFields` JSON — so `parseReplyCopy` is the
 * single gate both paths go through. It drops field by field rather than
 * rejecting whole: a usable subject should still improve the email when the
 * calendar block is malformed.
 */
export type ReplyCalendar = {
  title: string;
  /** ISO 8601. Validated as parseable, not as any particular shape. */
  start: string;
  end?: string;
  location?: string;
  url?: string;
  description?: string;
};

export type ReplyCopy = {
  subject?: string;
  paragraphs?: string[];
  signature?: string;
  calendar?: ReplyCalendar;
};

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function date(v: unknown): string | undefined {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? s : undefined;
}

function parseCalendar(raw: unknown): ReplyCalendar | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const c = raw as Record<string, unknown>;
  const title = str(c.title);
  const start = date(c.start);
  // Both are load-bearing: an event with no name or no start is not an event,
  // and half of one in a calendar client is worse than none.
  if (!title || !start) return undefined;
  const out: ReplyCalendar = { title, start };
  const end = date(c.end);
  if (end) out.end = end;
  const location = str(c.location);
  if (location) out.location = location;
  // https only. This becomes an href in an email we send; a javascript: or
  // data: URL arriving through a CMS field is not a link anyone meant to write.
  const url = str(c.url);
  if (url && /^https:\/\//i.test(url)) out.url = url;
  const description = str(c.description);
  if (description) out.description = description;
  return out;
}

/** Validate untrusted envelope data. Undefined means "nothing usable" — callers
 *  then fall back to the site's own copy rather than sending a blank email. */
export function parseReplyCopy(raw: unknown): ReplyCopy | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: ReplyCopy = {};
  const subject = str(r.subject);
  if (subject) out.subject = subject;
  const signature = str(r.signature);
  if (signature) out.signature = signature;
  if (Array.isArray(r.paragraphs)) {
    const ps = r.paragraphs.map(str).filter((p): p is string => p !== undefined);
    if (ps.length > 0) out.paragraphs = ps;
  }
  const calendar = parseCalendar(r.calendar);
  if (calendar) out.calendar = calendar;
  return Object.keys(out).length > 0 ? out : undefined;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd $MAINT && pnpm vitest run tests/forms/reply-copy.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/forms/reply-copy.ts tests/forms/reply-copy.test.ts
git commit -m "feat(forms): ReplyCopy envelope and its validator"
```

---

## Task 2: `_reply` survives normalization; every other underscore key does not

**Files:**

- Modify: `$MAINT/src/forms/payload.ts`
- Test: `$MAINT/tests/forms/payload.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing file)

```ts
// tests/forms/payload.test.ts — append
import { parseReplyCopy } from "../../src/forms/reply-copy.js"; // add to existing imports if absent

describe("reserved underscore keys", () => {
  it("validates _reply into extraFields", () => {
    const r = normalizeSubmission({
      formType: "rsvp",
      email: "guest@example.com",
      _reply: { subject: "You're on the list for Euphorbia" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.extraFields._reply).toEqual({
      subject: "You're on the list for Euphorbia",
    });
  });

  it("drops an unrecognized underscore key instead of folding it into extraFields", () => {
    const r = normalizeSubmission({
      formType: "contact",
      email: "a@b.com",
      _sneaky: "payload",
      extra: { _alsoSneaky: "payload", piece: "Untitled" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.extraFields._sneaky).toBeUndefined();
    expect(r.value.extraFields._alsoSneaky).toBeUndefined();
    expect(r.value.extraFields.piece).toBe("Untitled");
  });

  it("drops a malformed _reply rather than storing it", () => {
    const r = normalizeSubmission({ formType: "rsvp", email: "a@b.com", _reply: "not an object" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.extraFields._reply).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd $MAINT && pnpm vitest run tests/forms/payload.test.ts`
Expected: FAIL — `_sneaky` is currently folded into `extraFields`, and `_reply` is stored raw.

- [ ] **Step 3: Implement**

In `src/forms/payload.ts`:

```ts
// add to the imports
import { parseReplyCopy, type ReplyCopy } from "./reply-copy.js";
```

Add `_reply` to the `SubmissionPayload` type, next to `_meta`:

```ts
  /** Reserved: confirmation-email copy the SITE resolved from its own CMS.
   *  Validated by parseReplyCopy, then stored under the same key in extraFields
   *  so a replayed submission sends the same email it would have sent live. */
  _reply?: ReplyCopy;
```

Add the key to `KNOWN_KEYS`:

```ts
const KNOWN_KEYS = new Set([
  "formType",
  "name",
  "firstName",
  "lastName",
  "email",
  "phone",
  "message",
  "sourceUrl",
  "utm",
  "extra",
  "_meta",
  "_reply",
]);
```

Replace both merge loops in `normalizeSubmission` so underscore keys can never
become lead data, then write the validated envelope back explicitly:

```ts
  const extraFields: Record<string, unknown> = {};
  const extra = p.extra;
  if (typeof extra === "object" && extra !== null) {
    for (const [k, v] of Object.entries(extra)) {
      if (!DANGEROUS_KEYS.has(k) && !k.startsWith("_")) extraFields[k] = v;
    }
  }
  for (const [k, v] of Object.entries(p)) {
    if (!KNOWN_KEYS.has(k) && !DANGEROUS_KEYS.has(k) && !k.startsWith("_")) extraFields[k] = v;
  }
  // The ONE underscore key a caller may set. Everything above dropped the rest,
  // including any `_reply` smuggled in through `extra` — this is the only way a
  // value reaches that key, and it is validated on the way through.
  const reply = parseReplyCopy(p._reply);
  if (reply) extraFields._reply = reply;
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd $MAINT && pnpm vitest run tests/forms/payload.test.ts`
Expected: PASS, all existing tests plus 3 new.

- [ ] **Step 5: Commit**

```bash
git add src/forms/payload.ts tests/forms/payload.test.ts
git commit -m "feat(forms): accept _reply, reject every other underscore key"
```

---

## Task 3: Underscore keys stay out of the POC notification table

**Files:**

- Modify: `$MAINT/src/forms/notify.ts` (`extraFieldRows`)
- Test: `$MAINT/tests/forms/notify.test.ts`

- [ ] **Step 1: Write the failing test** (append to the `buildPocNotification` describe)

```ts
  it("never renders reserved underscore keys into the table", () => {
    const site = makeWebsiteRow({ pointOfContact: "owner@acme.com" });
    const sub = makeSubmissionRow({
      formType: "rsvp",
      email: "guest@x.com",
      extraFields: JSON.stringify({
        event: "Euphorbia",
        _reply: { subject: "You're on the list for Euphorbia" },
      }),
    });
    const input = buildPocNotification(site, sub)!;
    expect(input.html).toContain("Euphorbia");
    expect(input.html).not.toContain("Reply");
    expect(input.html).not.toContain("You're on the list");
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd $MAINT && pnpm vitest run tests/forms/notify.test.ts -t "reserved underscore"`
Expected: FAIL — the JSON-stringified envelope is rendered as a row.

- [ ] **Step 3: Implement**

In `src/forms/notify.ts`, change `extraFieldRows`:

```ts
function extraFieldRows(raw: string | null): Array<[string, string]> {
  return Object.entries(parseExtraFields(raw))
    // Underscore keys are reserved transport (see payload.ts), never lead data.
    // `_reply` is a whole confirmation email; rendering it here would put the
    // copy in the client's notification as an unreadable JSON row.
    .filter(([k]) => !k.startsWith("_"))
    .filter(([, v]) => !(typeof v === "string" && v.trim() === ""))
    .map(([k, v]) => [humanizeKey(k), formatValue(v)] as [string, string]);
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd $MAINT && pnpm vitest run tests/forms/notify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forms/notify.ts tests/forms/notify.test.ts
git commit -m "fix(forms): keep reserved keys out of the notification table"
```

---

## Task 4: Calendar formats

**Files:**

- Create: `$MAINT/src/forms/ics.ts`
- Test: `$MAINT/tests/forms/ics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/forms/ics.test.ts
import { describe, it, expect } from "vitest";
import { buildIcs, googleCalendarUrl } from "../../src/forms/ics.js";
import type { ReplyCalendar } from "../../src/forms/reply-copy.js";

const EVENT: ReplyCalendar = {
  title: "Euphorbia — Opening Reception",
  start: "2026-09-12T18:00:00-07:00",
  end: "2026-09-12T21:00:00-07:00",
  location: "3435 E Coast Highway, Corona del Mar, CA 92625",
  url: "https://gallerysonder.com/rsvp/euphorbia",
};

describe("buildIcs", () => {
  it("emits a single VEVENT with UTC stamps", () => {
    const ics = buildIcs(EVENT, new Date("2026-09-03T00:00:00Z"));
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART:20260913T010000Z");
    expect(ics).toContain("DTEND:20260913T040000Z");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics.split("BEGIN:VEVENT")).toHaveLength(2);
  });

  it("uses CRLF line endings, as RFC 5545 requires", () => {
    expect(buildIcs(EVENT)).toContain("\r\n");
    expect(buildIcs(EVENT).split("\r\n").length).toBeGreaterThan(8);
  });

  it("escapes commas, semicolons, backslashes and newlines in text", () => {
    const ics = buildIcs({
      title: "A, B; C\\D",
      start: "2026-09-12T18:00:00Z",
      description: "line one\nline two",
    });
    expect(ics).toContain("SUMMARY:A\\, B\\; C\\\\D");
    expect(ics).toContain("DESCRIPTION:line one\\nline two");
  });

  it("defaults a missing end to two hours after the start", () => {
    const ics = buildIcs({ title: "X", start: "2026-09-12T18:00:00Z" });
    expect(ics).toContain("DTSTART:20260912T180000Z");
    expect(ics).toContain("DTEND:20260912T200000Z");
  });

  it("derives a stable UID from the event, so a resend updates rather than duplicates", () => {
    expect(buildIcs(EVENT, new Date("2026-09-03T00:00:00Z"))).toEqual(
      buildIcs(EVENT, new Date("2026-09-03T00:00:00Z")),
    );
    const uid = /UID:(.+)\r\n/.exec(buildIcs(EVENT))![1];
    expect(/UID:(.+)\r\n/.exec(buildIcs({ ...EVENT, start: "2027-01-01T00:00:00Z" }))![1]).not.toBe(
      uid,
    );
  });
});

describe("googleCalendarUrl", () => {
  it("builds a TEMPLATE link with the date range and location", () => {
    const url = new URL(googleCalendarUrl(EVENT));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Euphorbia — Opening Reception");
    expect(url.searchParams.get("dates")).toBe("20260913T010000Z/20260913T040000Z");
    expect(url.searchParams.get("location")).toContain("Corona del Mar");
    expect(url.searchParams.get("details")).toContain("https://gallerysonder.com/rsvp/euphorbia");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd $MAINT && pnpm vitest run tests/forms/ics.test.ts`
Expected: FAIL — cannot resolve `../../src/forms/ics.js`.

- [ ] **Step 3: Implement**

```ts
// src/forms/ics.ts
/**
 * Calendar formats for the confirmation email: an RFC 5545 VEVENT and a Google
 * Calendar template URL. Kept apart from notify.ts because escaping rules are
 * fiddly enough to deserve their own tests, and because a calendar format has
 * nothing to do with email.
 */
import type { ReplyCalendar } from "./reply-copy.js";

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

/** `2026-09-12T18:00:00-07:00` → `20260913T010000Z`. Callers have already proven
 *  the string parses (parseReplyCopy), so this never sees NaN. */
function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function endStamp(e: ReplyCalendar): string {
  if (e.end) return stamp(e.end);
  return stamp(new Date(Date.parse(e.start) + DEFAULT_DURATION_MS).toISOString());
}

/** RFC 5545 §3.3.11. Backslash FIRST — escaping it after the others would
 *  double-escape the backslashes they just introduced. */
function esc(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Stable per event, so a guest who gets a second copy sees their calendar
 *  entry UPDATE rather than gain a duplicate. Derived from the fields that
 *  identify the event, not from the send. */
function uid(e: ReplyCalendar): string {
  const slug = e.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${stamp(e.start)}-${slug || "event"}@reddoorla.com`;
}

/** A complete single-event calendar, CRLF-delimited per the spec. */
export function buildIcs(e: ReplyCalendar, now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Reddoor Creative//Form Auto-Reply//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid(e)}`,
    `DTSTAMP:${stamp(now.toISOString())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${endStamp(e)}`,
    `SUMMARY:${esc(e.title)}`,
  ];
  if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
  const description = [e.description, e.url].filter(Boolean).join("\n\n");
  if (description) lines.push(`DESCRIPTION:${esc(description)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** The "Add to Google Calendar" link. Google reads the same UTC stamps. */
export function googleCalendarUrl(e: ReplyCalendar): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${stamp(e.start)}/${endStamp(e)}`,
  });
  if (e.location) params.set("location", e.location);
  const details = [e.description, e.url].filter(Boolean).join("\n\n");
  if (details) params.set("details", details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd $MAINT && pnpm vitest run tests/forms/ics.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/forms/ics.ts tests/forms/ics.test.ts
git commit -m "feat(forms): ICS and Google Calendar builders"
```

---

## Task 5: The autoresponder renders subject, body and signature from `ReplyCopy`

**Files:**

- Modify: `$MAINT/src/forms/notify.ts` (`buildAutoresponder`)
- Test: `$MAINT/tests/forms/notify.test.ts`

- [ ] **Step 1: Write the failing test** (append to the `buildAutoresponder` describe)

```ts
  it("prefers the envelope's subject, paragraphs and signature", () => {
    const site = makeWebsiteRow({
      name: "Gallery Sonder",
      pointOfContact: "info@gallerysonder.com",
      copyIntro: "generic intro",
      copyFooter: "generic footer",
    });
    const sub = makeSubmissionRow({
      formType: "rsvp",
      email: "guest@example.com",
      extraFields: JSON.stringify({
        event: "Euphorbia",
        _reply: {
          subject: "You're on the list for Euphorbia",
          paragraphs: ["Thanks for RSVPing.", "Doors at 6."],
          signature: "Gallery Sonder, Corona del Mar",
        },
      }),
    });
    const input = buildAutoresponder(site, sub)!;
    expect(input.subject).toBe("You're on the list for Euphorbia");
    expect(input.html).toContain("<p>Thanks for RSVPing.</p>");
    expect(input.html).toContain("<p>Doors at 6.</p>");
    expect(input.html).toContain("Gallery Sonder, Corona del Mar");
    expect(input.html).not.toContain("generic intro");
    expect(input.html).not.toContain("generic footer");
  });

  it("names the event in the subject when only the event is known", () => {
    const site = makeWebsiteRow({ pointOfContact: "info@x.com" });
    const sub = makeSubmissionRow({
      formType: "rsvp",
      email: "guest@example.com",
      extraFields: JSON.stringify({ event: "Euphorbia" }),
    });
    expect(buildAutoresponder(site, sub)!.subject).toBe("You're on the list for Euphorbia");
  });

  it("keeps today's subject and body when there is no envelope and no event", () => {
    const site = makeWebsiteRow({
      name: "Acme Co",
      pointOfContact: "owner@acme.com",
      copyIntro: "generic intro",
      copyContact: "generic contact",
      copyFooter: "generic footer",
    });
    const input = buildAutoresponder(site, makeSubmissionRow({ email: "lead@x.com" }))!;
    expect(input.subject).toBe("We got your message");
    expect(input.html).toContain("generic intro");
    expect(input.html).toContain("generic contact");
    expect(input.html).toContain("generic footer");
  });

  it("escapes envelope copy", () => {
    const site = makeWebsiteRow({ pointOfContact: "owner@acme.com" });
    const sub = makeSubmissionRow({
      email: "lead@x.com",
      extraFields: JSON.stringify({
        _reply: { paragraphs: ["<img src=x onerror=alert(1)>"] },
      }),
    });
    const input = buildAutoresponder(site, sub)!;
    expect(input.html).toContain("&lt;img");
    expect(input.html).not.toContain("<img src=x");
  });

  it("still suppresses for spam and same-domain backscatter, envelope or not", () => {
    const site = makeWebsiteRow({ url: "https://acme.com", pointOfContact: "owner@acme.com" });
    const envelope = JSON.stringify({ _reply: { subject: "hi" } });
    expect(
      buildAutoresponder(
        site,
        makeSubmissionRow({ email: "a@b.com", status: "spam", extraFields: envelope }),
      ),
    ).toBeNull();
    expect(
      buildAutoresponder(
        site,
        makeSubmissionRow({ email: "info@acme.com", extraFields: envelope }),
      ),
    ).toBeNull();
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd $MAINT && pnpm vitest run tests/forms/notify.test.ts -t "envelope"`
Expected: FAIL — subject is `"We got your message"` and the body is the site trio.

- [ ] **Step 3: Implement**

In `src/forms/notify.ts`, add the import:

```ts
import { parseReplyCopy } from "./reply-copy.js";
```

Replace the tail of `buildAutoresponder` — everything from the `const intro = …`
line to the end of the function — with:

```ts
  const extra = parseExtraFields(submission.extraFields);
  const reply = parseReplyCopy(extra._reply);
  const eventName = typeof extra.event === "string" ? extra.event.trim() : "";

  // Subject, best available first. The middle tier is why an RSVP reads like a
  // confirmation even before anyone writes a word of copy: the event name is
  // already on every submission.
  const subject =
    reply?.subject ??
    (eventName ? `You're on the list for ${eventName}` : "We got your message");

  // Body. The site trio is the last-resort net for sites that author nothing.
  const paragraphs = reply?.paragraphs ?? [
    site.copyIntro ?? `Thanks for reaching out to ${site.name}.`,
    site.copyContact ?? "We've received your message and will be in touch soon.",
  ];
  const signature = reply?.signature ?? site.copyFooter ?? site.name;

  const html = [...paragraphs, signature].map((p) => `<p>${escapeHtml(p)}</p>`).join("");

  return {
    from: `${displayName(site.name)} <${FORMS_FROM}>`,
    to: [submission.email],
    replyTo: resolveRecipients(site, submission)?.to[0] ?? FALLBACK_REPLY_TO,
    subject,
    html,
  };
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd $MAINT && pnpm vitest run tests/forms/notify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forms/notify.ts tests/forms/notify.test.ts
git commit -m "feat(forms): render the reply envelope in the autoresponder"
```

---

## Task 6: The autoresponder attaches the calendar

**Files:**

- Modify: `$MAINT/src/forms/notify.ts` (`buildAutoresponder`)
- Test: `$MAINT/tests/forms/notify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it("attaches an .ics and links Google Calendar when the envelope carries an event", () => {
    const site = makeWebsiteRow({ pointOfContact: "info@gallerysonder.com" });
    const sub = makeSubmissionRow({
      formType: "rsvp",
      email: "guest@example.com",
      extraFields: JSON.stringify({
        event: "Euphorbia",
        _reply: {
          paragraphs: ["Thanks for RSVPing."],
          calendar: {
            title: "Euphorbia — Opening Reception",
            start: "2026-09-12T18:00:00-07:00",
            end: "2026-09-12T21:00:00-07:00",
            location: "3435 E Coast Highway, Corona del Mar, CA 92625",
          },
        },
      }),
    });
    const input = buildAutoresponder(site, sub)!;
    expect(input.html).toContain("https://calendar.google.com/calendar/render");
    const att = input.attachments![0];
    expect(att.filename).toBe("event.ics");
    expect(att.contentType).toBe("text/calendar");
    expect(Buffer.from(att.content, "base64").toString("utf8")).toContain("BEGIN:VEVENT");
  });

  it("attaches nothing when the envelope has no calendar", () => {
    const site = makeWebsiteRow({ pointOfContact: "info@x.com" });
    const sub = makeSubmissionRow({
      email: "guest@example.com",
      extraFields: JSON.stringify({ _reply: { subject: "hi" } }),
    });
    expect(buildAutoresponder(site, sub)!.attachments).toBeUndefined();
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd $MAINT && pnpm vitest run tests/forms/notify.test.ts -t "attaches"`
Expected: FAIL — `input.attachments` is undefined.

- [ ] **Step 3: Implement**

Add the import:

```ts
import { buildIcs, googleCalendarUrl } from "./ics.js";
```

Replace the `const html = …; return { … }` tail from Task 5 with:

```ts
  const blocks = [...paragraphs];
  const calendar = reply?.calendar;
  if (calendar) {
    // A bare Google link strands every Apple Mail reader, and an .ics alone is
    // a file most people on a phone will not open. Both, once.
    blocks.push(
      `Add it to your calendar: <a href="${escapeHtml(googleCalendarUrl(calendar))}">Google Calendar</a>. ` +
        `The attached invite works in Apple Calendar and Outlook.`,
    );
  }

  const html =
    blocks
      .slice(0, paragraphs.length)
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join("") +
    (calendar ? `<p>${blocks[blocks.length - 1]}</p>` : "") +
    `<p>${escapeHtml(signature)}</p>`;

  const input: ResendSendInput = {
    from: `${displayName(site.name)} <${FORMS_FROM}>`,
    to: [submission.email],
    replyTo: resolveRecipients(site, submission)?.to[0] ?? FALLBACK_REPLY_TO,
    subject,
    html,
  };
  if (calendar) {
    input.attachments = [
      {
        filename: "event.ics",
        content: Buffer.from(buildIcs(calendar), "utf8").toString("base64"),
        contentType: "text/calendar",
      },
    ];
  }
  return input;
```

> The calendar sentence is the one block that is assembled rather than escaped
> wholesale, because it contains an anchor we built ourselves. Its only
> interpolated value is the Google URL, escaped on the way in — and
> `parseReplyCopy` has already refused any non-https `url` that feeds it.

- [ ] **Step 4: Run and watch it pass**

Run: `cd $MAINT && pnpm vitest run tests/forms/notify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forms/notify.ts tests/forms/notify.test.ts
git commit -m "feat(forms): attach a calendar invite to event confirmations"
```

---

## Task 7: `buildPayload` may be async

**Files:**

- Modify: `$MAINT/src/forms/endpoint.ts`
- Test: `$MAINT/tests/forms/endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it("awaits an async buildPayload", async () => {
    const handler = createIngestEndpoint({
      getConfig: () => ({ url: "https://ingest.test", token: "t" }),
      buildPayload: async (body) => {
        await Promise.resolve();
        return { formType: "rsvp", email: String(body.email), _reply: { subject: "hi" } };
      },
    });
    const res = await handler(makeEvent({ email: "guest@example.com" }));
    expect(res.status).toBe(200);
    expect(lastPayload()._reply).toEqual({ subject: "hi" });
  });

  it("treats a rejected buildPayload as a 400, like a throwing sync one", async () => {
    const handler = createIngestEndpoint({
      getConfig: () => ({ url: "https://ingest.test", token: "t" }),
      buildPayload: () => Promise.reject(new Error("cms exploded")),
    });
    const res = await handler(makeEvent({ email: "guest@example.com" }));
    expect(res.status).toBe(400);
  });
```

> Reuse whatever request/spy helpers the existing `endpoint.test.ts` already
> defines; `makeEvent` and `lastPayload` above stand for them. Read the top of
> that file first and match its names rather than adding new helpers.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd $MAINT && pnpm vitest run tests/forms/endpoint.test.ts`
Expected: FAIL — the promise is spread into the payload, so `formType` is undefined and the handler 400s on the first test.

- [ ] **Step 3: Implement**

In `src/forms/endpoint.ts`, widen the option type:

```ts
  /**
   * Map the parsed JSON body to a payload. Must set `formType` UNLESS the fixed
   * `formType` option is provided (then that is authoritative and overrides it).
   * May be async — a site that resolves confirmation copy from its CMS does a
   * read here (see `@reddoorla/maintenance/forms/prismic`).
   */
  buildPayload: (
    body: Record<string, unknown>,
    event: RequestEvent,
  ) => SubmissionPayload | Promise<SubmissionPayload>;
```

and await it, keeping the existing try/catch (a rejection now lands in the same
branch a throw always did):

```ts
    let payload: SubmissionPayload;
    try {
      payload = {
        ...(await opts.buildPayload(body, event)),
        ...(opts.formType ? { formType: opts.formType } : {}),
        _meta: buildSubmissionMeta(event, str(body[turnstileFieldName])),
      };
    } catch (err) {
      console.error(`[forms-ingest] buildPayload threw: ${String(err)}`);
      return json({ ok: false, error: failed }, { status: 400 });
    }
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd $MAINT && pnpm vitest run tests/forms/endpoint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forms/endpoint.ts tests/forms/endpoint.test.ts
git commit -m "feat(forms): allow an async buildPayload"
```

---

## Task 8: The Prismic resolver

**Files:**

- Create: `$MAINT/src/forms/prismic.ts`
- Test: `$MAINT/tests/forms/prismic-reply.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/forms/prismic-reply.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveReplyCopy, type PrismicReader } from "../../src/forms/prismic.js";

const SETTINGS = {
  data: {
    signature: [{ type: "paragraph", text: "Gallery Sonder, Corona del Mar" }],
    replies: [
      {
        form_type: "rsvp",
        subject: "You're on the list",
        body: [
          { type: "paragraph", text: "Thanks for RSVPing." },
          { type: "paragraph", text: "" },
          { type: "paragraph", text: "Doors at 6." },
        ],
      },
      { form_type: "contact", subject: "We got your note", body: [] },
    ],
  },
};

const EVENT = {
  uid: "euphorbia",
  data: {
    name: "Euphorbia",
    reply_subject: "You're on the list for Euphorbia",
    reply_body: [{ type: "paragraph", text: "See you at the opening." }],
    start_time: "2026-09-12T18:00:00+0000",
    end_time: "2026-09-12T21:00:00+0000",
    location: "3435 E Coast Highway",
  },
};

function reader(over: Partial<PrismicReader> = {}): PrismicReader {
  return {
    getSingle: vi.fn().mockResolvedValue(SETTINGS),
    getByUID: vi.fn().mockResolvedValue(EVENT),
    ...over,
  };
}

describe("resolveReplyCopy", () => {
  it("uses the site default for a form type with no event", async () => {
    const copy = await resolveReplyCopy(reader(), { formType: "contact" });
    expect(copy).toEqual({
      subject: "We got your note",
      signature: "Gallery Sonder, Corona del Mar",
    });
  });

  it("flattens rich text to paragraphs, dropping empty blocks", async () => {
    const copy = await resolveReplyCopy(reader({ getByUID: vi.fn() }), { formType: "rsvp" });
    expect(copy?.paragraphs).toEqual(["Thanks for RSVPing.", "Doors at 6."]);
  });

  it("lets the event override the site default and adds the calendar", async () => {
    const copy = await resolveReplyCopy(reader(), { formType: "rsvp", eventUid: "euphorbia" });
    expect(copy?.subject).toBe("You're on the list for Euphorbia");
    expect(copy?.paragraphs).toEqual(["See you at the opening."]);
    expect(copy?.signature).toBe("Gallery Sonder, Corona del Mar");
    expect(copy?.calendar).toMatchObject({
      title: "Euphorbia",
      location: "3435 E Coast Highway",
    });
  });

  it("omits the calendar when the event has no start_time", async () => {
    const noStart = { ...EVENT, data: { ...EVENT.data, start_time: null } };
    const copy = await resolveReplyCopy(reader({ getByUID: vi.fn().mockResolvedValue(noStart) }), {
      formType: "rsvp",
      eventUid: "euphorbia",
    });
    expect(copy?.calendar).toBeUndefined();
    expect(copy?.subject).toBe("You're on the list for Euphorbia");
  });

  it("falls back to the default location and attaches the event url", async () => {
    const noLoc = { ...EVENT, data: { ...EVENT.data, location: null } };
    const copy = await resolveReplyCopy(reader({ getByUID: vi.fn().mockResolvedValue(noLoc) }), {
      formType: "rsvp",
      eventUid: "euphorbia",
      defaultLocation: "Gallery Sonder, Corona del Mar CA",
      eventUrl: "https://gallerysonder.com/rsvp/euphorbia",
    });
    expect(copy?.calendar?.location).toBe("Gallery Sonder, Corona del Mar CA");
    expect(copy?.calendar?.url).toBe("https://gallerysonder.com/rsvp/euphorbia");
  });

  it("yields undefined rather than throwing when Prismic fails", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("404"));
    expect(await resolveReplyCopy(reader({ getSingle: boom, getByUID: boom }), {
      formType: "rsvp",
      eventUid: "nope",
    })).toBeUndefined();
  });

  it("yields undefined for a form type with no entry and no event", async () => {
    expect(await resolveReplyCopy(reader(), { formType: "inquiry" })).toBeUndefined();
  });

  it("keeps the event override even when the singleton read fails", async () => {
    const copy = await resolveReplyCopy(
      reader({ getSingle: vi.fn().mockRejectedValue(new Error("no doc")) }),
      { formType: "rsvp", eventUid: "euphorbia" },
    );
    expect(copy?.subject).toBe("You're on the list for Euphorbia");
    expect(copy?.signature).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd $MAINT && pnpm vitest run tests/forms/prismic-reply.test.ts`
Expected: FAIL — cannot resolve `../../src/forms/prismic.js`.

- [ ] **Step 3: Implement**

```ts
// src/forms/prismic.ts
/**
 * Resolve a submitter's confirmation copy from a Prismic repository.
 *
 * Published as its own subpath (`@reddoorla/maintenance/forms/prismic`) so the
 * CMS-agnostic core stays that way: `./forms` must remain importable by a site
 * that uses no CMS at all.
 *
 * The client is STRUCTURALLY typed rather than imported from
 * `@prismicio/client`. The two reads below are the whole surface, every fleet
 * site already constructs its own client, and duck-typing keeps this package's
 * dependency list — and a consuming site's bundle — untouched. It also makes the
 * tests a two-line object instead of a mocked SDK.
 *
 * Every read is wrapped: a CMS failure must cost the visitor nothing, because
 * the submission itself is already captured by the time this matters.
 */
import { parseReplyCopy, type ReplyCalendar, type ReplyCopy } from "./reply-copy.js";

export type PrismicReader = {
  getSingle: (type: string) => Promise<unknown>;
  getByUID: (type: string, uid: string) => Promise<unknown>;
};

export type ResolveReplyCopyOptions = {
  /** The submission's form type; selects the entry in the singleton. */
  formType: string;
  /** Present for event forms only. A miss is not an error. */
  eventUid?: string;
  /** Custom type holding events. Default "rsvp". */
  eventType?: string;
  /** Singleton holding site-level defaults. Default "form_replies". */
  settingsType?: string;
  /** Calendar location when the event names none — usually the venue address. */
  defaultLocation?: string;
  /** Canonical URL of the event page, attached to the calendar entry. */
  eventUrl?: string;
};

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function text(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/** Prismic Rich Text is an array of blocks each carrying a flat `.text`. That
 *  flat field is exactly what a plain-text email wants, so no renderer is
 *  needed — and no rich-text HTML can escape into the message. */
function paragraphs(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((b) => text(record(b).text))
    .filter((t): t is string => t !== undefined);
  return out.length > 0 ? out : undefined;
}

/** A Prismic Timestamp ("2026-09-12T18:00:00+0000") as an ISO string, or
 *  undefined if the field is blank or unparseable. */
function timestamp(v: unknown): string | undefined {
  const s = text(v);
  if (!s) return undefined;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** Never let a CMS read fail the caller. */
async function attempt<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch {
    return undefined;
  }
}

function calendarFrom(
  data: Record<string, unknown>,
  opts: ResolveReplyCopyOptions,
): ReplyCalendar | undefined {
  const start = timestamp(data.start_time);
  const title = text(data.name);
  // No start, no calendar — and deliberately no guess. An invite for the wrong
  // evening is worse for a guest than no invite at all.
  if (!start || !title) return undefined;
  const cal: ReplyCalendar = {
    title,
    start,
    end: timestamp(data.end_time) ?? new Date(Date.parse(start) + DEFAULT_DURATION_MS).toISOString(),
  };
  const location = text(data.location) ?? opts.defaultLocation;
  if (location) cal.location = location;
  if (opts.eventUrl) cal.url = opts.eventUrl;
  return cal;
}

/**
 * Site defaults for `formType`, overridden field-by-field by the event document
 * when `eventUid` names one. Undefined means "nothing authored" — the caller
 * omits `_reply` entirely and the shared package's own fallbacks apply.
 */
export async function resolveReplyCopy(
  client: PrismicReader,
  opts: ResolveReplyCopyOptions,
): Promise<ReplyCopy | undefined> {
  const settings = record(await attempt(() => client.getSingle(opts.settingsType ?? "form_replies")));
  const settingsData = record(settings.data);
  const entries = Array.isArray(settingsData.replies) ? settingsData.replies : [];
  const entry = record(entries.find((e) => record(e).form_type === opts.formType));

  const draft: Record<string, unknown> = {
    subject: text(entry.subject),
    paragraphs: paragraphs(entry.body),
    signature: paragraphs(settingsData.signature)?.join(" "),
  };

  if (opts.eventUid) {
    const event = record(
      await attempt(() => client.getByUID(opts.eventType ?? "rsvp", opts.eventUid as string)),
    );
    const data = record(event.data);
    if (Object.keys(data).length > 0) {
      draft.subject = text(data.reply_subject) ?? draft.subject;
      draft.paragraphs = paragraphs(data.reply_body) ?? draft.paragraphs;
      draft.calendar = calendarFrom(data, opts);
    }
  }

  return parseReplyCopy(draft);
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd $MAINT && pnpm vitest run tests/forms/prismic-reply.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/forms/prismic.ts tests/forms/prismic-reply.test.ts
git commit -m "feat(forms): resolve reply copy from a Prismic repository"
```

---

## Task 9: Publish the subpath, changeset, full verify

**Files:**

- Modify: `$MAINT/package.json`, `$MAINT/tsup.config.ts`
- Create: `$MAINT/.changeset/prismic-authored-autoreplies.md`

- [ ] **Step 1: Add the export**

In `package.json`, after the `"./forms"` entry:

```json
    "./forms/prismic": {
      "types": "./dist/forms/prismic.d.ts",
      "import": "./dist/forms/prismic.js"
    },
```

- [ ] **Step 2: Add the build entry**

In `tsup.config.ts`, add to `entry`, directly after `"src/forms/index.ts"`:

```ts
    // Its own entry, not folded into forms/index, so `./forms` stays the
    // CMS-agnostic surface a non-Prismic site can import.
    "src/forms/prismic.ts",
```

- [ ] **Step 3: Build and confirm the artifacts exist**

Run: `cd $MAINT && pnpm build && ls dist/forms/`
Expected: `index.js`, `index.d.ts`, `prismic.js`, `prismic.d.ts`.

- [ ] **Step 4: Write the changeset**

```markdown
---
"@reddoorla/maintenance": minor
---

Form auto-replies can now be authored in a site's CMS.

A site may forward a `_reply` envelope with a submission — subject, body
paragraphs, signature, and calendar details — and the autoresponder renders it,
attaching an RFC 5545 invite and a Google Calendar link when the envelope
carries an event. Sites that send nothing keep today's email exactly.

`@reddoorla/maintenance/forms/prismic` resolves that envelope from a Prismic
repository: per-form-type defaults from a `form_replies` singleton, overridden
per event. Its client is structurally typed, so the package still depends on no
CMS SDK.

Also: `buildPayload` may now be async, and reserved underscore keys can no
longer be smuggled into `extraFields` from a request.
```

- [ ] **Step 5: Full suite, lint, typecheck**

Run: `cd $MAINT && pnpm vitest run && pnpm lint && pnpm typecheck`
Expected: all green. Investigate any failure before continuing — do not proceed
to the site with a red package.

- [ ] **Step 6: Commit and open the PR**

```bash
git add package.json tsup.config.ts .changeset/prismic-authored-autoreplies.md
git commit -m "feat(forms): publish the forms/prismic subpath"
git push -u origin feat/prismic-reply-copy
gh pr create --title "feat(forms): CMS-authored auto-replies with calendar invites" --body "..."
```

---

## Task 10: The `form_replies` singleton

**Files:**

- Create: `$SITE/customtypes/form_replies/index.json`

- [ ] **Step 1: Write the model**

```json
{
	"format": "custom",
	"id": "form_replies",
	"label": "form replies",
	"repeatable": false,
	"status": true,
	"json": {
		"Main": {
			"replies": {
				"type": "Group",
				"config": {
					"label": "replies",
					"repeat": true,
					"fields": {
						"form_type": {
							"type": "Select",
							"config": {
								"label": "form",
								"placeholder": "which form this reply answers",
								"options": ["contact", "inquiry", "newsletter", "rsvp", "reserve"],
								"default_value": "contact"
							}
						},
						"subject": {
							"type": "Text",
							"config": {
								"label": "subject",
								"placeholder": "Subject line of the email the visitor receives"
							}
						},
						"body": {
							"type": "StructuredText",
							"config": {
								"label": "body",
								"placeholder": "What the visitor reads. Plain paragraphs — formatting is not sent.",
								"allowTargetBlank": true,
								"multi": "paragraph"
							}
						}
					}
				}
			},
			"signature": {
				"type": "StructuredText",
				"config": {
					"label": "signature",
					"placeholder": "Sign-off appended to every reply, whatever the form",
					"allowTargetBlank": true,
					"multi": "paragraph"
				}
			}
		}
	}
}
```

> `multi: "paragraph"` on purpose. The email is plain text; offering headings
> and lists in the editor would promise formatting that never arrives.

- [ ] **Step 2: Commit**

```bash
git add customtypes/form_replies/index.json
git commit -m "feat(prismic): form_replies singleton for per-form reply copy"
```

---

## Task 11: Per-event override fields on `rsvp`

**Files:**

- Modify: `$SITE/customtypes/rsvp/index.json`

- [ ] **Step 1: Add the fields**

Insert into `json.Main`, after the existing `dates` field and before `slices`:

```json
			"start_time": {
				"type": "Timestamp",
				"config": {
					"label": "start (for Add to Calendar)",
					"placeholder": "Leave blank and no calendar button is sent"
				}
			},
			"end_time": {
				"type": "Timestamp",
				"config": {
					"label": "end (for Add to Calendar)",
					"placeholder": "Blank means two hours after the start"
				}
			},
			"location": {
				"type": "Text",
				"config": {
					"label": "location (for Add to Calendar)",
					"placeholder": "Blank uses the gallery address"
				}
			},
			"reply_subject": {
				"type": "Text",
				"config": {
					"label": "confirmation email subject",
					"placeholder": "You're on the list for …"
				}
			},
			"reply_body": {
				"type": "StructuredText",
				"config": {
					"label": "confirmation email body",
					"placeholder": "Overrides the site-wide RSVP reply for this event only",
					"allowTargetBlank": true,
					"multi": "paragraph"
				}
			},
```

> `dates` is untouched. It stays what the page renders, and it is free-form and
> multi-line on real events — a single timestamp range cannot express it.

- [ ] **Step 2: Confirm the JSON parses**

Run: `cd $SITE && jq -e '.json.Main | keys' customtypes/rsvp/index.json`
Expected: a key list containing `start_time`, `reply_subject`, `reply_body`.

- [ ] **Step 3: Commit**

```bash
git add customtypes/rsvp/index.json
git commit -m "feat(prismic): per-event reply copy and calendar times on rsvp"
```

---

## Task 12: Export the gallery address

**Files:**

- Modify: `$SITE/src/lib/site.ts`

- [ ] **Step 1: Add the export**

Directly below the `GALLERY` const:

```ts
/**
 * The venue as one line, for calendar invites. Derived from GALLERY so it can
 * never drift from the address Google reads — the reason that const is the
 * single source in the first place.
 */
export const GALLERY_ADDRESS = `${GALLERY.streetAddress}, ${GALLERY.addressLocality}, ${GALLERY.addressRegion} ${GALLERY.postalCode}`;
```

- [ ] **Step 2: Confirm it typechecks**

Run: `cd $SITE && pnpm check`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/site.ts
git commit -m "feat(site): export the gallery address for calendar invites"
```

---

## Task 13: Wire the ingest route

**Files:**

- Create: `$SITE/src/lib/server/reply-copy.ts`
- Modify: `$SITE/src/routes/api/forms/+server.ts`
- Modify: `$SITE/src/routes/+layout.svelte`
- Modify: `$SITE/src/routes/[[preview=preview]]/rsvp/[uid]/+page.svelte`

- [ ] **Step 1: The site's resolver wrapper**

```ts
// src/lib/server/reply-copy.ts
import { createClient } from '$lib/prismicio';
import { resolveReplyCopy } from '@reddoorla/maintenance/forms/prismic';
import { GALLERY_ADDRESS, absoluteUrl } from '$lib/site';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Confirmation-email copy for one submission, read from Prismic on the server.
 *
 * The `eventUid` is the ONLY thing taken from the request, and it is a lookup
 * key, not content: the worst a forged POST achieves is naming a different real
 * exhibition. No text a visitor supplies can reach an outbound email.
 */
export async function replyCopyFor(
	event: RequestEvent,
	formType: string,
	eventUid: string | undefined
) {
	const client = createClient({ fetch: event.fetch });
	return resolveReplyCopy(client, {
		formType,
		eventUid,
		defaultLocation: GALLERY_ADDRESS,
		eventUrl: eventUid ? absoluteUrl(`/rsvp/${eventUid}`) : undefined
	});
}
```

- [ ] **Step 2: The route**

In `src/routes/api/forms/+server.ts`, add `event_uid` to `CONTROL_KEYS` (it is a
lookup key, not lead data — it must not land in `extra`), import the wrapper,
and make `buildPayload` async:

```ts
import { replyCopyFor } from '$lib/server/reply-copy';

const CONTROL_KEYS = new Set([
	'bot-field',
	'ts',
	'form-name',
	'cf-turnstile-response',
	'event_uid'
]);
```

```ts
	buildPayload: async (body, event): Promise<SubmissionPayload> => {
		const extra: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(body)) {
			// Underscore keys are RESERVED transport in the ingest wire format. A
			// request can always claim one; dropping them here is what stops a bot
			// from posting its own `_reply` and dictating the text of an email we
			// send from a domain with real sending reputation.
			if (k.startsWith('_')) continue;
			if (!CONTROL_KEYS.has(k) && !TYPED_KEYS.has(k)) extra[k] = v;
		}
		const formType = str(body.formType);
		const _reply = formType
			? await replyCopyFor(event, formType, str(body.event_uid))
			: undefined;
		return {
			formType,
			name: str(body.name),
			email: str(body.email),
			phone: str(body.phone),
			message: str(body.message),
			sourceUrl: str(body.sourceUrl),
			utm: str(body.utm),
			...(Object.keys(extra).length ? { extra } : {}),
			...(_reply ? { _reply } : {})
		};
	}
```

- [ ] **Step 3: The hidden input**

In `src/routes/+layout.svelte`, inside the `netlifyRsvpForm` form, after the
`event` input:

```svelte
	<input type="hidden" name="event_uid" />
```

- [ ] **Step 4: Populate it**

In `src/routes/[[preview=preview]]/rsvp/[uid]/+page.svelte`, add to the
`populateHiddenForm` call:

```ts
				event: (data.page.data.name as string) || data.page.uid,
				event_uid: data.page.uid
```

- [ ] **Step 5: Verify**

Run: `cd $SITE && pnpm check && pnpm lint && pnpm build`
Expected: green. The build resolves `@reddoorla/maintenance/forms/prismic`, so
this step fails until Task 14's link step is in place — do Task 14 Step 1 first
if it does.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/reply-copy.ts src/routes/api/forms/+server.ts src/routes/+layout.svelte "src/routes/[[preview=preview]]/rsvp/[uid]/+page.svelte"
git commit -m "feat(forms): resolve confirmation copy from Prismic at submit time"
```

---

## Task 14: Release gate and rollout

- [ ] **Step 1: Verify the site against the local package before the release**

```bash
cd $SITE
pnpm add -D "@reddoorla/maintenance@link:../../../reddoor-maintenance/.worktrees/prismic-reply-copy"
pnpm check && pnpm build
```

Expected: green. **Revert this link before committing** — it must never reach
the branch:

```bash
git checkout package.json pnpm-lock.yaml && pnpm install --frozen-lockfile
```

- [ ] **Step 2: Land the package**

Merge the maintenance PR from Task 9 and wait for the release workflow to
publish the new version.

- [ ] **Step 3: Bump the site**

```bash
cd $SITE && pnpm add -D @reddoorla/maintenance@latest
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): take @reddoorla/maintenance with CMS-authored replies"
```

- [ ] **Step 4: Push the custom types**

```bash
cd $MAINT && pnpm reddoor-maint prismic-models gallerysonder --push
```

Expected: `form_replies` created, `rsvp` updated, nothing deleted. Existing
documents stay valid with the new fields blank.

- [ ] **Step 5: Open the site PR**

```bash
cd $SITE && git push -u origin feat/prismic-reply-copy && gh pr create --title "feat(forms): Prismic-authored RSVP confirmations with Add to Calendar" --body "..."
```

- [ ] **Step 6: Hand off to the client**

Josh fills the `form_replies` singleton once, then `reply_subject` /
`reply_body` / `start_time` per exhibition. Until he does, every form sends
exactly what it sends today.

---

## Self-review notes

- **Spec coverage.** Envelope → Task 1. Trust boundary and underscore hardening
  → Tasks 2 and 13. Persisted-for-replay → Task 2. POC table filtering → Task 3.
  Calendar formats → Task 4. Subject/body/signature tiers → Task 5. Attachment →
  Task 6. Async `buildPayload` → Task 7. Resolver → Task 8. Subpath and
  changeset → Task 9. Both custom types → Tasks 10 and 11. Site wiring → Tasks
  12 and 13. Rollout → Task 14.
- **Deviation from the spec, deliberate.** The spec called `@prismicio/client` an
  optional peer dependency. The resolver takes a structurally typed reader
  instead, so the package gains no dependency at all and the tests need no
  mocked SDK. Amend the spec to match when Task 8 lands.
- **Not covered here, by design.** Retiring the frozen `copyIntro`/`copyContact`
  /`copyFooter` columns, the newsletter double opt-in, the `rsvp_submitted`
  dataLayer push, and Event JSON-LD. All listed out of scope in the spec.
