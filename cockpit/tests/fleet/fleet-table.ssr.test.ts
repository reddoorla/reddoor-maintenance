import { describe, it, expect } from "vitest";
import { buildSitesView } from "../../src/lib/cockpit/view.js";
import { buildCockpitModel } from "../../../src/dashboard/fleet-cockpit.js";

import Page from "../../src/routes/fleet/+page.svelte";
import { buildFleetTableModel, NO_STATUS_FILTER } from "../../../src/dashboard/fleet-table.js";
import type { FleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";
import { canonical, renderPage } from "../_helpers/parity.js";

/**
 * Since the cutover (#582) the old renderer is gone. Each case's markup is
 * pinned by a snapshot written while parity with the old renderer held (commit
 * "freeze each page's canonical markup as a snapshot, verified by parity"), so
 * each snapshot was what the old page rendered. Since #672 step 3 they also
 * carry the Health column and the signal chips, re-baselined after the merge.
 * Keep these test names: the snapshots are keyed on them.
 */
const BASE = "https://reddoor-maintenance.netlify.app";
const NOW = new Date("2026-06-11T12:00:00Z");
const DEFAULT_QUERY: FleetTableQuery = { sort: "name", dir: "asc", status: "", q: "" };

function sites() {
  return [
    makeWebsiteRow({
      id: "r1",
      name: "Acme Co",
      url: "https://acme.example.com",
      status: "maintained",
      pScore: 87,
      rScore: 95,
      bpScore: 90,
      seoScore: 100,
      nextMaintenanceAt: "2026-09-01",
      nextTestingAt: "2026-10-01",
      lastLighthouseAuditAt: "2026-08-20T18:00:00Z",
    }),
    makeWebsiteRow({ id: "r2", name: "Beachfront", status: "archived", statusRaw: "legacy" }),
    makeWebsiteRow({ id: "r3", name: "Untracked", status: null, url: "javascript:alert(1)" }),
    makeWebsiteRow({
      id: "r4",
      name: `<b>"Quote" & 'tick'</b>`,
      url: "https://x.example/?a=1&b=2",
    }),
  ];
}

const CASES: Array<[string, Partial<FleetTableQuery>, ReturnType<typeof sites>]> = [
  ["default view", {}, sites()],
  ["sorted by perf, descending", { sort: "perf", dir: "desc" }, sites()],
  ["status filter plus search", { status: "maintained", q: "acme" }, sites()],
  ["the no-status sentinel", { status: NO_STATUS_FILTER }, sites()],
  ["a status no site carries", { status: "retired" }, sites()],
  ["no rows", { q: "zzz" }, sites()],
  ["an empty fleet", {}, []],
];

describe("/fleet parity with renderFleetTableHtml", () => {
  for (const [name, query, rows] of CASES) {
    it(name, () => {
      const model = buildFleetTableModel(rows, { ...DEFAULT_QUERY, ...query });
      // Each row's health, from the cockpit model of the same rows (#672 step 3).
      const sitesView = buildSitesView(
        buildCockpitModel(rows, [], {}, BASE, NOW, [], null, [], 0, new Map(), new Map()),
        NOW,
      );
      const after = canonical(renderPage(Page, { data: { model, sites: sitesView } }));
      expect(after).toMatchSnapshot();
    });
  }
});
