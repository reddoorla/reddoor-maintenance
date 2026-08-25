import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Context } from "@netlify/functions";

// Only the two network-touching functions are stubbed; PKCE, the authorize-URL
// builder and the endpoint constants stay real, so this exercises the actual
// URL the operator would be sent to.
vi.mock("../../../src/dashboard/auth/google.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    exchangeCodeForTokens: vi.fn(async () => ({ ok: true, accessToken: "at-1" })),
    fetchVerifiedEmail: vi.fn(async () => ({ ok: true, email: "tim@reddoorla.com" })),
  };
});

import { exchangeCodeForTokens, fetchVerifiedEmail } from "../../../src/dashboard/auth/google.js";
import { mintOAuthState, STATE_COOKIE } from "../../../src/dashboard/auth/oauth-state.js";
import { SESSION_COOKIE, verifySession } from "../../../src/dashboard/auth/session.js";
import authFn from "../../../netlify/functions/auth.mjs";

const exchangeMock = vi.mocked(exchangeCodeForTokens);
const emailMock = vi.mocked(fetchVerifiedEmail);

const SECRET = "session-secret";
const ORIGINAL_ENV = { ...process.env };
const ctx = {} as unknown as Context;

function get(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "GET", headers });
}

/** Every Set-Cookie on a response, since sign-in sets two at once. */
function cookies(res: Response): string[] {
  const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  return getSetCookie ? getSetCookie.call(res.headers) : [res.headers.get("set-cookie") ?? ""];
}

function cookieFor(res: Response, name: string): string | undefined {
  return cookies(res).find((c) => c.startsWith(`${name}=`));
}

function googleConfigured() {
  process.env.DASHBOARD_SESSION_SECRET = SECRET;
  process.env.DASHBOARD_ALLOWED_EMAILS = "tucker@reddoorla.com,tim@reddoorla.com";
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-123";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
  process.env.DASHBOARD_BASE_URL = "https://dash.reddoor.test";
}

beforeEach(() => {
  for (const key of [
    "DASHBOARD_SESSION_SECRET",
    "DASHBOARD_ALLOWED_EMAILS",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "DASHBOARD_PASSWORD",
    "DASHBOARD_BASE_URL",
  ]) {
    delete process.env[key];
  }
  exchangeMock.mockResolvedValue({ ok: true, accessToken: "at-1" });
  emailMock.mockResolvedValue({ ok: true, email: "tim@reddoorla.com" });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("GET /auth/login — the page", () => {
  it("renders a Google sign-in link", async () => {
    googleConfigured();
    const res = await authFn(get("https://dash.reddoor.test/auth/login"), ctx);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Sign in with Google");
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("is never cached or indexed", async () => {
    googleConfigured();
    const res = await authFn(get("https://dash.reddoor.test/auth/login"), ctx);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toMatch(/noindex/);
  });

  it("offers the shared-password route only when DASHBOARD_PASSWORD is set", async () => {
    googleConfigured();
    expect(
      await (await authFn(get("https://dash.reddoor.test/auth/login"), ctx)).text(),
    ).not.toContain("/auth/basic");

    process.env.DASHBOARD_PASSWORD = "shared";
    expect(await (await authFn(get("https://dash.reddoor.test/auth/login"), ctx)).text()).toContain(
      "/auth/basic",
    );
  });

  it("explains a refusal on ?denied=1 and offers a different account", async () => {
    googleConfigured();
    const body = await (
      await authFn(get("https://dash.reddoor.test/auth/login?denied=1"), ctx)
    ).text();
    expect(body).toContain("not on the cockpit's list");
    expect(body).toContain("switch=1");
  });

  it("maps a known error code to its message", async () => {
    googleConfigured();
    const body = await (
      await authFn(get("https://dash.reddoor.test/auth/login?error=state"), ctx)
    ).text();
    expect(body).toContain("expired or was already used");
  });

  it("never echoes an unknown error code into the page", async () => {
    googleConfigured();
    const body = await (
      await authFn(
        get("https://dash.reddoor.test/auth/login?error=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E"),
        ctx,
      )
    ).text();
    expect(body).not.toContain("onerror");
    expect(body).toContain("Sign-in did not complete");
  });
});

describe("GET /auth/login?start=1 — beginning the flow", () => {
  it("redirects to Google with PKCE and sets the state cookie", async () => {
    googleConfigured();
    const res = await authFn(
      get("https://dash.reddoor.test/auth/login?start=1&returnTo=%2Faudits"),
      ctx,
    );
    expect(res.status).toBe(302);

    const target = new URL(res.headers.get("location")!);
    expect(target.host).toBe("accounts.google.com");
    expect(target.searchParams.get("client_id")).toBe("client-123");
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.get("redirect_uri")).toBe("https://dash.reddoor.test/auth/callback");
    expect(target.searchParams.get("prompt")).toBeNull();

    const state = cookieFor(res, STATE_COOKIE);
    expect(state).toBeDefined();
    expect(state).toContain("Path=/auth");
    expect(state).toContain("HttpOnly");
  });

  it("forces the account chooser only on the switch path", async () => {
    googleConfigured();
    const res = await authFn(get("https://dash.reddoor.test/auth/login?switch=1"), ctx);
    const target = new URL(res.headers.get("location")!);
    expect(target.searchParams.get("prompt")).toBe("select_account");
  });

  it("falls back to the page with ?error=config when Google is not configured", async () => {
    // Preview-shaped deploy: shared password only. Must not 503 — the login
    // page still has to render so the shared-password link is reachable.
    process.env.DASHBOARD_PASSWORD = "shared";
    const res = await authFn(get("https://dash.reddoor.test/auth/login?start=1"), ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login?error=config");
  });
});

describe("GET /auth/callback", () => {
  function stateCookie(returnTo = "/audits", state = "st4te") {
    const token = mintOAuthState({ state, verifier: "v3rifier", returnTo }, SECRET, new Date());
    return { cookie: `${STATE_COOKIE}=${encodeURIComponent(token)}` };
  }

  it("signs in an allowlisted operator and returns them to where they were going", async () => {
    googleConfigured();
    const res = await authFn(
      get("https://dash.reddoor.test/auth/callback?code=abc&state=st4te", stateCookie()),
      ctx,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/audits");

    const session = cookieFor(res, SESSION_COOKIE);
    expect(session).toBeDefined();
    const token = decodeURIComponent(session!.split(";")[0]!.split("=")[1]!);
    expect(verifySession(token, SECRET, new Date())?.email).toBe("tim@reddoorla.com");

    // The exchange got the verifier out of the signed cookie, not the query.
    expect(exchangeMock).toHaveBeenCalledWith(expect.objectContaining({ verifier: "v3rifier" }));
  });

  it("clears the state cookie on success — it must not outlive its attempt", async () => {
    googleConfigured();
    const res = await authFn(
      get("https://dash.reddoor.test/auth/callback?code=abc&state=st4te", stateCookie()),
      ctx,
    );
    expect(cookieFor(res, STATE_COOKIE)).toContain("Max-Age=0");
  });

  it("refuses a state that does not match the cookie, and issues no session", async () => {
    googleConfigured();
    const res = await authFn(
      get("https://dash.reddoor.test/auth/callback?code=abc&state=WRONG", stateCookie()),
      ctx,
    );
    expect(res.headers.get("location")).toBe("/auth/login?error=state");
    expect(cookieFor(res, SESSION_COOKIE)).toBeUndefined();
    expect(cookieFor(res, STATE_COOKIE)).toContain("Max-Age=0");
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("refuses a callback with no state cookie at all", async () => {
    googleConfigured();
    const res = await authFn(
      get("https://dash.reddoor.test/auth/callback?code=abc&state=st4te"),
      ctx,
    );
    expect(res.headers.get("location")).toBe("/auth/login?error=state");
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("sends a non-allowlisted address to ?denied=1 without a session", async () => {
    googleConfigured();
    emailMock.mockResolvedValue({ ok: true, email: "attacker@evil.com" });
    const res = await authFn(
      get("https://dash.reddoor.test/auth/callback?code=abc&state=st4te", stateCookie()),
      ctx,
    );
    expect(res.headers.get("location")).toBe("/auth/login?denied=1");
    expect(cookieFor(res, SESSION_COOKIE)).toBeUndefined();
  });

  it("reports an unverified Google address distinctly", async () => {
    googleConfigured();
    emailMock.mockResolvedValue({
      ok: false,
      error: "google reports this address as unverified",
    });
    const res = await authFn(
      get("https://dash.reddoor.test/auth/callback?code=abc&state=st4te", stateCookie()),
      ctx,
    );
    expect(res.headers.get("location")).toBe("/auth/login?error=unverified");
  });

  it("treats a failed exchange as a retryable error, not a sign-in", async () => {
    googleConfigured();
    exchangeMock.mockResolvedValue({ ok: false, error: "token endpoint 400: invalid_grant" });
    const res = await authFn(
      get("https://dash.reddoor.test/auth/callback?code=abc&state=st4te", stateCookie()),
      ctx,
    );
    expect(res.headers.get("location")).toBe("/auth/login?error=exchange");
    expect(cookieFor(res, SESSION_COOKIE)).toBeUndefined();
  });

  it("treats a cancelled sign-in as a plain return to the login page, not an error", async () => {
    googleConfigured();
    const res = await authFn(
      get("https://dash.reddoor.test/auth/callback?error=access_denied", stateCookie()),
      ctx,
    );
    expect(res.headers.get("location")).toBe("/auth/login");
  });

  it("sanitises a returnTo smuggled into the state cookie", async () => {
    googleConfigured();
    const res = await authFn(
      get(
        "https://dash.reddoor.test/auth/callback?code=abc&state=st4te",
        stateCookie("//evil.com"),
      ),
      ctx,
    );
    expect(res.headers.get("location")).toBe("/");
  });
});

describe("GET /auth/logout", () => {
  it("clears the session and returns to the login page", async () => {
    googleConfigured();
    const res = await authFn(get("https://dash.reddoor.test/auth/logout"), ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login");
    expect(cookieFor(res, SESSION_COOKIE)).toContain("Max-Age=0");
  });
});

describe("GET /auth/basic", () => {
  it("challenges when no credential is supplied", async () => {
    googleConfigured();
    process.env.DASHBOARD_PASSWORD = "shared";
    const res = await authFn(get("https://dash.reddoor.test/auth/basic"), ctx);
    expect(res.status).toBe(401);
    // The one place a challenge is ever sent — deliberately, so the browser
    // will offer the cached credential to the rest of the site afterwards.
    expect(res.headers.get("www-authenticate")).toMatch(/Basic realm="Reddoor fleet"/);
  });

  it("redirects to a safe returnTo once the password validates", async () => {
    googleConfigured();
    process.env.DASHBOARD_PASSWORD = "shared";
    const authHeader = `Basic ${Buffer.from("op:shared", "utf-8").toString("base64")}`;
    const res = await authFn(
      get("https://dash.reddoor.test/auth/basic?returnTo=%2Fsubmissions", {
        authorization: authHeader,
      }),
      ctx,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/submissions");
  });

  it("refuses an open redirect through returnTo", async () => {
    googleConfigured();
    process.env.DASHBOARD_PASSWORD = "shared";
    const authHeader = `Basic ${Buffer.from("op:shared", "utf-8").toString("base64")}`;
    const res = await authFn(
      get("https://dash.reddoor.test/auth/basic?returnTo=https%3A%2F%2Fevil.com", {
        authorization: authHeader,
      }),
      ctx,
    );
    expect(res.headers.get("location")).toBe("/");
  });

  it("404s when no shared password is configured, rather than advertising a prompt", async () => {
    googleConfigured();
    const res = await authFn(get("https://dash.reddoor.test/auth/basic"), ctx);
    expect(res.status).toBe(404);
  });
});

describe("method and route gating", () => {
  it("405s a non-GET", async () => {
    googleConfigured();
    const res = await authFn(
      new Request("https://dash.reddoor.test/auth/login", { method: "POST" }),
      ctx,
    );
    expect(res.status).toBe(405);
  });

  it("404s an unknown /auth path", async () => {
    googleConfigured();
    const res = await authFn(get("https://dash.reddoor.test/auth/nope"), ctx);
    expect(res.status).toBe(404);
  });
});
