import type { Browser } from "@playwright/test";
import { headingLevelsRule } from "./heading-levels.js";
import { noJsRule } from "./no-js.js";
import { reducedMotionRule } from "./reduced-motion.js";
import type { DesignRule, DesignRuleId, RuleOutcome } from "./types.js";

export type { DesignRule, DesignRuleId, RuleFinding, RuleOutcome, RuleStatus } from "./types.js";

/** The rules from `docs/design-review-rules-2026-09.md` that have a page check,
 *  encoded in the order the operator chose on 2026-10-20: the ones no reviewer
 *  catches by eye first (R2, R4, R9, R12). */
export const DESIGN_RULES: Record<DesignRuleId, DesignRule> = {
  R2: reducedMotionRule,
  R4: noJsRule,
  R9: headingLevelsRule,
};

/**
 * Check each url against each rule. Each check opens its own contexts, so one
 * rule's emulation (reduced motion, JS off) never leaks into another's. A page
 * that fails to load, or a check that throws, is `unmeasured`, never a pass.
 * Not a gate: nothing here runs on its own, in CI or against the fleet.
 * Running it is `scripts/design-rules.mts`.
 */
export async function runDesignRules(
  urls: string[],
  rules: DesignRule[],
  browser: Browser,
): Promise<RuleOutcome[]> {
  const outcomes: RuleOutcome[] = [];
  for (const url of urls) {
    for (const rule of rules) {
      try {
        outcomes.push(await rule.check(browser, url));
      } catch (error) {
        outcomes.push({
          rule: rule.id,
          url,
          status: "unmeasured",
          findings: [],
          note: `the check threw: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
        });
      }
    }
  }
  return outcomes;
}
