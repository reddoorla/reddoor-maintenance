import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import rateLimit, { config } from "../../netlify/edge-functions/cockpit-rate-limit.js";
import authRateLimit, {
  config as authConfig,
} from "../../netlify/edge-functions/auth-rate-limit.js";

/**
 * The dashboard's per-IP rate limits (#582, maintenance#1642). Netlify's Pro
 * plan honours at most 5 code-based rate-limit rules per project; with 18
 * declared, none applied (260 requests from one IP, no 429), and with one rule
 * alone the deploy preview answered 429 from request 66 of 90. So the
 * dashboard is one SvelteKit function behind one edge rule on `/*`, sign-in has
 * a stricter edge rule of its own, and only the fleet's contact forms and the
 * Resend webhook keep a function rule.
 */

const ROOT = join(import.meta.dirname, "../..");
const ROUTES = join(ROOT, "cockpit/src/routes");
const FUNCTIONS = join(ROOT, "netlify/functions");
const EDGE = join(ROOT, "netlify/edge-functions");

const MAX_RULES = 5;

/** Every route file of one kind the cockpit serves, as a concrete path (`[slug]` → `x`). */
function routePaths(file: "+page.svelte" | "+server.ts", dir = ROUTES, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      const seg = /^\[.+\]$/.test(e.name) ? "x" : e.name;
      return routePaths(file, join(dir, e.name), `${prefix}/${seg}`);
    }
    return e.name === file ? [prefix === "" ? "/" : prefix] : [];
  });
}

/** Functions that declare no `path` and answer only on
 *  /.netlify/functions/<name>: two scheduled clocks and the Resend webhook. */
const PATHLESS = ["nightly-clock", "nightly-send-clock", "resend-webhook"];

const sources = (dir: string) =>
  readdirSync(dir)
    .filter((f) => /\.m?[jt]s$/.test(f))
    .map((f) => ({ name: f.replace(/\.m?[jt]s$/, ""), src: readFileSync(join(dir, f), "utf8") }));

/** Every path a Netlify function answers, as a concrete path (`:token` → `x`),
 *  with whether that function declares its own `rateLimit`. A function with a
 *  `path` answers only there (Netlify drops its default URL); one without
 *  answers on /.netlify/functions/<name>. A function this parse reads no path
 *  from must be one of PATHLESS, so a spelling it cannot read fails here
 *  rather than passing. */
function functionPaths(): { path: string; ownRule: boolean }[] {
  return sources(FUNCTIONS).flatMap(({ name, src }) => {
    const cfg = src.slice(src.indexOf("export const config"));
    const value = /\bpath:\s*(\[[^\]]*\]|"[^"]*"|'[^']*'|`[^`]*`)/.exec(cfg)?.[1] ?? "";
    const paths = [...value.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1] ?? "");
    if (paths.length === 0 && !PATHLESS.includes(name))
      throw new Error(`no path read from netlify/functions/${name}`);
    const ownRule = /^\s*rateLimit:/m.test(cfg);
    return (paths.length ? paths : [`/.netlify/functions/${name}`]).map((p) => ({
      path: p.replace(/:[^/]+/g, "x"),
      ownRule,
    }));
  });
}

/** Netlify's path glob: `*` matches anything, `/` included. */
const glob = (pattern: string, path: string): boolean =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(path);

const limited = (path: string): boolean =>
  glob(config.path, path) && !config.excludedPath.some((p) => glob(p, path));
const authLimited = (path: string): boolean => glob(authConfig.path, path);

describe("the dashboard's rate-limit rules", () => {
  it("declares at most five rules across functions and edge functions", () => {
    const rules = [...sources(FUNCTIONS), ...sources(EDGE)].filter(({ src }) =>
      /^\s*rateLimit:/m.test(src),
    );
    expect(rules.map((r) => r.name).sort()).toEqual([
      "auth-rate-limit",
      "cockpit-rate-limit",
      "form-ingest",
      "resend-webhook",
    ]);
    expect(rules.length).toBeLessThanOrEqual(MAX_RULES);
  });

  it("gives the dashboard one budget of 120 a minute per IP", () => {
    expect(config.rateLimit).toEqual({ windowSize: 60, windowLimit: 120, aggregateBy: ["ip"] });
  });

  it("covers every page, each page's data, every cockpit endpoint and unknown paths", () => {
    const pages = routePaths("+page.svelte");
    const apis = routePaths("+server.ts").filter((p) => p.startsWith("/api/"));
    expect(pages).toContain("/s/x"); // the walk found the dynamic route
    expect(apis).toContain("/api/reports/x/approve"); // and the endpoint routes
    const covered = [
      ...pages,
      ...pages.map((p) => `${p === "/" ? "" : p}/__data.json`),
      ...apis,
      "/api/nope",
      "/r/a/b",
      "/wp-login.php",
    ];
    expect(covered.filter((p) => !limited(p))).toEqual([]);
  });

  it("limits sign-in on its own rule, at the old auth function's 30 a minute", () => {
    const auth = routePaths("+server.ts").filter((p) => p.startsWith("/auth/"));
    expect(auth.sort()).toEqual(["/auth/basic", "/auth/callback", "/auth/login", "/auth/logout"]);
    expect([...auth, "/auth/nope"].filter((p) => !authLimited(p) || limited(p))).toEqual([]);
    expect(authConfig.rateLimit).toEqual({ windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] });
  });

  it("leaves no function path unlimited: each is under the edge rule or has its own, never both", () => {
    const owned = functionPaths();
    const paths = owned.map((o) => o.path);
    expect(paths).toContain("/api/forms/x"); // the parse found the declared paths
    expect(paths).toContain("/r/x");
    expect(paths).toContain("/.netlify/functions/resend-webhook");
    const clocks = (p: string) => /^\/\.netlify\/functions\/nightly-/.test(p);
    expect(owned.filter((o) => !clocks(o.path) && o.ownRule === limited(o.path))).toEqual([]);
  });

  it("leaves the build assets alone", () => {
    expect(limited("/_app/immutable/entry/start.js")).toBe(false);
  });

  it("the glob is a real instrument: it limits a page and frees the contact forms", () => {
    expect(limited("/fleet")).toBe(true);
    expect(limited("/api/forms/x")).toBe(false);
  });

  it("passes every request on, unchanged", async () => {
    for (const fn of [rateLimit, authRateLimit]) {
      const page = new Response("page");
      const next = vi.fn(async () => page);
      const res = await fn(new Request("https://x/fleet"), { next });
      expect(next).toHaveBeenCalledOnce();
      expect(res).toBe(page);
    }
  });
});
