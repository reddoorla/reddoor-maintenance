import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import rateLimit, { config } from "../../netlify/edge-functions/cockpit-rate-limit.js";

/**
 * The cockpit pages' per-IP rate limit (#582 cutover). The five page functions
 * it replaces each carried `{ windowSize: 60, windowLimit: 60, aggregateBy:
 * ["ip"] }`; the SvelteKit adapter's page functions take no rate-limit option,
 * so the limit sits on an edge function in front of them.
 */

const ROOT = join(import.meta.dirname, "../..");
const ROUTES = join(ROOT, "cockpit/src/routes");

/** Every page route the cockpit serves, as a concrete path (`[slug]` → `x`). */
function pagePaths(dir = ROUTES, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      const seg = /^\[.+\]$/.test(e.name) ? "x" : e.name;
      return pagePaths(join(dir, e.name), `${prefix}/${seg}`);
    }
    return e.name === "+page.svelte" ? [prefix === "" ? "/" : prefix] : [];
  });
}

/** Functions that declare no `path` and answer only on
 *  /.netlify/functions/<name>: two scheduled clocks and the Resend webhook. */
const PATHLESS = ["nightly-clock", "nightly-send-clock", "resend-webhook"];

/** Every path another Netlify function declares, as a concrete path
 *  (`:token` → `x`). A function this parse reads no path from must be one of
 *  PATHLESS, so a spelling it cannot read fails here rather than passing. */
function functionPaths(): string[] {
  const dir = join(ROOT, "netlify/functions");
  return readdirSync(dir)
    .filter((f) => /\.m?[jt]s$/.test(f))
    .flatMap((f) => {
      const name = f.replace(/\.m?[jt]s$/, "");
      const src = readFileSync(join(dir, f), "utf8");
      const config = src.slice(src.indexOf("export const config"));
      const value = /\bpath:\s*(\[[^\]]*\]|"[^"]*"|'[^']*'|`[^`]*`)/.exec(config)?.[1] ?? "";
      const paths = [...value.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1] ?? "");
      if (paths.length === 0 && !PATHLESS.includes(name))
        throw new Error(`no path read from netlify/functions/${f}`);
      return [...paths, `/.netlify/functions/${name}`];
    })
    .map((p) => p.replace(/:[^/]+/g, "x"));
}

/** Netlify's path glob: `*` matches anything, `/` included. */
const glob = (pattern: string, path: string): boolean =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(path);

const limited = (path: string): boolean =>
  glob(config.path, path) && !config.excludedPath.some((p) => glob(p, path));

describe("the cockpit rate-limit edge function", () => {
  it("carries the page functions' limit", () => {
    expect(config.rateLimit).toEqual({ windowSize: 60, windowLimit: 60, aggregateBy: ["ip"] });
  });

  it("covers every page, each page's data endpoint, and unknown paths", () => {
    const pages = pagePaths();
    expect(pages).toContain("/s/x"); // the walk found the dynamic route
    const covered = [
      ...pages,
      ...pages.map((p) => `${p === "/" ? "" : p}/__data.json`),
      "/wp-login.php",
    ];
    expect(covered.filter((p) => !limited(p))).toEqual([]);
  });

  it("leaves every other function's paths, and the build assets, to themselves", () => {
    const owned = functionPaths();
    expect(owned).toContain("/api/forms/x"); // the parse found the declared paths
    expect(owned).toContain("/.netlify/functions/resend-webhook");
    expect([...owned, "/_app/immutable/entry/start.js"].filter(limited)).toEqual([]);
  });

  it("the glob is a real instrument: it limits a page and frees an endpoint", () => {
    expect(limited("/fleet")).toBe(true);
    expect(limited("/api/forms/x")).toBe(false);
  });

  it("passes every request on to the page, unchanged", async () => {
    const page = new Response("page");
    const next = vi.fn(async () => page);
    const res = await rateLimit(new Request("https://x/fleet"), { next });
    expect(next).toHaveBeenCalledOnce();
    expect(res).toBe(page);
  });
});
