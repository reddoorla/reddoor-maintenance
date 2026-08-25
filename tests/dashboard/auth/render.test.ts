import { describe, it, expect } from "vitest";
import {
  renderLoginPageHtml,
  renderAuthChrome,
  loginErrorMessage,
  LOGIN_ERROR_MESSAGE,
} from "../../../src/dashboard/auth/render.js";

describe("loginErrorMessage", () => {
  it("maps every known code to its own message", () => {
    for (const code of Object.keys(LOGIN_ERROR_MESSAGE)) {
      expect(loginErrorMessage(code)).toBe(LOGIN_ERROR_MESSAGE[code]);
    }
  });

  it("falls back to a generic message for an unknown code", () => {
    expect(loginErrorMessage("anything-else")).toBe("Sign-in did not complete. Try again.");
  });

  it("returns null when there is no error at all", () => {
    expect(loginErrorMessage(null)).toBeNull();
    expect(loginErrorMessage(undefined)).toBeNull();
    expect(loginErrorMessage("")).toBeNull();
  });
});

describe("renderLoginPageHtml", () => {
  const base = { returnTo: "/audits", basicFallbackAvailable: false };

  it("offers Google sign-in and carries the returnTo through", () => {
    const html = renderLoginPageHtml(base);
    expect(html).toContain("Sign in with Google");
    expect(html).toContain(`returnTo=${encodeURIComponent("/audits")}`);
  });

  it("shows the shared-password link only when the fallback is available", () => {
    expect(renderLoginPageHtml(base)).not.toContain("/auth/basic");
    expect(renderLoginPageHtml({ ...base, basicFallbackAvailable: true })).toContain("/auth/basic");
  });

  it("explains a refusal and offers a different account", () => {
    const html = renderLoginPageHtml({ ...base, denied: true });
    expect(html).toContain("not on the cockpit's list");
    expect(html).toContain("switch=1");
  });

  it("renders a mapped message for a known error code", () => {
    expect(renderLoginPageHtml({ ...base, errorCode: "unverified" })).toContain("not verified");
  });

  it("never puts an attacker-supplied error code into the page", () => {
    // The code is a lookup key, never text. This is the whole reason the
    // messages live in a fixed table rather than coming off the query string.
    const html = renderLoginPageHtml({
      ...base,
      errorCode: '"><script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Sign-in did not complete");
  });

  it("percent-encodes returnTo so it cannot break out of the href attribute", () => {
    const html = renderLoginPageHtml({ ...base, returnTo: '/x"><script>alert(1)</script>' });
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("is marked noindex", () => {
    expect(renderLoginPageHtml(base)).toContain("noindex");
  });
});

describe("renderAuthChrome", () => {
  it("names the signed-in operator and offers sign out", () => {
    const html = renderAuthChrome("tim@reddoorla.com");
    expect(html).toContain("tim@reddoorla.com");
    expect(html).toContain('href="/auth/logout"');
  });

  it("renders nothing for a session with no identity", () => {
    // The shared-password fallback. Showing "signed in as cockpit" would dress
    // an anonymous shared credential up as a person.
    expect(renderAuthChrome(null)).toBe("");
    expect(renderAuthChrome(undefined)).toBe("");
    expect(renderAuthChrome("")).toBe("");
  });

  it("escapes the address", () => {
    expect(renderAuthChrome("<img src=x onerror=alert(1)>@evil.com")).not.toContain("<img");
  });
});
