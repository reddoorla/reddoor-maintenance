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
 * briefs/2026-10-26-p1-78f-triage-route.md), and the digest's fallbacks name it.
 * P1-78g (briefs/2026-10-26-p1-78g-overview.md): the overview takes /, the nav
 * reads Overview · Triage · Sites · Inbox · Audits, and sign-in lands on / again.
 */

async function thrownBy(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (thrown) {
    return thrown;
  }
  return undefined;
}

describe("the triage page lives at /triage; the overview at /", () => {
  it("/ renders the overview and never redirects (P1-78g)", async () => {
    // A store failure reaches the overview's own load: it answers with that error,
    // which it could not do if it bounced the request to /triage first.
    const thrown = await thrownBy(() =>
      (rootLoad as (e: unknown) => unknown)({
        url: new URL("https://dash.example/?since=7"),
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

  it("/triage renders its own page and never redirects (no loop)", async () => {
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
  it("reads Overview · Triage · Sites · Inbox · Audits, with Triage at /triage", () => {
    expect(NAV_ITEMS.map((n) => [n.label, n.href])).toEqual([
      ["Overview", "/"],
      ["Triage", "/triage"],
      ["Sites", "/fleet"],
      ["Inbox", "/submissions"],
      ["Audits", "/audits"],
    ]);
  });
});

describe("the fallbacks", () => {
  it("the sign-in return default is the overview again (P1-78g)", () => {
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("/audits")).toBe("/audits");
  });

  it("the digest's fleet-wide url-probe item links the triage page, not the bare root", () => {
    // A row never probed rolls into the one fleet-wide url-probe-stale item.
    const items = collectUrlResolveAlerts(
      [makeWebsiteRow({ id: "recA", name: "Acme", status: "maintained", urlCheckedAt: null })],
      "https://dash.example/",
      new Date("2026-10-27T12:00:00Z"),
    ).filter((i) => i.key === "url-probe-stale");
    expect(items.map((i) => i.url)).toEqual(["https://dash.example/triage"]);
  });

  it("a production signal on a site whose name slugs to nothing links the triage page", () => {
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
