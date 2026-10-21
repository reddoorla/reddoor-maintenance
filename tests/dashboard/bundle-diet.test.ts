import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * The dashboard's server code must not import the report send pipeline or the
 * MJML renderer (maintenance#1642). Two value imports put them there: the site
 * page's view took `parseAddresses`/`withGlobalCc` from send/orchestrate.ts
 * (Playwright's header-image capture, Resend's React renderer) and
 * `rendersCommentary` from render.ts (MJML and its HTML toolchain). Each page
 * function was about 16 MB; the site view alone bundled to 3.3 MB, and 40 KB
 * once it imported the leaf modules instead.
 *
 * The walk follows static value imports (not `import type`, which bundles
 * nothing) from every file under cockpit/src: the pages, the hook and the
 * endpoint handlers, which are one function since #1645.
 */

const ROOT = join(import.meta.dirname, "../..");

const BANNED_FILES = ["src/reports/send/orchestrate.ts", "src/reports/render.ts"];
const BANNED_PACKAGES = ["mjml", "@playwright/test", "playwright", "playwright-core", "resend"];

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return filesUnder(full);
    return /\.(ts|svelte)$/.test(e.name) && !e.name.endsWith(".d.ts") ? [full] : [];
  });
}

/** Static value-import specifiers of one file. */
function specifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) out.push(m[1] ?? "");
  return out;
}

/** `./x.js` → the `.ts` (or `.svelte`, `/index.ts`) file it names. */
function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [base.replace(/\.js$/, ".ts"), base, `${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const packageOf = (spec: string) =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] ?? "");

/** Every banned file or package reachable from the entries, with one path to it. */
function reach(entries: string[]): string[] {
  const parent = new Map<string, string | null>(entries.map((e) => [e, null]));
  const queue = [...entries];
  const hits: string[] = [];
  const chain = (f: string) => {
    const out: string[] = [];
    for (let c: string | null | undefined = f; c; c = parent.get(c)) out.unshift(relative(ROOT, c));
    return out.join(" -> ");
  };
  while (queue.length) {
    const file = queue.shift() as string;
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) {
        const next = resolveLocal(file, spec);
        if (!next || parent.has(next)) continue;
        parent.set(next, file);
        if (BANNED_FILES.includes(relative(ROOT, next))) hits.push(chain(next));
        else queue.push(next);
      } else if (BANNED_PACKAGES.includes(packageOf(spec))) {
        hits.push(`${chain(file)} -> ${spec}`);
      }
    }
  }
  return hits;
}

// The pages, their loads, the hook and the dashboard's endpoint handlers
// (cockpit/src/lib/server/endpoints/) all live here since #1645.
const entries = filesUnder(join(ROOT, "cockpit/src"));

describe("the dashboard's server code stays off the send pipeline", () => {
  it("reaches neither the send orchestrator, the MJML renderer, nor their packages", () => {
    expect(reach(entries)).toEqual([]);
  });

  it("the walk is a real instrument: it finds the pipeline from the CLI's send command", () => {
    expect(entries.length).toBeGreaterThan(20);
    const hits = reach([join(ROOT, "src/reports/send/orchestrate.ts")]);
    expect(hits.some((h) => h.endsWith("-> resend") || h.includes("@playwright/test"))).toBe(true);
    expect(reach([join(ROOT, "src/reports/preflight.ts")])).toEqual([]);
  });
});
