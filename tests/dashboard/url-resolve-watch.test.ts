import { describe, it, expect } from "vitest";
import {
  buildCockpitModel,
  buildNeedsYouFeed,
  buildSiteAlarmContext,
} from "../../src/dashboard/fleet-cockpit.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { URL_NOT_DEPLOYED, URL_PROBE_STALE_DAYS } from "../../src/alerts/digest-collectors.js";
import { WATCH_CONDITION_OPTIONS } from "../../src/dashboard/site-details.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-09-30T12:00:00Z");
const FRESH = "2026-09-30T08:05:00.000Z";
const STALE = new Date(NOW.getTime() - (URL_PROBE_STALE_DAYS * 24 + 1) * 3600_000).toISOString();

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    id: "recGOOD",
    name: "Good Site",
    url: "https://good.example.com",
    status: "maintained",
    ga4PropertyId: "123456789",
    searchConsoleProperty: "sc-domain:good.example.com",
    gitRepo: "reddoorla/good-site",
    netlifyId: "11111111-2222-3333-4444-555555555555",
    pScore: 95,
    rScore: 95,
    bpScore: 95,
    seoScore: 95,
    urlResolves: "pass",
    urlStatus: "200",
    urlCheckedAt: FRESH,
    ...over,
  });
}

const failing = (over: Partial<WebsiteRow> = {}) =>
  site({ urlResolves: "fail", urlStatus: "404 netlify-site-not-found", ...over });

/** P1-78b: the roster url probe is an alarm item on the cockpit now, Broken (a
 *  visitor can't reach the site), replacing the Watch candidate #912 added. */
function model(sites: WebsiteRow[]) {
  return buildCockpitModel(sites, [], {}, "https://cockpit.test", NOW);
}
const card = (m: ReturnType<typeof model>) => m.cards[0]!;

describe("the cockpit's roster url alarm (#912, P1-78b)", () => {
  it("KNOWN-GOOD: a fresh pass raises nothing", () => {
    const m = model([site()]);
    expect(card(m).tier).toBe("healthy");
    expect(m.cardless ?? []).toEqual([]);
  });

  it("KNOWN-BAD: a maintained site with a fresh fail is Broken, with a dated item and a Broken row", () => {
    const m = model([failing()]);
    expect(card(m).tier).toBe("broken");
    expect(card(m).items.map((i) => [i.key, i.level])).toEqual([
      ["url-unresolved:recGOOD", "broken"],
    ]);
    expect(card(m).items[0]!.title).toContain("https://good.example.com does not resolve (404");
    expect(buildNeedsYouFeed(m)).toMatchObject([{ group: "broken", siteName: "Good Site" }]);
  });

  it("the accept key still mutes it: a site deliberately left undeployed is not broken", () => {
    expect(card(model([failing({ acceptedWatchConditions: ["url not deployed"] })])).tier).toBe(
      "healthy",
    );
    expect(card(model([failing({ acceptedWatchConditions: ["url-not-deployed"] })])).tier).toBe(
      "healthy",
    );
  });

  it("the accept key the item names is one the site editor will store", () => {
    expect(WATCH_CONDITION_OPTIONS).toContain(URL_NOT_DEPLOYED);
    expect(card(model([failing()])).items[0]!.title).toContain(`"${URL_NOT_DEPLOYED}"`);
  });

  it("names a missing status", () => {
    expect(card(model([failing({ urlStatus: null })])).items[0]!.title).toContain(
      "does not resolve (no status)",
    );
  });

  it("a fresh blank url (null verdict) raises nothing", () => {
    const m = model([site({ url: "", urlResolves: null, urlStatus: "no url" })]);
    expect(card(m).tier).toBe("healthy");
  });

  it("a stale fail is not a current alarm: the stale probe is an Attention item on no card", () => {
    const m = model([failing({ urlCheckedAt: STALE })]);
    expect(card(m).tier).toBe("healthy");
    expect((m.cardless ?? []).map((i) => [i.key, i.level])).toEqual([
      ["url-probe-stale", "attention"],
    ]);
  });

  it("a launching site's dead url breaks the pre-launch mute (it is a Broken item)", () => {
    const m = model([failing({ status: "launching" })]);
    expect(card(m).tier).toBe("broken");
    expect(card(m).items.map((i) => i.key)).toEqual(["url-unresolved:recGOOD"]);
  });

  it("the stale-probe item never reaches a site's own page", () => {
    const ctx = buildSiteAlarmContext(failing({ urlCheckedAt: STALE }), [], "https://c.test", NOW);
    expect(ctx.items).toEqual([]);
    expect(ctx.tier).toBe("healthy");
  });
});
