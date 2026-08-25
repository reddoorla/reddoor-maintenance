import { describe, it, expect, afterEach, vi } from "vitest";
import type { Context } from "@netlify/functions";

// Airtable client is mocked so importing the handler (via src/dashboard/index.js,
// which re-exports the whole dashboard module graph) never reaches a live base —
// same defensive convention as fleet-table-adapter.test.ts / fleet-homepage-adapter.test.ts.
// This page never calls it; the mock only guards against an accidental future call.
vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => ({}) as unknown),
}));

import { openDb, readDbConfig } from "../../src/db/client.js";
import type { Db } from "../../src/db/client.js";
import { createProspectAudit } from "../../src/db/prospect-audits.js";

let sharedDb: Db | null = null;

// The handler opens its own db connection per invocation via
// openDb(readDbConfig()). For ":memory:" that is a brand-new, empty SQLite
// database per call — two separate @libsql/client(":memory:") clients do not
// share state — so a test that seeds a row via createProspectAudit and then
// invokes the handler needs both calls routed to the SAME instance. Mirrors
// the identical workaround in prospect-report.test.ts.
vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  return {
    ...actual,
    openDb: vi.fn(async (cfg: Parameters<typeof actual.openDb>[0]) => {
      sharedDb ??= await actual.openDb(cfg);
      return sharedDb;
    }),
  };
});

import prospectAuditsPage, { config } from "../../netlify/functions/prospect-audits-page.mjs";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  sharedDb = null;
});

const ctx = {} as unknown as Context;

function get(headers: Record<string, string> = {}): Request {
  return new Request("https://dash.reddoor.test/audits", { method: "GET", headers });
}

/** A valid Basic header for the given password (username is ignored by the gate). */
function authHeader(password: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`tucker:${password}`).toString("base64")}` };
}

describe("prospect-audits-page adapter — method + env/auth gating", () => {
  it("405s a non-GET method", async () => {
    process.env.DASHBOARD_PASSWORD = "s3cret";
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await prospectAuditsPage(
      new Request("https://dash.reddoor.test/audits", {
        method: "POST",
        headers: authHeader("s3cret"),
      }),
      ctx,
    );
    expect(res.status).toBe(405);
  });

  it("503s with a setup hint when DASHBOARD_PASSWORD is unset", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    delete process.env.DASHBOARD_PASSWORD;
    const res = await prospectAuditsPage(get(), ctx);
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/DASHBOARD_PASSWORD/);
  });

  it("redirects an unauthenticated navigation to the login page", async () => {
    process.env.DASHBOARD_PASSWORD = "s3cret";
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await prospectAuditsPage(get(), ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/auth\/login\?returnTo=/);
    // No challenge header: the native dialog is opt-in via /auth/basic now.
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("refuses a request whose Basic password is wrong", async () => {
    process.env.DASHBOARD_PASSWORD = "s3cret";
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await prospectAuditsPage(get(authHeader("nope")), ctx);
    expect(res.status).toBe(302);
  });

  it("does NOT leak backend env state to an UNAUTHENTICATED probe (auth precedes the Turso guard)", async () => {
    process.env.DASHBOARD_PASSWORD = "s3cret";
    delete process.env.TURSO_DATABASE_URL;
    const res = await prospectAuditsPage(get(), ctx);
    expect(res.status).toBe(302);
  });

  it("500s when Turso env is missing — but only AFTER auth passes", async () => {
    process.env.DASHBOARD_PASSWORD = "s3cret";
    delete process.env.TURSO_DATABASE_URL;
    const res = await prospectAuditsPage(get(authHeader("s3cret")), ctx);
    expect(res.status).toBe(500);
  });
});

describe("prospect-audits-page adapter — authenticated render", () => {
  it("renders seeded rows and escapes a hostile business name", async () => {
    process.env.DASHBOARD_PASSWORD = "s3cret";
    process.env.TURSO_DATABASE_URL = ":memory:";

    const db = await openDb(readDbConfig());
    const hostileBusiness = '<img src=x onerror=alert(1)>Acme "Evil" & Co';
    await createProspectAudit(db, {
      url: "https://acme.example/",
      business: hostileBusiness,
      resultJson: "{}",
      status: "complete",
    });
    await createProspectAudit(db, {
      url: "https://bravo.example/",
      business: "Bravo Co",
      resultJson: "{}",
      status: "partial",
    });

    const res = await prospectAuditsPage(get(authHeader("s3cret")), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const body = await res.text();
    expect(body).toContain("Bravo Co");
    expect(body).toContain("Partial");
    expect(body).not.toContain("<img src=x onerror=alert(1)>");
    expect(body).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(body).toContain("&quot;Evil&quot;");
  });

  it("renders the empty state when there are no audits yet", async () => {
    process.env.DASHBOARD_PASSWORD = "s3cret";
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await prospectAuditsPage(get(authHeader("s3cret")), ctx);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("No audits yet");
  });
});

describe("prospect-audits-page adapter — routing", () => {
  it("claims /audits as well as the raw function path", () => {
    expect(config.path).toContain("/audits");
    expect(config.path).toContain("/.netlify/functions/prospect-audits-page");
  });
});
