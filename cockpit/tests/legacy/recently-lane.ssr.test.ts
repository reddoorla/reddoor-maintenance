import { describe, it, expect } from "vitest";
import { renderCockpitHtml, renderSitesHtml } from "./render.js";
import { buildCockpitModel } from "../../../src/dashboard/fleet-cockpit.js";
import type { FleetEvent } from "../../../src/db/fleet-events.js";
import { deploysToShow } from "../../../src/dashboard/snapshot-views.js";

function modelWith(events: FleetEvent[]) {
  return buildCockpitModel([], [], {}, "https://d.test", new Date(), [], null, events);
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
    const html = renderSitesHtml(modelWith([merge]), null, deploysToShow([merge, deploy]));
    expect(html).toContain("auto-merged vite→7.3.5");
    expect(html).not.toContain("Deploy published");
    expect(html).toContain("Recently (1)");
  });

  it("shows a deploy with no merge before it as Deploy published", () => {
    const html = renderSitesHtml(modelWith([]), null, deploysToShow([deploy]));
    expect(html).toContain("Deploy published");
    expect(html).toContain("Recently (1)");
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
    const html = renderSitesHtml(modelWith(recent), null, deploys);
    expect(html).toContain("Recently (20)");
  });
});
