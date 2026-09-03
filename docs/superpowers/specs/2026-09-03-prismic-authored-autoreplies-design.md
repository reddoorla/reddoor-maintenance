# Prismic-authored form auto-replies

Date: 2026-09-03
Repos: `reddoor-maintenance` (shared package), `gallerysonder` (first caller)
Driver: Gallery Sonder / Carlo Valentino RSVP scope, item 1 of the 2026-09-01 recap

## Problem

Every form submission on every fleet site gets the same confirmation email. The
subject is the hardcoded string `"We got your message"`, and the body is three
per-site strings — `copyIntro`, `copyContact`, `copyFooter` — read off the site
row in `buildAutoresponder` (`src/forms/notify.ts`). An RSVP for a specific
exhibition, a price-list inquiry about a specific artwork, and a newsletter
signup all produce identical text.

Two things make this newly worth fixing:

1. Gallery Sonder asked for per-exhibition confirmation copy plus an
   Add-to-Calendar button, authored by the gallery, not by us.
2. The copy fields have no editor anymore. They were Airtable cells; Airtable is
   frozen (`TURSO_IS_AUTHORITATIVE = true` in `src/db/freeze.ts`) and form ingest
   reads Turso only. Whatever is in those columns is what a client gets, and no
   client can change it.

The content the email wants already exists in the site's CMS. It just has no way
to reach the send path.

## Approach

The site derives the copy server-side at submit time and forwards it in a
reserved `_reply` envelope alongside the submission. The shared package renders
whatever it is handed and falls back to today's behavior when handed nothing.

Copy is sourced from Prismic in two tiers:

- **Site-level defaults** — a `form_replies` singleton, one entry per form type.
  This is the tier that generalizes: it is the same document on every fleet site
  and is the whole feature for sites with no per-event concept.
- **Per-event override** — `reply_subject` / `reply_body` on an individual `rsvp`
  document, which wins when present.

Rejected alternatives:

- **Maintenance fetches the CMS at notify time.** Requires a per-site CMS
  identifier in the fleet DB and puts a network call between "lead captured" and
  "confirmation sent" — a new failure mode for content the site already held.
- **Hidden form fields carry the copy from the browser.** The autoresponder
  emails a submitter-supplied address. Submitter-supplied *body text* on top of
  that turns `forms@reddoorla.com` into a phishing relay on a domain with real
  sending reputation. Not viable at any price.

The envelope is content-agnostic: nothing in `src/forms/` mentions RSVPs, and
nothing in it mentions Prismic either. The Prismic resolver is a separate,
optional entry point that sites opt into.

## Trust boundary

This is the part that decides whether the design is safe.

The site's `/api/forms` route never trusts copy from the request. It reads one
opaque key — `event_uid` — and resolves the actual text from its own CMS. The
worst a forged request achieves is naming a different genuine exhibition, which
sends that exhibition's real confirmation to whoever asked for it. No text an
attacker authors can reach an outbound email.

**A latent hole must close as part of this work.** `gallerysonder`'s
`buildPayload` copies every key that is neither control nor typed into `extra`.
That includes `_`-prefixed keys, even though `src/forms/payload.ts` documents
underscore keys as reserved transport that site fields must never use. Today
nothing reads them so nothing happens. The moment `_reply` carries meaning, a
bot can post its own. `buildPayload` must drop `_`-prefixed keys, and
`normalizeSubmission` must not fold an unrecognized `_`-prefixed top-level key
into `extraFields`.

## Data flow

```text
any form → submitForm()   hidden event_uid = page.uid (rsvp pages only)
        │
        ▼
/api/forms +server.ts     buildPayload (now async)
        │                 · strips every _-prefixed key from the request
        │                 · resolveReplyCopy(client, formType, event_uid)
        │                     getSingle('form_replies')  → tier 2, the base
        │                     getByUID('rsvp', event_uid) → tier 1, overrides it
        │                 · builds _reply
        ▼
submitToIngest            _reply rides the existing token-authenticated POST
        │
        ▼
normalizeSubmission       _reply joins KNOWN_KEYS so the catch-all loop cannot
        │                 fold it in blindly, then is validated and written to
        │                 extraFields._reply explicitly
        ▼
buildAutoresponder        renders _reply if present; else today's site copy
```

`_reply` is persisted into `extraFields` rather than threaded as a transient
argument. That is deliberate: a dead-lettered submission replayed later
(`src/forms/replay.ts`) then sends the same email it would have sent
originally, instead of silently degrading to the generic one. The cost is that
`extraFieldRows` must filter `_`-prefixed keys so the copy never appears in the
point-of-contact notification table.

## Envelope

```ts
export type ReplyCopy = {
  subject?: string;
  /** Body paragraphs, plain text. Rendered one <p> each, HTML-escaped. */
  paragraphs?: string[];
  /** Appended after the body. The site-level signature. */
  signature?: string;
  calendar?: {
    title: string;
    /** ISO 8601 with offset. */
    start: string;
    end?: string;
    location?: string;
    url?: string;
    description?: string;
  };
};
```

Every field optional, independently. A `_reply` with only a `subject` is valid
and improves the email. Anything malformed is treated as absent.

## Prismic model — site-level defaults

New singleton, `form_replies` (`repeatable: false`, `format: "custom"`, matching
the existing `nav` and `intro_images` singletons). **This is the shared model** —
byte-identical across every fleet site, which is what makes the rollout a file
copy rather than a design exercise each time.

| Field | Type | Notes |
| --- | --- | --- |
| `replies` | Group (repeatable) | One entry per form type |
| `replies.form_type` | Select | `rsvp` · `inquiry` · `contact` · `newsletter`. Options mirror `SUBMISSION_FORM_TYPES` |
| `replies.subject` | Text | Blank → the shared package's subject fallback |
| `replies.body` | Rich Text | Blank → the frozen `copyIntro`/`copyContact` strings |
| `signature` | Rich Text | Appended to every reply regardless of form type. Replaces `copyFooter` |

A Select rather than free text because a typo'd form type would silently produce
no match, and the failure would look exactly like an unfilled field.

Entries for form types a site does not use are simply absent; entries for form
types the site *does* use but has not written copy for fall through to tier 3.

## Prismic model — per-event override (`rsvp`)

| Field | Type | Blank behavior |
| --- | --- | --- |
| `reply_subject` | Text | `You're on the list for {name}`, then the site default |
| `reply_body` | Rich Text | The site default for `rsvp` |
| `start_time` | Timestamp | No calendar links; rest of the email unaffected |
| `end_time` | Timestamp | `start_time` + 2 hours |
| `location` | Text | Gallery address constant from `$lib/site` |

`dates` is untouched and stays authoritative for the page. It is free-form and
multi-line on real events ("date + reception/reading times"), which a single
timestamp range cannot express, so the display string is not derived from the
timestamps. Josh enters the date twice on events that want a calendar button;
events that skip `start_time` keep working exactly as they do now. No migration
of existing content.

Rich Text is read as plain text per block — no rich-text HTML is forwarded. The
email stays plain-text-shaped, per the client's "no new design needed."

## Rendering

`buildAutoresponder` resolution order, per element:

- **Subject:** `_reply.subject` → `You're on the list for {event}` when
  `extraFields.event` exists → `"We got your message"`.
- **Body:** `_reply.paragraphs` → the existing `copyIntro`/`copyContact` pair.
- **Signature:** `_reply.signature` → `copyFooter` → the site name.
- **Calendar:** only when `_reply.calendar.start` parses. Emits a Google
  Calendar template URL and attaches a real `.ics` — `ResendSendInput` already
  supports base64 attachments (`src/reports/send/resend.ts`), so Apple Mail
  renders a native add-to-calendar chip rather than a link that Apple users
  cannot act on.

ICS generation and escaping live in the shared package, tested once, rather than
being pre-rendered per site.

All existing guards run first and are unchanged: the spam-status short-circuit,
the same-domain backscatter suppression, and the missing-submitter-email exit.

## The shared resolver

`@reddoorla/maintenance/forms/prismic` — a new entry point, separate from
`./forms` so the CMS-agnostic core stays that way and sites not on Prismic never
load it. `@prismicio/client` is an optional peer dependency; every fleet site
already has it.

```ts
resolveReplyCopy(client, {
  formType: string,
  eventUid?: string,
  eventType?: string,   // default "rsvp"
}): Promise<ReplyCopy | undefined>
```

It owns the tier walk, the Rich-Text-to-paragraphs flattening, the timestamp →
calendar mapping, and the "any failure yields undefined" rule. A site's
`buildPayload` is then a handful of lines, which is the point: the second site
to adopt this writes almost no code.

## Fleet rollout

Per site, three steps:

1. Copy `customtypes/form_replies/index.json` into the site repo. Identical
   file everywhere.
2. `reddoor-maint prismic-models <site> --push` puts it in that site's Prismic
   repo. The existing canon/diff pipeline already refuses to delete a live
   model, so this is safe against a stale checkout.
3. Bump `@reddoorla/maintenance` and call `resolveReplyCopy` in the site's
   `buildPayload`.

Gallery Sonder is step 0 — it proves the shape. Subsequent sites are done as
they come up for other work, not in a sweep. The same JSON should land in
`reddoor-starter` so new sites get it without step 1.

Sites that adopt nothing are unaffected: no `form_replies` document means no
`_reply`, which means today's email.

## Failure behavior

Uniformly degrade, never fail. Prismic unreachable, no `form_replies` document,
no matching form-type entry, or an unknown `event_uid` → no `_reply` → today's
email. Empty `reply_body` → the site default, then today's body. No `start_time`
→ no calendar. Malformed `_reply` → treated as absent. The autoresponder remains
best-effort inside `notifySubmission`: it is already wrapped so a throw is logged
and never changes `notifyStatus`.

The resolver adds one Prismic read to the submit path. It is behind the CDN and
already warm from the page render, and a failure costs the visitor nothing — the
submission forwards regardless.

## Testing

Shared package (`tests/forms/`):

- `notify.test.ts` — subject resolution across all three tiers; paragraphs
  render escaped, one `<p>` each; signature resolution; body falls back when
  `paragraphs` is empty or malformed; calendar attachment present only with a
  parseable `start`; `.ics` escapes commas, semicolons and newlines per
  RFC 5545; spam and backscatter guards still suppress before any of it.
- `payload.test.ts` — `_reply` survives normalization as a reserved key; an
  unrecognized `_`-prefixed top-level key is dropped rather than folded into
  `extraFields`.
- `notify.test.ts` — `extraFieldRows` omits `_`-prefixed keys, so the POC
  notification table is unchanged by the presence of `_reply`.
- `endpoint.test.ts` — an async `buildPayload` is awaited; a rejected one is a
  400, matching the existing "never 500s" guarantee for a throwing sync one.

Resolver (`tests/forms/prismic-reply.test.ts`, fake client):

- Per-event override beats the site default beats undefined.
- Unknown form type, missing singleton, and a throwing client each yield
  `undefined` rather than propagating.
- Rich Text flattening drops empty blocks and preserves paragraph order.
- `end_time` defaulting and the no-`start_time` case.

Site (`gallerysonder`):

- `buildPayload` strips `_`-prefixed request keys.
- A valid `event_uid` produces `_reply`; an unknown one still forwards.
- A Prismic failure does not fail the submission.

## Ship order

1. Shared package: envelope type, async `buildPayload`, `KNOWN_KEYS`,
   `extraFieldRows` filter, subject/body/signature/calendar rendering, ICS
   builder, the `forms/prismic` resolver, tests. Changeset, release.
2. `gallerysonder`: bump `@reddoorla/maintenance` off `^0.90.0`, add
   `event_uid`, harden and make `buildPayload` async, call the resolver.
3. Push both custom types (`form_replies` new, `rsvp` amended). Existing
   documents stay valid with the new fields blank, so this is safe to push
   before any copy is written.
4. Josh fills `form_replies` once, then `reply_subject` / `reply_body` /
   `start_time` per exhibition as he wants them.

Steps 1–3 are invisible to visitors. Behavior changes only at step 4.

## Out of scope

- **Retiring the frozen `copyIntro`/`copyContact`/`copyFooter` columns.** They
  stay as the last-resort net for sites that adopt nothing. Removing them is a
  fleet-wide change for after the rollout, not part of this.
- **Newsletter double opt-in and "Notify Me About" checkboxes** (Carlo's
  secondary item). The *copy* half of it comes free with the `newsletter` entry
  in `form_replies`; the opt-in flow and the interest tags do not.
- **Add-to-Calendar for anything but RSVPs.** The envelope permits it; nothing
  else has event data.
- **The `rsvp_submitted` dataLayer push.** Same engagement, independent work,
  and currently blocked on GTM container access rather than on code.
- **Event JSON-LD.** Would reuse `start_time`, but is a page concern.
