import { describe, it, expect } from "vitest";
import { auditsPageView } from "../../src/lib/audits/view.js";
import { NOW, item } from "./fixtures.js";

// W1: the list says whether a prospect can open each report.
describe("/audits review state", () => {
  const label = (over: Parameters<typeof item>[0]) =>
    auditsPageView([item(over)], NOW).audits[0]!.review?.label ?? null;

  it("a finished run is a draft, and a partial one says do not send", () => {
    expect(label({})).toBe("Draft, not approved: the link 404s");
    expect(label({ status: "partial" })).toBe("Draft, partial run: do not send");
  });

  it("approved, withdrawn and superseded say so; withdrawn wins over approved", () => {
    expect(label({ approved_at: "2026-11-23T20:00:00.000Z" })).toBe("Approved: the link is live");
    expect(
      label({ approved_at: "2026-11-23T20:00:00.000Z", withdrawn_at: "2026-11-23T21:00:00.000Z" }),
    ).toBe("Withdrawn: the link 404s");
    expect(label({ superseded_by: "B".repeat(22), withdrawn_at: "2026-11-23T21:00:00.000Z" })).toBe(
      "Superseded by a newer report",
    );
  });

  it("a row with no report behind it has no review state", () => {
    expect(label({ status: "running" })).toBeNull();
    expect(label({ status: "failed" })).toBeNull();
  });
});
