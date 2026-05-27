import { describe, it, expect } from "vitest";
import { STATUS_MAP } from "../../src/reports/webhook-events.js";

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
