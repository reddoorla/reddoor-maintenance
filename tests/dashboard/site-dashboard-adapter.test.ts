import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Context } from "@netlify/functions";

// Airtable client mocked: the gates below return before any base read. Proves
// the .mts module's deep src/ imports resolve and the no-slug/env/auth branches
// behave; the render path is covered by the render unit tests.
vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => ((t: string) => t) as unknown),
}));

import siteDashboard from "../../netlify/functions/site-dashboard.mjs";

const ORIGINAL_ENV = { ...process.env };

function get(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "GET", headers });
}

// The handler only reads `ctx.params`; a minimal cast is enough and avoids
// fragile multi-line `@ts-expect-error` placement once Prettier wraps the call.
function ctx(params?: Record<string, string>): Context {
  return { params } as unknown as Context;
}

describe("site-dashboard adapter — slug resolution + env/auth gating", () => {
  beforeEach(() => {
    delete process.env.AIRTABLE_PAT;
    delete process.env.AIRTABLE_BASE_ID;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.DASHBOARD_PASSWORD;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns the presence-only health check when no slug is present", async () => {
    const res = await siteDashboard(
      get("https://dash.reddoor.test/.netlify/functions/site-dashboard"),
      ctx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { service: string; env: Record<string, boolean> };
    expect(body.service).toBe("reddoor-site-dashboard");
    // presence-only: false because env is unset, never the value itself
    expect(body.env.AIRTABLE_PAT).toBe(false);
  });

  it("500s when a slug is given but Airtable env is missing", async () => {
    const res = await siteDashboard(get("https://dash.reddoor.test/s/acme"), ctx({ slug: "acme" }));
    expect(res.status).toBe(500);
  });

  it("401s an unauthenticated slug request (gate fires before any Airtable read)", async () => {
    process.env.AIRTABLE_PAT = "pat";
    process.env.AIRTABLE_BASE_ID = "appX";
    process.env.TURSO_DATABASE_URL = "libsql://x";
    process.env.DASHBOARD_PASSWORD = "s3cret";
    const res = await siteDashboard(get("https://dash.reddoor.test/s/acme"), ctx({ slug: "acme" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Basic realm="Reddoor fleet"/);
  });

  it("resolves the slug from the ?slug= query param when no path param", async () => {
    process.env.AIRTABLE_PAT = "pat";
    process.env.AIRTABLE_BASE_ID = "appX";
    process.env.TURSO_DATABASE_URL = "libsql://x";
    process.env.DASHBOARD_PASSWORD = "s3cret";
    // No ctx.params → slug comes from the query string → NOT the health check,
    // so we reach the auth gate (401) rather than a 200 health response.
    const res = await siteDashboard(get("https://dash.reddoor.test/x?slug=acme"), ctx());
    expect(res.status).toBe(401);
  });
});
