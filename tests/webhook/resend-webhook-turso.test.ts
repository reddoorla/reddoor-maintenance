import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Webhook } from "svix";

/**
 * #539 Phase 6 step 2 (#646): the resend-webhook's REPORT path reads and writes
 * Turso.
 *
 * Unlike tests/webhook/resend-webhook.test.ts, nothing is mocked here: the
 * handler opens a real libSQL database — a throwaway `file:` database in a temp
 * dir (not `:memory:`, because every openDb on `:memory:` is a brand-new empty
 * database, and the handler opens its own). TURSO_DATABASE_URL is overwritten
 * and TURSO_AUTH_TOKEN deleted for every test, so an operator shell with real
 * Turso credentials exported can never point this suite at production.
 */
import resendWebhook from "../../netlify/functions/resend-webhook.mjs";
import { openDb, type Db } from "../../src/db/client.js";

const TEST_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const DIR = mkdtempSync(join(tmpdir(), "resend-webhook-turso-"));
let dbSeq = 0;
let url = "";
let db: Db;

function signedPost(event: unknown): Request {
  const body = JSON.stringify(event);
  const msgId = "msg_turso_test";
  const timestamp = new Date();
  const signature = new Webhook(TEST_SECRET).sign(msgId, timestamp, body);
  return new Request("https://x/webhook", {
    method: "POST",
    body,
    headers: {
      "svix-id": msgId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
      "content-type": "application/json",
    },
  });
}

async function post(type: string, emailId: string): Promise<Response> {
  const event = { type, created_at: new Date().toISOString(), data: { email_id: emailId } };
  // @ts-expect-error — Netlify Context is unused in the handler
  return resendWebhook(signedPost(event), {});
}

async function seedReport(id: string, messageId: string, status: string | null): Promise<void> {
  await db
    .insertInto("reports")
    .values({
      id,
      site_id: "recSite1",
      report_id: `${id}-2026-09`,
      resend_message_id: messageId,
      delivery_status: status,
    } as never)
    .execute();
}

async function statusOf(id: string): Promise<string | null | undefined> {
  const r = await db
    .selectFrom("reports")
    .select("delivery_status")
    .where("id", "=", id)
    .executeTakeFirst();
  return r?.delivery_status;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;
  delete process.env.TURSO_AUTH_TOKEN;
  url = `file:${join(DIR, `db-${++dbSeq}.sqlite`)}`;
  process.env.TURSO_DATABASE_URL = url;
  db = await openDb({ url });
});

afterEach(async () => {
  await db.destroy();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe("resend-webhook on Turso", () => {
  it("records a delivered event on the Turso report row — 200", async () => {
    await seedReport("recRep1", "msg_delivered_1", "pending");
    const res = await post("email.delivered", "msg_delivered_1");
    expect(await res.text()).toBe("OK");
    expect(res.status).toBe(200);
    expect(await statusOf("recRep1")).toBe("delivered");
  });

  it("records a bounce on the Turso report row (the submissions lookup misses first)", async () => {
    await seedReport("recRep2", "msg_bounce_2", "delivered");
    const res = await post("email.bounced", "msg_bounce_2");
    expect(res.status).toBe(200);
    expect(await statusOf("recRep2")).toBe("bounced");
  });

  it("the monotonic guard reads the Turso status: a late delivered never clobbers a bounce", async () => {
    await seedReport("recRep3", "msg_late_3", "bounced");
    const res = await post("email.delivered", "msg_late_3");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK (no downgrade)");
    expect(await statusOf("recRep3")).toBe("bounced");
  });

  it("an unmatched fresh event still 500s so svix retries (the stamp race), looked up in Turso", async () => {
    await seedReport("recRep4", "msg_other", "pending");
    const res = await post("email.delivered", "msg_not_stamped_yet");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("no matching report (will retry)");
    expect(await statusOf("recRep4")).toBe("pending");
  });

  it("a redelivered bounce re-applies idempotently: same rank is not a downgrade", async () => {
    await seedReport("recRep5", "msg_redelivered_5", "pending");
    const first = await post("email.bounced", "msg_redelivered_5");
    expect(first.status).toBe(200);
    const retry = await post("email.bounced", "msg_redelivered_5");
    expect(retry.status).toBe(200);
    expect(await retry.text()).toBe("OK");
    expect(await statusOf("recRep5")).toBe("bounced");
  });
});
