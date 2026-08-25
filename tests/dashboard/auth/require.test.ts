import { describe, it, expect } from "vitest";
import {
  requireOperator,
  readAuthConfig,
  pathWithQuery,
  denialResponse,
  type AuthRequestLike,
} from "../../../src/dashboard/auth/require.js";
import { mintSession, SESSION_COOKIE } from "../../../src/dashboard/auth/session.js";

const SECRET = "session-secret";
const NOW = new Date("2026-08-25T12:00:00Z");

/** A fully-configured production-shaped environment. */
function googleEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    DASHBOARD_SESSION_SECRET: SECRET,
    DASHBOARD_ALLOWED_EMAILS: "tucker@reddoorla.com,tim@reddoorla.com",
    GOOGLE_OAUTH_CLIENT_ID: "client-123",
    GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
    ...extra,
  } as NodeJS.ProcessEnv;
}

function req(headers: Record<string, string> = {}, url = "https://dash.example/audits?x=1") {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
  } satisfies AuthRequestLike;
}

function sessionCookie(email: string, secret = SECRET, now = NOW, ttl?: number) {
  return { cookie: `${SESSION_COOKIE}=${mintSession(email, secret, now, ttl)}` };
}

function basic(password: string) {
  return { authorization: `Basic ${Buffer.from(`op:${password}`, "utf-8").toString("base64")}` };
}

describe("requireOperator — session", () => {
  it("admits an allowlisted operator and reports their address", () => {
    const auth = requireOperator(req(sessionCookie("tim@reddoorla.com")), {
      wants: "redirect",
      env: googleEnv(),
      now: NOW,
    });
    expect(auth).toEqual({ ok: true, email: "tim@reddoorla.com" });
  });

  it("rejects an operator removed from the allowlist mid-session, and clears the cookie", () => {
    // The cookie is still cryptographically valid — this is the whole
    // revocation mechanism, and it must not depend on the cookie expiring.
    const auth = requireOperator(req(sessionCookie("erik@reddoorla.com")), {
      wants: "redirect",
      env: googleEnv(),
      now: NOW,
    });
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.denial.status).toBe(302);
    expect(auth.denial.headers.location).toBe("/auth/login?denied=1");
    expect(auth.denial.headers["set-cookie"]).toContain("Max-Age=0");
  });

  it("returns 403 rather than a redirect for a removed operator on a json route", () => {
    const auth = requireOperator(req(sessionCookie("erik@reddoorla.com")), {
      wants: "json",
      env: googleEnv(),
      now: NOW,
    });
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.denial.status).toBe(403);
    expect(auth.denial.headers["set-cookie"]).toContain("Max-Age=0");
  });

  it("does not admit an expired session", () => {
    const cookie = sessionCookie("tim@reddoorla.com", SECRET, NOW, 60);
    const auth = requireOperator(req(cookie), {
      wants: "redirect",
      env: googleEnv(),
      now: new Date(NOW.getTime() + 61_000),
    });
    expect(auth.ok).toBe(false);
  });

  it("does not admit a session signed with a different secret", () => {
    const cookie = sessionCookie("tim@reddoorla.com", "someone-elses-secret");
    const auth = requireOperator(req(cookie), { wants: "redirect", env: googleEnv(), now: NOW });
    expect(auth.ok).toBe(false);
  });

  it("does not admit a tampered cookie", () => {
    const auth = requireOperator(req({ cookie: `${SESSION_COOKIE}=v1.aaaa.bbbb` }), {
      wants: "redirect",
      env: googleEnv(),
      now: NOW,
    });
    expect(auth.ok).toBe(false);
  });
});

describe("requireOperator — unauthenticated", () => {
  it("redirects a navigation to the login page, preserving where it was going", () => {
    const auth = requireOperator(req(), { wants: "redirect", env: googleEnv(), now: NOW });
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.denial.status).toBe(302);
    expect(auth.denial.headers.location).toBe(
      `/auth/login?returnTo=${encodeURIComponent("/audits?x=1")}`,
    );
  });

  it("returns 401 JSON to a fetch, because a 302 to Google is useless inside fetch()", () => {
    const auth = requireOperator(req(), { wants: "json", env: googleEnv(), now: NOW });
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.denial.status).toBe(401);
    expect(auth.denial.contentType).toBe("application/json");
    expect(JSON.parse(auth.denial.body).error).toBe("unauthenticated");
  });

  it("never sends WWW-Authenticate, which would pop a native dialog mid-fetch", () => {
    const auth = requireOperator(req({}, "https://dash.example/api/fleet/refresh"), {
      wants: "json",
      env: googleEnv({ DASHBOARD_PASSWORD: "shared" }),
      now: NOW,
    });
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    const names = Object.keys(auth.denial.headers).map((h) => h.toLowerCase());
    expect(names).not.toContain("www-authenticate");
  });
});

describe("requireOperator — shared-password fallback", () => {
  it("admits a valid Basic credential with no identity to report", () => {
    const env = googleEnv({ DASHBOARD_PASSWORD: "shared" });
    expect(requireOperator(req(basic("shared")), { wants: "redirect", env, now: NOW })).toEqual({
      ok: true,
      email: null,
    });
  });

  it("rejects a wrong password", () => {
    const env = googleEnv({ DASHBOARD_PASSWORD: "shared" });
    expect(requireOperator(req(basic("wrong")), { wants: "redirect", env, now: NOW }).ok).toBe(
      false,
    );
  });

  it("prefers a valid session over Basic, so identity is not lost when both are present", () => {
    const env = googleEnv({ DASHBOARD_PASSWORD: "shared" });
    const headers = { ...sessionCookie("tim@reddoorla.com"), ...basic("shared") };
    expect(requireOperator(req(headers), { wants: "redirect", env, now: NOW })).toEqual({
      ok: true,
      email: "tim@reddoorla.com",
    });
  });

  it("authenticates a preview deploy that has ONLY the shared password", () => {
    // The case the ordering exists for. Treating a missing allowlist as an
    // immediate 503 would lock everyone out of every deploy preview, where
    // Google sign-in cannot work at all.
    const env = { DASHBOARD_PASSWORD: "shared" } as NodeJS.ProcessEnv;
    expect(requireOperator(req(basic("shared")), { wants: "redirect", env, now: NOW })).toEqual({
      ok: true,
      email: null,
    });
  });

  it("challenges rather than 503s on a preview with only the shared password and no credential", () => {
    const env = { DASHBOARD_PASSWORD: "shared" } as NodeJS.ProcessEnv;
    const auth = requireOperator(req(), { wants: "redirect", env, now: NOW });
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.denial.status).toBe(302);
  });
});

describe("requireOperator — unconfigured", () => {
  it("returns 503 when neither mechanism is configured", () => {
    const auth = requireOperator(req(), { wants: "redirect", env: {}, now: NOW });
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.denial.status).toBe(503);
  });

  it("returns 503 as JSON on a json route", () => {
    const auth = requireOperator(req(), { wants: "json", env: {}, now: NOW });
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.denial.status).toBe(503);
    expect(JSON.parse(auth.denial.body).error).toBe("unconfigured");
  });

  it("treats a blank allowlist as configured-but-empty, admitting nobody", () => {
    const env = googleEnv({ DASHBOARD_ALLOWED_EMAILS: "  " });
    const auth = requireOperator(req(sessionCookie("tim@reddoorla.com")), {
      wants: "redirect",
      env,
      now: NOW,
    });
    expect(auth.ok).toBe(false);
  });
});

describe("readAuthConfig", () => {
  it("reports googleReady only when every ingredient is present", () => {
    expect(readAuthConfig(googleEnv()).googleReady).toBe(true);
    expect(readAuthConfig(googleEnv({ GOOGLE_OAUTH_CLIENT_ID: "" })).googleReady).toBe(false);
    expect(readAuthConfig(googleEnv({ DASHBOARD_ALLOWED_EMAILS: "" })).googleReady).toBe(false);
    expect(readAuthConfig({} as NodeJS.ProcessEnv).googleReady).toBe(false);
  });

  it("treats whitespace-only values as unset", () => {
    const config = readAuthConfig({ DASHBOARD_PASSWORD: "   " } as NodeJS.ProcessEnv);
    expect(config.password).toBeNull();
  });
});

describe("pathWithQuery", () => {
  it("keeps the path and query, dropping the origin", () => {
    expect(pathWithQuery("https://dash.example/s/reddoorla?tab=x")).toBe("/s/reddoorla?tab=x");
  });

  it("falls back to / on an unparseable url", () => {
    expect(pathWithQuery("not a url")).toBe("/");
  });
});

describe("denialResponse", () => {
  it("carries status, content type and headers onto a Response", async () => {
    const res = denialResponse({
      status: 302,
      headers: { location: "/auth/login", "set-cookie": "rd_session=; Max-Age=0" },
      body: "Sign in to continue.",
      contentType: "text/plain",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login");
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("Sign in to continue.");
  });
});
