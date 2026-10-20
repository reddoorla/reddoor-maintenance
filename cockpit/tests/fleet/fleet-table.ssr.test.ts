import { describe, it, expect } from "vitest";
import Page from "../../src/routes/fleet/+page.svelte";
import { renderFleetTableHtml } from "../../../src/dashboard/fleet-table-render.js";
import { buildFleetTableModel, NO_STATUS_FILTER } from "../../../src/dashboard/fleet-table.js";
import type { FleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";
import { canonical, bodyOf, renderPage } from "../_helpers/parity.js";

/**
 * /fleet, ported (#582): the page renders what the old string renderer did,
 * line for line in canonical form. The only intended difference is the shell:
 * the old page's own "← Fleet home" link and auth fragment give way to the
 * shared nav, which the layout renders and these page renders do not include.
 */

const OLD_ONLY = ["a.home", 'div[style^="float:right"]'];
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
      const before = canonical(bodyOf(renderFleetTableHtml(model, "op@example.com")), OLD_ONLY);
      const after = canonical(renderPage(Page, { data: { model } }));
      expect(after).toEqual(before);
    });
  }

  it("the instrument sees a one-character difference", () => {
    const model = buildFleetTableModel(sites(), DEFAULT_QUERY);
    const before = canonical(bodyOf(renderFleetTableHtml(model)), OLD_ONLY);
    const after = canonical(
      renderPage(Page, { data: { model } }).replace("Fleet table", "Fleet tabel"),
    );
    expect(after).not.toEqual(before);
  });
});
