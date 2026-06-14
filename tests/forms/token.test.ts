import { describe, it, expect } from "vitest";
import { verifyFormsToken, bearerToken } from "../../src/forms/token.js";

describe("verifyFormsToken", () => {
  it("accepts an exact match", () => {
    expect(verifyFormsToken("s3cret", "s3cret")).toBe(true);
  });
  it("rejects a mismatch, a length mismatch, and empty inputs", () => {
    expect(verifyFormsToken("s3cret", "other!")).toBe(false);
    expect(verifyFormsToken("short", "longervalue")).toBe(false);
    expect(verifyFormsToken("", "x")).toBe(false);
    expect(verifyFormsToken("x", undefined)).toBe(false);
    expect(verifyFormsToken(null, "x")).toBe(false);
  });
});

describe("bearerToken", () => {
  it("parses a Bearer header case-insensitively", () => {
    expect(bearerToken("Bearer abc.def")).toBe("abc.def");
    expect(bearerToken("bearer   xyz")).toBe("xyz");
  });
  it("returns null for non-bearer or missing headers", () => {
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});
