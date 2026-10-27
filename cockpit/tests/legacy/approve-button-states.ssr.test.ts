import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * The approve button's visual states, as string assertions over the site page's
 * stylesheet: "the rule is present and ordered correctly" is the honest thing to
 * check without a browser. Which class the click handler applies, and when, is
 * executed in the DOM tests (cockpit/tests/site/site.dom.test.ts) since the
 * cockpit's port (#582).
 */
/** The page's stylesheet as one string, for order-sensitive assertions: the
 *  shared rules, then the site page's own, as the page loads them. */
function styles(): string {
  return ["../../src/lib/base.css", "../../src/routes/s/[slug]/site.css"]
    .map((f) => readFileSync(new URL(f, import.meta.url), "utf8"))
    .join("\n");
}

describe("approve button — approved state", () => {
  it("renders a darker green than the idle button", () => {
    const css = styles();
    expect(css).toContain("button.approve.is-approved");
    expect(css).toMatch(/button\.approve\.is-approved[^}]*background: #14663c/);
    // Idle stays the original green — the darker shade must be a distinct state,
    // not a recolour of the button at rest.
    expect(css).toMatch(/button\.approve \{[^}]*background: #2c7/);
  });

  it("beats the :disabled dimming so 'Approved' is not rendered washed out", () => {
    const css = styles();
    // The button stays disabled after a successful approve, so .is-approved must both
    // come AFTER the :disabled rule and reset its opacity, or the terminal state reads
    // as 60%-opaque and unfinished.
    expect(css).toMatch(/button\.approve\.is-approved[^}]*opacity: 1/);
    expect(css.indexOf("button.approve.is-approved")).toBeGreaterThan(
      css.indexOf("button.approve:disabled"),
    );
  });

  // "is applied by the click handler on a successful approve — to every twin": its behaviour is the DOM tests' now (site.dom: approve twins).
});

describe("approve button — spinner", () => {
  it("defines a spinner pseudo-element and its keyframes", () => {
    const css = styles();
    expect(css).toMatch(/button\.approve\.is-loading::after[^}]*animation: approve-spin/);
    expect(css).toContain("@keyframes approve-spin");
  });

  it("keeps the button width stable while in flight", () => {
    // Transparent label rather than removed text: the button must not resize mid-request
    // and reflow the pending row.
    expect(styles()).toMatch(/button\.approve\.is-loading \{[^}]*color: transparent/);
  });

  it("slows the spin under prefers-reduced-motion instead of freezing it", () => {
    // The whole @media block: the stylesheet is formatted one declaration a line.
    const css = styles();
    const at = css.indexOf("@media (prefers-reduced-motion");
    const rule = at < 0 ? undefined : css.slice(at, css.indexOf("\n}", at) + 2);
    expect(rule, "no prefers-reduced-motion rule at all").toBeDefined();
    expect(rule).toContain("button.approve.is-loading::after");
    // A frozen ring reads as a hung request — the animation must still RUN, just slower.
    // `animation: none` here would be the tempting-but-wrong reading of the media query.
    expect(rule).toContain("animation-duration: 2.4s");
    expect(rule).not.toContain("animation: none");
  });

  // "is raised on click and cleared on every exit path": its behaviour is the DOM tests' now (site.dom: the approve spinner).
  // "does not inject markup for the spinner": its behaviour is the DOM tests' now (the Svelte port sets no innerHTML).
});

describe("dashboard buttons — hover and focus states", () => {
  const BUTTONS = ["approve", "override-toggle", "override-submit", "trigger-renovate"];

  it.each(BUTTONS)("button.%s has a hover state", (cls) => {
    expect(styles()).toContain(`button.${cls}:hover`);
  });

  it.each(BUTTONS)("button.%s has a keyboard focus state", (cls) => {
    expect(styles()).toContain(`button.${cls}:focus-visible`);
  });

  it("does not offer hover feedback on disabled buttons", () => {
    const css = styles();
    for (const cls of ["approve", "override-submit", "trigger-renovate"]) {
      expect(css).toContain(`button.${cls}:hover:not(:disabled)`);
    }
  });
});
