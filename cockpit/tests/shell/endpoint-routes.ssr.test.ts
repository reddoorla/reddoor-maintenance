import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { RequestEvent } from "@sveltejs/kit";

/**
 * The dashboard's `/api/*` and `/auth/*` endpoints, moved from Netlify
 * functions into the cockpit as `+server.ts` routes (maintenance#1642). The hook
 * hands a matched endpoint route its request without the page gate, so each
 * route must hand every method to its handler (which answers 405s itself) and
 * each `/api/*` handler must refuse a signed-out caller on its own.
 */

const ROUTES = join(import.meta.dirname, "../../src/routes");
const ORIGINAL_ENV = { ...process.env };

/** Every endpoint route: its file, and a concrete path (`[id]` → `rec1`). */
function endpointRoutes(
  dir = ROUTES,
): { file: string; path: string; params: Record<string, string> }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return endpointRoutes(full);
    if (e.name !== "+server.ts") return [];
    const params: Record<string, string> = {};
    const path = `/${relative(ROUTES, dir)}`
      .split("/")
      .map((seg) => {
        const m = /^\[(.+)\]$/.exec(seg);
        if (!m) return seg;
        params[m[1] ?? ""] = "rec1";
        return "rec1";
      })
      .join("/");
    return [{ file: full, path, params }];
  });
}

const routes = endpointRoutes();

async function call(
  route: (typeof routes)[number],
  method: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const mod = (await import(route.file)) as { fallback: (e: RequestEvent) => Promise<Response> };
  const request = new Request(`https://cockpit.example${route.path}`, { method, headers });
  return mod.fallback({ request, params: route.params } as unknown as RequestEvent);
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    DASHBOARD_PASSWORD: "s3cret",
    DASHBOARD_SESSION_SECRET: "test-session-secret-0123456789abcdef",
    DASHBOARD_ALLOWED_EMAILS: "op@example.com",
    GOOGLE_OAUTH_CLIENT_ID: "id",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret",
  };
  delete process.env.CONTEXT;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("the cockpit's endpoint routes", () => {
  it("are exactly the endpoints the dashboard's functions served", () => {
    expect(routes.map((r) => r.path).sort()).toEqual([
      "/api/fleet/refresh",
      "/api/fleet/refresh/status",
      "/api/prospect-audit/run",
      "/api/reports/rec1/approve",
      "/api/reports/rec1/commentary",
      "/api/reports/rec1/preview",
      "/api/reports/rec1/rerender",
      "/api/reports/rec1/unapprove",
      "/api/reports/rec1/withdraw",
      "/api/sites/rec1/details",
      "/api/sites/rec1/trigger-renovate",
      "/api/submissions/rec1/status",
      "/auth/basic",
      "/auth/callback",
      "/auth/login",
      "/auth/logout",
    ]);
  });

  it("each hands every method to its handler: one `fallback`, no per-method export", async () => {
    for (const route of routes) {
      const mod = (await import(route.file)) as Record<string, unknown>;
      expect([route.path, Object.keys(mod)]).toEqual([route.path, ["fallback"]]);
    }
  });

  it("a method no handler takes is the handler's own 405", async () => {
    for (const route of routes.filter((r) => r.path.startsWith("/api/"))) {
      const res = await call(route, "PUT", { origin: "https://cockpit.example" });
      expect([route.path, res.status]).toEqual([route.path, 405]);
    }
  });

  it("each /api handler refuses a signed-out caller itself", async () => {
    for (const route of routes.filter((r) => r.path.startsWith("/api/"))) {
      // The preview is the one read-only endpoint, GET only; the rest act on POST.
      const method = route.path.endsWith("/preview") ? "GET" : "POST";
      const res = await call(route, method, { origin: "https://cockpit.example" });
      // A JSON 401 for a fetch; the preview, opened as a page, sends the
      // visitor to sign-in instead.
      const refused =
        res.status === 401 ||
        (res.status === 302 && (res.headers.get("location") ?? "").startsWith("/auth/login"));
      expect([route.path, res.status, refused]).toEqual([route.path, res.status, true]);
    }
  });

  it("each state-changing /api handler refuses a cross-site POST itself", async () => {
    for (const route of routes.filter(
      (r) => r.path.startsWith("/api/") && !r.path.endsWith("/preview"),
    )) {
      const res = await call(route, "POST", { origin: "https://evil.example" });
      expect([route.path, res.status]).toEqual([route.path, 403]);
    }
  });
});
