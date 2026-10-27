import { describe, it, expect } from "vitest";
import { isHttpError, isRedirect } from "@sveltejs/kit";
import { load as rootLoad } from "../../src/routes/+page.js";
import { load as triageLoad } from "../../src/routes/triage/+page.js";
import { NAV_ITEMS } from "../../src/lib/nav.js";
import { safeReturnTo } from "../../../src/dashboard/auth/oauth-state.js";
import { collectUrlResolveAlerts } from "../../../src/alerts/digest-collectors.js";
import { collectDomainAlerts } from "../../../src/alerts/production-signals.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";

/**
 * P1-78f: the triage start page moves to /triage (workspace
 * briefs/2026-10-26-p1-78f-triage-route.md). Until the overview takes / (P1-78g),
 * / answers with a temporary redirect, the nav reads Triage · Sites · Inbox ·
 * Audits, and every fallback that named / names /triage.
 */

async function thrownBy(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (thrown) {
    return thrown;
  }
  return undefined;
}

describe("the start page lives at /triage", () => {
  it("/ redirects to /triage temporarily (307), carrying the query", async () => {
    const thrown = await thrownBy(() =>
      (rootLoad as (e: unknown) => unknown)({ url: new URL("https://dash.example/?since=7") }),
    );
    expect(isRedirect(thrown)).toBe(true);
    const r = thrown as { status: number; location: string };
    // Never permanent: a browser must not learn that / means /triage.
    expect(r.status).toBe(307);
    expect(r.location).toBe("/triage?since=7");
  });

  it("/triage renders its own page and never redirects (no loop)", async () => {
    // A store failure reaches the page's own load: it answers with that error,
    // which it could not do if it bounced the request elsewhere first.
    const thrown = await thrownBy(() =>
      (triageLoad as (e: unknown) => unknown)({
        url: new URL("https://dash.example/triage"),
        params: {},
        parent: async () => ({
          snapshot: null,
          failure: { status: 500, message: "Turso env missing" },
          clockOffsetMs: 0,
        }),
      }),
    );
    expect(isRedirect(thrown)).toBe(false);
    expect(isHttpError(thrown) && thrown.status).toBe(500);
  });
});

describe("the nav", () => {
  it("reads Triage · Sites · Inbox · Audits, with Triage at /triage", () => {
    expect(NAV_ITEMS.map((n) => [n.label, n.href])).toEqual([
      ["Triage", "/triage"],
      ["Sites", "/fleet"],
      ["Inbox", "/submissions"],
      ["Audits", "/audits"],
    ]);
  });
});

describe("the fallbacks that named / name /triage", () => {
  it("the sign-in return default", () => {
    expect(safeReturnTo(null)).toBe("/triage");
    expect(safeReturnTo("https://evil.example")).toBe("/triage");
    expect(safeReturnTo("/audits")).toBe("/audits");
  });

  it("the digest's fleet-wide url-probe item links the cockpit home, not the bare root", () => {
    // A row never probed rolls into the one fleet-wide url-probe-stale item.
    const items = collectUrlResolveAlerts(
      [makeWebsiteRow({ id: "recA", name: "Acme", status: "maintained", urlCheckedAt: null })],
      "https://dash.example/",
      new Date("2026-10-27T12:00:00Z"),
    ).filter((i) => i.key === "url-probe-stale");
    expect(items.map((i) => i.url)).toEqual(["https://dash.example/triage"]);
  });

  it("a production signal on a site whose name slugs to nothing links the cockpit home", () => {
    // No /s/<slug> page exists for such a site, so the item falls back to the home.
    const items = collectDomainAlerts(
      [
        makeWebsiteRow({
          id: "recP",
          name: "!!!",
          status: "maintained",
          certDaysRemaining: 3,
          domainCheckedAt: "2026-10-27T06:00:00Z",
        }),
      ],
      "https://dash.example/",
      new Date("2026-10-27T12:00:00Z"),
    );
    expect(items.map((i) => i.url)).toEqual(["https://dash.example/triage"]);
  });
});
