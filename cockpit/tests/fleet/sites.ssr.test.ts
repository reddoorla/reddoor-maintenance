import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Page from "../../src/routes/fleet/+page.svelte";
import { buildSitesView } from "../../src/lib/cockpit/view.js";
import { buildFleetTableModel, parseFleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import { parse, type HTMLElement } from "node-html-parser";
import { render } from "svelte/server";
import { canonical, renderPage } from "../_helpers/parity.js";
import { cases, NOW } from "../home/fixtures.js";
import { load } from "../../src/routes/fleet/+page.js";
import { allSitesHref, showHiddenHref, sortHref } from "../../src/routes/fleet/view.js";
import { healthy, snapshot, STALE, NOW as OVERVIEW_NOW } from "../overview/fixtures.js";

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

/** P1-87 PR 8b: `/fleet?check=<slug>` lists only the maintained sites that failed that check.
 *  Fixture: Bravo and Charlie fail Certificate, Delta could not be read (a stale check), 15
 *  sites pass. Lima is launching: visible with a card, not maintained, and would fail, so it must
 *  not be listed; Xray is archived and would fail, so it must not be listed either. */
describe("Sites filtered to one health check (P1-87, PR 8b)", () => {
  beforeAll(() => {
    vi.setSystemTime(OVERVIEW_NOW);
  });
  const CHECK_SNAP = snapshot({
    sites: [
      healthy({ id: "recA", name: "Acme" }),
      healthy({ id: "recB", name: "Bravo", certDaysRemaining: 9 }),
      healthy({ id: "recC", name: "Charlie", certDaysRemaining: 9 }),
      healthy({ id: "recD", name: "Delta", domainCheckedAt: STALE }),
      ...Array.from({ length: 14 }, (_, i) => healthy({ id: `recP${i}`, name: `Pass ${i}` })),
      healthy({ id: "recL", name: "Lima", status: "launching", certDaysRemaining: 9 }),
      healthy({ id: "recX", name: "Xray", status: "archived", certDaysRemaining: 9 }),
    ],
  });

  type Data = Parameters<typeof Page>[1]["data"];
  async function page(href: string, snap = CHECK_SNAP): Promise<HTMLElement> {
    const url = new URL(href, "https://dash.example");
    const data = (await (load as unknown as (e: unknown) => Promise<Data>)({
      url,
      parent: async () => ({ snapshot: snap, failure: null, clockOffsetMs: 0 }),
    })) as Data;
    return parse(render(Page, { props: { data } }).body);
  }
  const text = (el: HTMLElement) => el.textContent.replace(/\s+/g, " ").trim();
  const rowNames = (doc: HTMLElement) =>
    doc.querySelectorAll("tr.fleet-row").map((tr) => text(tr.querySelector("td")!));
  const checkLine = (doc: HTMLElement) => doc.querySelector(".check-filter");

  it("lists exactly the sites that failed the check, and counts the unread ones beside them", async () => {
    const doc = await page("/fleet?check=certificate");
    expect(rowNames(doc)).toEqual(["Bravo", "Charlie"]);
    expect(text(checkLine(doc)!)).toContain("Failing Certificate: 2 sites");
    expect(text(checkLine(doc)!)).toContain("1 more could not be read");
  });

  it("keeps the check in every sort link and in the status form's hidden input", async () => {
    const doc = await page("/fleet?check=certificate");
    const sortHrefs = doc
      .querySelectorAll("table.fleet thead th a")
      .map((a) => a.getAttribute("href")!);
    expect(sortHrefs.length).toBeGreaterThan(0);
    for (const href of sortHrefs) expect(href).toContain("check=certificate");
    const input = doc.querySelector('form.filters input[name="check"]');
    expect(input?.getAttribute("value")).toBe("certificate");
  });

  it("marks the filtered column, and only that one", async () => {
    const doc = await page("/fleet?check=certificate");
    const marked = doc.querySelectorAll("table.fleet thead th.filtered-col");
    expect(marked.map(text)).toEqual(["Certificate (filtered)"]);
  });

  it("gives a check with no failing site an empty list and a count of 0", async () => {
    const doc = await page("/fleet?check=security");
    expect(rowNames(doc)).toEqual([]);
    expect(text(checkLine(doc)!)).toContain("Failing Security: 0 sites");
  });

  it("names an unknown check, shows the full table, and prints the slug as text", async () => {
    const doc = await page("/fleet?check=nope");
    // 18 maintained sites and Lima (launching, visible); Xray (archived) stays hidden by default.
    expect(rowNames(doc)).toHaveLength(19);
    expect(text(checkLine(doc)!)).toBe('No check is called "nope". Showing all sites.');
    expect(doc.querySelector("input[name='check']")).toBeNull();
    const hostile = await page("/fleet?check=%3Cscript%3E");
    const line = checkLine(hostile)!;
    expect(line.querySelector("script")).toBeNull();
    expect(text(line)).toBe('No check is called "<script>". Showing all sites.');
  });
});

describe("the Sites links keep or drop the check (P1-87, PR 8b)", () => {
  const model = (qs: string) =>
    buildFleetTableModel([], parseFleetTableQuery(new URLSearchParams(qs)), new Map());

  it("keeps the check in the sort links and in the hidden-archived link", () => {
    const m = model("check=certificate&sort=perf&dir=desc&status=maintenance&q=a");
    expect(sortHref(m, "name")).toContain("check=certificate");
    expect(showHiddenHref(m)).toContain("check=certificate");
  });

  it("drops the check from Show all sites and keeps the sort, status and search", () => {
    const m = model("check=certificate&sort=perf&dir=desc&status=maintenance&q=a");
    expect(allSitesHref(m)).toBe("/fleet?sort=perf&dir=desc&status=maintenance&q=a");
  });
});
