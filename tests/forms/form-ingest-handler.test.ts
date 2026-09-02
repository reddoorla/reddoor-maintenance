/**
 * Handler-level tests for the lead hot path (#612 follow-up).
 *
 * The claim under test is the one the freeze made true and nothing asserted:
 * post-freeze `makeSiteLookup` is strict, so form ingest resolves a site from
 * Turso ALONE. Airtable is unreachable from this path — which means no Airtable
 * env var, credential or outage may be able to cost a lead.
 *
 * That was not what the handler did. A presence check on AIRTABLE_PAT /
 * AIRTABLE_BASE_ID sat in front of every POST and returned 500 — BEFORE
 * `ingestSubmission` is entered, so before the dead-letter that exists to catch
 * exactly this. `submitToIngest` does not retry. Every lead in such a window is
 * gone, announced by a log line.
 *
 * Both tests are deliberately handler-level rather than adapter-level: the
 * defect lived entirely in the glue that no unit test covers, and an assertion
 * on a pure helper would have passed throughout.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import type { Context } from "@netlify/functions";

// Mocked so the module graph can never reach a live base, AND so the second
// test can prove the hot path never even constructs one.
// hoisted: vi.mock's factory is lifted above the imports, so the spy has to be too.
const { openBaseMock } = vi.hoisted(() => ({ openBaseMock: vi.fn(() => ({}) as unknown) }));
vi.mock("../../src/reports/airtable/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/reports/airtable/client.js")>();
  return { ...actual, openBase: openBaseMock };
});

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
  openBaseMock.mockClear();
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

/** Only the vars the lead path legitimately needs. Airtable's are set by the
 *  caller when a test is about their presence. */
function baseEnv(): void {
  process.env.TURSO_DATABASE_URL = ":memory:";
  process.env.FORMS_INGEST_TOKEN = "tok";
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.AIRTABLE_PAT;
  delete process.env.AIRTABLE_BASE_ID;
  delete process.env.RESEND_API_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY_2;
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

describe("form-ingest — Airtable cannot cost a lead", () => {
  it("captures the lead with AIRTABLE_PAT and AIRTABLE_BASE_ID unset", async () => {
    baseEnv();
    await seedSite();

    const res = await formIngest(post(), ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: expect.any(String) });
  });

  it("never constructs an Airtable client on the hot path, even when configured", async () => {
    baseEnv();
    process.env.AIRTABLE_PAT = "pat-present";
    process.env.AIRTABLE_BASE_ID = "app-present";
    await seedSite();

    const res = await formIngest(post(), ctx);

    expect(res.status).toBe(200);
    // Post-freeze the fallback is never consulted, so building the base is pure
    // exposure: it is what let a credential problem reach the lead path at all.
    expect(openBaseMock).not.toHaveBeenCalled();
  });
});
