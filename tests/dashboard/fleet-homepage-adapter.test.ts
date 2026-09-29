import { describe, it, expect, beforeEach, afterEach } from "vitest";

// These tests only exercise the env/auth gates, which all return BEFORE any
// store read — the point is (a) the .mts module's deep src/ imports resolve
// and (b) the gate branches behave. The full render path is covered by the
// fleet-render / fleet-cockpit unit tests.

import fleetHomepage from "../../netlify/functions/fleet-homepage.mjs";

const ORIGINAL_ENV = { ...process.env };

function get(headers: Record<string, string> = {}): Request {
  return new Request("https://dash.reddoor.test/", { method: "GET", headers });
}

/** A valid Basic header for the given password (username is ignored by the gate). */
function authHeader(password: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`x:${password}`).toString("base64")}` };
}

describe("fleet-homepage adapter — env + auth gating", () => {
  beforeEach(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.DASHBOARD_PASSWORD;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("500s when Turso env is missing — but only AFTER auth passes", async () => {
    process.env.DASHBOARD_PASSWORD = "s3cret";
    // @ts-expect-error — minimal Context
    const res = await fleetHomepage(get(authHeader("s3cret")), {});
    expect(res.status).toBe(500);
  });

  it("does NOT leak backend env state to an UNAUTHENTICATED probe (auth precedes env guards)", async () => {
    // Password set but no creds + Turso unset: must be the auth
    // redirect, not a differentiated 500/503 disclosing which backend is missing.
    process.env.DASHBOARD_PASSWORD = "s3cret";
    // @ts-expect-error — minimal Context
    const res = await fleetHomepage(get(), {});
    expect(res.status).toBe(302);
  });

  it("503s with a setup hint when DASHBOARD_PASSWORD is unset", async () => {
    process.env.TURSO_DATABASE_URL = "libsql://x";
    // @ts-expect-error — minimal Context
    const res = await fleetHomepage(get(), {});
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/DASHBOARD_PASSWORD/);
  });

  it("redirects an unauthenticated navigation to the login page", async () => {
    process.env.TURSO_DATABASE_URL = "libsql://x";
    process.env.DASHBOARD_PASSWORD = "s3cret";
    // @ts-expect-error — minimal Context
    const res = await fleetHomepage(get(), {});
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/auth\/login\?returnTo=/);
    // No challenge header: a native password dialog is now opt-in via
    // /auth/basic, never volunteered.
    expect(res.headers.get("www-authenticate")).toBeNull();
  });
});
