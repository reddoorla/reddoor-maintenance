import { describe, it, expect } from "vitest";
import {
  mintSession,
  verifySession,
  sessionSetCookie,
  sessionClearCookie,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "../../../src/dashboard/auth/session.js";
import { sign } from "../../../src/dashboard/auth/signing.js";

const SECRET = "session-secret";
const NOW = new Date("2026-08-25T12:00:00Z");

describe("mintSession / verifySession", () => {
  it("round-trips a verified address", () => {
    const payload = verifySession(mintSession("tim@reddoorla.com", SECRET, NOW), SECRET, NOW);
    expect(payload?.email).toBe("tim@reddoorla.com");
  });

  it("lowercases the address so allowlist comparison never sees Google's casing", () => {
    const payload = verifySession(mintSession("Tim@ReddoorLA.com", SECRET, NOW), SECRET, NOW);
    expect(payload?.email).toBe("tim@reddoorla.com");
  });

  it("sets exp one TTL ahead of now", () => {
    const payload = verifySession(mintSession("a@b.com", SECRET, NOW), SECRET, NOW);
    expect(payload!.exp - payload!.iat).toBe(SESSION_TTL_SECONDS);
  });

  it("rejects an expired token", () => {
    const token = mintSession("a@b.com", SECRET, NOW, 60);
    const later = new Date(NOW.getTime() + 61_000);
    expect(verifySession(token, SECRET, later)).toBeNull();
  });

  it("treats exp exactly at now as expired", () => {
    const token = mintSession("a@b.com", SECRET, NOW, 60);
    expect(verifySession(token, SECRET, new Date(NOW.getTime() + 60_000))).toBeNull();
  });

  it("rejects a token signed with a rotated secret", () => {
    expect(verifySession(mintSession("a@b.com", SECRET, NOW), "rotated", NOW)).toBeNull();
  });

  it("accepts a future iat rather than treating clock skew as an attack", () => {
    // iat is carried for debugging and deliberately not enforced — rejecting a
    // future iat would turn skew between deploys into a mysterious sign-out.
    const skewed = sign(
      JSON.stringify({ email: "a@b.com", iat: 9_999_999_999, exp: 9_999_999_999 }),
      SECRET,
    );
    expect(verifySession(skewed, SECRET, NOW)?.email).toBe("a@b.com");
  });

  it("rejects a validly-signed token whose payload is the wrong shape", () => {
    // Signed by us, so `verify` passes — the shape check is what has to catch it.
    expect(verifySession(sign("not json", SECRET), SECRET, NOW)).toBeNull();
    expect(verifySession(sign(JSON.stringify({ exp: 1 }), SECRET), SECRET, NOW)).toBeNull();
    expect(
      verifySession(sign(JSON.stringify({ email: "", iat: 1, exp: 9e9 }), SECRET), SECRET, NOW),
    ).toBeNull();
    expect(
      verifySession(
        sign(JSON.stringify({ email: "a@b.com", iat: 1, exp: "soon" }), SECRET),
        SECRET,
        NOW,
      ),
    ).toBeNull();
    expect(verifySession(sign(JSON.stringify(null), SECRET), SECRET, NOW)).toBeNull();
  });

  it("rejects missing tokens", () => {
    expect(verifySession(null, SECRET, NOW)).toBeNull();
    expect(verifySession(undefined, SECRET, NOW)).toBeNull();
  });
});

describe("session cookies", () => {
  it("sets a root-path Lax cookie for the full TTL", () => {
    const header = sessionSetCookie("token-value");
    expect(header).toContain(`${SESSION_COOKIE}=token-value`);
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
  });

  it("uses SameSite=Lax, which the OAuth callback depends on", () => {
    // Strict withholds cookies on cross-site navigations, and the callback IS a
    // cross-site navigation from accounts.google.com. Strict here breaks sign-in.
    expect(sessionSetCookie("t")).toContain("SameSite=Lax");
  });

  it("clears at the same path it was set on", () => {
    expect(sessionClearCookie()).toContain("Max-Age=0");
    expect(sessionClearCookie()).toContain("Path=/");
  });
});
