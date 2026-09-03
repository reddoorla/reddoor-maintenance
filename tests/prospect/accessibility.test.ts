import { describe, expect, it } from "vitest";
import {
  MAX_REPORTED_RULES,
  summarizeAccessibility,
  type AxePageResult,
} from "../../src/prospect/accessibility.js";
import { asRendered } from "../../src/prospect/crawl.js";
import type { PageCapture } from "../../src/prospect/types.js";

const violation = (id: string, over: Partial<AxePageResult["violations"][number]> = {}) => ({
  id,
  impact: "serious" as const,
  help: `${id} help`,
  helpUrl: `https://dequeuniversity.com/rules/axe/4.10/${id}`,
  nodes: 1,
  sample: `<div id="${id}">`,
  ...over,
});

const page = (url: string, axe: AxePageResult | null | undefined): PageCapture => ({
  url,
  status: 200,
  raw: null,
  rendered: null,
  error: null,
  ...(axe === undefined ? {} : { axe }),
});

const result = (over: Partial<AxePageResult> = {}): AxePageResult => ({
  violations: [],
  passes: 42,
  incomplete: 1,
  // Measured against our own report page: axe's default set is 90 rules, of
  // which 47 had nothing on the page to apply to.
  inapplicable: 47,
  ...over,
});

describe("summarizeAccessibility — our blindness is not their all-clear", () => {
  it("is unmeasured when no page carried a result", () => {
    // Every report stored before this existed looks like this. Read as "no
    // violations" it becomes a clean accessibility record for a site nobody
    // scanned — the worst possible false all-clear.
    const s = summarizeAccessibility([page("https://x.test/", undefined)]);
    expect(s.measured).toBe(false);
    expect(s.violations).toEqual([]);
    expect(s.rulesPassed).toBe(0);
  });

  it("is unmeasured when the scan itself threw", () => {
    // `runAxe` returns null rather than throwing, so a scanner that fell over
    // arrives here as an explicit null — which must not be a pass.
    expect(summarizeAccessibility([page("https://x.test/", null)]).measured).toBe(false);
  });

  it("distinguishes a clean scan from no scan", () => {
    const s = summarizeAccessibility([page("https://x.test/", result())]);
    expect(s.measured).toBe(true);
    expect(s.violations).toEqual([]);
    expect(s.rulesPassed).toBe(42);
    // The number we may print is what had something to check, not the size of
    // the rule set: 42 + 1 + 47 is 90, and only the first is a check we ran.
    expect(s.rulesInapplicable).toBe(47);
  });

  it("ignores pages that were never scanned when counting the ones that were", () => {
    const s = summarizeAccessibility([
      page("https://x.test/", result()),
      page("https://x.test/b", null),
      page("https://x.test/c", undefined),
    ]);
    expect(s.pagesExamined).toBe(1);
  });
});

describe("summarizeAccessibility — one rule is one job", () => {
  it("aggregates a rule across pages instead of repeating the sentence", () => {
    // "Your headings skip a level on six pages" is one job. Six identical rows
    // is not a longer report, it is a worse one.
    const s = summarizeAccessibility([
      page("https://x.test/", result({ violations: [violation("heading-order", { nodes: 2 })] })),
      page("https://x.test/b", result({ violations: [violation("heading-order", { nodes: 3 })] })),
    ]);
    expect(s.violations).toHaveLength(1);
    expect(s.violations[0]!.nodes).toBe(5);
    expect(s.violations[0]!.pages).toEqual(["https://x.test/", "https://x.test/b"]);
  });

  it("does not sum the pass count across pages", () => {
    // The same rule set runs on every page, so summing reports "470 checks"
    // for 94 rules over five pages — a number inflated on our own behalf.
    const s = summarizeAccessibility([
      page("https://x.test/", result({ passes: 42 })),
      page("https://x.test/b", result({ passes: 42 })),
      page("https://x.test/c", result({ passes: 39 })),
    ]);
    expect(s.rulesPassed).toBe(42);
  });

  it("orders by impact, then by how much of the page is affected", () => {
    const s = summarizeAccessibility([
      page(
        "https://x.test/",
        result({
          violations: [
            violation("minor-thing", { impact: "minor" }),
            violation("critical-thing", { impact: "critical" }),
            violation("serious-few", { impact: "serious", nodes: 1 }),
            violation("serious-many", { impact: "serious", nodes: 40 }),
          ],
        }),
      ),
    ]);
    expect(s.violations.map((v) => v.id)).toEqual([
      "critical-thing",
      "serious-many",
      "serious-few",
      "minor-thing",
    ]);
  });

  it("caps the list but reports the true total", () => {
    const many = Array.from({ length: MAX_REPORTED_RULES + 7 }, (_, i) => violation(`rule-${i}`));
    const s = summarizeAccessibility([page("https://x.test/", result({ violations: many }))]);
    expect(s.violations).toHaveLength(MAX_REPORTED_RULES);
    // A truncated list that looks complete is the quiet lie this codebase is
    // built not to tell.
    expect(s.violationsTotal).toBe(MAX_REPORTED_RULES + 7);
  });

  it("keeps a sample element so a reader can go and find it", () => {
    const s = summarizeAccessibility([
      page("https://x.test/", result({ violations: [violation("color-contrast")] })),
    ]);
    expect(s.violations[0]!.sample).toBe('<div id="color-contrast">');
    expect(s.violations[0]!.helpUrl).toContain("dequeuniversity.com");
  });
});

describe("asRendered — the seventeen existing stubs stay honest", () => {
  it("reads a bare HTML string as 'no rules were run here'", () => {
    // Every injected test stub returns a string. Defaulting that to an empty
    // violation list would make each of them silently assert a clean scan.
    // Neither the rules nor the browser measurements ran — both must read as
    // "not measured" rather than as a clean result.
    expect(asRendered("<html></html>")).toEqual({
      html: "<html></html>",
      axe: null,
      vitals: null,
    });
  });

  it("passes a full result through untouched", () => {
    const r = { html: "<html></html>", axe: result() };
    expect(asRendered(r)).toBe(r);
  });

  it("reads a missing entry as no render at all", () => {
    expect(asRendered(undefined)).toBeNull();
  });
});
