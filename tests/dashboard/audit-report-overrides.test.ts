import { describe, it, expect, afterEach, vi } from "vitest";
import type { Context } from "@netlify/functions";

vi.mock("../../src/reports/airtable/client.js", () => ({ openBase: vi.fn(() => ({}) as unknown) }));

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
import { createProspectAudit, getProspectAuditByToken } from "../../src/db/prospect-audits.js";
import saveOverrides from "../../netlify/functions/audit-report-overrides.mjs";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  sharedDb = null;
});

const ctxFor = (token: string) => ({ params: { token } }) as unknown as Context;

function post(body: unknown, token?: string): Request {
  return new Request("https://ops.reddoor.test/api/audit-report/x/overrides", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function seed() {
  process.env.TURSO_DATABASE_URL = ":memory:";
  process.env.PROSPECT_EDIT_TOKEN = "s3cret";
  const db = await openDb(readDbConfig());
  const { token } = await createProspectAudit(db, {
    url: "https://acme.test/",
    business: "Acme",
    resultJson: JSON.stringify({ url: "https://acme.test/" }),
  });
  return { db, token };
}

const MAP = { "composed:headlineFinding": { original: "a", text: "b" } };

describe("audit-report-overrides", () => {
  it("stores the map for a correct token", async () => {
    const { db, token } = await seed();
    const res = await saveOverrides(post({ overrides: MAP }, "s3cret"), ctxFor(token));
    expect(res.status).toBe(200);
    const row = await getProspectAuditByToken(db, token);
    expect(JSON.parse(row!.overrides_json!)).toEqual(MAP);
  });

  it("fails closed when PROSPECT_EDIT_TOKEN is unset", async () => {
    const { db, token } = await seed();
    delete process.env.PROSPECT_EDIT_TOKEN;
    const res = await saveOverrides(post({ overrides: MAP }, "s3cret"), ctxFor(token));
    expect(res.status).toBe(503);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses a wrong shared token, and says nothing about the report", async () => {
    const { db, token } = await seed();
    const res = await saveOverrides(post({ overrides: MAP }, "wrong"), ctxFor(token));
    expect(res.status).toBe(404);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses a missing authorization header", async () => {
    const { token } = await seed();
    const res = await saveOverrides(post({ overrides: MAP }), ctxFor(token));
    expect(res.status).toBe(404);
  });

  it("rejects a malformed override map with 400", async () => {
    const { db, token } = await seed();
    const res = await saveOverrides(
      post({ overrides: { k: { original: 1, text: "b" } } }, "s3cret"),
      ctxFor(token),
    );
    expect(res.status).toBe(400);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses GET", async () => {
    const { token } = await seed();
    const res = await saveOverrides(
      new Request("https://ops.reddoor.test/x", { method: "GET" }),
      ctxFor(token),
    );
    expect(res.status).toBe(405);
  });

  it("404s a malformed report token", async () => {
    await seed();
    const res = await saveOverrides(post({ overrides: MAP }, "s3cret"), ctxFor("nope"));
    expect(res.status).toBe(404);
  });
});
