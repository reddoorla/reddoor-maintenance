import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withSubjectFailover,
  isAuthShapedError,
  isQuotaShapedError,
} from "../../../src/reports/ga/failover.js";

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

/** A marked "this subject can't see the resource" sentinel (the search client's
 *  empty-sites.list case) — auth-shaped for failover purposes, but weaker evidence
 *  than a real auth failure. */
function sentinelError(msg = "no property visible"): Error {
  return Object.assign(new Error(msg), { failoverToNextSubject: true });
}

/** A webmasters-v3-style per-user quota 403 (gaxios shape). */
function quotaError(reason = "userRateLimitExceeded"): Error {
  return Object.assign(new Error("User Rate Limit Exceeded"), {
    response: { status: 403, data: { error: { errors: [{ reason }] } } },
  });
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

describe("isQuotaShapedError", () => {
  it("matches webmasters-v3 per-user quota 403s by structured reason", () => {
    expect(isQuotaShapedError(quotaError("userRateLimitExceeded"))).toBe(true);
    expect(isQuotaShapedError(quotaError("quotaExceeded"))).toBe(true);
    expect(isQuotaShapedError(quotaError("dailyLimitExceeded"))).toBe(true);
    expect(isQuotaShapedError(quotaError("rateLimitExceeded"))).toBe(true);
  });

  it("matches quota-shaped messages when no structured reason survives", () => {
    expect(isQuotaShapedError(new Error("Quota exceeded for quota metric"))).toBe(true);
    expect(isQuotaShapedError(new Error("User Rate Limit Exceeded"))).toBe(true);
  });

  it("does NOT match real access failures", () => {
    expect(isQuotaShapedError(quotaError("forbidden"))).toBe(false);
    expect(isQuotaShapedError(new Error("7 PERMISSION_DENIED: no access"))).toBe(false);
    expect(isQuotaShapedError(new Error("invalid_grant: Invalid email or User ID"))).toBe(false);
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

  // A real auth failure must dominate a soft sentinel regardless of subject order — otherwise
  // the search client would convert the last-thrown sentinel into a clean not-found and mask
  // the outage (the confirmed masking bug this fix closes).
  it("throws the REAL auth error, not a later sentinel [real-auth, sentinel]", async () => {
    const real = authError("suspended primary");
    const attempt = vi.fn().mockRejectedValueOnce(real).mockRejectedValueOnce(sentinelError());
    await expect(withSubjectFailover(["a@x.com", "b@x.com"], "SEARCH", attempt)).rejects.toBe(real);
    expect(warn).not.toHaveBeenCalled();
  });

  it("throws the REAL auth error, not an earlier sentinel [sentinel, real-auth]", async () => {
    const real = authError("suspended backup");
    const attempt = vi.fn().mockRejectedValueOnce(sentinelError()).mockRejectedValueOnce(real);
    await expect(withSubjectFailover(["a@x.com", "b@x.com"], "SEARCH", attempt)).rejects.toBe(real);
    expect(warn).not.toHaveBeenCalled();
  });

  it("throws the sentinel only when EVERY subject returns the sentinel", async () => {
    const last = sentinelError("b has no property");
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(sentinelError("a has no property"))
      .mockRejectedValueOnce(last);
    const err = await withSubjectFailover(["a@x.com", "b@x.com"], "SEARCH", attempt).catch(
      (e) => e,
    );
    expect(err).toBe(last);
    expect((err as { failoverToNextSubject?: boolean }).failoverToNextSubject).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("softens the warning to 'transient quota/rate-limit' when all failures were quota", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(quotaError()).mockResolvedValueOnce(9);
    await expect(withSubjectFailover(["a@x.com", "b@x.com"], "SEARCH", attempt)).resolves.toBe(9);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toMatch(/transient quota\/rate-limit/i);
    expect(msg).not.toContain("runbook");
    expect(msg).not.toContain("ga-search-role-account-cutover");
  });

  it("keeps the runbook warning when any failure was a real access loss (not quota)", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(quotaError())
      .mockRejectedValueOnce(authError("invalid_grant"))
      .mockResolvedValueOnce(9);
    await expect(
      withSubjectFailover(["a@x.com", "b@x.com", "c@x.com"], "SEARCH", attempt),
    ).resolves.toBe(9);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toContain("ga-search-role-account-cutover.md");
  });
});
