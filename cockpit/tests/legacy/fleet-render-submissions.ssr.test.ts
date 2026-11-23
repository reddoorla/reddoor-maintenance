import { describe, it, expect } from "vitest";
import { renderFleetBrowsePanel } from "./render.js";
import type { CockpitModel, SiteCard } from "../../../src/dashboard/fleet-cockpit.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";

function model(over: Partial<CockpitModel> = {}): CockpitModel {
  return {
    summary: {
      broken: 0,
      attention: 0,
      watch: 0,
      healthy: 0,
      preLaunch: 0,
      criticalHighVulns: 0,
      lighthouseBelowFloor: 0,
      deliveryFailures: 0,
      renovateFailing: 0,
      ciRed: 0,
      autoFixStuck: 0,
      pending: 0,
      newSubmissions: 0,
    },
    cards: [],
    pending: [],
    submissions: [],
    ...over,
  };
}

/* #2241: the /triage inbox lane is gone (submissions have their own page), so
 * only the per-card chip on Sites is left to pin here. */
describe("renderFleetBrowsePanel — per-card submissions chip split", () => {
  function cardModel(cardOver: Partial<SiteCard>): CockpitModel {
    const card: SiteCard = {
      site: makeWebsiteRow({ id: "recSITE", name: "Acme Co", status: "maintained" }),
      tier: "healthy",
      items: [],
      watchReasons: [],
      watchSignals: [],
      acceptedReasons: [],
      ...cardOver,
    };
    return model({ cards: [card] });
  }

  it("renders leads + newsletter when both are present", () => {
    const html = renderFleetBrowsePanel(
      cardModel({ newSubmissions: 3, newLeads: 1, newSignups: 2 }),
    );
    expect(html).toContain("1 new · +2 newsletter");
  });

  it("renders only the lead count when there are no signups", () => {
    const html = renderFleetBrowsePanel(
      cardModel({ newSubmissions: 2, newLeads: 2, newSignups: 0 }),
    );
    expect(html).toContain("2 new");
    expect(html).not.toContain("newsletter");
  });

  it("renders a signups-only chip without a fake lead count", () => {
    const html = renderFleetBrowsePanel(
      cardModel({ newSubmissions: 2, newLeads: 0, newSignups: 2 }),
    );
    expect(html).toContain("+2 newsletter");
    expect(html).not.toContain("0 new");
  });

  it("legacy card with only newSubmissions still renders the old label (fallback)", () => {
    const html = renderFleetBrowsePanel(cardModel({ newSubmissions: 3 }));
    expect(html).toContain("3 new");
  });

  it("renders no chip when all counts are zero", () => {
    const html = renderFleetBrowsePanel(
      cardModel({ newSubmissions: 0, newLeads: 0, newSignups: 0 }),
    );
    expect(html).not.toContain("📥");
  });
});
