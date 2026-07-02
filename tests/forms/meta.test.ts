import { describe, it, expect } from "vitest";
import { readMeta } from "../../src/forms/meta.js";

describe("readMeta", () => {
  it("round-trips token/ip/ua from a well-formed _meta envelope", () => {
    const m = readMeta({
      email: "a@b.co",
      _meta: { turnstileToken: "tok", clientIp: "1.2.3.4", userAgent: "Mozilla/5.0" },
    });
    expect(m).toEqual({ turnstileToken: "tok", clientIp: "1.2.3.4", userAgent: "Mozilla/5.0" });
  });

  it("trims whitespace and drops blank string fields", () => {
    const m = readMeta({ _meta: { turnstileToken: "  tok  ", clientIp: "   ", userAgent: "" } });
    expect(m).toEqual({ turnstileToken: "tok" });
  });

  it("drops non-string fields (a bot can't smuggle a non-string clientIp/ua)", () => {
    const m = readMeta({ _meta: { turnstileToken: 123, clientIp: { x: 1 }, userAgent: null } });
    expect(m).toEqual({});
  });

  it("returns an empty object when _meta is absent, wrong-typed, or the payload is not an object", () => {
    expect(readMeta({ email: "a@b.co" })).toEqual({});
    expect(readMeta({ _meta: "nope" })).toEqual({});
    expect(readMeta(null)).toEqual({});
    expect(readMeta("nope")).toEqual({});
  });
});
