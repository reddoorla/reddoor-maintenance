import { describe, it, expect, afterEach } from "vitest";
import prospectReport from "../../netlify/functions/prospect-report.mjs";
import type { Context } from "@netlify/functions";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const ctx = (token?: string): Context => ({ params: token ? { token } : {} }) as unknown as Context;
const req = (method = "GET"): Request => new Request("https://dash.reddoor.test/r/abc", { method });

describe("GET /r/:token", () => {
  it("rejects a non-GET", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await prospectReport(req("POST"), ctx("A".repeat(22)));
    expect(res.status).toBe(405);
  });

  it("404s a malformed token without touching the database", async () => {
    delete process.env.TURSO_DATABASE_URL;
    const res = await prospectReport(req(), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("503s when Turso is unconfigured", async () => {
    delete process.env.TURSO_DATABASE_URL;
    const res = await prospectReport(req(), ctx("A".repeat(22)));
    expect(res.status).toBe(503);
  });

  it("404s a well-formed token with no row", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await prospectReport(req(), ctx("A".repeat(22)));
    expect(res.status).toBe(404);
  });

  it("never asks for basic auth", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await prospectReport(req(), ctx("A".repeat(22)));
    expect(res.status).not.toBe(401);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });
});
