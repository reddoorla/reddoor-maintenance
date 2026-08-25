import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Context } from "@netlify/functions";
import { makeWebsiteRow } from "../_helpers/website-row.js";

// Airtable client is mocked so importing the handler never reaches a live base
// (the fleet table itself is a pure Turso read — Phase 4 has no Airtable call).
vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => ({}) as unknown),
}));
// Turso is stubbed at the seam the handler actually uses: `openDb(readDbConfig())`
// plus the one `listSites` read that feeds the whole page. Originals are spread
// through so every OTHER export of these modules still resolves for the rest of
// the dashboard import graph.
vi.mock("../../src/db/client.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    openDb: vi.fn(async () => ({}) as unknown),
    readDbConfig: vi.fn(() => ({ url: ":memory:" })),
  };
});
vi.mock("../../src/db/fleet-state.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, listSites: vi.fn(async () => []) };
});

import { listSites } from "../../src/db/fleet-state.js";
import fleetTable, { config } from "../../netlify/functions/fleet-table.mjs";

const listSitesMock = vi.mocked(listSites);

// Three distinctly-named sites so a rendered body can be checked for WHICH rows
// it carries, not merely that something rendered.
const SITES = [
  makeWebsiteRow({ id: "r1", name: "Alpha Co", url: "https://alpha.example.com" }),
  makeWebsiteRow({ id: "r2", name: "Bravo Co", url: "https://bravo.example.com" }),
  makeWebsiteRow({ id: "r3", name: "Charlie Co", url: "https://charlie.example.com" }),
];

const ORIGINAL_ENV = { ...process.env };
const ctx = {} as unknown as Context;

function req(url: string, method: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method, headers });
}

function get(
  url = "https://dash.reddoor.test/fleet",
  headers: Record<string, string> = {},
): Request {
  return req(url, "GET", headers);
}

/** A valid Basic header for the given password (username is ignored by the gate). */
function authHeader(password: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`x:${password}`).toString("base64")}` };
}

describe("fleet-table adapter — method + env/auth gating", () => {
  beforeEach(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.DASHBOARD_PASSWORD;
    listSitesMock.mockResolvedValue(SITES);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("405s a POST — even a fully authenticated one (the method guard precedes auth)", async () => {
    process.env.TURSO_DATABASE_URL = "libsql://x";
    process.env.DASHBOARD_PASSWORD = "s3cret";
    const res = await fleetTable(
      req("https://dash.reddoor.test/fleet", "POST", authHeader("s3cret")),
      ctx,
    );
    expect(res.status).toBe(405);
    expect(listSitesMock).not.toHaveBeenCalled();
  });

  it("405s non-GET methods", async () => {
    process.env.TURSO_DATABASE_URL = "libsql://x";
    process.env.DASHBOARD_PASSWORD = "s3cret";
    for (const method of ["DELETE", "PUT", "PATCH"]) {
      const res = await fleetTable(req("https://dash.reddoor.test/fleet", method), ctx);
      expect(res.status).toBe(405);
    }
    expect(listSitesMock).not.toHaveBeenCalled();
  });

  it("405s HEAD — GET-only is the house behavior for server-rendered pages", async () => {
    // Documented, not incidental: report-preview and submissions-page 405 HEAD
    // the same way. Uptime probes must use GET against this endpoint.
    process.env.TURSO_DATABASE_URL = "libsql://x";
    process.env.DASHBOARD_PASSWORD = "s3cret";
    const res = await fleetTable(req("https://dash.reddoor.test/fleet", "HEAD"), ctx);
    expect(res.status).toBe(405);
  });

  it("503s with a setup hint when DASHBOARD_PASSWORD is unset", async () => {
    process.env.TURSO_DATABASE_URL = "libsql://x";
    const res = await fleetTable(get(), ctx);
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/DASHBOARD_PASSWORD/);
  });

  it("redirects an unauthenticated navigation to the login page", async () => {
    process.env.TURSO_DATABASE_URL = "libsql://x";
    process.env.DASHBOARD_PASSWORD = "s3cret";
    const res = await fleetTable(get(), ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/auth\/login\?returnTo=/);
    expect(res.headers.get("www-authenticate")).toBeNull();
    // The whole fleet inventory is behind this gate — nothing may be read first.
    expect(listSitesMock).not.toHaveBeenCalled();
  });

  it("refuses a request whose Basic password is wrong", async () => {
    process.env.TURSO_DATABASE_URL = "libsql://x";
    process.env.DASHBOARD_PASSWORD = "s3cret";
    const res = await fleetTable(get("https://dash.reddoor.test/fleet", authHeader("nope")), ctx);
    expect(res.status).toBe(302);
    expect(listSitesMock).not.toHaveBeenCalled();
  });

  it("does NOT leak backend env state to an UNAUTHENTICATED probe (auth precedes env guards)", async () => {
    // Password set but no creds AND Turso unset: must be the auth redirect, not
    // a differentiated 500 disclosing whether the backend env is wired.
    process.env.DASHBOARD_PASSWORD = "s3cret";
    const res = await fleetTable(get(), ctx);
    expect(res.status).toBe(302);
  });

  it("500s when Turso env is missing — but only AFTER auth passes", async () => {
    process.env.DASHBOARD_PASSWORD = "s3cret";
    const res = await fleetTable(get("https://dash.reddoor.test/fleet", authHeader("s3cret")), ctx);
    expect(res.status).toBe(500);
  });
});

describe("fleet-table adapter — authenticated render", () => {
  beforeEach(() => {
    process.env.TURSO_DATABASE_URL = "libsql://x";
    process.env.DASHBOARD_PASSWORD = "s3cret";
    listSitesMock.mockResolvedValue(SITES);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function render(url: string): Promise<{ status: number; body: string }> {
    const res = await fleetTable(get(url, authHeader("s3cret")), ctx);
    return { status: res.status, body: await res.text() };
  }

  it("200s and renders the sites it was actually given", async () => {
    const { status, body } = await render("https://dash.reddoor.test/fleet");
    expect(status).toBe(200);
    expect(body).toContain("Fleet table");
    // The real rows, not just "a page happened": all three names, and a count
    // derived from them (a handler that passed [] would say "0 of 0 sites").
    expect(body).toContain("Alpha Co");
    expect(body).toContain("Bravo Co");
    expect(body).toContain("Charlie Co");
    expect(body).toContain("3 of 3 sites");
  });

  it("applies ?q — the query string reaches the model, not just the URL", async () => {
    const { status, body } = await render("https://dash.reddoor.test/fleet?q=bravo");
    expect(status).toBe(200);
    expect(body).toContain("Bravo Co");
    expect(body).not.toContain("Alpha Co");
    expect(body).not.toContain("Charlie Co");
    expect(body).toContain("1 of 3 sites");
  });

  it("applies ?dir=desc — sort params reach the model too", async () => {
    const { body } = await render("https://dash.reddoor.test/fleet?sort=name&dir=desc");
    expect(body).toContain("3 of 3 sites");
    expect(body.indexOf("Charlie Co")).toBeLessThan(body.indexOf("Alpha Co"));
  });

  it("applies ?status — a filter that excludes everything renders the empty state", async () => {
    const { body } = await render("https://dash.reddoor.test/fleet?status=no-such-status");
    expect(body).toContain("No sites match these filters.");
    expect(body).toContain("0 of 3 sites");
  });
});

describe("fleet-table adapter — routing", () => {
  it("claims /fleet as well as the raw function path", () => {
    // Every in-app link to this page is written as /fleet; losing the alias
    // 404s all of them while the function itself stays perfectly healthy.
    expect(config.path).toContain("/fleet");
    expect(config.path).toContain("/.netlify/functions/fleet-table");
  });
});
