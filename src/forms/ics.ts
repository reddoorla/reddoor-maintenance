/**
 * Calendar formats for the confirmation email: an RFC 5545 VEVENT and a Google
 * Calendar template URL. Kept apart from notify.ts because the escaping rules
 * are fiddly enough to deserve their own tests, and because a calendar format
 * has nothing to do with email.
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

/** Stable per event, so a guest who receives a second copy sees their calendar
 *  entry UPDATE rather than gain a duplicate. Derived from the fields that
 *  identify the event, never from the send. */
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
