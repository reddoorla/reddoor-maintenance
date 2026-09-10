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
import {
  createProspectAudit,
  getProspectAuditByToken,
  setProspectAuditOverrides,
} from "../../src/db/prospect-audits.js";
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

    const body = (await res.json()) as { report: { scores: { findability: number } } };
    expect(body.report.scores.findability).toBe(91);
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

  // Still served through untouched, wrapper and all: the response is built by
  // concatenation precisely so the stored bytes are never parsed and
  // re-serialised, which would only add a failure mode between the database and
  // the consumer. Asserting the WHOLE body against the exact wrapper — not a
  // `toContain` — is half of what keeps that property under test.
  //
  // THE FIXTURE BELOW IS DELIBERATELY NON-CANONICAL JSON, and it is a hand-
  // written string literal rather than a `JSON.stringify(...)` call ON PURPOSE.
  // Do not "tidy" it back. This test used to build its fixture with
  // `JSON.stringify`, and review found that made the assertion VACUOUS: for
  // canonical input, a route written as
  // `JSON.stringify({ report: JSON.parse(row.result_json), ... })` emits a
  // byte-identical body, so the test passed against exactly the implementation
  // it exists to forbid. Two things here survive concatenation and do not
  // survive a parse/stringify round trip — the spaces after `:` and `,`, and
  // `1.50`, which comes back as `1.5`. That is what makes a failure possible,
  // and a test that cannot fail on its own subject is not evidence.
  it("passes the stored JSON through byte-for-byte", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const stored = '{"url": "https://acme.example/", "score": 1.50, "nested": {"deep": [1, 2, 3]}}';
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: "Acme Roofing",
      resultJson: stored,
      status: "complete",
    });

    const res = await auditReportJson(req(), ctxFor(token));
    expect(await res.text()).toBe(
      `{"report":${stored},"overrides":null,"editedAt":null,"openedAt":null}`,
    );
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

describe("audit-report-json — overrides", () => {
  it("wraps the stored report and its overrides in one body", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: "Acme Roofing",
      resultJson: JSON.stringify({ url: "https://acme.example/", businessName: "Acme Roofing" }),
    });
    await setProspectAuditOverrides(db, token, {
      "composed:headlineFinding": { original: "a", text: "b" },
    });

    const res = await auditReportJson(req(), ctxFor(token));
    const body = (await res.json()) as {
      report: unknown;
      overrides: unknown;
      editedAt: string | null;
    };

    expect(res.status).toBe(200);
    expect(body.report).toEqual({ url: "https://acme.example/", businessName: "Acme Roofing" });
    expect(body.overrides).toEqual({ "composed:headlineFinding": { original: "a", text: "b" } });
    expect(body.editedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("serves overrides as null when the report has never been edited", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: null,
      resultJson: JSON.stringify({ url: "https://acme.example/" }),
    });

    const body = (await (await auditReportJson(req(), ctxFor(token))).json()) as {
      overrides: unknown;
      editedAt: string | null;
    };
    expect(body.overrides).toBeNull();
    expect(body.editedAt).toBeNull();
  });

  it("never caches: an edit must not wait out a max-age", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: null,
      resultJson: JSON.stringify({ url: "https://acme.example/" }),
    });

    const res = await auditReportJson(req(), ctxFor(token));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("stamps opened_at on a plain fetch", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: null,
      resultJson: JSON.stringify({ url: "https://acme.example/" }),
    });

    await auditReportJson(req(), ctxFor(token));
    const row = await getProspectAuditByToken(db, token);
    expect(row!.opened_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does NOT stamp opened_at when the caller declares an edit session", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: null,
      resultJson: JSON.stringify({ url: "https://acme.example/" }),
    });

    const editing = new Request("https://ops.reddoor.test/api/audit-report/x", {
      method: "GET",
      headers: { "x-reddoor-edit-session": "1" },
    });
    const res = await auditReportJson(editing, ctxFor(token));
    // A 404, a 503 or a 502 out of `handlerError` would ALSO leave opened_at
    // null. Without this the test stays green on a route that served nothing.
    expect(res.status).toBe(200);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.opened_at).toBeNull();
  });

  // The one test that makes the body's `openedAt` OBSERVABLE. Every other test
  // here builds a row whose opened_at is still null when the body is built, so
  // they all assert `"openedAt":null` and a route that simply hardcoded that
  // would pass the entire file. Mutation-proven: hardcoding `"openedAt":null`
  // reds this test and only this one.
  //
  // It also pins an ordering fact nothing else records: the body is built from
  // the row BEFORE the stamp is written, so a plain fetch returns the PREVIOUS
  // open time, never its own. The operator's edit-session fetch — which does
  // not stamp at all — is therefore the one that shows the prospect's true last
  // open, which is exactly the reading the report editor wants.
  it("reports the open time a previous fetch wrote", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: null,
      resultJson: JSON.stringify({ url: "https://acme.example/" }),
    });

    // The prospect opens it. This stamps, and its own body still says null.
    const first = await auditReportJson(req(), ctxFor(token));
    const firstBody = (await first.json()) as { openedAt: string | null };
    expect(firstBody.openedAt).toBeNull();

    const stamped = (await getProspectAuditByToken(db, token))!.opened_at;
    expect(stamped).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // The operator opens the editor. No stamp, and the body carries the
    // prospect's open time — a real timestamp, not merely "defined".
    const editing = new Request("https://ops.reddoor.test/api/audit-report/x", {
      method: "GET",
      headers: { "x-reddoor-edit-session": "1" },
    });
    const second = await auditReportJson(editing, ctxFor(token));
    const body = (await second.json()) as { openedAt: string | null };

    expect(second.status).toBe(200);
    expect(body.openedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.openedAt).toBe(stamped);
  });
});
