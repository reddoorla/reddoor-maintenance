import { describe, it, expect } from "vitest";
import { verifyBasicAuth } from "../../src/dashboard/basic-auth.js";

// Build an Authorization header value from username + password.
function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf-8").toString("base64")}`;
}

describe("verifyBasicAuth", () => {
  it("accepts a valid password regardless of username", () => {
    expect(verifyBasicAuth(basic("anyone", "s3cret"), "s3cret")).toBe(true);
    expect(verifyBasicAuth(basic("", "s3cret"), "s3cret")).toBe(true);
    expect(verifyBasicAuth(basic("admin", "s3cret"), "s3cret")).toBe(true);
  });

  it("rejects a wrong password", () => {
    expect(verifyBasicAuth(basic("admin", "wrong"), "s3cret")).toBe(false);
  });

  it("returns false (does not throw) when provided/expected share JS length but differ in UTF-8 byte length", () => {
    // "abcd" is 4 bytes; "abcé" is 4 JS chars but 5 UTF-8 bytes (é = 2 bytes).
    // A JS-length-only guard would let these reach timingSafeEqual, which throws
    // a RangeError on a buffer-length mismatch → an uncaught 500. Must return false.
    const expected = "abcd";
    const provided = "abcé";
    expect(provided.length).toBe(expected.length); // equal JS length
    expect(() => verifyBasicAuth(basic("admin", provided), expected)).not.toThrow();
    expect(verifyBasicAuth(basic("admin", provided), expected)).toBe(false);
  });

  it("rejects when the Authorization header is missing", () => {
    expect(verifyBasicAuth(null, "s3cret")).toBe(false);
    expect(verifyBasicAuth(undefined, "s3cret")).toBe(false);
    expect(verifyBasicAuth("", "s3cret")).toBe(false);
  });

  it("rejects non-Basic auth schemes", () => {
    expect(verifyBasicAuth("Bearer abc123", "s3cret")).toBe(false);
    expect(verifyBasicAuth('Digest username="x"', "s3cret")).toBe(false);
  });

  it("rejects malformed base64", () => {
    expect(verifyBasicAuth("Basic !!!notbase64!!!", "s3cret")).toBe(false);
  });

  it("rejects decoded payloads with no colon (not user:password shape)", () => {
    const noColon = `Basic ${Buffer.from("nocolon", "utf-8").toString("base64")}`;
    expect(verifyBasicAuth(noColon, "s3cret")).toBe(false);
  });

  it("rejects when the expected password is null/empty (site has no DASHBOARD_PASSWORD set)", () => {
    expect(verifyBasicAuth(basic("admin", "anything"), "")).toBe(false);
    expect(verifyBasicAuth(basic("admin", "anything"), null)).toBe(false);
  });

  it("treats the 'Basic' scheme case-insensitively (per RFC 7235)", () => {
    const lower = `basic ${Buffer.from("u:s3cret", "utf-8").toString("base64")}`;
    expect(verifyBasicAuth(lower, "s3cret")).toBe(true);
  });
});
