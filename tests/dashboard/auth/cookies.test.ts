import { describe, it, expect } from "vitest";
import { readCookie, serializeCookie, clearCookie } from "../../../src/dashboard/auth/cookies.js";

describe("readCookie", () => {
  it("finds a cookie among several", () => {
    expect(readCookie("a=1; rd_session=abc; b=2", "rd_session")).toBe("abc");
  });

  it("tolerates missing spaces and odd padding", () => {
    expect(readCookie("a=1;rd_session=abc", "rd_session")).toBe("abc");
    expect(readCookie("  rd_session = abc  ", "rd_session")).toBe("abc");
  });

  it("returns null for a missing cookie or header", () => {
    expect(readCookie("a=1", "rd_session")).toBeNull();
    expect(readCookie(null, "rd_session")).toBeNull();
    expect(readCookie(undefined, "rd_session")).toBeNull();
    expect(readCookie("", "rd_session")).toBeNull();
  });

  it("does not match a cookie whose name merely ends with the target", () => {
    expect(readCookie("not_rd_session=abc", "rd_session")).toBeNull();
  });

  it("percent-decodes, round-tripping serializeCookie", () => {
    const header = serializeCookie("rd_session", "a b;c=d", { maxAgeSeconds: 60, path: "/" });
    const value = header.split(";")[0]!.slice("rd_session=".length);
    expect(readCookie(`rd_session=${value}`, "rd_session")).toBe("a b;c=d");
  });

  it("returns null (does not throw) on a malformed percent escape", () => {
    // Any client can send this; a decode failure must be a miss, not a 500.
    expect(() => readCookie("rd_session=%zz", "rd_session")).not.toThrow();
    expect(readCookie("rd_session=%zz", "rd_session")).toBeNull();
  });
});

describe("serializeCookie", () => {
  it("defaults to HttpOnly, Secure and SameSite=Lax", () => {
    const header = serializeCookie("rd_session", "abc", { maxAgeSeconds: 60, path: "/" });
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=60");
  });

  it("percent-encodes the value so it cannot forge extra attributes", () => {
    const header = serializeCookie("rd_session", "x; Domain=evil.com", {
      maxAgeSeconds: 60,
      path: "/",
    });
    expect(header).not.toContain("Domain=evil.com");
  });

  it("never emits a negative Max-Age", () => {
    expect(serializeCookie("x", "y", { maxAgeSeconds: -50, path: "/" })).toContain("Max-Age=0");
  });
});

describe("clearCookie", () => {
  it("expires immediately at the given path", () => {
    const header = clearCookie("rd_auth_state", "/auth");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Path=/auth");
  });
});
