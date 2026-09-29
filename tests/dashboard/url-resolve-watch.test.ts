import { describe, it, expect } from "vitest";
import { assignTier } from "../../src/dashboard/fleet-cockpit.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { URL_NOT_DEPLOYED, URL_PROBE_STALE_DAYS } from "../../src/alerts/digest-collectors.js";
import { WATCH_CONDITION_OPTIONS } from "../../src/dashboard/site-details.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-09-30T12:00:00Z");
const FRESH = "2026-09-30T08:05:00.000Z";
const STALE = new Date(NOW.getTime() - (URL_PROBE_STALE_DAYS * 24 + 1) * 3600_000).toISOString();
const REASON = "roster url does not resolve (404 netlify-site-not-found)";

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

describe("assignTier — roster url watch (#912)", () => {
  it("KNOWN-GOOD: a fresh pass raises nothing", () => {
    expect(assignTier(site(), [], NOW).tier).toBe("healthy");
  });

  it("KNOWN-BAD: a maintained site with a fresh fail watches and names its accept key", () => {
    const r = assignTier(failing(), [], NOW);
    expect(r.tier).toBe("watch");
    expect(r.watchReasons).toEqual([REASON]);
    expect(r.watchAcceptKeys).toEqual([URL_NOT_DEPLOYED]);
    expect(r.watchSignals).toEqual(["url-unresolved"]);
  });

  it("the accept key mutes it to a visible chip", () => {
    const r = assignTier(failing({ acceptedWatchConditions: ["url not deployed"] }), [], NOW);
    expect(r.tier).toBe("healthy");
    expect(r.acceptedReasons).toEqual([REASON]);
  });

  it("the accept key the card names is one the site editor will store", () => {
    expect(WATCH_CONDITION_OPTIONS).toContain(URL_NOT_DEPLOYED);
  });

  it("a fresh blank url (null verdict) is not a watch", () => {
    const r = assignTier(site({ url: "", urlResolves: null, urlStatus: "no url" }), [], NOW);
    expect(r.tier).toBe("healthy");
    expect(r.watchSignals).toEqual([]);
  });

  it('the alias "url-not-deployed" mutes it too', () => {
    const r = assignTier(failing({ acceptedWatchConditions: ["url-not-deployed"] }), [], NOW);
    expect(r.tier).toBe("healthy");
  });

  it("a stale fail is not a current watch; the digest's stale item carries it", () => {
    expect(assignTier(failing({ urlCheckedAt: STALE }), [], NOW).tier).toBe("healthy");
  });

  it("only maintained rows: other visible statuses have no card to watch on", () => {
    expect(assignTier(failing({ status: "launching" }), [], NOW).tier).toBe("pre-launch");
    expect(assignTier(failing({ status: "hosted-only" }), [], NOW).watchSignals).toEqual([]);
  });
});
