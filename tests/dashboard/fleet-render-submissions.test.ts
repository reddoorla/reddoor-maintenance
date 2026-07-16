import { describe, it, expect } from "vitest";
import { renderCockpitHtml } from "../../src/dashboard/fleet-render.js";
import { renderFleetBrowsePanel } from "../../src/dashboard/fleet-browse-render.js";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import type { CockpitModel, SiteCard, SubmissionEntry } from "../../src/dashboard/fleet-cockpit.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

function model(over: Partial<CockpitModel> = {}): CockpitModel {
  return {
    summary: {
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

const BASE = "https://reddoor-maintenance.netlify.app";
const NOW = new Date("2026-06-22T12:00:00Z");

/** Builds a real model with one attention-tier site, spam data, and one submission. */
function oneSubmissionModel(): CockpitModel {
  const site = makeWebsiteRow({
    id: "recSITE",
    name: "Acme Co",
    status: "maintenance",
    securityVulnsCritical: 2, // forces attention tier
    securityVulnsHigh: 0,
    securityVulnsModerate: 0,
    securityVulnsLow: 0,
  });
  const sub = {
    id: "s1",
    siteId: "recSITE",
    formType: "contact",
    name: "Jane",
    email: "jane@x.com",
    submittedAt: "2026-06-14T12:00:00Z",
  } as never;
  const built = buildCockpitModel([site], [], {}, BASE, NOW, [sub]);
  // Graft spam data onto the model — buildCockpitModel doesn't produce it,
  // but the render function reads model.spam directly.
  return { ...built, spam: { caught: 5, through: 1 } } as never;
}

describe("renderCockpitHtml — submissions", () => {
  it("omits the inbox lane when there are no submissions and no spam", () => {
    expect(renderCockpitHtml(model())).not.toContain('class="inbox"');
  });

  it("renders the inbox lane with an escaped entry and a count", () => {
    const html = renderCockpitHtml(
      model({
        summary: { ...model().summary, newSubmissions: 1 },
        submissions: [
          {
            submissionId: "s1",
            siteName: "Acme <b>",
            slug: "acme",
            formType: "contact",
            name: "Jane",
            email: "jane@x.com",
            submittedAt: "2026-06-14T12:00:00Z",
          },
        ],
      }),
    );
    expect(html).toContain('<details class="inbox">');
    expect(html).toContain("📥 Submissions (1 new)");
    expect(html).toContain("Acme &lt;b&gt;");
    expect(html).toContain('href="/s/acme"');
  });

  it("orders the fleet browse panel before the inbox lane (submissions + spam)", () => {
    const html = renderCockpitHtml(oneSubmissionModel());
    const fleetIdx = html.indexOf('<details class="fleet-browse">');
    const inboxIdx = html.indexOf('<details class="inbox">');
    // Use the full div tag to avoid matching the CSS rule (.spam-rollup) in <head>.
    const spamIdx = html.indexOf('class="spam-rollup');
    expect(fleetIdx).toBeGreaterThan(-1);
    expect(inboxIdx).toBeGreaterThan(-1);
    expect(spamIdx).toBeGreaterThan(-1);
    expect(fleetIdx).toBeLessThan(inboxIdx); // fleet panel comes before the inbox lane
    expect(inboxIdx).toBeLessThan(spamIdx); // spam line lives inside the inbox lane
  });

  it("links the inbox lane to /submissions", () => {
    const html = renderCockpitHtml(
      model({
        summary: { ...model().summary, newSubmissions: 1 },
        submissions: [
          {
            submissionId: "s1",
            siteName: "Acme Co",
            slug: "acme-co",
            formType: "contact",
            name: "Jane",
            email: "jane@x.com",
            submittedAt: "2026-06-14T12:00:00Z",
          },
        ],
      }),
    );
    expect(html).toContain('href="/submissions"');
  });
});

describe("renderCockpitHtml — inbox lane lead/signup split", () => {
  const entry = (id: string, formType: SubmissionEntry["formType"]): SubmissionEntry => ({
    submissionId: id,
    siteName: "Acme Co",
    slug: "acme-co",
    formType,
    name: "Jane",
    email: "jane@x.com",
    submittedAt: "2026-06-14T12:00:00Z",
  });

  it("renders an all-lead queue without a newsletter term (unchanged rendering)", () => {
    const html = renderCockpitHtml(
      model({ submissions: [entry("s1", "contact"), entry("s2", "inquiry")] }),
    );
    expect(html).toContain("📥 Submissions (2 new)");
    expect(html).not.toContain("newsletter/rsvp");
  });

  it("renders a mixed queue as leads + a separate signup term", () => {
    const html = renderCockpitHtml(
      model({
        submissions: [
          entry("s1", "contact"),
          entry("s2", "contact"),
          entry("s3", "newsletter"),
          entry("s4", "rsvp"),
          entry("s5", "newsletter"),
        ],
      }),
    );
    expect(html).toContain("📥 Submissions (2 new · +3 newsletter/rsvp)");
  });

  it("renders a signup-only backlog honestly as 0 new", () => {
    const subs = Array.from({ length: 73 }, (_, i) => entry(`s${i}`, "newsletter"));
    const html = renderCockpitHtml(model({ submissions: subs }));
    expect(html).toContain("📥 Submissions (0 new · +73 newsletter/rsvp)");
  });
});

describe("renderFleetBrowsePanel — per-card submissions chip split", () => {
  function cardModel(cardOver: Partial<SiteCard>): CockpitModel {
    const card: SiteCard = {
      site: makeWebsiteRow({ id: "recSITE", name: "Acme Co", status: "maintenance" }),
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
    expect(html).toContain("📥 1 new · +2 newsletter");
  });

  it("renders only the lead count when there are no signups", () => {
    const html = renderFleetBrowsePanel(
      cardModel({ newSubmissions: 2, newLeads: 2, newSignups: 0 }),
    );
    expect(html).toContain("📥 2 new");
    expect(html).not.toContain("newsletter");
  });

  it("renders a signups-only chip without a fake lead count", () => {
    const html = renderFleetBrowsePanel(
      cardModel({ newSubmissions: 2, newLeads: 0, newSignups: 2 }),
    );
    expect(html).toContain("📥 +2 newsletter");
    expect(html).not.toContain("0 new");
  });

  it("legacy card with only newSubmissions still renders the old label (fallback)", () => {
    const html = renderFleetBrowsePanel(cardModel({ newSubmissions: 3 }));
    expect(html).toContain("📥 3 new");
  });

  it("renders no chip when all counts are zero", () => {
    const html = renderFleetBrowsePanel(
      cardModel({ newSubmissions: 0, newLeads: 0, newSignups: 0 }),
    );
    expect(html).not.toContain("📥");
  });
});

describe("renderCockpitHtml — auto-filtered affordance", () => {
  it("omits the affordance when nothing was auto-filtered", () => {
    const html = renderCockpitHtml(model());
    expect(html).not.toContain("auto-filtered this week");
  });
  it("renders the count and links to /submissions filtered to spam_auto", () => {
    const html = renderCockpitHtml(model({ autoFiltered: 4 }));
    expect(html).toContain("4 auto-filtered this week");
    expect(html).toContain('href="/submissions?status=spam_auto"');
  });
});
