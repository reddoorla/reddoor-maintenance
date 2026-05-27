import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { STATUS_MAP } from "../../src/reports/webhook-events.js";
import resendWebhook from "../../netlify/functions/resend-webhook.mjs";

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
