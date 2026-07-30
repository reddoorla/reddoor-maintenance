import { describe, it, expect } from "vitest";
import { renderSiteDashboardHtml } from "../../src/dashboard/render.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

/**
 * The approve button's visual states. These are string assertions over the rendered
 * stylesheet/script rather than a headless browser — the page ships as one self-contained
 * document, so "the rule is present and ordered correctly" is the honest thing to check
 * here. Parseability of the script itself is covered by inline-script-syntax.test.ts.
 */
const html = (): string =>
  renderSiteDashboardHtml(makeWebsiteRow(), [], [], null, new Date("2026-07-30T12:00:00Z"), null);

/** The stylesheet, as one string, for order-sensitive assertions. */
function styles(): string {
  return /<style>([\s\S]*?)<\/style>/.exec(html())![1]!;
}

function script(): string {
  return /<script>([\s\S]*?)<\/script>/.exec(html())![1]!;
}

/** Just the approve handler. The page's other handlers (override status, site-details)
 *  legitimately use innerHTML, so an assertion about THIS handler has to be scoped. */
function approveHandler(): string {
  const s = script();
  return s.slice(
    s.indexOf('querySelectorAll("button.approve")'),
    s.indexOf('querySelectorAll("button.override-toggle")'),
  );
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

  it("is applied by the click handler on a successful approve", () => {
    expect(script()).toContain('b.classList.add("is-approved")');
  });
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
    const rule = styles()
      .split("\n")
      .find((l) => l.includes("prefers-reduced-motion"));
    expect(rule, "no prefers-reduced-motion rule at all").toBeDefined();
    expect(rule).toContain("button.approve.is-loading::after");
    // A frozen ring reads as a hung request — the animation must still RUN, just slower.
    // `animation: none` here would be the tempting-but-wrong reading of the media query.
    expect(rule).toContain("animation-duration: 2.4s");
    expect(rule).not.toContain("animation: none");
  });

  it("is raised on click and cleared on every exit path", () => {
    const s = script();
    expect(s).toContain('b.classList.add("is-loading")');
    expect(s).toContain('b.setAttribute("aria-busy", "true")');
    // The clears live in a finally, so neither the ok, the blocked, nor the thrown path
    // can strand the button spinning.
    expect(s).toMatch(
      /finally \{\s*b\.classList\.remove\("is-loading"\);\s*b\.removeAttribute\("aria-busy"\);/,
    );
  });

  it("does not inject markup for the spinner", () => {
    // The approve handler is deliberately textContent/title-only so server strings can
    // never become HTML; a CSS pseudo-element keeps that property. Match an assignment,
    // not the bare word — the handler's own comment mentions innerHTML to explain why it
    // avoids it, and a substring check would flag that comment as a violation.
    expect(approveHandler()).not.toMatch(/\.innerHTML\s*=/);
    expect(approveHandler()).toContain("textContent");
  });
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
