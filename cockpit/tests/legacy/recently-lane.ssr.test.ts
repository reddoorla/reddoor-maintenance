import { describe, it, expect } from "vitest";
import { renderCockpitHtml, renderFleetTableHtml, renderSitesHtml } from "./render.js";
import { buildCockpitModel } from "../../../src/dashboard/fleet-cockpit.js";
import type { FleetEvent } from "../../../src/db/fleet-events.js";
import { cockpitModelFromSnapshot, deploysToShow } from "../../../src/dashboard/snapshot-views.js";
import { buildSitesView } from "../../src/lib/cockpit/view.js";
import { buildFleetTableModel, parseFleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import { snapshot } from "../overview/fixtures.js";

function modelWith(events: FleetEvent[], now: Date = new Date()) {
  return buildCockpitModel([], [], {}, "https://d.test", now, [], events);
}

describe("renderRecentlyLane (via renderCockpitHtml)", () => {
  it("renders a collapsed details.recently with a count and per-type icons", () => {
    const html = renderSitesHtml(
      modelWith([
        {
          id: "pr_automerged:reddoorla/caltex#14",
          ts: "2026-06-24T09:00:00.000Z",
          type: "pr_automerged",
          siteId: "recC",
          siteName: "Caltex",
          summary: "auto-merged vite→7.3.5",
          data: { url: "https://github.com/reddoorla/caltex/pull/14" },
        },
        {
          id: "fleet_swept:security:2026-06-25",
          ts: "2026-06-25T07:00:00.000Z",
          type: "fleet_swept",
          siteId: null,
          siteName: null,
          summary: "security-swept 11 sites",
          data: null,
        },
      ]),
    );
    expect(html).toContain('<details class="recently">');
    expect(html).toContain("Recently (2)");
    // PR row links externally; fleet_swept row has no link
    expect(html).toContain('href="https://github.com/reddoorla/caltex/pull/14"');
    expect(html).toContain("Caltex");
  });

  it("links a site-scoped non-PR event to /s/<slug>", () => {
    const html = renderSitesHtml(
      modelWith([
        {
          id: "vuln_cleared:recC:2026-06-25",
          ts: "2026-06-25T07:00:00.000Z",
          type: "vuln_cleared",
          siteId: "recC",
          siteName: "Caltex",
          summary: "cleared 2 critical/high vulns",
          data: { from: 2 },
        },
      ]),
    );
    expect(html).toContain('href="/s/caltex"');
  });

  it("renders nothing when there are no recent events", () => {
    const html = renderCockpitHtml(modelWith([]));
    expect(html).not.toContain('class="recently"');
  });
});

// P1-87 PR 9, review C1: the Recently lane takes the overview's deploy rule. The recent read
// no longer carries deploys; the snapshot's `feedDeploys` (already `deploysToShow`-filtered)
// sit beside the recent events, newest first, under the lane's cut.
describe("renderRecentlyLane: deploys follow the overview's rule (P1-87 PR 9, C1)", () => {
  // The page's `now`, an hour after the newest fixture. The lane windows deploys at `now`, so
  // leaving it to the real clock put these fixtures out of the window on 2026-11-24 (#2269).
  const NOW = new Date("2026-11-17T18:00:00.000Z");
  const merge: FleetEvent = {
    id: "pr_automerged:reddoorla/caltex#20",
    ts: "2026-11-17T17:00:00.000Z",
    type: "pr_automerged",
    siteId: "recC",
    siteName: "Caltex",
    summary: "auto-merged vite→7.3.5",
    data: { url: "https://github.com/reddoorla/caltex/pull/20" },
  };
  const deploy: FleetEvent = {
    id: "site_deployed:recC:1",
    ts: "2026-11-17T17:05:00.000Z",
    type: "site_deployed",
    siteId: "recC",
    siteName: "Caltex",
    summary: "Deploy published",
    data: null,
  };

  it("shows a merge, and leaves out the deploy 5 minutes after it on the same site", () => {
    const html = renderSitesHtml(
      modelWith([merge], NOW),
      null,
      deploysToShow([merge, deploy]),
      NOW,
    );
    expect(html).toContain("auto-merged vite→7.3.5");
    expect(html).not.toContain("Deploy published");
    expect(html).toContain("Recently (1)");
  });

  it("shows a deploy with no merge before it as Deploy published", () => {
    const html = renderSitesHtml(modelWith([], NOW), null, deploysToShow([deploy]), NOW);
    expect(html).toContain("Deploy published");
    expect(html).toContain("Recently (1)");
    // The deploy row links to its site's page (P1-87 PR 9, T11): the slug of "Caltex".
    expect(html).toContain('href="/s/caltex"');
  });

  it("keeps the lane at its cut of 20 rows across the recent events and the deploys", () => {
    const recent: FleetEvent[] = Array.from({ length: 20 }, (_, i) => ({
      id: `vuln_cleared:recA:${i}`,
      ts: `2026-11-16T${String(i).padStart(2, "0")}:00:00.000Z`,
      type: "vuln_cleared",
      siteId: "recA",
      siteName: "Acme",
      summary: `cleared ${i}`,
      data: { from: 1 },
    }));
    const deploys: FleetEvent[] = Array.from({ length: 5 }, (_, i) => ({
      ...deploy,
      id: `site_deployed:recB:${i}`,
      ts: `2026-11-17T${String(i).padStart(2, "0")}:00:00.000Z`,
      siteId: "recB",
      siteName: "Beta",
    }));
    const html = renderSitesHtml(modelWith(recent, NOW), null, deploys, NOW);
    expect(html).toContain("Recently (20)");
    // Which rows the cut keeps, not only how many (P1-87 PR 9, T10): the five deploys are the
    // newest, then the events from "cleared 19" down to "cleared 5"; "cleared 4" is cut.
    expect(html.match(/Deploy published/g)).toHaveLength(5);
    expect(html).toContain("cleared 5");
    expect(html).not.toContain("cleared 4");
    expect(html.indexOf("Deploy published")).toBeLessThan(html.indexOf("cleared 19"));
  });
});

// P1-87 PR 9, review R2-C1: a deploy re-windows at the page's `now`, as the recent events do.
describe("renderRecentlyLane: deploys re-window at the page's now (P1-87 PR 9, R2-C1)", () => {
  const OLD = "2026-11-11T12:00:00.000Z";
  const event: FleetEvent = {
    id: "vuln_cleared:recC:2026-11-11",
    ts: OLD,
    type: "vuln_cleared",
    siteId: "recC",
    siteName: "Caltex",
    summary: "cleared 2 critical/high vulns",
    data: { from: 2 },
  };
  const deploy: FleetEvent = {
    id: "site_deployed:recC:2026-11-11",
    ts: OLD,
    type: "site_deployed",
    siteId: "recC",
    siteName: "Caltex",
    summary: "Deploy published",
    data: null,
  };
  // Taken on the 17th; the page is derived from it at a later `now`, as `/fleet` does.
  const snap = snapshot({
    takenAt: "2026-11-17T18:00:00.000Z",
    recentEvents: [event],
    feedDeploys: [deploy],
  });
  function laneAt(now: Date): string {
    const cockpit = cockpitModelFromSnapshot(snap, now);
    const table = buildFleetTableModel(
      cockpit.cards.map((c) => c.site),
      parseFleetTableQuery(new URLSearchParams()),
    );
    return renderFleetTableHtml(table, null, buildSitesView(cockpit, now, snap.feedDeploys));
  }

  it("leaves out a recent event and a deploy older than the window at the page's now", () => {
    const html = laneAt(new Date("2026-11-19T18:00:00.000Z"));
    expect(html).not.toContain("cleared 2 critical/high vulns");
    expect(html).not.toContain("Deploy published");
  });

  it("shows both when the page's now is the snapshot's time", () => {
    const html = laneAt(new Date("2026-11-17T18:00:00.000Z"));
    expect(html).toContain("cleared 2 critical/high vulns");
    expect(html).toContain("Deploy published");
    expect(html).toContain("Recently (2)");
  });
});
