import type { BrowserContextOptions, Page } from "@playwright/test";

/** The design-review rules this module checks on a page, by their ID in
 *  `docs/design-review-rules-2026-09.md`. */
export type DesignRuleId = "R2";

/** `unmeasured` is the instrument's own failure: the page did not load, or the
 *  condition the check depends on (an emulated preference, say) did not take.
 *  It is never a pass. */
export type RuleStatus = "pass" | "fail" | "unmeasured";

/** One defect, on one element. `target` is a short CSS-ish path to it. */
export type RuleFinding = { target: string; problem: string };

export type RuleOutcome = {
  rule: DesignRuleId;
  url: string;
  status: RuleStatus;
  findings: RuleFinding[];
  note: string;
};

/** One rule: the browser context it needs, and the check that navigates to a
 *  url in that context and judges it. */
export type DesignRule = {
  id: DesignRuleId;
  title: string;
  contextOptions: BrowserContextOptions;
  check: (page: Page, url: string) => Promise<RuleOutcome>;
};
