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
import type { FleetEvent } from "../../../src/db/fleet-events.js";
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
    // Nor is the known check's line a live region: it is read with the page.
    expect(checkLine(doc)!.hasAttribute("role")).toBe(false);
    expect(checkLine(doc)!.hasAttribute("aria-live")).toBe(false);
  });

  it("names an unknown check, shows the full table, and prints the slug as text", async () => {
    const doc = await page("/fleet?check=nope");
    // 18 maintained sites and Lima (launching, visible); Xray (archived) stays hidden by default.
    expect(rowNames(doc)).toHaveLength(19);
    expect(text(checkLine(doc)!)).toBe('No check is called "nope". Showing all sites.');
    // Not a live region: the line is read on load, and a role would announce it again.
    expect(checkLine(doc)!.hasAttribute("role")).toBe(false);
    expect(checkLine(doc)!.hasAttribute("aria-live")).toBe(false);
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
  // #2185: the count is the fleet's; when the status form or the search leaves fewer rows, the
  // line also says how many are shown, so it is true of the rows under it.
  it.each([
    ["/fleet?check=certificate&status=archived", "Failing Certificate: 2 sites, 0 shown"],
    ["/fleet?check=certificate&q=zzz", "Failing Certificate: 2 sites, 0 shown"],
    ["/fleet?check=certificate&q=bra", "Failing Certificate: 2 sites, 1 shown"],
  ])("%s says how many of the failing sites are shown", async (href, line) => {
    const doc = await page(href);
    expect(text(checkLine(doc)!)).toContain(line);
  });

  it("says nothing of shown when every failing site is a row", async () => {
    const doc = await page("/fleet?check=certificate");
    expect(text(checkLine(doc)!)).not.toContain("shown");
  });

  // #2186: the title names the check, so the route announcer reads it on arrival.
  async function title(href: string): Promise<string> {
    const url = new URL(href, "https://dash.example");
    const data = (await (load as unknown as (e: unknown) => Promise<Data>)({
      url,
      parent: async () => ({ snapshot: CHECK_SNAP, failure: null, clockOffsetMs: 0 }),
    })) as Data;
    return text(parse(render(Page, { props: { data } }).head).querySelector("title")!);
  }

  it("titles the page with the check in force, and leaves the plain title otherwise", async () => {
    expect(await title("/fleet?check=certificate")).toBe(
      "Failing Certificate · Sites — Reddoor maintenance",
    );
    expect(await title("/fleet")).toBe("Sites — Reddoor maintenance");
    expect(await title("/fleet?check=nope")).toBe("Sites — Reddoor maintenance");
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

/** P1-87 PR 9, review T9: `/fleet`'s load hands the snapshot's deploys to the Recently lane. A
 *  deploy with no merge before it must reach the page through `load`, not only through the view. */
describe("/fleet's Recently lane shows the snapshot's deploys through its load (P1-87, PR 9, T9)", () => {
  beforeAll(() => {
    vi.setSystemTime(OVERVIEW_NOW);
  });
  type Data = Parameters<typeof Page>[1]["data"];

  it("shows a deploy with no merge on it as Deploy published", async () => {
    const deploy: FleetEvent = {
      id: "site_deployed:recA:1",
      ts: "2026-10-27T17:00:00.000Z",
      type: "site_deployed",
      siteId: "recA",
      siteName: "Acme",
      summary: "Deploy published",
      data: null,
    };
    const data = (await (load as unknown as (e: unknown) => Promise<Data>)({
      url: new URL("/fleet", "https://dash.example"),
      parent: async () => ({
        snapshot: snapshot({ feedDeploys: [deploy] }),
        failure: null,
        clockOffsetMs: 0,
      }),
    })) as Data;
    const html = render(Page, { props: { data } }).body;
    expect(html).toContain("Deploy published");
    expect(html).toContain("Recently (1)");
  });
});

/** P1-87 PR 9, review T12: `/fleet`'s load windows the snapshot's event and deploy at the page's
 *  own now, not at the snapshot's takenAt. A page read two days after its snapshot must drop the
 *  event and the deploy, which were inside the window when the snapshot was taken. */
describe("/fleet's Recently lane windows at the page's now, not the snapshot's time (P1-87, PR 9, T12)", () => {
  type Data = Parameters<typeof Page>[1]["data"];
  const SNAP_AT = "2026-11-17T18:00:00.000Z";
  const EVENT_TS = "2026-11-11T12:00:00.000Z";
  const EVENT_SUMMARY = "cleared 2 critical/high vulns";
  const DEPLOY_SUMMARY = "Deploy published";

  const takenSnapshot = () =>
    snapshot({
      takenAt: SNAP_AT,
      recentEvents: [
        {
          id: "vuln_cleared:recA:1",
          ts: EVENT_TS,
          type: "vuln_cleared",
          siteId: "recA",
          siteName: "Caltex",
          summary: EVENT_SUMMARY,
          data: { from: 2 },
        },
      ],
      feedDeploys: [
        {
          id: `site_deployed:recA:${EVENT_TS}`,
          ts: EVENT_TS,
          type: "site_deployed",
          siteId: "recA",
          siteName: "Caltex",
          summary: DEPLOY_SUMMARY,
          data: null,
        },
      ],
    });

  async function renderAt(systemTime: string): Promise<string> {
    vi.setSystemTime(new Date(systemTime));
    const data = (await (load as unknown as (e: unknown) => Promise<Data>)({
      url: new URL("/fleet", "https://dash.example"),
      parent: async () => ({ snapshot: takenSnapshot(), failure: null, clockOffsetMs: 0 }),
    })) as Data;
    return render(Page, { props: { data } }).body;
  }

  afterAll(() => {
    vi.setSystemTime(OVERVIEW_NOW);
  });

  it("instrument: read at the snapshot's own time, both the event and the deploy show", async () => {
    const html = await renderAt(SNAP_AT);
    expect(html).toContain(EVENT_SUMMARY);
    expect(html).toContain(DEPLOY_SUMMARY);
  });

  it("drops both two days after the snapshot, because the window is at the page's now", async () => {
    const html = await renderAt("2026-11-19T18:00:00.000Z");
    expect(html).not.toContain(EVENT_SUMMARY);
    expect(html).not.toContain(DEPLOY_SUMMARY);
  });
});

/** #2202 and #2203: the Recently lane's window, at its edge and under a clock offset. An event
 *  and a deploy at the same time must both show or both go: they share one window. */
describe("/fleet's Recently lane: the window's inclusive edge and the page's clock offset", () => {
  type Data = Parameters<typeof Page>[1]["data"];
  const EVENT_SUMMARY = "cleared 2 critical/high vulns";
  const DEPLOY_SUMMARY = "Deploy published";
  const WEEK = 7 * 86_400_000;

  const snapWith = (takenAt: string, ts: string) =>
    snapshot({
      takenAt,
      recentEvents: [
        {
          id: "vuln_cleared:recA:edge",
          ts,
          type: "vuln_cleared",
          siteId: "recA",
          siteName: "Caltex",
          summary: EVENT_SUMMARY,
          data: { from: 2 },
        },
      ],
      feedDeploys: [
        {
          id: `site_deployed:recA:${ts}`,
          ts,
          type: "site_deployed",
          siteId: "recA",
          siteName: "Caltex",
          summary: DEPLOY_SUMMARY,
          data: null,
        },
      ],
    });

  async function renderWith(
    systemTime: string,
    takenAt: string,
    ts: string,
    clockOffsetMs: number,
  ): Promise<string> {
    vi.setSystemTime(new Date(systemTime));
    const data = (await (load as unknown as (e: unknown) => Promise<Data>)({
      url: new URL("/fleet", "https://dash.example"),
      parent: async () => ({ snapshot: snapWith(takenAt, ts), failure: null, clockOffsetMs }),
    })) as Data;
    return render(Page, { props: { data } }).body;
  }

  afterAll(() => {
    vi.setSystemTime(OVERVIEW_NOW);
  });

  const AT = "2026-11-17T18:00:00.000Z";

  // #2202: `>= since`, the same inclusive bound the recent events get.
  it("shows the event and the deploy exactly 7 days old", async () => {
    const html = await renderWith(AT, AT, new Date(Date.parse(AT) - WEEK).toISOString(), 0);
    expect(html).toContain(EVENT_SUMMARY);
    expect(html).toContain(DEPLOY_SUMMARY);
    expect(html).toContain("Recently (2)");
  });

  it("shows neither 1 ms older than that", async () => {
    const html = await renderWith(AT, AT, new Date(Date.parse(AT) - WEEK - 1).toISOString(), 0);
    expect(html).not.toContain(EVENT_SUMMARY);
    expect(html).not.toContain(DEPLOY_SUMMARY);
  });

  // #2203: a browser clock 3 days ahead of the server's. The page's now is
  // Date.now() + clockOffsetMs = 2026-11-17T18:00Z, so both rows, 5.25 days old, show.
  it("windows both rows at Date.now() + clockOffsetMs, not at the machine's clock", async () => {
    const html = await renderWith(
      "2026-11-20T18:00:00.000Z",
      AT,
      "2026-11-12T12:00:00.000Z",
      -3 * 86_400_000,
    );
    expect(html).toContain(EVENT_SUMMARY);
    expect(html).toContain(DEPLOY_SUMMARY);
    expect(html).toContain("Recently (2)");
  });
});
