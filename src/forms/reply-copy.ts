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
