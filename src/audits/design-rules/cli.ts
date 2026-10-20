import { DESIGN_RULES } from "./index.js";
import type { DesignRuleId, RuleOutcome } from "./types.js";

/** What `scripts/design-rules.mts` was asked to do, or why it cannot. */
export type DesignRulesArgs =
  { urls: string[]; rules: DesignRuleId[]; json: boolean } | { error: string };

/** `<url…> [--rule R2]… [--json]`. No `--rule` means every rule. PURE. */
export function parseDesignRulesArgs(argv: string[]): DesignRulesArgs {
  const urls: string[] = [];
  const picked: DesignRuleId[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") json = true;
    else if (arg === "--rule") {
      const id = argv[++i];
      if (!id || !Object.hasOwn(DESIGN_RULES, id)) {
        return {
          error: `unknown rule ${id ?? "(none)"}; known: ${Object.keys(DESIGN_RULES).join(", ")}`,
        };
      }
      picked.push(id as DesignRuleId);
    } else urls.push(arg);
  }
  if (urls.length === 0) return { error: "usage: design-rules.mts <url…> [--rule R2] [--json]" };
  const rules = picked.length > 0 ? picked : (Object.keys(DESIGN_RULES) as DesignRuleId[]);
  return { urls, rules, json };
}

/** 1 when any page failed a rule, 2 when nothing failed but something was
 *  unmeasured, 0 when every check passed. PURE. */
export function exitCodeFor(outcomes: RuleOutcome[]): 0 | 1 | 2 {
  if (outcomes.some((o) => o.status === "fail")) return 1;
  if (outcomes.length === 0 || outcomes.some((o) => o.status === "unmeasured")) return 2;
  return 0;
}

/** Motion a reader sees now first, then what waits, then what a reset fixes. */
function severity(problem: string): number {
  if (/still running|paused short|moved by script/.test(problem)) return 0;
  if (/-delay /.test(problem)) return 1;
  return 2;
}

/**
 * One outcome as the CLI prints it: the verdict line, then each distinct
 * problem once, with how many elements have it and up to three of their
 * paths. A page with no reset has hundreds of findings that are one fix;
 * `--json` keeps every one. PURE.
 */
export function formatOutcome(o: RuleOutcome): string[] {
  const lines = [`${o.status.toUpperCase()} ${o.rule} ${o.url}: ${o.note}`];
  const groups = new Map<string, string[]>();
  for (const f of o.findings) groups.set(f.problem, [...(groups.get(f.problem) ?? []), f.target]);
  const ordered = [...groups.entries()].sort(
    ([a, x], [b, y]) => severity(a) - severity(b) || y.length - x.length,
  );
  for (const [problem, targets] of ordered) {
    const more = targets.length > 3 ? ` (+${targets.length - 3} more)` : "";
    lines.push(`  - ${targets.length > 1 ? `${targets.length}× ` : ""}${problem}`);
    for (const t of targets.slice(0, 3)) lines.push(`      ${t}`);
    if (more) lines.push(`     ${more}`);
  }
  return lines;
}
