import { describe, it, expect } from "vitest";
import { verifyPrismicSecret } from "../../src/video-pipeline/webhook.js";

describe("webhook: verifyPrismicSecret", () => {
  it("true for the right secret", () => {
    expect(verifyPrismicSecret({ secret: "abc" }, "abc")).toBe(true);
  });
  it("false for the wrong secret", () => {
    expect(verifyPrismicSecret({ secret: "abd" }, "abc")).toBe(false);
  });
  it("false when body.secret is missing", () => {
    expect(verifyPrismicSecret({ type: "x" }, "abc")).toBe(false);
  });
  it("false when the configured secret is empty, even with an empty body secret", () => {
    expect(verifyPrismicSecret({ secret: "" }, "")).toBe(false);
    expect(verifyPrismicSecret({ secret: "" }, undefined)).toBe(false);
  });
  it("false for a non-object body", () => {
    expect(verifyPrismicSecret("abc", "abc")).toBe(false);
    expect(verifyPrismicSecret(null, "abc")).toBe(false);
  });
});
