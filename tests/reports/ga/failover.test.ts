import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withSubjectFailover, isAuthShapedError } from "../../../src/reports/ga/failover.js";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

function authError(msg = "403 PERMISSION_DENIED"): Error {
  return Object.assign(new Error(msg), { code: 7 });
}

describe("isAuthShapedError", () => {
  it("matches HTTP 401/403 on status, code, and response.status", () => {
    expect(isAuthShapedError(Object.assign(new Error("x"), { status: 403 }))).toBe(true);
    expect(isAuthShapedError(Object.assign(new Error("x"), { code: 401 }))).toBe(true);
    expect(isAuthShapedError(Object.assign(new Error("x"), { response: { status: 403 } }))).toBe(
      true,
    );
  });

  it("matches gRPC PERMISSION_DENIED (7) and UNAUTHENTICATED (16) codes", () => {
    expect(isAuthShapedError(Object.assign(new Error("x"), { code: 7 }))).toBe(true);
    expect(isAuthShapedError(Object.assign(new Error("x"), { code: 16 }))).toBe(true);
  });

  it("matches auth-shaped messages (GA gRPC text, OAuth invalid_grant, plain 403s)", () => {
    // The exact shapes the two clients surface: GA Data API prefixes the gRPC code name;
    // a suspended/deleted subject fails token exchange with OAuth `invalid_grant`.
    expect(isAuthShapedError(new Error("7 PERMISSION_DENIED: user does not have access"))).toBe(
      true,
    );
    expect(isAuthShapedError(new Error("invalid_grant: Invalid email or User ID"))).toBe(true);
    expect(isAuthShapedError(new Error("unauthorized_client"))).toBe(true);
    expect(isAuthShapedError(new Error("Request failed with status code 403"))).toBe(true);
  });

  it("does NOT match non-auth failures (network, 5xx, invalid input)", () => {
    expect(isAuthShapedError(new Error("socket hang up"))).toBe(false);
    expect(isAuthShapedError(Object.assign(new Error("boom"), { status: 500 }))).toBe(false);
    expect(isAuthShapedError(new Error("3 INVALID_ARGUMENT: property required"))).toBe(false);
  });
});

describe("withSubjectFailover", () => {
  it("returns the first subject's result without warning", async () => {
    const attempt = vi.fn().mockResolvedValue(42);
    await expect(withSubjectFailover(["a@x.com", "b@x.com"], "GA", attempt)).resolves.toBe(42);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith("a@x.com");
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls through to the next subject on an auth error and warns greppably", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(authError()).mockResolvedValueOnce(7);
    await expect(withSubjectFailover(["dead@x.com", "live@x.com"], "GA", attempt)).resolves.toBe(7);
    expect(attempt).toHaveBeenNthCalledWith(1, "dead@x.com");
    expect(attempt).toHaveBeenNthCalledWith(2, "live@x.com");
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toContain("GA subject failover");
    expect(msg).toContain("dead@x.com");
    expect(msg).toContain("live@x.com");
  });

  it("throws the LAST error when every subject fails auth (callers soft-fail as before)", async () => {
    const last = authError("last");
    const attempt = vi.fn().mockRejectedValueOnce(authError("first")).mockRejectedValueOnce(last);
    await expect(withSubjectFailover(["a@x.com", "b@x.com"], "GA", attempt)).rejects.toBe(last);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does NOT fail over on a non-auth error — throws immediately", async () => {
    const attempt = vi.fn().mockRejectedValue(new Error("socket hang up"));
    await expect(withSubjectFailover(["a@x.com", "b@x.com"], "GA", attempt)).rejects.toThrow(
      "socket hang up",
    );
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("throws on an empty subject list", async () => {
    const attempt = vi.fn();
    await expect(withSubjectFailover([], "GA", attempt)).rejects.toThrow(/no.*subject/i);
    expect(attempt).not.toHaveBeenCalled();
  });
});
