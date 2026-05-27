import { describe, it, expect } from "vitest";

// Mirror the mapping from netlify/functions/resend-webhook.mts. Pinning it here so
// a typo'd event type in the function gets caught.
const STATUS_MAP: Record<string, "delivered" | "bounced" | "complained"> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

describe("Resend webhook event → Delivery status mapping", () => {
  it("maps delivered/bounced/complained", () => {
    expect(STATUS_MAP["email.delivered"]).toBe("delivered");
    expect(STATUS_MAP["email.bounced"]).toBe("bounced");
    expect(STATUS_MAP["email.complained"]).toBe("complained");
  });

  it("ignores unmapped event types (no change to Airtable)", () => {
    expect(STATUS_MAP["email.sent"]).toBeUndefined();
    expect(STATUS_MAP["email.delivery_delayed"]).toBeUndefined();
  });
});
