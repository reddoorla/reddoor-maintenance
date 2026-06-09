import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Webhook } from "svix";
import { STATUS_MAP } from "../../src/reports/webhook-events.js";
import resendWebhook from "../../netlify/functions/resend-webhook.mjs";

// The webhook handler talks to Airtable via these two functions; mock the whole
// module so the signed-POST path can be exercised without a live base.
vi.mock("../../src/reports/airtable/reports.js", () => ({
  findReportByMessageId: vi.fn(),
  setDeliveryStatus: vi.fn(),
}));
import { findReportByMessageId, setDeliveryStatus } from "../../src/reports/airtable/reports.js";

// Imports the real STATUS_MAP from the webhook handler so a drift between code
// and "expected" mapping fails this test. (Previously this file declared its
// own copy of STATUS_MAP and asserted on it — drift-blind.)
describe("Resend webhook event → Delivery status mapping", () => {
  it("maps delivered/bounced/complained", () => {
    expect(STATUS_MAP["email.delivered"]).toBe("delivered");
    expect(STATUS_MAP["email.bounced"]).toBe("bounced");
    expect(STATUS_MAP["email.complained"]).toBe("complained");
  });

  it("ignores unmapped event types (no change to Airtable)", () => {
    expect(STATUS_MAP["email.sent"]).toBeUndefined();
    expect(STATUS_MAP["email.delivery_delayed"]).toBeUndefined();
    expect(STATUS_MAP["email.opened"]).toBeUndefined();
  });
});

describe("Resend webhook GET health check", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.AIRTABLE_PAT;
    delete process.env.AIRTABLE_BASE_ID;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  // The health check exists so the operator can curl the deployed URL right
  // after wiring Netlify env vars and confirm both (a) the function is reachable
  // and (b) the three required env vars made it through. Reports presence-only,
  // never values.
  it("returns 200 with all env vars absent when nothing is set", async () => {
    // @ts-expect-error — Netlify Context is unused for GET
    const res = await resendWebhook(new Request("https://x/", { method: "GET" }), {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      service: string;
      env: Record<string, boolean>;
    };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("reddoor-resend-webhook");
    expect(body.env).toEqual({
      RESEND_WEBHOOK_SECRET: false,
      AIRTABLE_PAT: false,
      AIRTABLE_BASE_ID: false,
    });
  });

  it("reports each env var as present once it's set, but never the value", async () => {
    process.env.RESEND_WEBHOOK_SECRET = "whsec_top_secret_should_not_leak";
    process.env.AIRTABLE_PAT = "pat_should_not_leak";
    process.env.AIRTABLE_BASE_ID = "appXXXXXXXXX";
    // @ts-expect-error — Netlify Context is unused for GET
    const res = await resendWebhook(new Request("https://x/", { method: "GET" }), {});
    const raw = await res.text();
    const body = JSON.parse(raw) as { env: Record<string, boolean> };
    expect(body.env).toEqual({
      RESEND_WEBHOOK_SECRET: true,
      AIRTABLE_PAT: true,
      AIRTABLE_BASE_ID: true,
    });
    // Defense-in-depth: the body must never contain a secret value, even
    // accidentally via a typo on the key name. Operators may share the curl
    // output in a support ticket.
    expect(raw).not.toContain("whsec_top_secret_should_not_leak");
    expect(raw).not.toContain("pat_should_not_leak");
    expect(raw).not.toContain("appXXXXXXXXX");
  });

  it("ignores GET requests entirely if the method isn't GET (POST still uses the existing flow)", async () => {
    // For POST without env vars set, the existing 500-on-missing-env behaviour
    // still applies — health check must not short-circuit POSTs.
    // @ts-expect-error — Netlify Context is unused
    const res = await resendWebhook(new Request("https://x/", { method: "POST", body: "{}" }), {});
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/RESEND_WEBHOOK_SECRET missing/);
  });
});

// A working svix test secret (svix's own docs use this shape). It only needs to
// round-trip sign→verify in-process; it is never a real Resend secret.
const TEST_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

// Build a signed POST exactly as Resend/svix would: a fresh svix-timestamp (so
// the signature passes svix's replay tolerance) wrapping a Resend event body.
// `createdAt` controls the *event's own* age, which is what the freshness-window
// logic keys off — independent of the svix delivery timestamp.
function signedResendPost(event: unknown): Request {
  const body = JSON.stringify(event);
  const msgId = "msg_test_2k9";
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

function resendEvent(
  type: string,
  opts: { emailId?: string; createdAt?: string } = {},
): Record<string, unknown> {
  return {
    type,
    created_at: opts.createdAt ?? new Date().toISOString(),
    data: { email_id: opts.emailId ?? "msgId_abc123" },
  };
}

const findReportMock = vi.mocked(findReportByMessageId);
const setStatusMock = vi.mocked(setDeliveryStatus);
const fakeReport = { id: "recReport123" } as Awaited<ReturnType<typeof findReportByMessageId>>;

describe("Resend webhook signed-POST path", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;
    process.env.AIRTABLE_PAT = "pat_test";
    process.env.AIRTABLE_BASE_ID = "appTestBase";
    findReportMock.mockReset();
    setStatusMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function post(event: unknown): Promise<Response> {
    // @ts-expect-error — Netlify Context is unused in the handler
    return resendWebhook(signedResendPost(event), {});
  }

  it("maps a delivered event to a Delivery-status update", async () => {
    findReportMock.mockResolvedValue(fakeReport);
    const res = await post(resendEvent("email.delivered", { emailId: "msgId_xyz" }));
    expect(res.status).toBe(200);
    expect(findReportMock).toHaveBeenCalledWith(expect.anything(), "msgId_xyz");
    expect(setStatusMock).toHaveBeenCalledWith(expect.anything(), "recReport123", "delivered");
  });

  it("rejects a tampered/invalid signature with 400", async () => {
    const good = signedResendPost(resendEvent("email.delivered"));
    const body = await good.text();
    const tampered = new Request("https://x/webhook", {
      method: "POST",
      body,
      headers: {
        "svix-id": good.headers.get("svix-id")!,
        "svix-timestamp": good.headers.get("svix-timestamp")!,
        "svix-signature": "v1,deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef=",
      },
    });
    // @ts-expect-error — Netlify Context is unused
    const res = await resendWebhook(tampered, {});
    expect(res.status).toBe(400);
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it("acknowledges an unmapped event type with 200 and no Airtable write", async () => {
    const res = await post(resendEvent("email.opened"));
    expect(res.status).toBe(200);
    expect(findReportMock).not.toHaveBeenCalled();
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it("acknowledges a mapped event missing data.email_id with 200 and no write", async () => {
    const res = await post({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: {},
    });
    expect(res.status).toBe(200);
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it("returns 500 so svix retries when no report matches and the event is still fresh (race)", async () => {
    findReportMock.mockResolvedValue(null);
    const res = await post(resendEvent("email.delivered", { createdAt: new Date().toISOString() }));
    expect(res.status).toBe(500);
  });

  it("returns 200 (orphan, stop retrying) when no report matches and the event is stale", async () => {
    findReportMock.mockResolvedValue(null);
    const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const res = await post(resendEvent("email.delivered", { createdAt: elevenMinAgo }));
    expect(res.status).toBe(200);
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it("falls back to 500 (retry) for an unmatched event with a missing/unparseable created_at", async () => {
    findReportMock.mockResolvedValue(null);
    const res = await post({ type: "email.delivered", data: { email_id: "msgId_no_ts" } });
    expect(res.status).toBe(500);
  });
});
