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
 * the submission itself is captured either way.
 */
import {
  parseReplyCopy,
  REPLY_BLOCK_TYPES,
  type ReplyBlock,
  type ReplyCalendar,
  type ReplyCopy,
  type ReplySpan,
} from "./reply-copy.js";

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

/** Prismic Rich Text is already a block/span AST, and `ReplyBlock` is modelled
 *  on it — so this is close to a pass-through, mapping Prismic's `hyperlink`
 *  onto our `link` and dropping any block or span kind the renderer does not
 *  know. Nothing is converted to HTML here: the AST crosses the wire and the
 *  shared renderer is the only thing that ever emits a tag. */
function blocks(v: unknown): ReplyBlock[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ReplyBlock[] = [];
  for (const raw of v) {
    const b = record(raw);
    const body = typeof b.text === "string" ? b.text : "";
    if (body.trim() === "") continue;
    const declared = typeof b.type === "string" ? b.type : "paragraph";
    const type = (REPLY_BLOCK_TYPES as readonly string[]).includes(declared)
      ? (declared as ReplyBlock["type"])
      : "paragraph";
    const block: ReplyBlock = { type, text: body };
    const spans = Array.isArray(b.spans) ? b.spans.map(record) : [];
    const mapped: ReplySpan[] = [];
    for (const s of spans) {
      const kind = s.type === "hyperlink" ? "link" : s.type;
      if (kind !== "strong" && kind !== "em" && kind !== "link") continue;
      const start = typeof s.start === "number" ? s.start : NaN;
      const end = typeof s.end === "number" ? s.end : NaN;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const span: ReplySpan = { start, end, type: kind };
      const url = text(record(s.data).url);
      if (url) span.url = url;
      mapped.push(span);
    }
    if (mapped.length > 0) block.spans = mapped;
    out.push(block);
  }
  return out.length > 0 ? out : undefined;
}

/** The signature is a short sign-off, so it stays flat text. */
function flatText(v: unknown): string | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((b) => text(record(b).text)).filter((t): t is string => t !== undefined);
  return out.length > 0 ? out.join(" ") : undefined;
}

/** A Prismic Timestamp ("2026-09-12T18:00:00+0000") as an ISO string, or
 *  undefined when the field is blank or unparseable. */
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
    end:
      timestamp(data.end_time) ?? new Date(Date.parse(start) + DEFAULT_DURATION_MS).toISOString(),
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
  const settings = record(
    await attempt(() => client.getSingle(opts.settingsType ?? "form_replies")),
  );
  const settingsData = record(settings.data);
  const entries = Array.isArray(settingsData.replies) ? settingsData.replies : [];
  const entry = record(entries.find((e) => record(e).form_type === opts.formType));

  const draft: Record<string, unknown> = {
    subject: text(entry.subject),
    body: blocks(entry.body),
    signature: flatText(settingsData.signature),
  };

  if (opts.eventUid) {
    const event = record(
      await attempt(() => client.getByUID(opts.eventType ?? "rsvp", opts.eventUid as string)),
    );
    const data = record(event.data);
    if (Object.keys(data).length > 0) {
      draft.subject = text(data.reply_subject) ?? draft.subject;
      draft.body = blocks(data.reply_body) ?? draft.body;
      draft.calendar = calendarFrom(data, opts);
    }
  }

  return parseReplyCopy(draft);
}
