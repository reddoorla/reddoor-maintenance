import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Page from "../../src/routes/+page.svelte";
import { renderCockpitHtml } from "../../../src/dashboard/fleet-render.js";
import { buildCockpitView } from "../../src/lib/cockpit/view.js";
import { canonical, bodyOf, renderPage } from "../_helpers/parity.js";
import { cases, NOW } from "./fixtures.js";

/**
 * `/`, ported (#582): the page renders what `renderCockpitHtml` did, line for
 * line in canonical form, for every verdict band and lane. Two things are
 * dropped on purpose and named here: the page's own nav (one link, to
 * /audits), which the shell's nav replaces, and the auth fragment, which the
 * shell renders. The old renderer reads the wall clock for every "Xm ago", so
 * the clock is pinned to the view's `now`.
 */

const OLD_ONLY = ["nav.top-nav", 'div[style^="float:right"]'];

const page = (model: Parameters<typeof buildCockpitView>[0]) =>
  renderPage(Page, { data: { view: buildCockpitView(model, NOW) } });

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

describe("/ parity with renderCockpitHtml", () => {
  for (const [name, model] of cases()) {
    it(name, () => {
      const before = canonical(bodyOf(renderCockpitHtml(model, "op@example.com")), OLD_ONLY);
      const after = canonical(page(model));
      expect(after).toEqual(before);
    });
  }

  it("the instrument sees a one-character difference", () => {
    const [, model] = cases()[2]!;
    const before = canonical(bodyOf(renderCockpitHtml(model)), OLD_ONLY);
    const after = canonical(page(model).replace("Open ▸", "Open ▹"));
    expect(after).not.toEqual(before);
  });
});
