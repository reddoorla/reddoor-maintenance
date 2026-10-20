import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import { handle } from "../../src/hooks.server.js";
import { mintSession, SESSION_COOKIE } from "../../../src/dashboard/auth/session.js";
import { authHeader } from "../../../tests/_helpers/basic-auth.js";

/**
 * The cockpit's auth gate (#582): every page goes through `requireOperator`,
 * the gate the Netlify page functions call, before any load runs.
 */

const ORIGINAL_ENV = { ...process.env };
const SECRET = "test-session-secret-0123456789abcdef";

function event(headers: Record<string, string> = {}, path = "/fleet?sort=perf") {
  return {
    request: new Request(`https://cockpit.example${path}`, { headers }),
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
});
