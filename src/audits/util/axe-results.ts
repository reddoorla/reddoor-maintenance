// Serialized into the a11y audit's generated Playwright spec with
// `Function.prototype.toString()`, like revealBelowFold and the cross-origin
// helpers, so the tests exercise the code that ships. It must stay
// self-contained: no import, no module-scope identifier, no named inner
// helper (a bundler's keep-names shim would reference a `__name` that does
// not exist where the text runs).
//
// WHY THE AUDIT READS AXE'S RAW REPORT (#916 review). axe runs each frame
// separately and merges every frame's result for a rule into one. When the
// rule THREW in any frame, the merged result carries `error`, and axe's
// default (v1) report then keeps only that rule's `incomplete` group: the
// violations and passes it DID produce, in every other frame, are dropped
// (axe-core 4.13.0 `aggregateResult`: `if (subResult.error) copyToGroup(...,
// CANTTELL_GROUP)`). So a color-contrast crash inside a third party's embed
// erased the site's own contrast failures, and the crash's one node was then
// dropped by the cross-origin frame filter, and the page passed. The raw
// report keeps every group of every rule, and each crash as its own node, in
// the frame it happened in. This reads it into the v1 shape the spec already
// consumed, plus the crashes.

/** One axe node, as the spec reads it (the v1 shape). */
export type AxeNode = {
  html?: string | undefined;
  target?: unknown;
  any: unknown[];
  all: unknown[];
  none: unknown[];
  impact?: string | null;
};

/** One rule's nodes in one result group, as the spec reads it (the v1 shape). */
export type AxeRuleNodes = {
  id: string;
  impact: string | null;
  help?: string | undefined;
  helpUrl?: string | undefined;
  nodes: AxeNode[];
};

/**
 * One place a rule threw. `nodes` is the node axe filed the crash on, whose
 * target says which frame it happened in; empty when axe reported an error
 * without one, which nothing can attribute to a third party.
 */
export type AxeCrash = {
  rule: string;
  helpUrl?: string | undefined;
  message: string | null;
  nodes: AxeNode[];
};

export type AxeReading = {
  violations: AxeRuleNodes[];
  passes: AxeRuleNodes[];
  incomplete: AxeRuleNodes[];
  crashes: AxeCrash[];
};

/**
 * axe's raw report (`reporter: "raw"`), read into `violations`, `passes` and
 * `incomplete` in the v1 shape, with every crash moved out of `incomplete`
 * into `crashes`. A crash is a node carrying axe's `error-occurred` check;
 * a rule that carries `error` with no such node is still a crash, with no
 * node. Nothing a rule produced is dropped because it also threw somewhere.
 * Anything that is not an array fails closed (#916 review): it reads as one
 * crash with no node, which the spec fails as `rule-errored`. An empty
 * report would read as a clean page that measured nothing, and a later
 * `.options()` that dropped `reporter: "raw"` is exactly how one would arrive.
 */
export function readAxeResults(raw: unknown): AxeReading {
  const reading: AxeReading = { violations: [], passes: [], incomplete: [], crashes: [] };
  if (!Array.isArray(raw)) {
    reading.crashes.push({ rule: "axe", message: "axe returned no raw report", nodes: [] });
    return reading;
  }
  const rules = raw as Array<Record<string, unknown>>;
  for (const rule of rules) {
    if (!rule || typeof rule.id !== "string") continue;
    const id = rule.id;
    const helpUrl = typeof rule.helpUrl === "string" ? rule.helpUrl : undefined;
    const error = rule.error as { message?: unknown } | null | undefined;
    const errorMessage = error && typeof error.message === "string" ? error.message : null;
    let crashed = false;
    for (const group of ["violations", "passes", "incomplete"] as const) {
      const nodes: AxeNode[] = [];
      const entries = Array.isArray(rule[group])
        ? (rule[group] as Array<Record<string, unknown>>)
        : [];
      for (const entry of entries) {
        if (!entry) continue;
        // raw: { node: { selector, source }, any, all, none }; v1: { target, html, ... }.
        const spec = (entry.node ?? entry) as { selector?: unknown; source?: unknown };
        const node: AxeNode = {
          html: typeof spec.source === "string" ? spec.source : (entry.html as string | undefined),
          target: Array.isArray(spec.selector) ? spec.selector : entry.target,
          any: Array.isArray(entry.any) ? entry.any : [],
          all: Array.isArray(entry.all) ? entry.all : [],
          none: Array.isArray(entry.none) ? entry.none : [],
          impact: typeof entry.impact === "string" ? entry.impact : null,
        };
        const crash =
          group === "incomplete"
            ? ([...node.any, ...node.all, ...node.none].find(
                (c) => !!c && (c as { id?: unknown }).id === "error-occurred",
              ) as { data?: { message?: unknown } | null } | undefined)
            : undefined;
        if (crash) {
          crashed = true;
          const said =
            crash.data && typeof crash.data.message === "string" ? crash.data.message : null;
          reading.crashes.push({ rule: id, helpUrl, message: said ?? errorMessage, nodes: [node] });
        } else {
          nodes.push(node);
        }
      }
      if (nodes.length > 0) {
        reading[group].push({
          id,
          impact: typeof rule.impact === "string" ? rule.impact : null,
          help: typeof rule.help === "string" ? rule.help : undefined,
          helpUrl,
          nodes,
        });
      }
    }
    if (error && !crashed)
      reading.crashes.push({ rule: id, helpUrl, message: errorMessage, nodes: [] });
  }
  return reading;
}
