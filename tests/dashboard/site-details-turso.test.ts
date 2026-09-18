import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * #539 Phase 6 (#646): a site-detail edit is a TURSO write with an Airtable
 * shadow, so it must keep working once `AIRTABLE_PAT` / `AIRTABLE_BASE_ID` are
 * pulled — the same gate dropped from `resend-webhook`
 * (https://github.com/reddoorla/reddoor-maintenance/pull/855) and from
 * `report-commentary` (https://github.com/reddoorla/reddoor-maintenance/pull/868).
 *
 * Nothing on the Turso side is mocked: the handler opens a real libSQL database
 * — a throwaway `file:` database in a temp dir (not `:memory:`, because every
 * openDb on `:memory:` is a brand-new empty database and the handler opens its
 * own). TURSO_DATABASE_URL is overwritten and TURSO_AUTH_TOKEN deleted for every
 * test, so an operator shell with real Turso credentials exported can never
 * point this suite at production.
 *
 * Only the Airtable I/O is mocked, so the shadow write can be observed and made
 * to fail, and so no test can reach a real base.
 *
 * `setSiteDetail`'s validation, its field allowlist and its secret-field
 * semantics (empty = unchanged, `__clear__` = clear) are asserted here through
 * the REAL handler as well as in tests/dashboard/site-details.test.ts: dropping
 * the env gate must not move any of them.
 */

// Partial mock: only the Airtable writer is replaced. The module's pure exports
// stay real, because both the Turso reader (src/db/fleet-state.ts) and
// src/dashboard/site-details.ts import row helpers and the AirtableCellValue
// type through this module.
vi.mock("../../src/reports/airtable/websites.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/reports/airtable/websites.js")>()),
  updateSiteField: vi.fn(),
}));
vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => ((t: string) => t) as unknown),
}));
import { updateSiteField } from "../../src/reports/airtable/websites.js";
import { openBase } from "../../src/reports/airtable/client.js";
import siteDetailsHandler from "../../netlify/functions/site-details.mjs";
import { openDb, type Db } from "../../src/db/client.js";
import { CLEAR_SECRET } from "../../src/dashboard/site-details.js";

const shadowWrite = vi.mocked(updateSiteField);
const openBaseMock = vi.mocked(openBase);

// "op:s3cret" base64 — username ignored, password is the gate.
const AUTH = "Basic " + Buffer.from("op:s3cret").toString("base64");

const DIR = mkdtempSync(join(tmpdir(), "site-details-turso-"));
let dbSeq = 0;
let db: Db;

async function post(
  slug: string,
  field: string,
  value: string,
  headers: Record<string, string> = { authorization: AUTH },
): Promise<Response> {
  const req = new Request(`https://x/api/sites/${slug}/details`, {
    method: "POST",
    body: JSON.stringify({ field, value }),
    headers: { "content-type": "application/json", ...headers },
  });
  // @ts-expect-error — minimal Netlify Context (only params are read)
  return siteDetailsHandler(req, { params: { slug } });
}

async function seedSite(id: string, slug: string, over: Record<string, unknown> = {}) {
  await db
    .insertInto("sites")
    .values({
      id,
      slug,
      name: `Site ${slug}`,
      url: "https://example.com",
      status: "Maintained",
      ...over,
    } as never)
    .execute();
}

async function siteRow(id: string): Promise<Record<string, unknown> | undefined> {
  return (await db.selectFrom("sites").selectAll().where("id", "=", id).executeTakeFirst()) as
    Record<string, unknown> | undefined;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  process.env.DASHBOARD_PASSWORD = "s3cret";
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.AIRTABLE_PAT;
  delete process.env.AIRTABLE_BASE_ID;
  const url = `file:${join(DIR, `db-${++dbSeq}.sqlite`)}`;
  process.env.TURSO_DATABASE_URL = url;
  db = await openDb({ url });
  shadowWrite.mockReset();
  shadowWrite.mockResolvedValue(undefined);
  openBaseMock.mockClear();
});

afterEach(async () => {
  await db.destroy();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe("site-details with NO Airtable env (the post-unplug world)", () => {
  it("writes the field to Turso — 200, not airtable-env-missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("recSite1", "acme");
    const res = await post("acme", "copyIntro", "  A fresh intro paragraph.  ");
    expect(await res.json()).toEqual({ ok: true });
    expect(res.status).toBe(200);
    // The edit actually LANDS in the authoritative store, trimmed.
    expect((await siteRow("recSite1"))?.copy_intro).toBe("A fresh intro paragraph.");
    expect(shadowWrite).not.toHaveBeenCalled();
    // No Airtable client is even constructed without credentials.
    expect(openBaseMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join("\n")).toContain(
      "AIRTABLE_SHADOW skipped=env-absent record=recSite1",
    );
    warn.mockRestore();
  });

  it("clears a text field with an empty value — the cell goes back to NULL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("recSite2", "beta", { copy_footer: "an earlier footer" });
    const res = await post("beta", "copyFooter", "   ");
    expect(res.status).toBe(200);
    expect((await siteRow("recSite2"))?.copy_footer).toBeNull();
    warn.mockRestore();
  });

  it("writes the non-text kinds through the importer's own coercion", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("recSite3", "gamma");
    expect((await post("gamma", "requireTurnstile", "true")).status).toBe(200);
    expect((await post("gamma", "acceptedWatchConditions", "SEO, Performance")).status).toBe(200);
    const row = await siteRow("recSite3");
    // The checkbox stores the importer's 1/0, not the string "true" — parity
    // compares raw-to-raw, so a mirror storing "true" would red every check.
    expect(row?.require_turnstile).toBe(1);
    // ...and the multi-select stores the importer's JSON array, not the comma
    // string the form submitted.
    expect(row?.accepted_watch_conditions).toBe('["SEO","Performance"]');
    warn.mockRestore();
  });

  it("a HALF-configured Airtable env skips the shadow too, and still lands the edit", async () => {
    process.env.AIRTABLE_BASE_ID = "base_only";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("recSite4", "delta");
    const res = await post("delta", "searchQuery", "acme dentist");
    expect(res.status).toBe(200);
    expect((await siteRow("recSite4"))?.search_query).toBe("acme dentist");
    expect(shadowWrite).not.toHaveBeenCalled();
    expect(openBaseMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join("\n")).toContain("AIRTABLE_SHADOW skipped=env-partial");
    warn.mockRestore();
  });

  it("a minted site_<ULID> id is served too (its shadow would skip anyway)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("site_01K5F0RZ2N9Q7M3V8T4H6XW1AB", "epsilon");
    const res = await post("epsilon", "netlifyId", "abc-123");
    expect(res.status).toBe(200);
    expect((await siteRow("site_01K5F0RZ2N9Q7M3V8T4H6XW1AB"))?.netlify_id).toBe("abc-123");
    warn.mockRestore();
  });
});

describe("site-details: validation and secret semantics are untouched by the env drop", () => {
  it("an unknown field is still refused BEFORE any read or write", async () => {
    await seedSite("recSite5", "zeta");
    const res = await post("zeta", "DNS password", "hax");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "bad-field" });
    expect(shadowWrite).not.toHaveBeenCalled();
  });

  it("an invalid url is still refused — the scheme allowlist holds", async () => {
    await seedSite("recSite6", "eta", { url: "https://real.example" });
    const res = await post("eta", "url", "javascript:alert(1)");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid", field: "url" });
    expect((await siteRow("recSite6"))?.url).toBe("https://real.example");
  });

  it("an off-allowlist multi-select option is still refused", async () => {
    await seedSite("recSite7", "theta");
    const res = await post("theta", "acceptedWatchConditions", "Performance, turnstile-unverified");
    expect(res.status).toBe(400);
    expect((await siteRow("recSite7"))?.accepted_watch_conditions).toBeNull();
  });

  it("a rolled-over calendar date is still refused", async () => {
    await seedSite("recSite8", "iota");
    const res = await post("iota", "maintenanceDay", "2026-02-31");
    expect(res.status).toBe(400);
    expect((await siteRow("recSite8"))?.maintenance_day).toBeNull();
  });

  it("an EMPTY secret leaves the stored key alone — no write at all", async () => {
    await seedSite("recSite9", "kappa", { mailchimp_api_key: "key-that-works" });
    const res = await post("kappa", "mailchimpApiKey", "");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await siteRow("recSite9"))?.mailchimp_api_key).toBe("key-that-works");
    expect(shadowWrite).not.toHaveBeenCalled();
  });

  it("the __clear__ sentinel still erases a secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("recSite10", "lambda", { mailchimp_api_key: "key-that-works" });
    const res = await post("lambda", "mailchimpApiKey", CLEAR_SECRET);
    expect(res.status).toBe(200);
    expect((await siteRow("recSite10"))?.mailchimp_api_key).toBeNull();
    warn.mockRestore();
  });

  it("an unknown slug is still a 404", async () => {
    const res = await post("no-such-site", "copyIntro", "hello");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not-found" });
  });

  it("a malformed JSON body is still a 400", async () => {
    await seedSite("recSite11", "mu");
    const req = new Request("https://x/api/sites/mu/details", {
      method: "POST",
      body: "{not json",
      headers: { "content-type": "application/json", authorization: AUTH },
    });
    // @ts-expect-error — minimal Netlify Context
    const res = await siteDetailsHandler(req, { params: { slug: "mu" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid-json" });
  });

  it("an unauthenticated POST is refused before anything is written", async () => {
    await seedSite("recSite12", "nu");
    const res = await post("nu", "copyIntro", "not mine to write", {});
    expect(res.status).toBe(401);
    expect((await siteRow("recSite12"))?.copy_intro).toBeNull();
    expect(shadowWrite).not.toHaveBeenCalled();
  });

  it("a cross-site POST is refused with 403 before auth", async () => {
    await seedSite("recSite13", "xi");
    const res = await post("xi", "copyIntro", "forged", {
      authorization: AUTH,
      "sec-fetch-site": "cross-site",
    });
    expect(res.status).toBe(403);
    expect((await siteRow("recSite13"))?.copy_intro).toBeNull();
  });
});

describe("site-details WITH Airtable env (the rollback-window world)", () => {
  beforeEach(() => {
    process.env.AIRTABLE_PAT = "pat_test";
    process.env.AIRTABLE_BASE_ID = "appTestBase";
  });

  // The positive control: this is the behaviour that already ships, so it must
  // pass on origin/main as well as on this branch. If the harness itself were
  // broken (auth, routing, the temp db) this test would fail too, and no FAIL
  // above could be trusted.
  it("still writes the Airtable shadow, and the edit lands in Turso", async () => {
    await seedSite("recSite14", "omicron");
    const res = await post("omicron", "copyContact", "Call us any time.");
    expect(res.status).toBe(200);
    expect((await siteRow("recSite14"))?.copy_contact).toBe("Call us any time.");
    expect(shadowWrite).toHaveBeenCalledWith(
      expect.anything(),
      "recSite14",
      "Copy — Contact",
      "Call us any time.",
    );
  });

  it("a failing shadow write still reds the request, after Turso landed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await seedSite("recSite15", "pi");
    shadowWrite.mockRejectedValueOnce(new Error("Airtable 503"));
    const res = await post("pi", "copyIntro", "Shadow is down.");
    expect(res.status).toBe(502);
    // The authoritative store is written FIRST, so the outage costs only the
    // shadow — the operator's edit is not lost with it.
    expect((await siteRow("recSite15"))?.copy_intro).toBe("Shadow is down.");
    // A retry is idempotent and catches the shadow up.
    const retry = await post("pi", "copyIntro", "Shadow is down.");
    expect(retry.status).toBe(200);
    expect(shadowWrite).toHaveBeenLastCalledWith(
      expect.anything(),
      "recSite15",
      "Copy — Intro",
      "Shadow is down.",
    );
    err.mockRestore();
  });
});
