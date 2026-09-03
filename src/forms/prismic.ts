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
  const out = v.map((b) => text(record(b).text)).filter((t): t is string => t !== undefined);
  return out.length > 0 ? out : undefined;
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
