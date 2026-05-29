import { describe, it, expect } from "vitest";
import { relativeTimeFromNow } from "../../src/dashboard/relative-time.js";

const NOW = new Date("2026-05-28T12:00:00Z");

describe("relativeTimeFromNow", () => {
  it("returns '—' for null", () => {
    expect(relativeTimeFromNow(null, NOW)).toBe("—");
  });

  it("returns 'just now' for under 1 minute", () => {
    expect(relativeTimeFromNow("2026-05-28T11:59:30Z", NOW)).toBe("just now");
  });

  it("returns 'Nm ago' for under 1 hour", () => {
    expect(relativeTimeFromNow("2026-05-28T11:55:00Z", NOW)).toBe("5m ago");
    expect(relativeTimeFromNow("2026-05-28T11:01:00Z", NOW)).toBe("59m ago");
  });

  it("returns 'Nh ago' for under 1 day", () => {
    expect(relativeTimeFromNow("2026-05-28T10:00:00Z", NOW)).toBe("2h ago");
    expect(relativeTimeFromNow("2026-05-27T13:00:00Z", NOW)).toBe("23h ago");
  });

  it("returns 'Nd ago' for under 1 week", () => {
    expect(relativeTimeFromNow("2026-05-26T12:00:00Z", NOW)).toBe("2d ago");
    expect(relativeTimeFromNow("2026-05-22T12:00:00Z", NOW)).toBe("6d ago");
  });

  it("returns 'Nw ago' for under 1 month", () => {
    expect(relativeTimeFromNow("2026-05-21T12:00:00Z", NOW)).toBe("1w ago");
    expect(relativeTimeFromNow("2026-05-01T12:00:00Z", NOW)).toBe("3w ago");
  });

  it("returns 'Nmo ago' beyond 4 weeks", () => {
    expect(relativeTimeFromNow("2026-03-28T12:00:00Z", NOW)).toBe("2mo ago");
    expect(relativeTimeFromNow("2025-05-28T12:00:00Z", NOW)).toBe("12mo ago");
  });

  it("returns '—' for invalid ISO strings", () => {
    expect(relativeTimeFromNow("not-a-date", NOW)).toBe("—");
    expect(relativeTimeFromNow("", NOW)).toBe("—");
  });
});
