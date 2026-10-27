import { describe, it, expect } from "vitest";
import { toFormType, toStatus, toNotifyStatus } from "../../src/reports/submission-row.js";

describe("submission-row validators", () => {
  it("toStatus falls back to new on bad input", () => {
    expect(toStatus("read")).toBe("read");
    expect(toStatus("garbage")).toBe("new");
    expect(toStatus(undefined)).toBe("new");
  });
  it("toStatus accepts spam_auto", () => {
    expect(toStatus("spam_auto")).toBe("spam_auto");
  });
  it("toNotifyStatus falls back to skipped", () => {
    expect(toNotifyStatus("sent")).toBe("sent");
    expect(toNotifyStatus("nope")).toBe("skipped");
  });
  it("toNotifyStatus accepts bounced (webhook-written terminal failure)", () => {
    expect(toNotifyStatus("bounced")).toBe("bounced");
  });
  it("toFormType falls back to contact", () => {
    expect(toFormType("newsletter")).toBe("newsletter");
    expect(toFormType("weird")).toBe("contact");
  });
});
