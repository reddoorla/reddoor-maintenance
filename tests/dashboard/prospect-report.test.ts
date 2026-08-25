import { describe, it, expect, afterEach, vi } from "vitest";
import prospectReport from "../../netlify/functions/prospect-report.mjs";
import type { Context } from "@netlify/functions";
import { openDb, readDbConfig } from "../../src/db/client.js";
import type { Db } from "../../src/db/client.js";
import {
  createProspectAudit,
  generateToken,
  newProspectAuditId,
} from "../../src/db/prospect-audits.js";
import type { ProspectAuditResult } from "../../src/prospect/types.js";

let sharedDb: Db | null = null;

// The handler opens its own db connection per invocation via
// openDb(readDbConfig()). For ":memory:" that is a brand-new, empty SQLite
// database per call — two separate @libsql/client(":memory:") clients do not
// share state — so a test that seeds a row via createProspectAudit and then
// invokes the handler needs both calls routed to the SAME instance. Delegate
// to the real openDb on first call and cache it here; reset in afterEach so
// each test still gets its own fresh in-memory database, same as before this
// mock existed.
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

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  sharedDb = null;
});

const ctx = (token?: string): Context => ({ params: token ? { token } : {} }) as unknown as Context;
const req = (method = "GET"): Request => new Request("https://dash.reddoor.test/r/abc", { method });

/** Minimal but type-correct ProspectAuditResult: only `crawl` is required to
 *  be `ok:true` (the type narrows it — a crawl failure never reaches this far
 *  in the pipeline); every other stage renders its "not measured" degrade
 *  path when `ok:false`, so this stays small while still exercising the same
 *  JSON.parse → renderProspectReport path a real row goes through. */
function seedResult(business: string): ProspectAuditResult {
  return {
    url: "https://acme.example/",
    business,
    generatedAt: "2026-08-25T17:00:00.000Z",
    scores: { findability: 50, readability: 50, answers: null, aiVisibility: null },
    crawl: {
      ok: true,
      data: {
        origin: "https://acme.example",
        robotsTxt: null,
        agentAccess: [],
        sitemap: { present: false, urlCount: 0 },
        llmsTxt: { present: false, firstLine: null },
        sidecarErrors: { robots: null, llms: null, sitemap: null },
        homeHeaders: {},
        pages: [],
      },
    },
    checks: { ok: false, error: "not measured in this test" },
    lighthouse: { ok: false, error: "not measured in this test" },
    analyze: { ok: false, error: "not measured in this test" },
    probes: { ok: false, error: "not measured in this test" },
  };
}

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

  it("renders the report for a real token", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const business = "Zylofoo Testing Co";
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business,
      resultJson: JSON.stringify(seedResult(business)),
    });

    const res = await prospectReport(req(), ctx(token));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    // A shared cache could never serve this to anyone lacking the token, but
    // the document names this business and lists its weaknesses — it belongs
    // in the recipient's own browser, not a CDN or corporate proxy.
    expect(res.headers.get("cache-control")).toContain("private");
    const body = await res.text();
    expect(body).toContain(business);
  });

  it("degrades a malformed stored result_json to the generic error body, without leaking it", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const token = generateToken();
    // Bypass createProspectAudit (which always stores valid JSON) to simulate
    // a corrupted row directly through the Kysely builder.
    await db
      .insertInto("prospect_audits")
      .values({
        id: newProspectAuditId(),
        token,
        url: "https://acme.example/",
        business: "Zylofoo Testing Co",
        created_at: new Date().toISOString(),
        status: "complete",
        result_json: "{not json",
      })
      .execute();

    const res = await prospectReport(req(), ctx(token));

    expect(res.ok).toBe(false);
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    const body = await res.text();
    expect(body).not.toContain("{not json");
    expect(body).not.toMatch(/SyntaxError|at .*\.(m?ts|m?js):\d+/);
  });
});
