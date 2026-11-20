import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Page from "../../src/routes/fleet/+page.svelte";
import { buildSitesView } from "../../src/lib/cockpit/view.js";
import { buildFleetTableModel, parseFleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import { parse, type HTMLElement } from "node-html-parser";
import { render } from "svelte/server";
import { canonical, renderPage } from "../_helpers/parity.js";
import { cases, NOW } from "../home/fixtures.js";
import { load } from "../../src/routes/fleet/+page.js";
import {
  allSitesHref,
  CHECK_COLUMN,
  FACT_COLUMNS,
  showHiddenHref,
  sortHref,
} from "../../src/routes/fleet/view.js";
import { healthy, snapshot, FRESH, STALE, NOW as OVERVIEW_NOW } from "../overview/fixtures.js";
import {
  CHECK_SLUGS,
  HEALTH_CHECK_NAMES,
  overviewFromSnapshot,
} from "../../src/lib/overview/view.js";

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
    expect(text(checkLine(doc)!)).toContain("1 more neither passes nor fails");
  });

  it("reads the whole line with a space before each dot", async () => {
    const doc = await page("/fleet?check=certificate");
    expect(text(checkLine(doc)!)).toBe(
      "Failing Certificate: 2 sites · 1 more neither passes nor fails · Show all sites",
    );
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
    // The text, not only the class: one visually hidden "(filtered)" in the whole header.
    const hidden = doc.querySelectorAll("table.fleet thead .visually-hidden");
    expect(hidden.map(text)).toEqual(["(filtered)"]);
  });

  it("gives a check with no failing site an empty list and a count of 0", async () => {
    const doc = await page("/fleet?check=security");
    expect(rowNames(doc)).toEqual([]);
    expect(text(checkLine(doc)!)).toContain("Failing Security: 0 sites");
  });

  it("says nothing of unread sites when none is unread", async () => {
    const doc = await page("/fleet?check=security");
    expect(text(checkLine(doc)!)).toBe("Failing Security: 0 sites · Show all sites");
  });

  it("names an unknown check, shows the full table, and prints the slug as text", async () => {
    const doc = await page("/fleet?check=nope");
    // 18 maintained sites and Lima (launching, visible); Xray (archived) stays hidden by default.
    expect(rowNames(doc)).toHaveLength(19);
    expect(text(checkLine(doc)!)).toBe('No check is called "nope". Showing all sites.');
    expect(doc.querySelector("input[name='check']")).toBeNull();
    // The unknown slug is dropped, not carried: no sort link keeps a check parameter.
    const sortLinks = doc
      .querySelectorAll("table.fleet thead th a")
      .map((a) => a.getAttribute("href")!);
    expect(sortLinks.length).toBeGreaterThan(0);
    for (const href of sortLinks) expect(href).not.toContain("check");
    const hostile = await page("/fleet?check=%3Cscript%3E");
    const line = checkLine(hostile)!;
    expect(line.querySelector("script")).toBeNull();
    expect(text(line)).toBe('No check is called "<script>". Showing all sites.');
  });

  // T1: a failed form test is not a failing site; it is one of the three unknown kinds, and the
  // line counts all three (a test-failed site, a site with no verdict, one not checked lately).
  const FORM_SNAP = snapshot({
    sites: [
      healthy({ id: "recA", name: "Acme" }),
      healthy({ id: "recB", name: "Bravo", formE2eOk: "fail" }),
      healthy({ id: "recC", name: "Charlie", formE2eOk: null }),
      healthy({ id: "recD", name: "Delta", formE2eOk: null, formE2eCheckedAt: STALE }),
    ],
  });
  it("lists no site for a failed form test, and counts each unknown kind beside the empty list", async () => {
    const doc = await page("/fleet?check=contact-form", FORM_SNAP);
    expect(rowNames(doc)).toEqual([]);
    expect(text(checkLine(doc)!)).toBe(
      "Failing Contact form: 0 sites · 3 more neither pass nor fail · Show all sites",
    );
  });

  // The table is not rendered for a filter with no rows, and the Contact form filter never has a
  // row (a failed form test is not a failure), so its Forms header is never on screen. The mapping
  // is what can be pinned: the Contact form check marks the Forms column.
  it("maps the Contact form check to the Forms column", () => {
    expect(CHECK_COLUMN["Contact form"]).toBe("Forms");
    expect(FACT_COLUMNS).toContain("Forms");
  });

  // T2: one failing site per check. Each check's rows are the sites the overview's bar counts as
  // failing, and the line's unread count is the bar's unknown count. Contact form cannot fail
  // (a failed form test is not a failure), so its list is empty.
  const HEALTH_SNAP = snapshot({
    sites: [
      healthy({ id: "recA", name: "Acme" }),
      healthy({ id: "recL", name: "Lima", urlResolves: "fail", urlStatus: "404" }),
      healthy({ id: "recC", name: "Certo", certDaysRemaining: 9 }),
      healthy({ id: "recD", name: "Delta", deployStatus: "error" }),
      healthy({ id: "recS", name: "Sierra", securityVulnsCritical: 1 }),
      healthy({
        id: "recG",
        name: "Golf",
        a11yViolations: 3,
        a11yRoutesScanned: 10,
        a11yRoutesTotal: 10,
        a11yCheckedAt: FRESH,
      }),
      healthy({ id: "recB", name: "Bravo", smokeOk: "fail", lastSmokeAt: FRESH }),
      healthy({ id: "recF", name: "Foxtrot", formE2eOk: null }),
    ],
  });
  const FAILING: Record<string, string[]> = {
    Live: ["Lima"],
    Certificate: ["Certo"],
    Deploy: ["Delta"],
    "Contact form": [],
    Security: ["Sierra"],
    Accessibility: ["Golf"],
    "Build + tests": ["Bravo"],
  };
  it("lists, for each check, the sites its bar counts as failing, and the unread count is the bar's unknown count", async () => {
    const health = overviewFromSnapshot(HEALTH_SNAP, OVERVIEW_NOW).health;
    for (const name of HEALTH_CHECK_NAMES) {
      const doc = await page(`/fleet?check=${CHECK_SLUGS[name]}`, HEALTH_SNAP);
      const bar = health.checks.find((c) => c.name === name)!;
      expect(rowNames(doc), name).toEqual(FAILING[name]);
      // The plural: one site reads "1 site", never "1 sites" (a word boundary, not a substring).
      if (FAILING[name]!.length === 1) expect(text(checkLine(doc)!), name).toMatch(/: 1 site(?!s)/);
      expect(bar.fail, name).toBe(FAILING[name]!.length);
      const more = text(checkLine(doc)!).match(/(\d+) more /);
      expect(more ? Number(more[1]) : 0, name).toBe(bar.unknown);
    }
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
