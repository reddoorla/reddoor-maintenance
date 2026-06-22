import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Airtable client is mocked so importing the handler never reaches a live base.
// These tests only exercise the env/auth gates, which all return BEFORE any
// Airtable read — the point is (a) the .mts module's deep src/ imports resolve
// and (b) the gate branches behave. The full render path is covered by the
// fleet-render / fleet-cockpit unit tests.
vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => ((t: string) => t) as unknown),
}));

import fleetHomepage from "../../netlify/functions/fleet-homepage.mjs";

const ORIGINAL_ENV = { ...process.env };

function get(headers: Record<string, string> = {}): Request {
  return new Request("https://dash.reddoor.test/", { method: "GET", headers });
}

describe("fleet-homepage adapter — env + auth gating", () => {
  beforeEach(() => {
    delete process.env.AIRTABLE_PAT;
    delete process.env.AIRTABLE_BASE_ID;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.DASHBOARD_PASSWORD;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("500s when Airtable env is missing", async () => {
    // @ts-expect-error — minimal Context
    const res = await fleetHomepage(get(), {});
    expect(res.status).toBe(500);
  });

  it("500s when Turso env is missing", async () => {
    process.env.AIRTABLE_PAT = "pat";
    process.env.AIRTABLE_BASE_ID = "appX";
    // @ts-expect-error — minimal Context
    const res = await fleetHomepage(get(), {});
    expect(res.status).toBe(500);
  });

  it("503s with a setup hint when DASHBOARD_PASSWORD is unset", async () => {
    process.env.AIRTABLE_PAT = "pat";
    process.env.AIRTABLE_BASE_ID = "appX";
    process.env.TURSO_DATABASE_URL = "libsql://x";
    // @ts-expect-error — minimal Context
    const res = await fleetHomepage(get(), {});
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/DASHBOARD_PASSWORD/);
  });

  it("401s an unauthenticated request with a Basic challenge", async () => {
    process.env.AIRTABLE_PAT = "pat";
    process.env.AIRTABLE_BASE_ID = "appX";
    process.env.TURSO_DATABASE_URL = "libsql://x";
    process.env.DASHBOARD_PASSWORD = "s3cret";
    // @ts-expect-error — minimal Context
    const res = await fleetHomepage(get(), {});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Basic realm="Reddoor fleet"/);
  });
});
