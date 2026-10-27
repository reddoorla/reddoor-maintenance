import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Page from "../../src/routes/triage/+page.svelte";
import { buildCockpitView } from "../../src/lib/cockpit/view.js";
import { canonical, renderPage } from "../_helpers/parity.js";
import { cases, NOW } from "./fixtures.js";

/**
 * Since the cutover (#582) the old renderer is gone. Each case's markup is
 * pinned by a snapshot written while parity with the old renderer held (commit
 * "freeze each page's canonical markup as a snapshot, verified by parity"), so
 * each snapshot is what the old page rendered. Keep these test names: the
 * snapshots are keyed on them.
 */
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
      const after = canonical(page(model));
      expect(after).toMatchSnapshot();
    });
  }
});
