import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import { handle, NOT_COCKPIT_PREFIXES, ENDPOINT_ROUTE_PREFIXES } from "../../src/hooks.server.js";
import { config as edgeRateLimit } from "../../../netlify/edge-functions/cockpit-rate-limit.js";
import { config as authRateLimit } from "../../../netlify/edge-functions/auth-rate-limit.js";
import { mintSession, SESSION_COOKIE } from "../../../src/dashboard/auth/session.js";
import { authHeader } from "../../../tests/_helpers/basic-auth.js";

/**
 * The cockpit's auth gate (#582): every page goes through `requireOperator`,
 * the gate the Netlify page functions call, before any load runs.
 */

const ORIGINAL_ENV = { ...process.env };
const SECRET = "test-session-secret-0123456789abcdef";

function event(
  headers: Record<string, string> = {},
  path = "/fleet?sort=perf",
  method = "GET",
  // SvelteKit's `event.url`: for a data request, the page's URL without `/__data.json`.
  url = `https://cockpit.example${path}`,
  // SvelteKit's `event.route.id`: the route the path matched, or null.
  routeId: string | null = null,
) {
  return {
    request: new Request(`https://cockpit.example${path}`, { headers, method }),
    url: new URL(url),
    route: { id: routeId },
    locals: {} as App.Locals,
  } as unknown as RequestEvent;
}

async function run(ev: RequestEvent) {
  const resolve = vi.fn(async () => new Response("page"));
  const res = await handle({ event: ev, resolve });
  return { res, resolve };
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    DASHBOARD_PASSWORD: "s3cret",
    DASHBOARD_SESSION_SECRET: SECRET,
    DASHBOARD_ALLOWED_EMAILS: "op@example.com",
    GOOGLE_OAUTH_CLIENT_ID: "id",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret",
  };
  delete process.env.CONTEXT;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("the cockpit auth hook", () => {
  it("redirects an unauthenticated navigation to sign-in, keeping where it was going", async () => {
    const { res, resolve } = await run(event());
    expect(resolve).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `/auth/login?returnTo=${encodeURIComponent("/fleet?sort=perf")}`,
    );
  });

  it("serves a signed-in operator and records the email for the shell", async () => {
    const token = mintSession("Op@Example.com", SECRET, new Date());
    const ev = event({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` });
    const { res, resolve } = await run(ev);
    expect(resolve).toHaveBeenCalledOnce();
    expect(await res.text()).toBe("page");
    expect(ev.locals.email).toBe("op@example.com");
  });

  it("serves the shared-password fallback with no identity", async () => {
    const ev = event(authHeader("s3cret"));
    const { resolve } = await run(ev);
    expect(resolve).toHaveBeenCalledOnce();
    expect(ev.locals.email).toBeNull();
  });

  it("refuses the shared password in production once Google sign-in is ready", async () => {
    process.env.CONTEXT = "production";
    const { res, resolve } = await run(event(authHeader("s3cret")));
    expect(resolve).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it("refuses a session signed with another secret", async () => {
    const token = mintSession("op@example.com", "another-secret-0123456789abcdef", new Date());
    const { resolve } = await run(
      event({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` }),
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses a cross-site POST with a 403 before auth, signed in or not", async () => {
    for (const headers of [{}, authHeader("s3cret")]) {
      const ev = event({ ...headers, "sec-fetch-site": "cross-site" }, "/submissions", "POST");
      const { res, resolve } = await run(ev);
      expect(resolve).not.toHaveBeenCalled();
      expect(res.status).toBe(403);
    }
  });

  it("lets a same-origin POST through to auth", async () => {
    const ev = event(
      { ...authHeader("s3cret"), "sec-fetch-site": "same-origin" },
      "/submissions",
      "POST",
    );
    const { resolve } = await run(ev);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("answers 404 before the gate under the prefixes no cockpit page owns, whatever the password", async () => {
    for (const path of [
      "/api/nope",
      "/auth/nope",
      "/r/a/b",
      "/_app/remote/x",
      "/.netlify/x",
      // Other spellings of the same prefixes, in case the edge router normalises
      // a path before testing its exclusions (review round 3).
      "/%61pi/nope",
      "/API/nope",
      "//api/nope",
      "/api",
      "/api%2Fnope",
      "/%2Fapi/nope",
    ]) {
      for (const pw of ["s3cret", "wrong"]) {
        // `event.url` as SvelteKit rewrites it for its own requests: not the raw path.
        const { res, resolve } = await run(
          event(authHeader(pw), path, "GET", "https://cockpit.example/fleet"),
        );
        expect([path, pw, res.status]).toEqual([path, pw, 404]);
        expect(resolve).not.toHaveBeenCalled();
      }
    }
  });

  it("still gates a page path beside those prefixes (the positive control)", async () => {
    const { res } = await run(event(authHeader("wrong"), "/rate"));
    expect(res.status).toBe(302);
  });

  it("returns a signed-out data request to the page, not to its JSON", async () => {
    const { res } = await run(
      event({}, "/fleet/__data.json?sort=perf", "GET", "https://cockpit.example/fleet?sort=perf"),
    );
    expect(res.headers.get("location")).toBe(
      `/auth/login?returnTo=${encodeURIComponent("/fleet?sort=perf")}`,
    );
  });

  it("refuses every prefix the edge rate limit leaves to other rules or none", () => {
    // An excluded path no route owns still reaches the cockpit, the site's one
    // function on `/*`. Off the dashboard's limit, it must never reach the
    // password check.
    const excluded = edgeRateLimit.excludedPath.map((p) => p.replace(/\*$/, ""));
    expect(excluded.filter((e) => !NOT_COCKPIT_PREFIXES.some((p) => e.startsWith(p)))).toEqual([]);
    // Sign-in, off the shared budget, has its own stricter rule.
    expect(excluded).toContain("/auth/");
    expect(authRateLimit.path).toBe("/auth/*");
  });

  it("hands a request that matched an endpoint route to it, ungated (each handler checks for itself)", async () => {
    for (const [path, routeId] of [
      ["/api/reports/rec1/approve", "/api/reports/[id]/approve"],
      ["/api/fleet/refresh/status", "/api/fleet/refresh/status"],
      ["/auth/login", "/auth/login"],
      ["/auth/basic", "/auth/basic"],
    ] as const) {
      // No credentials, and a cross-site POST: the handler, not the hook, answers.
      const ev = event({ origin: "https://evil.example" }, path, "POST", undefined, routeId);
      const { res, resolve } = await run(ev);
      expect([path, res.status]).toEqual([path, 200]);
      expect(resolve).toHaveBeenCalledOnce();
    }
  });

  it("still refuses an endpoint prefix no route matched, and a page route reached through one", async () => {
    for (const [path, routeId] of [
      ["/api/reports/rec1/nope", null],
      ["/API/reports/rec1/approve", null],
      ["/api/forms/a/b", null],
      // A route outside the endpoint prefixes is never served through them.
      ["/api%2Ffleet", "/fleet"],
      ["/r/a/b", "/r/[x]/[y]"],
      // An endpoint route reached through a prefix the edge limit skips.
      ["/_app/x", "/api/reports/[id]/approve"],
      ["/.netlify/x", "/auth/basic"],
    ] as const) {
      for (const pw of ["s3cret", "wrong"]) {
        const ev = event(authHeader(pw), path, "GET", "https://cockpit.example/fleet", routeId);
        const { res, resolve } = await run(ev);
        expect([path, pw, res.status]).toEqual([path, pw, 404]);
        expect(resolve).not.toHaveBeenCalled();
      }
    }
    expect(ENDPOINT_ROUTE_PREFIXES).toEqual(["/api/", "/auth/"]);
  });
});
