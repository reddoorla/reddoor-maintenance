import { describe, it, expect } from "vitest";
import { autoTickChecklist, type AutoTickSignals } from "../../src/reports/auto-tick.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-06-18T12:00:00.000Z");
const GOOGLE = "Maint: Google Indexed";

function signals(over: Partial<AutoTickSignals> = {}): AutoTickSignals {
  return { search: { value: null, softFailed: false }, ...over };
}

describe("autoTickChecklist — Google Indexed", () => {
  it("passes when Search Console shows page 1, with the position in the note", () => {
    const ev = autoTickChecklist(
      makeWebsiteRow(),
      "Maintenance",
      NOW,
      signals({ search: { value: { foundOnPage1: true, position: 3 }, softFailed: false } }),
    );
    const g = ev.get(GOOGLE)!;
    expect(g.result).toBe("pass");
    expect(g.checkedAt).toBe(NOW.toISOString());
    expect(g.note).toMatch(/page 1/i);
    expect(g.note).toContain("3");
  });

  it("fails (no tick) when not on page 1", () => {
    const ev = autoTickChecklist(
      makeWebsiteRow(),
      "Maintenance",
      NOW,
      signals({ search: { value: { foundOnPage1: false, position: 18 }, softFailed: false } }),
    );
    expect(ev.get(GOOGLE)!.result).toBe("fail");
  });

  it("is unknown (no tick) when the Search Console call soft-failed", () => {
    const ev = autoTickChecklist(
      makeWebsiteRow(),
      "Maintenance",
      NOW,
      signals({ search: { value: null, softFailed: true } }),
    );
    expect(ev.get(GOOGLE)!.result).toBe("unknown");
  });

  it("emits no Google evidence when search is not configured (value null, not soft-failed)", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Maintenance", NOW, signals());
    expect(ev.has(GOOGLE)).toBe(false);
  });

  it("emits Google evidence for a Testing report too (Testing gates on all 13)", () => {
    const ev = autoTickChecklist(
      makeWebsiteRow(),
      "Testing",
      NOW,
      signals({ search: { value: { foundOnPage1: true, position: 1 }, softFailed: false } }),
    );
    expect(ev.get(GOOGLE)!.result).toBe("pass");
  });

  it("emits nothing for Launch/Announcement (no checklist)", () => {
    const ev = autoTickChecklist(
      makeWebsiteRow(),
      "Launch",
      NOW,
      signals({ search: { value: { foundOnPage1: true, position: 1 }, softFailed: false } }),
    );
    expect(ev.size).toBe(0);
  });
});
