import { describe, it, expect } from "vitest";
import { buildSiteAlarmContext, buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import { renderSiteDashboardHtml } from "../../src/dashboard/render.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-06-11T12:00:00Z");
const BASE = "https://reddoor-maintenance.netlify.app";

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    pointOfContact: "Tucker",
    maintenanceFreq: "Monthly",
    reportRecipientsTo: "t@x.com",
    pScore: 95,
    rScore: 95,
    bpScore: 95,
    seoScore: 95,
    lastLighthouseAuditAt: "2026-06-10T12:00:00Z",
    a11yViolations: 0,
    depsDrifted: 0,
    depsMajorBehind: 0,
    securityVulnsCritical: 0,
    securityVulnsHigh: 0,
    securityVulnsModerate: 0,
    securityVulnsLow: 0,
    ...over,
  });
}

/** The keys the cockpit surfaces for one site — the parity yardstick. */
function cockpitItemKeys(s: WebsiteRow, notify = new Map<string, number>()): string[] {
  const m = buildCockpitModel([s], [], {}, BASE, NOW, [], null, [], 0, notify);
  const card = m.cards.find((c) => c.site.id === s.id)!;
  return card.items.map((i) => i.key).sort();
}

describe("buildSiteAlarmContext", () => {
  it("a clean site is healthy with no items or reasons", () => {
    const alarm = buildSiteAlarmContext(site({ id: "a", name: "Good" }), [], BASE, NOW);
    expect(alarm.tier).toBe("healthy");
    expect(alarm.items).toEqual([]);
    expect(alarm.watchReasons).toEqual([]);
    expect(alarm.acceptedReasons).toEqual([]);
  });

  it("surfaces a critical vuln as an attention item", () => {
    const s = site({ id: "a", name: "Bad", securityVulnsCritical: 2, securityVulnsHigh: 1 });
    const alarm = buildSiteAlarmContext(s, [], BASE, NOW);
    expect(alarm.tier).toBe("attention");
    expect(alarm.items).toHaveLength(1);
    expect(alarm.items[0]!.kind).toBe("vuln");
  });

  it("surfaces bounced lead notifications as a critical notify-bounce item", () => {
    const s = site({ id: "a", name: "Espada" });
    const alarm = buildSiteAlarmContext(s, [], BASE, NOW, new Map([["a", 4]]));
    expect(alarm.tier).toBe("attention");
    const bounce = alarm.items.find((i) => i.kind === "notify-bounce")!;
    expect(bounce.severity).toBe("critical");
    expect(bounce.metric).toBe(4);
  });

  // The reuse guarantee: buildSiteAlarmContext must surface the SAME items the
  // cockpit does for a given site. Drift is structurally prevented — both call the
  // shared collectFleetAttentionItems — so this is a behavioral cross-check that the
  // two entry points agree (and that assignTier over a one-site array matches the
  // per-card verdict) for inputs that trigger the vuln and notify-bounce collectors.
  it("emits the same item keys as buildCockpitModel for the same site (reuse parity)", () => {
    const clean = site({ id: "a", name: "Good" });
    expect(
      buildSiteAlarmContext(clean, [], BASE, NOW)
        .items.map((i) => i.key)
        .sort(),
    ).toEqual(cockpitItemKeys(clean));

    const vuln = site({ id: "b", name: "Bad", securityVulnsCritical: 2 });
    expect(
      buildSiteAlarmContext(vuln, [], BASE, NOW)
        .items.map((i) => i.key)
        .sort(),
    ).toEqual(cockpitItemKeys(vuln));

    const bouncing = site({ id: "c", name: "Espada" });
    const notify = new Map([["c", 4]]);
    expect(
      buildSiteAlarmContext(bouncing, [], BASE, NOW, notify)
        .items.map((i) => i.key)
        .sort(),
    ).toEqual(cockpitItemKeys(bouncing, notify));
  });

  it("passes an unmet turnstile guardrail through as a watch reason with an accept key", () => {
    // requireTurnstile with a non-passing widget is the canonical watch condition.
    const s = site({ id: "a", name: "Reddoor", requireTurnstile: true, turnstileWidget: null });
    const alarm = buildSiteAlarmContext(s, [], BASE, NOW);
    expect(alarm.tier).toBe("watch");
    expect(alarm.watchReasons.length).toBeGreaterThan(0);
    expect(alarm.watchAcceptKeys.length).toBe(alarm.watchReasons.length);
  });
});

describe("renderSiteDashboardHtml — alarm strip", () => {
  it("renders no alarm section when alarm is null", () => {
    const html = renderSiteDashboardHtml(site({ name: "Good" }), [], [], null, NOW, null);
    expect(html).not.toContain('class="section alarm"');
  });

  it("renders a Needs-attention chip carrying the item title", () => {
    const s = site({ id: "a", name: "Bad", securityVulnsCritical: 2 });
    const alarm = buildSiteAlarmContext(s, [], BASE, NOW);
    const html = renderSiteDashboardHtml(s, [], [], null, NOW, alarm);
    expect(html).toContain('class="section alarm"');
    expect(html).toContain("Needs attention");
    expect(html).toContain("chip critical");
  });

  it("renders no alarm section for a healthy site with nothing to show", () => {
    const s = site({ id: "a", name: "Good" });
    const alarm = buildSiteAlarmContext(s, [], BASE, NOW);
    const html = renderSiteDashboardHtml(s, [], [], null, NOW, alarm);
    expect(html).not.toContain('class="section alarm"');
  });
});
