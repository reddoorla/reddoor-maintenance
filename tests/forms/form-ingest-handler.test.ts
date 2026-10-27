/**
 * Handler-level tests for the lead hot path (#612 follow-up).
 *
 * The claim under test: form ingest resolves a site from Turso ALONE
 * (`getSiteBySlug`).
 *
 * These tests are deliberately handler-level rather than adapter-level: the
 * glue is what no unit test covers.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import type { Context } from "@netlify/functions";

// The handler opens its own connection per invocation, and two ":memory:"
// clients share nothing — route both to one instance so a seeded site is
// visible to the handler. Mirrors audit-report-json.test.ts.
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
import { mirrorSiteInsert } from "../../src/db/fleet-state.js";
import formIngest from "../../netlify/functions/form-ingest.mjs";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  sharedDb = null;
});

const SLUG = "acme-gallery";
const NOW = "2026-09-02T12:00:00.000Z";

/** A site the hourly import would have written; `sites.slug` = siteSlug(Name). */
const SITE = {
  id: "recACME",
  fields: {
    Name: "Acme Gallery",
    Status: "live",
    url: "https://acme.example.com",
    "point of contact": "owner@acme.example.com",
  },
};

/** Only the vars the lead path legitimately needs. */
function baseEnv(): void {
  process.env.TURSO_DATABASE_URL = ":memory:";
  process.env.FORMS_INGEST_TOKEN = "tok";
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.RESEND_API_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY_2;
  delete process.env.TURNSTILE_SECRET_KEY_3;
}

async function seedSite(): Promise<void> {
  const db = await openDb(readDbConfig());
  await mirrorSiteInsert(db, SITE, NOW);
}

function post(): Request {
  return new Request(`https://ops.reddoor.test/api/forms/${SLUG}`, {
    method: "POST",
    headers: { "x-forms-token": "tok", "content-type": "application/json" },
    body: JSON.stringify({
      formType: "contact",
      name: "Jo Buyer",
      email: "jo@example.com",
      message: "Please get in touch about a new site.",
    }),
  });
}

const ctx = { params: { slug: SLUG } } as unknown as Context;

describe("form-ingest — the site resolves from Turso", () => {
  it("captures the lead for a site Turso holds", async () => {
    baseEnv();
    await seedSite();

    const res = await formIngest(post(), ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: expect.any(String) });
  });

  it("a slug Turso does not hold is an unknown site", async () => {
    baseEnv();
    await openDb(readDbConfig());

    const res = await formIngest(post(), ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "unknown-site" });
  });
});
