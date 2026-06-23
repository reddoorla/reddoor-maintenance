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
  it("does not throw on differing lengths (digest-then-compare, not raw-buffer)", () => {
    // A raw timingSafeEqual on unequal-length buffers throws; the fixed-length
    // digest makes a length mismatch a normal false, not an exception.
    expect(() => verifyFormsToken("a", "aaaaaaaaaaaaaaaaaaaa")).not.toThrow();
    expect(verifyFormsToken("a", "aaaaaaaaaaaaaaaaaaaa")).toBe(false);
    // A long exact match still passes.
    const long = "x".repeat(512);
    expect(verifyFormsToken(long, long)).toBe(true);
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
  it("returns null for a bearer prefix with no token", () => {
    expect(bearerToken("Bearer ")).toBeNull();
  });
});
