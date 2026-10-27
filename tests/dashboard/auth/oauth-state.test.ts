import { describe, it, expect } from "vitest";
import {
  mintOAuthState,
  verifyOAuthState,
  safeReturnTo,
  stateSetCookie,
  stateClearCookie,
  STATE_COOKIE,
} from "../../../src/dashboard/auth/oauth-state.js";
import { sign } from "../../../src/dashboard/auth/signing.js";

const SECRET = "state-secret";
const NOW = new Date("2026-08-25T12:00:00Z");

/** Built by codepoint rather than written as escapes, so no control byte ever
 *  appears literally in this file. */
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

describe("mintOAuthState / verifyOAuthState", () => {
  const input = { state: "st4te", verifier: "v3rifier", returnTo: "/audits?x=1" };

  it("round-trips state, verifier and returnTo", () => {
    const parsed = verifyOAuthState(mintOAuthState(input, SECRET, NOW), SECRET, NOW);
    expect(parsed).toMatchObject({ state: "st4te", verifier: "v3rifier", returnTo: "/audits?x=1" });
  });

  it("expires after its TTL", () => {
    const token = mintOAuthState(input, SECRET, NOW, 600);
    expect(verifyOAuthState(token, SECRET, new Date(NOW.getTime() + 601_000))).toBeNull();
  });

  it("rejects a forged or rotated-secret token", () => {
    expect(verifyOAuthState(mintOAuthState(input, SECRET, NOW), "other", NOW)).toBeNull();
    expect(verifyOAuthState("v1.aaaa.bbbb", SECRET, NOW)).toBeNull();
  });

  it("sanitises returnTo on the way out, not only on the way in", () => {
    // Signed by us, so the signature passes; the outbound guard is what stops a
    // hostile returnTo reaching a Location header.
    const hostile = sign(
      JSON.stringify({ state: "s", verifier: "v", returnTo: "//evil.com", exp: 9_999_999_999 }),
      SECRET,
    );
    expect(verifyOAuthState(hostile, SECRET, NOW)?.returnTo).toBe("/triage");
  });

  it("rejects payloads of the wrong shape", () => {
    expect(verifyOAuthState(sign("nope", SECRET), SECRET, NOW)).toBeNull();
    expect(verifyOAuthState(sign(JSON.stringify({ state: "s" }), SECRET), SECRET, NOW)).toBeNull();
  });
});

// P1-78f: every refusal falls back to the cockpit home, /triage until P1-78g (it was "/").
describe("safeReturnTo", () => {
  it("keeps ordinary same-origin paths", () => {
    expect(safeReturnTo("/audits")).toBe("/audits");
    expect(safeReturnTo("/s/reddoorla?tab=reports")).toBe("/s/reddoorla?tab=reports");
  });

  it("rejects absolute URLs", () => {
    expect(safeReturnTo("https://evil.com")).toBe("/triage");
    expect(safeReturnTo("http://evil.com/x")).toBe("/triage");
  });

  it("rejects protocol-relative and backslash forms that a startsWith('/') check would pass", () => {
    expect(safeReturnTo("//evil.com")).toBe("/triage");
    expect(safeReturnTo("/\\evil.com")).toBe("/triage");
  });

  it("rejects control characters, which would be header injection in Location", () => {
    expect(safeReturnTo("/audits\r\nSet-Cookie: x=1")).toBe("/triage");
    expect(safeReturnTo(`/audits${NUL}`)).toBe("/triage");
    expect(safeReturnTo(`/audits${DEL}`)).toBe("/triage");
  });

  it("refuses /auth/* so a successful sign-in cannot land back on the login page", () => {
    expect(safeReturnTo("/auth/login")).toBe("/triage");
    expect(safeReturnTo("/auth")).toBe("/triage");
    expect(safeReturnTo("/auth?x=1")).toBe("/triage");
  });

  it("falls back to the cockpit home (/triage, P1-78f) for empty and missing values", () => {
    expect(safeReturnTo("")).toBe("/triage");
    expect(safeReturnTo(null)).toBe("/triage");
    expect(safeReturnTo(undefined)).toBe("/triage");
    expect(safeReturnTo("   ")).toBe("/triage");
  });
});

describe("state cookies", () => {
  it("is scoped to /auth and short-lived", () => {
    const header = stateSetCookie("token");
    expect(header).toContain(`${STATE_COOKIE}=token`);
    expect(header).toContain("Path=/auth");
    expect(header).toContain("SameSite=Lax");
  });

  it("clears at the same path", () => {
    expect(stateClearCookie()).toContain("Path=/auth");
    expect(stateClearCookie()).toContain("Max-Age=0");
  });
});
