import { describe, it, expect, afterEach, vi } from "vitest";
import type { Context } from "@netlify/functions";

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

const sent: unknown[] = [];
vi.mock("../../src/reports/send/resend.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/reports/send/resend.js")>();
  return {
    ...actual,
    defaultResendClient: () => ({
      send: async (input: unknown) => {
        sent.push(input);
        return { id: `msg-${sent.length}` };
      },
    }),
  };
});

import { openDb, readDbConfig } from "../../src/db/client.js";
import { listSites, mirrorSiteInsert } from "../../src/db/fleet-state.js";
import {
  countSubmissionsFiltered,
  countSubmissionsSinceBySite,
  listNewSubmissions,
} from "../../src/db/submissions.js";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import formIngest from "../../netlify/functions/form-ingest.mjs";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  sharedDb = null;
  sent.length = 0;
});

const SLUG = "acme-gallery";
const NOW = "2026-09-29T12:00:00.000Z";
const SITE = {
  id: "recACME",
  fields: {
    Name: "Acme Gallery",
    Status: "maintained",
    url: "https://acme.example.com",
    "point of contact": "owner@acme.example.com",
  },
};

function baseEnv(): void {
  process.env.TURSO_DATABASE_URL = ":memory:";
  process.env.FORMS_INGEST_TOKEN = "tok";
  process.env.RESEND_API_KEY = "re_test";
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY_2;
  delete process.env.TURNSTILE_SECRET_KEY_3;
}

const probeBody = (marked: boolean) => ({
  formType: "contact",
  name: "Reddoor Monitor",
  email: "monitor+e2e@reddoorla.com",
  phone: "5555550123",
  message: "Synthetic end-to-end health check — please ignore.",
  company: "Synthetic end-to-end health check — please ignore.",
  interest: "funds",
  ...(marked ? { testMode: true } : {}),
});

async function ingest(marked: boolean): Promise<Response> {
  baseEnv();
  const db = await openDb(readDbConfig());
  await mirrorSiteInsert(db, SITE, NOW);
  return formIngest(
    new Request(`https://ops.reddoor.test/api/forms/${SLUG}`, {
      method: "POST",
      headers: { "x-forms-token": "tok", "content-type": "application/json" },
      body: JSON.stringify(probeBody(marked)),
    }),
    { params: { slug: SLUG } } as unknown as Context,
  );
}

async function filters() {
  const db = await openDb(readDbConfig());
  const unread = await listNewSubmissions(db);
  const cockpit = buildCockpitModel(
    await listSites(db),
    [],
    {},
    "https://ops.reddoor.test",
    new Date(NOW),
    unread,
  );
  const stored = await db
    .selectFrom("submissions")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("site_id", "=", SITE.id)
    .executeTakeFirstOrThrow();
  const card = cockpit.cards.find((c) => c.site.name === SITE.fields.Name);
  return {
    notifications: sent.length,
    storedRows: Number(stored.n),
    unreadBadge: unread.length,
    unreadPage: await countSubmissionsFiltered(db, { status: "new" }),
    cockpitLeads: card?.newLeads ?? null,
    digestLeads:
      (await countSubmissionsSinceBySite(db, "2000-01-01T00:00:00.000Z")).get(SITE.id)?.leads ?? 0,
  };
}

describe("form-e2e's testMode marker reaches every filter (#779)", () => {
  it("control: the same submission WITHOUT the marker is emailed, unread and on the cockpit", async () => {
    const res = await ingest(false);
    expect(res.status).toBe(200);
    const seen = await filters();
    expect(seen.notifications).toBeGreaterThan(0);
    expect(seen).toEqual({
      notifications: seen.notifications,
      storedRows: 1,
      unreadBadge: 1,
      unreadPage: 1,
      cockpitLeads: 1,
      digestLeads: 1,
    });
  });

  it("the marked probe is accepted but reaches no inbox, no unread count and no cockpit", async () => {
    const res = await ingest(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(await filters()).toEqual({
      notifications: 0,
      storedRows: 0,
      unreadBadge: 0,
      unreadPage: 0,
      cockpitLeads: 0,
      digestLeads: 0,
    });
  });
});
