import { describe, it, expect, afterEach, vi } from "vitest";
import type { Context } from "@netlify/functions";

// Airtable is mocked so importing the handler's module graph never reaches a
// live base — the same defensive convention as the other adapter tests here.
vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => ({}) as unknown),
}));

// The handler opens its own connection per invocation. For ":memory:" that is a
// brand-new empty database each time — two @libsql/client(":memory:") clients
// share nothing — so a test that seeds a row and then invokes the handler needs
// both routed to the SAME instance. Mirrors prospect-audits-page-adapter.test.ts.
let sharedDb: Awaited<ReturnType<typeof import("../../src/db/client.js").openDb>> | null = null;
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

import { openDb, readDbConfig } from "../../src/db/client.js";
import { createProspectAudit } from "../../src/db/prospect-audits.js";
import auditReportJson, { config } from "../../netlify/functions/audit-report-json.mjs";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  sharedDb = null;
});

function ctxFor(token: string): Context {
  return { params: { token } } as unknown as Context;
}

const req = (method = "GET"): Request =>
  new Request("https://ops.reddoor.test/api/audit-report/x", { method });

/** Shape-valid but not present in the database. */
const ABSENT_TOKEN = "aB3-_xY9zQ1rS2tU4vW6xY";

describe("audit-report-json — serving a report", () => {
  it("returns the stored result_json for a valid token", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: "Acme Roofing",
      resultJson: JSON.stringify({
        url: "https://acme.example/",
        businessName: "Acme Roofing",
        scores: { findability: 91 },
      }),
      status: "complete",
    });

    const res = await auditReportJson(req(), ctxFor(token));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as { scores: { findability: number } };
    expect(body.scores.findability).toBe(91);
  });

  // The token in the URL means a shared cache holding this would hand one
  // prospect's report to the next caller through that cache.
  it("never allows a shared cache to retain the response", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: "Acme Roofing",
      resultJson: "{}",
      status: "complete",
    });

    const res = await auditReportJson(req(), ctxFor(token));
    const cache = res.headers.get("cache-control") ?? "";
    expect(cache).toContain("private");
    expect(cache).not.toContain("public");
  });

  // Served through untouched: parsing and re-serialising here would only add a
  // failure mode between the database and the consumer.
  it("passes the stored JSON through byte-for-byte", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const stored = JSON.stringify({ url: "https://acme.example/", nested: { deep: [1, 2, 3] } });
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: "Acme Roofing",
      resultJson: stored,
      status: "complete",
    });

    const res = await auditReportJson(req(), ctxFor(token));
    expect(await res.text()).toBe(stored);
  });
});

describe("audit-report-json — refusals", () => {
  it("404s a shape-valid token that does not exist", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    await openDb(readDbConfig());
    const res = await auditReportJson(req(), ctxFor(ABSENT_TOKEN));
    expect(res.status).toBe(404);
  });

  // A malformed token must not reach the database: a probe should cost us
  // nothing and learn nothing.
  it("404s a malformed token without opening a connection", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const openSpy = vi.mocked(openDb);
    openSpy.mockClear();
    const res = await auditReportJson(req(), ctxFor("../../etc/passwd"));
    expect(res.status).toBe(404);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("404s a missing token", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await auditReportJson(req(), { params: {} } as unknown as Context);
    expect(res.status).toBe(404);
  });

  it("405s a non-GET", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await auditReportJson(req("POST"), ctxFor(ABSENT_TOKEN));
    expect(res.status).toBe(405);
  });

  it("503s when Turso is unconfigured", async () => {
    delete process.env.TURSO_DATABASE_URL;
    const res = await auditReportJson(req(), ctxFor(ABSENT_TOKEN));
    expect(res.status).toBe(503);
  });

  // A 404 and a 503 must stay distinguishable to the website: one means the
  // report is genuinely gone, the other means we are broken. Neither may leak
  // whether the token exists.
  it("says nothing about token existence in any refusal body", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    await openDb(readDbConfig());
    const missing = await auditReportJson(req(), ctxFor(ABSENT_TOKEN));
    expect(await missing.text()).not.toContain(ABSENT_TOKEN);

    delete process.env.TURSO_DATABASE_URL;
    const broken = await auditReportJson(req(), ctxFor(ABSENT_TOKEN));
    expect(await broken.text()).not.toContain(ABSENT_TOKEN);
  });
});

describe("audit-report-json — routing", () => {
  it("claims the /api/audit-report path", () => {
    expect(config.path).toContain("/api/audit-report/:token");
  });

  it("is rate limited, like the public report route it mirrors", () => {
    expect(config.rateLimit).toBeDefined();
  });
});
