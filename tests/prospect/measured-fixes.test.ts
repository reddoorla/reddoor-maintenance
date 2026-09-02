import { describe, it, expect } from "vitest";
import { measuredFixes, type MeasuredInput } from "../../src/prospect/measured-fixes.js";

/**
 * The fix list used to be entirely model-written, and the one measured defect
 * on a page (a plain-text phone number) never reached it while ten
 * suggestions did. These are the fixes CODE writes from what the audit
 * measured. Each one is a finding, so each one names its receipt — and none of
 * them predicts what an answer engine will do, because nothing here can.
 */
const empty = (): MeasuredInput => ({
  goalFit: null,
  checks: null,
  phones: null,
  brokenLinks: null,
  brokenImages: null,
});

const req = (key: string, status: "met" | "missing" | "unmeasured") => ({
  key,
  label: key,
  status,
  evidence: null,
  why: "why",
  scope: "content" as const,
});

const checks = (over: Partial<NonNullable<MeasuredInput["checks"]>> = {}) => ({
  headings: { pagesWithoutH1: 0, pagesWithLevelSkips: 0 },
  meta: {
    pageCount: 5,
    missingCanonical: 0,
    missingTitle: 0,
    missingDescription: 0,
    missingSocial: 0,
  },
  schema: { typesFound: [], missingExpected: [], invalidBlocks: 0 },
  crawlerAccessMeasured: true,
  crawlerAccess: { blockedAi: [], allowedAi: [], blockedClassical: [] },
  ...over,
});

describe("measuredFixes", () => {
  it("returns nothing when nothing was measured", () => {
    expect(measuredFixes(empty())).toEqual([]);
  });

  it("turns a missing goal requirement into the first fix, tagged to it", () => {
    const fixes = measuredFixes({
      ...empty(),
      goalFit: {
        goal: "enquire",
        source: "operator",
        requirements: [req("price-signal", "missing"), req("tappable-phone", "met")],
        met: 1,
        total: 2,
      },
    });
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({
      addresses: "price-signal",
      origin: "measured",
      impact: "high",
    });
  });

  it("never proposes a fix for a met or unmeasured requirement", () => {
    const fixes = measuredFixes({
      ...empty(),
      goalFit: {
        goal: "book",
        source: "inferred",
        requirements: [req("booking-link", "met"), req("hours", "unmeasured")],
        met: 1,
        total: 1,
      },
    });
    expect(fixes).toEqual([]);
  });

  it("asks for a tappable phone number only when one is plain text", () => {
    const linked = measuredFixes({
      ...empty(),
      phones: [{ normalized: "13105551234", linked: true }],
    });
    expect(linked).toEqual([]);
    // Absent `linked` is an older row that never measured it — never a defect.
    const unmeasured = measuredFixes({ ...empty(), phones: [{ normalized: "13105551234" }] });
    expect(unmeasured).toEqual([]);
    const plain = measuredFixes({
      ...empty(),
      phones: [{ normalized: "13105551234", linked: false }],
    });
    expect(plain.map((f) => f.title)).toEqual(["Make your phone number tappable"]);
    expect(plain[0]!.why).toContain("1 number");
  });

  it("counts pages without a top heading and pages without a canonical address", () => {
    const fixes = measuredFixes({
      ...empty(),
      checks: checks({
        headings: { pagesWithoutH1: 2, pagesWithLevelSkips: 0 },
        meta: {
          pageCount: 20,
          missingCanonical: 20,
          missingTitle: 0,
          missingDescription: 0,
          missingSocial: 0,
        },
      }),
    });
    expect(fixes.map((f) => f.title)).toEqual([
      "Give 2 pages a top heading",
      "Tell search engines which address is the real one for each page",
    ]);
    expect(fixes[1]!.why).toContain("20 of 20");
  });

  it("names the crawlers robots.txt turns away, ahead of everything else", () => {
    const blocked = measuredFixes({
      ...empty(),
      brokenLinks: 2,
      checks: checks({
        crawlerAccess: { blockedAi: ["GPTBot", "ClaudeBot"], allowedAi: [], blockedClassical: [] },
      }),
    });
    expect(blocked[0]).toMatchObject({ tier: "crawl", impact: "high", effort: "low" });
    expect(blocked[0]!.why).toContain("GPTBot");
  });

  it("says nothing about robots.txt when the fetch itself failed", () => {
    const fixes = measuredFixes({
      ...empty(),
      checks: checks({
        crawlerAccessMeasured: false,
        crawlerAccess: { blockedAi: [], allowedAi: [], blockedClassical: [] },
      }),
    });
    expect(fixes).toEqual([]);
  });

  it("reports broken links and images as one fix each, with the count", () => {
    const fixes = measuredFixes({ ...empty(), brokenLinks: 3, brokenImages: 1 });
    expect(fixes.map((f) => f.title)).toEqual(["Repair 3 broken links", "Replace 1 broken image"]);
  });

  it("never predicts what an answer engine will do", () => {
    const all = measuredFixes({
      ...empty(),
      goalFit: {
        goal: "enquire",
        source: "operator",
        requirements: [req("price-signal", "missing")],
        met: 0,
        total: 1,
      },
      phones: [{ normalized: "1", linked: false }],
      checks: checks({
        headings: { pagesWithoutH1: 1, pagesWithLevelSkips: 0 },
        meta: {
          pageCount: 3,
          missingCanonical: 3,
          missingTitle: 0,
          missingDescription: 0,
          missingSocial: 0,
        },
        crawlerAccess: { blockedAi: ["GPTBot"], allowedAi: [], blockedClassical: [] },
      }),
      brokenLinks: 1,
      brokenImages: 1,
    });
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const f of all) {
      expect(`${f.title} ${f.why}`).not.toMatch(/\b(cite|cited|citation|recommend|rank|repeat)/i);
      expect(f.origin).toBe("measured");
    }
  });
});
