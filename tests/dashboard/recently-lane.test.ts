import { describe, it, expect } from "vitest";
import { renderCockpitHtml } from "../../src/dashboard/fleet-render.js";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import type { FleetEvent } from "../../src/db/fleet-events.js";

function modelWith(events: FleetEvent[]) {
  return buildCockpitModel([], [], {}, "https://d.test", new Date(), [], null, events);
}

describe("renderRecentlyLane (via renderCockpitHtml)", () => {
  it("renders a collapsed details.recently with a count and per-type icons", () => {
    const html = renderCockpitHtml(
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
    expect(html).toContain("🔧 Recently (2)");
    expect(html).toContain("🔧"); // pr_automerged icon
    expect(html).toContain("🔄"); // fleet_swept icon
    // PR row links externally; fleet_swept row has no link
    expect(html).toContain('href="https://github.com/reddoorla/caltex/pull/14"');
    expect(html).toContain("Caltex");
  });

  it("links a site-scoped non-PR event to /s/<slug>", () => {
    const html = renderCockpitHtml(
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
    expect(html).toContain("🛡"); // vuln_cleared icon
    expect(html).toContain('href="/s/caltex"');
  });

  it("renders nothing when there are no recent events", () => {
    const html = renderCockpitHtml(modelWith([]));
    expect(html).not.toContain('class="recently"');
  });
});
