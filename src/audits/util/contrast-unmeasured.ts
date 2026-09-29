// Functions the a11y audit serializes into its generated Playwright spec with
// `Function.prototype.toString()`, like revealBelowFold and the cross-origin
// helpers, so the tests exercise the code that ships rather than a
// transcription of it. Each must stay self-contained: no import, no
// module-scope identifier, and no named inner helper (a bundler's keep-names
// shim would reference a `__name` that does not exist where the text runs).
//
// #888: contrast that was never measured, reported as clean. An unparseable
// colour reaches axe-core 4.13.0 in TWO shapes, and which one depends on where
// the colour sits in the text's element stack. Both MEASURED in Chromium, not
// inferred; `scripts/probe-axe-contrast.mjs` re-runs them:
//
//   1. The colour is the first opaque background behind the text (or the
//      text's own colour). axe catches the parse failure PER NODE and leaves
//      that node `incomplete` with `messageKey: "colorParse"` (the rejected
//      string in `data.colorParse`). The rule keeps running everywhere else.
//
//        band on one element : passes=1 incomplete=1 keys=["colorParse"]
//        same colour on body : passes=0 incomplete=2 keys=["colorParse"]
//        healthy control     : passes=2 incomplete=0 keys=[]
//
//      -> unparseableContrastNodes, reported as `contrast-unmeasured`.
//
//   2. The colour sits BENEATH an opaque background: a white CTA or card
//      inside a `bg-neutral-900` section, which is the starter's Hero. axe
//      finds the white first and stops looking for the background, but then
//      builds the stacking context for the blend, parses every element in the
//      stack without a catch, and THROWS. The whole rule is skipped for the
//      whole page: one `incomplete` entry carrying `error` ("Unable to parse
//      color "oklch(0.205 0 none)" Skipping color-contrast rule.") and an
//      `error-occurred` check, and zero contrast passes anywhere on the page.
//      This is the shape #888 reported ("0 contrast nodes where there should
//      have been 61").
//
//      -> reported as `rule-errored`, from axe's documented `incomplete[].error`,
//         with ruleErroredHelp naming the remedy.
//
// "colorParse" is the RIGHT per-node signal precisely because it means the
// browser understood the colour and axe did not: an instrument failure. The
// rule's other messageKeys (bgImage, bgGradient, imgNode, elmPartiallyObscured,
// shortTextContent, ...) are properties of the PAGE, where "axe cannot be sure"
// is the honest answer and not a defect, and a page with no text makes the rule
// inapplicable. None of those is reported.

/** The part of one axe check this reads. */
type AxeCheck = { data?: { messageKey?: unknown; colorParse?: unknown } | null } | null;

/** The part of one axe result node this reads. */
export type AxeCheckedNode = {
  html?: string;
  target?: unknown;
  any?: AxeCheck[];
  all?: AxeCheck[];
  none?: AxeCheck[];
};

/**
 * The `color-contrast` nodes axe left `incomplete` because it could not parse
 * a colour the browser had already resolved. Empty when there are none, when
 * the rule was inapplicable, and when every incomplete node is incomplete for a
 * reason that belongs to the page (a gradient, an image, an obscured box).
 */
export function unparseableContrastNodes<N extends AxeCheckedNode>(results: {
  incomplete?: Array<{ id: string; nodes?: N[] }>;
}): N[] {
  const rule = (results.incomplete ?? []).find((r) => r.id === "color-contrast");
  if (!rule) return [];
  return (rule.nodes ?? []).filter((n) =>
    [...(n.any ?? []), ...(n.all ?? []), ...(n.none ?? [])].some(
      (c) => !!c && !!c.data && c.data.messageKey === "colorParse",
    ),
  );
}

/**
 * The `contrast-unmeasured` finding's `help`, which is also its line in the CI
 * summary. One line, carrying the count (how blind the run was), the colour
 * axe rejected (what to change, up to two named) and the remedy: an alarm
 * without a remedy just gets muted.
 *
 * The remedy is the one #888 measured: give the token an explicit hue. At
 * chroma 0 the hue has no effect, and the rendered PNGs of
 * `oklch(0.205 0 none)` and `oklch(0.205 0 0)` are byte-identical; only axe can
 * tell them apart.
 */
export function contrastUnmeasuredHelp(nodes: AxeCheckedNode[]): string {
  const colours: string[] = [];
  for (const n of nodes) {
    for (const c of [...(n.any ?? []), ...(n.all ?? []), ...(n.none ?? [])]) {
      const value = c && c.data ? c.data.colorParse : undefined;
      if (typeof value === "string" && !colours.includes(value)) colours.push(value);
    }
  }
  const named =
    colours.length === 0
      ? ""
      : ` (${colours.slice(0, 2).join(", ")}${colours.length > 2 ? `, +${colours.length - 2} more` : ""})`;
  return (
    `${nodes.length} element(s) on a colour axe cannot parse${named}, so contrast was never` +
    " measured there — give the oklch() token an explicit hue (identical at chroma 0)"
  );
}

/**
 * The `rule-errored` finding's `help`: the rule and axe's own message, which
 * already names what it choked on. When that is a colour it could not parse
 * (shape 2 above: the whole rule was skipped for the whole page), the line
 * also carries the remedy, for the same reason contrastUnmeasuredHelp does.
 */
export function ruleErroredHelp(ruleId: string, message: string | undefined | null): string {
  const said = message || "no message from axe";
  const remedy = /Unable to parse colou?r/i.test(said)
    ? " — give the oklch() token an explicit hue (identical at chroma 0)"
    : "";
  return `axe could not run "${ruleId}": ${said}${remedy}`;
}
