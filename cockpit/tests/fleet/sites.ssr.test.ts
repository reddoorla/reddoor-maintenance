import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Page from "../../src/routes/fleet/+page.svelte";
import { buildSitesView } from "../../src/lib/cockpit/view.js";
import { buildFleetTableModel, parseFleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import { canonical, renderPage } from "../_helpers/parity.js";
import { cases, NOW } from "../home/fixtures.js";

/**
 * Sites (`/fleet`) for every case `/`'s snapshots use (#672 step 3). The browse
 * panel's cards and the Recently and Archived lanes moved here from `/`, so their
 * markup (pills, chips, badges, accept keys, deploy states, the Setup checklist,
 * hostile strings) is pinned here now. Unlike the `/` snapshots, these were
 * written after the move, not under parity with the old renderer; the per-field
 * rules behind them are the legacy suite's, which runs against this page.
 */
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

describe("Sites for each cockpit case", () => {
  for (const [name, model] of cases()) {
    it(name, () => {
      const table = buildFleetTableModel(
        [...model.cards.map((c) => c.site)],
        parseFleetTableQuery(new URLSearchParams()),
      );
      const html = renderPage(Page, { data: { model: table, sites: buildSitesView(model, NOW) } });
      expect(canonical(html)).toMatchSnapshot();
    });
  }
});
