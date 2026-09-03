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
