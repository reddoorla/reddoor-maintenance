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
