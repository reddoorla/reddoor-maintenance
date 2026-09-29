import { describe, it, expect } from "vitest";
import {
  collectUrlResolveAlerts,
  URL_NOT_DEPLOYED,
  URL_PROBE_STALE_DAYS,
} from "../../src/alerts/digest-collectors.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-09-30T09:23:00Z");
const BASE = "https://dash.example.com";
const FRESH = "2026-09-30T08:05:00.000Z";
const STALE = new Date(NOW.getTime() - (URL_PROBE_STALE_DAYS * 24 + 1) * 3600_000).toISOString();

function row(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    id: "recPOINTE",
    name: "The Pointe Burbank",
    url: "https://the-pointe-burbank.netlify.app",
    status: "building",
    urlResolves: "fail",
    urlStatus: "404 netlify-site-not-found",
    urlCheckedAt: FRESH,
    ...over,
  });
}

function passing(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return row({
    id: "recTOWER",
    name: "The Tower",
    url: "https://the-tower-burbank-rd.netlify.app",
    urlResolves: "pass",
    urlStatus: "200",
    ...over,
  });
}

describe("collectUrlResolveAlerts — a fresh fail", () => {
  it("reaches the digest naming the site, its url and the status", () => {
    const items = collectUrlResolveAlerts([row(), passing()], BASE, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "url-unresolved:recPOINTE",
      kind: "url",
      siteName: "The Pointe Burbank",
      severity: "warning",
      metric: 1,
      url: `${BASE}/s/the-pointe-burbank`,
    });
    expect(items[0]!.title).toContain("https://the-pointe-burbank.netlify.app");
    expect(items[0]!.title).toContain("404 netlify-site-not-found");
  });

  it("covers every non-archived status, not only maintained", () => {
    for (const status of [
      "building",
      "maintained",
      "launching",
      "external",
      "hosted-only",
    ] as const) {
      const items = collectUrlResolveAlerts([row({ status })], BASE, NOW);
      expect(
        items.map((i) => i.key),
        status,
      ).toEqual(["url-unresolved:recPOINTE"]);
    }
  });

  it("never reports an archived row, fail or stale", () => {
    expect(collectUrlResolveAlerts([row({ status: "archived" })], BASE, NOW)).toEqual([]);
    expect(
      collectUrlResolveAlerts([row({ status: "archived", urlCheckedAt: null })], BASE, NOW),
    ).toEqual([]);
  });

  it("is silent for a fresh pass and for a fresh blank url", () => {
    expect(collectUrlResolveAlerts([passing()], BASE, NOW)).toEqual([]);
    expect(
      collectUrlResolveAlerts(
        [row({ url: "", urlResolves: null, urlStatus: "no url" })],
        BASE,
        NOW,
      ),
    ).toEqual([]);
  });

  it("keeps one key per site however the status wording moves", () => {
    const a = collectUrlResolveAlerts([row({ urlStatus: "404" })], BASE, NOW);
    const b = collectUrlResolveAlerts([row({ urlStatus: "error: ENOTFOUND" })], BASE, NOW);
    expect(a[0]!.key).toBe(b[0]!.key);
  });
});

describe("collectUrlResolveAlerts — the accept key mutes only fail", () => {
  it(`"${URL_NOT_DEPLOYED}" mutes a fresh fail, case- and space-insensitive`, () => {
    expect(
      collectUrlResolveAlerts(
        [row({ acceptedWatchConditions: ["  URL Not Deployed "] })],
        BASE,
        NOW,
      ),
    ).toEqual([]);
  });

  it("an unrelated accepted condition mutes nothing", () => {
    const items = collectUrlResolveAlerts(
      [row({ acceptedWatchConditions: ["no custom domain", "stale repo", "url"] })],
      BASE,
      NOW,
    );
    expect(items.map((i) => i.key)).toEqual(["url-unresolved:recPOINTE"]);
  });

  it("does not mute staleness: an accepted row whose stamp went stale is still counted", () => {
    const items = collectUrlResolveAlerts(
      [row({ acceptedWatchConditions: [URL_NOT_DEPLOYED], urlCheckedAt: STALE })],
      BASE,
      NOW,
    );
    expect(items.map((i) => i.key)).toEqual(["url-probe-stale"]);
    expect(items[0]!.metric).toBe(1);
  });
});

describe("collectUrlResolveAlerts — a stale stamp is itself caught", () => {
  it("rolls every stale non-archived row into ONE fleet item whose metric is the count", () => {
    const items = collectUrlResolveAlerts(
      [
        passing({ id: "a", urlCheckedAt: STALE }),
        passing({ id: "b", urlCheckedAt: null }),
        passing({ id: "c", urlCheckedAt: "not a date" }),
        passing({ id: "d" }),
        passing({ id: "e", status: "archived", urlCheckedAt: null }),
      ],
      BASE,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "url-probe-stale",
      kind: "url",
      severity: "warning",
      metric: 3,
      url: BASE,
    });
    expect(items[0]!.title).toMatch(/3 of 4/);
    expect(items[0]!.title).toContain("Probe roster urls to Turso");
  });

  it("a stamp inside the window is fresh, one just past it is stale", () => {
    const inside = new Date(NOW.getTime() - URL_PROBE_STALE_DAYS * 24 * 3600_000 + 60_000);
    expect(
      collectUrlResolveAlerts([passing({ urlCheckedAt: inside.toISOString() })], BASE, NOW),
    ).toEqual([]);
    expect(
      collectUrlResolveAlerts([passing({ urlCheckedAt: STALE })], BASE, NOW).map((i) => i.key),
    ).toEqual(["url-probe-stale"]);
  });

  it("the window is three days, in literal time: 71 h is fresh, 73 h is stale", () => {
    const at = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
    expect(collectUrlResolveAlerts([passing({ urlCheckedAt: at(71) })], BASE, NOW)).toEqual([]);
    expect(
      collectUrlResolveAlerts([passing({ urlCheckedAt: at(73) })], BASE, NOW).map((i) => i.key),
    ).toEqual(["url-probe-stale"]);
  });

  it("a stale fail is not reported as a current failure; it rides the stale item", () => {
    const items = collectUrlResolveAlerts([row({ urlCheckedAt: STALE })], BASE, NOW);
    expect(items.map((i) => i.key)).toEqual(["url-probe-stale"]);
  });

  it("a never-probed fleet is not a silent all-fine", () => {
    const items = collectUrlResolveAlerts(
      [passing({ urlResolves: null, urlStatus: null, urlCheckedAt: null })],
      BASE,
      NOW,
    );
    expect(items.map((i) => i.key)).toEqual(["url-probe-stale"]);
  });

  it("an empty roster raises nothing", () => {
    expect(collectUrlResolveAlerts([], BASE, NOW)).toEqual([]);
  });
});
