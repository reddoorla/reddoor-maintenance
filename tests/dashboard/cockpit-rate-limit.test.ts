import { describe, it, expect, vi } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import rateLimit, { config } from "../../netlify/edge-functions/cockpit-rate-limit.js";

/**
 * The cockpit pages' per-IP rate limit (#582 cutover). The five page functions
 * it replaces each carried `{ windowSize: 60, windowLimit: 60, aggregateBy:
 * ["ip"] }`; the SvelteKit adapter's page functions take no rate-limit option,
 * so the limit sits on an edge function in front of them.
 */

const ROUTES = join(import.meta.dirname, "../../cockpit/src/routes");

/** Every page route the cockpit serves, as a Netlify path (`[slug]` → `*`). */
function pagePaths(dir = ROUTES, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      const seg = /^\[.+\]$/.test(e.name) ? "*" : e.name;
      return pagePaths(join(dir, e.name), `${prefix}/${seg}`);
    }
    return e.name === "+page.svelte" ? [prefix === "" ? "/" : prefix] : [];
  });
}

describe("the cockpit rate-limit edge function", () => {
  it("carries the page functions' limit", () => {
    expect(config.rateLimit).toEqual({ windowSize: 60, windowLimit: 60, aggregateBy: ["ip"] });
  });

  it("covers every page the cockpit serves, and nothing else", () => {
    expect([...config.path].sort()).toEqual(pagePaths().sort());
  });

  it("passes every request on to the page, unchanged", async () => {
    const page = new Response("page");
    const next = vi.fn(async () => page);
    const res = await rateLimit(new Request("https://x/fleet"), { next });
    expect(next).toHaveBeenCalledOnce();
    expect(res).toBe(page);
  });
});
