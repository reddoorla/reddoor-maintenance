// Serialized into the a11y audit's generated Playwright spec with
// `Function.prototype.toString()`, like axe-results.ts: self-contained, no
// import, no module-scope identifier.
//
// WHY A BLEND-MODE CRASH IS "NOT MEASURED". axe-core 4.13 composites a text
// node's backdrop through a table of blend functions (`blendFunctions` in its
// color utilities) keyed by the computed `mix-blend-mode`. The table has no
// `plus-lighter`, which Chrome renders and Tailwind ships as
// `mix-blend-plus-lighter`, so the lookup yields undefined and the call throws
// `blendFunctions[blendMode] is not a function`. The throw skips the rule for
// the whole document, so vida-legacy-foundation's grain overlays cost the gate
// every contrast measurement on `/` and `/es`, and #916 then failed them as
// `rule-errored`. That is axe's gap, not the site's defect: the spec re-runs
// the rule with each crashing node excluded, so the rest of the page is
// measured, and names each excluded node as not measured. Only this one
// message shape is exempt; every other crash still fails.

/**
 * A crash the spec may re-run around: axe's missing-blend-function TypeError
 * and no other message, filed on a node of the page's own top-level document
 * that it can exclude. Not one: a crash with no node; one filed on the root
 * element (excluding the root would exclude the whole document, and the page
 * would pass having measured nothing); one inside a frame or a shadow root (a
 * target of more than one step), whose children reincludedChildren cannot
 * address. Those stay crashes, and the frame split decides them as before.
 */
export function isExcludableBlendCrash(crash: {
  message: string | null;
  nodes: Array<{ target?: unknown }>;
}): boolean {
  const target = crash.nodes[0]?.target;
  return (
    typeof crash.message === "string" &&
    /\bblendFunctions\[[^\]]*\] is not a function/.test(crash.message) &&
    Array.isArray(target) &&
    target.length === 1 &&
    typeof target[0] === "string" &&
    target[0] !== "html"
  );
}

/**
 * The element children of each excluded node, as selectors axe can include,
 * minus any child that is itself excluded.
 *
 * axe's exclude takes a node's whole subtree, and the node a crash is filed
 * on can be a wrapper with text of its own (a section, a div, the body), so
 * the text inside it would go unmeasured with no word. Including the children
 * again brings them back: in axe's context the deeper of an include and an
 * exclude wins. On a tie, the same element both included and excluded, the
 * include wins, which is why an excluded child is left out here rather than
 * excluded over a generic `> *`.
 *
 * Runs IN THE PAGE, on the top-level document.
 */
export function reincludedChildren(excluded: string[]): string[] {
  const hidden = excluded.map((selector) => document.querySelector(selector));
  const children: string[] = [];
  for (const selector of excluded) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const kids = Array.from(element.children);
    for (let i = 0; i < kids.length; i++) {
      if (!hidden.includes(kids[i] ?? null)) children.push(`${selector} > :nth-child(${i + 1})`);
    }
  }
  return children;
}

/**
 * The first `mix-blend-mode` axe-core 4.13 has no blend function for, on the
 * element, its ancestors, or any element whose box overlaps its box. Null when none
 * is found, which the summary words as "no function for this blend mode".
 *
 * Runs IN THE PAGE, on the element resolveTargetElement found.
 */
export function unsupportedBlendModeAt(element: Element | null): string | null {
  if (!element) return null;
  const known = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
  ];
  const view = element.ownerDocument.defaultView;
  if (!view) return null;
  const candidates: Element[] = [];
  for (let e: Element | null = element; e; e = e.parentElement) candidates.push(e);
  // Then every element whose box overlaps it. Not elementsFromPoint: that
  // skips `pointer-events: none`, which is how a decorative grain overlay is
  // written (vida's HeartHero).
  const box = element.getBoundingClientRect();
  for (const e of element.ownerDocument.querySelectorAll("*")) {
    const r = e.getBoundingClientRect();
    const overlaps =
      r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom;
    if (overlaps && !candidates.includes(e)) candidates.push(e);
  }
  for (const e of candidates) {
    const mode = view.getComputedStyle(e).mixBlendMode;
    if (mode && !known.includes(mode)) return mode;
  }
  return null;
}

/** One element axe could not measure for one rule, because of a blend mode. */
export type BlendUnmeasured = {
  route: string;
  rule: string;
  blendMode: string | null;
  target: unknown;
};

/**
 * The blend clause of the summary: how many elements, under which rule and
 * blend mode, on which routes. Empty when there are none, so a run without
 * one keeps its line byte-for-byte.
 */
export function describeBlendUnmeasured(records: BlendUnmeasured[]): string {
  const groups = new Map<
    string,
    { rule: string; mode: string | null; n: number; routes: Map<string, number> }
  >();
  for (const r of records) {
    const key = `${r.rule}\u0000${r.blendMode ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { rule: r.rule, mode: r.blendMode, n: 0, routes: new Map() };
      groups.set(key, g);
    }
    g.n += 1;
    g.routes.set(r.route, (g.routes.get(r.route) ?? 0) + 1);
  }
  return [...groups.values()]
    .map((g) => {
      const mode = g.mode ? `no "${g.mode}" blend mode` : "no function for this blend mode";
      const where = [...g.routes].map(([route, n]) => `${route} (${n})`).join(", ");
      return `${g.n} element(s) not measured for ${g.rule} — axe has ${mode}: ${where}`;
    })
    .join("; ");
}
