import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Webhook } from "svix";
import {
  STATUS_MAP,
  isStatusDowngrade,
  classifyUnmatchedEvent,
  ORPHAN_RETRY_WINDOW_MS,
} from "../../src/reports/webhook-events.js";
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

describe("isStatusDowngrade — monotonic delivery-status ordering", () => {
  it("flags a terminal failure being overwritten by delivered/pending as a downgrade", () => {
    expect(isStatusDowngrade("bounced", "delivered")).toBe(true);
    expect(isStatusDowngrade("bounced", "pending")).toBe(true);
    expect(isStatusDowngrade("complained", "delivered")).toBe(true);
    expect(isStatusDowngrade("complained", "pending")).toBe(true);
    expect(isStatusDowngrade("delivered", "pending")).toBe(true);
  });

  it("allows forward moves and same-rank rewrites (not a downgrade)", () => {
    expect(isStatusDowngrade("pending", "delivered")).toBe(false);
    expect(isStatusDowngrade("pending", "bounced")).toBe(false);
    expect(isStatusDowngrade("pending", "complained")).toBe(false);
    expect(isStatusDowngrade("delivered", "bounced")).toBe(false);
    expect(isStatusDowngrade("delivered", "complained")).toBe(false);
    // bounced and complained share a rank — neither downgrades the other.
    expect(isStatusDowngrade("bounced", "complained")).toBe(false);
    expect(isStatusDowngrade("complained", "bounced")).toBe(false);
    expect(isStatusDowngrade("delivered", "delivered")).toBe(false);
  });
});

describe("classifyUnmatchedEvent — orphan-vs-retry aging", () => {
  const NOW = Date.parse("2026-06-12T12:00:00.000Z");

  it("retries inside the race window (delivery beat the Airtable write)", () => {
    const createdAt = new Date(NOW - 1000).toISOString(); // 1s ago
    const { decision, ageMs } = classifyUnmatchedEvent(createdAt, NOW);
    expect(decision).toBe("retry");
    expect(ageMs).toBe(1000);
  });

  it("treats an event older than the window as a terminal orphan", () => {
    const createdAt = new Date(NOW - (ORPHAN_RETRY_WINDOW_MS + 1)).toISOString();
    const { decision } = classifyUnmatchedEvent(createdAt, NOW);
    expect(decision).toBe("orphan");
  });

  it("retries exactly at the window boundary (strictly-greater check)", () => {
    const createdAt = new Date(NOW - ORPHAN_RETRY_WINDOW_MS).toISOString();
    expect(classifyUnmatchedEvent(createdAt, NOW).decision).toBe("retry");
  });

  it("conservatively retries when created_at is missing or unparseable (can't be aged)", () => {
    expect(classifyUnmatchedEvent(undefined, NOW)).toEqual({ decision: "retry", ageMs: 0 });
    expect(classifyUnmatchedEvent("not-a-date", NOW)).toEqual({ decision: "retry", ageMs: 0 });
  });

  it("honours a custom window", () => {
    const createdAt = new Date(NOW - 5000).toISOString();
    expect(classifyUnmatchedEvent(createdAt, NOW, 1000).decision).toBe("orphan");
    expect(classifyUnmatchedEvent(createdAt, NOW, 10_000).decision).toBe("retry");
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

  // Build a matched report row carrying a specific current Delivery status, so
  // the handler's monotonic guard has something to compare against.
  function reportWith(status: string): Awaited<ReturnType<typeof findReportByMessageId>> {
    return { id: "recReport123", deliveryStatus: status } as Awaited<
      ReturnType<typeof findReportByMessageId>
    >;
  }

  it("does NOT downgrade a terminal 'bounced' when a late 'delivered' arrives (200, no write)", async () => {
    findReportMock.mockResolvedValue(reportWith("bounced"));
    const res = await post(resendEvent("email.delivered"));
    expect(res.status).toBe(200);
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it("does NOT downgrade a terminal 'complained' when a late 'delivered' arrives (200, no write)", async () => {
    findReportMock.mockResolvedValue(reportWith("complained"));
    const res = await post(resendEvent("email.delivered"));
    expect(res.status).toBe(200);
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it("still applies pending → delivered (forward move writes)", async () => {
    findReportMock.mockResolvedValue(reportWith("pending"));
    const res = await post(resendEvent("email.delivered"));
    expect(res.status).toBe(200);
    expect(setStatusMock).toHaveBeenCalledWith(expect.anything(), "recReport123", "delivered");
  });

  it("still applies pending → bounced (forward move writes)", async () => {
    findReportMock.mockResolvedValue(reportWith("pending"));
    const res = await post(resendEvent("email.bounced"));
    expect(res.status).toBe(200);
    expect(setStatusMock).toHaveBeenCalledWith(expect.anything(), "recReport123", "bounced");
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
