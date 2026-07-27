/// <reference lib="dom" />
// The evaluate() callbacks below run in the browser page context, so they use
// DOM globals (document/window). The CLI's base tsconfig is Node-only (lib
// ES2022); this directive adds DOM types for this file's type-checking.
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { chromium, type Page } from "@playwright/test";

// The Blux export's index.html renders its final layout only after its runtime
// JS applies height/position adjustments. Freezing the RAW html renders the
// wrong height (the-pointe: 16873px); freezing the JS-SETTLED DOM renders the
// live height (15333px). So the freeze hydrates the page once in headless
// chromium, scrolls top→bottom to trigger the layout pass, and snapshots the
// settled DOM. (Proven in the design POC scratchpad/freeze-final.mjs.)

export interface SettleOptions {
  /** Layout viewport — Blux desktop layout is authored at 1440. */
  width?: number;
  height?: number;
  /** Scroll step in px (smaller = more reliable lazy triggers, slower). */
  step?: number;
}

export interface SettledExport {
  /** The serialized settled DOM (full document HTML). */
  html: string;
  /**
   * Nav-anchor answer key, measured from the export's OWN runtime: hash index
   * → the id its JS actually scrolls to. Blux core maps `/#N` to
   * `page-block-N`, but site-specific custom scripts override that (the-pointe
   * embeds one sending any "Contact Us" link to `footer0`) — behavior no
   * static rule can recover, so it is recorded by clicking each hashlink with
   * `scrollPageToTarget` instrumented. Empty when the runtime is absent.
   */
  anchorTargets: Record<string, string>;
}

// Blux runtime globals reached from inside evaluate() callbacks. Types are
// erased before serialization, so declaring this at module level is safe.
type BluxWindow = Window & {
  DANDOM?: { prototype: { scrollPageToTarget?: (t: string) => unknown } };
  __rdAnchorCalls?: string[];
  alreadyScrolling?: boolean;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * One-shot local static server over the export dir, for the anchor audit ONLY.
 * The audit must run on an http origin: there `/#N` is a same-document hash
 * change (exactly the live site's semantics), while on `file://` it resolves
 * to the filesystem ROOT — a cross-document navigation that Blux's handler
 * chain triggers even past preventDefault + timer stubs, tearing the page down
 * mid-audit. Serving beats intercepting.
 */
async function serveExport(dir: string): Promise<{ url: string; server: Server }> {
  const root = normalize(dir);
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const path = decodeURIComponent((req.url ?? "/").split(/[?#]/)[0]!);
        const rel = path === "/" ? "index.html" : path.slice(1);
        // Separator-anchored: a bare prefix test would also pass sibling
        // dirs that merely share the prefix (/exports/site-secret vs
        // /exports/site).
        const file = normalize(join(root, rel));
        if (!file.startsWith(root + sep)) throw new Error("traversal");
        const body = await readFile(file);
        res.writeHead(200, {
          "content-type": MIME[extname(file)] ?? "application/octet-stream",
        });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("export server failed to bind");
  return { url: `http://127.0.0.1:${address.port}/`, server };
}

/**
 * Click every distinct `/#N` hashlink on the SERVED page and record the first
 * target the site's runtime passes to `scrollPageToTarget` — first, because on
 * the live site later calls in a click's handler chain are gated by
 * `alreadyScrolling`, so the first call is the one users see. The scroll
 * itself is suppressed (the wrapper records and returns), so clicks leave no
 * scroll state behind; the settle snapshot is taken from a separate file://
 * page that the audit never touches.
 */
async function auditAnchors(page: Page): Promise<Record<string, string>> {
  const ns = await page.evaluate(() => {
    const found = new Set<string>();
    for (const a of document.querySelectorAll('a[href^="/#"]')) {
      const m = /^\/#(\d+)$/.exec(a.getAttribute("href") ?? "");
      if (m?.[1]) found.add(m[1]);
    }
    return [...found];
  });
  if (ns.length === 0) return {};

  const instrumented = await page.evaluate(() => {
    const w = window as unknown as BluxWindow;
    const proto = w.DANDOM?.prototype;
    if (!proto?.scrollPageToTarget) return false;
    w.__rdAnchorCalls = [];
    proto.scrollPageToTarget = function (t: string) {
      w.__rdAnchorCalls?.push(t);
      return this; // record only — never actually scroll
    };
    return true;
  });
  if (!instrumented) return {};

  const targets: Record<string, string> = {};
  for (const n of ns) {
    // Audit EVERY link sharing this index, not just the first: custom scripts
    // intercept by link semantics (the-pointe keys on "Contact Us" text), so
    // two /#N links can legitimately scroll to different targets. The bake is
    // per-index, so disagreement can't be represented — surface it loudly and
    // bake the first link's (document-order) behavior.
    const count = await page.evaluate(
      (nn) => document.querySelectorAll(`a[href="/#${nn}"]`).length,
      n,
    );
    const seen: string[] = [];
    for (let i = 0; i < count; i++) {
      await page.evaluate(
        ({ nn, idx }) => {
          const w = window as unknown as BluxWindow;
          w.__rdAnchorCalls = [];
          w.alreadyScrolling = false;
          history.replaceState(null, "", "/");
          document.querySelectorAll<HTMLElement>(`a[href="/#${nn}"]`)[idx]?.click();
        },
        { nn: n, idx: i },
      );
      // checkScrollHash defers its core scroll 100ms past the hashchange (and
      // re-navigates at +50ms); 400ms covers the whole handler chain.
      await page.waitForTimeout(400);
      const first = await page.evaluate(
        () => (window as unknown as BluxWindow).__rdAnchorCalls?.[0] ?? null,
      );
      if (first) seen.push(first);
    }
    const distinct = [...new Set(seen)];
    if (distinct.length > 1) {
      console.warn(
        `[freeze] anchor /#${n}: links disagree on target (${distinct.join(", ")}) — ` +
          `baking "${seen[0]}" for all; verify that page's nav fidelity by hand`,
      );
    }
    if (seen[0]) targets[n] = seen[0];
  }
  return targets;
}

/**
 * Render a local `index.html` in headless chromium, let its JS settle the
 * layout, and return the serialized settled DOM plus the measured nav-anchor
 * answer key.
 */
export async function settleExport(
  indexHtmlPath: string,
  opts: SettleOptions = {},
): Promise<SettledExport> {
  const width = opts.width ?? 1440;
  const height = opts.height ?? 1000;
  const step = opts.step ?? 500;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`file://${indexHtmlPath}`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    // Trigger the JS layout pass across the whole page.
    const total = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < total + 1000; y += step) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1200);
    const html = await page.content();

    // Anchor audit on a separate, HTTP-served copy (see serveExport). Media
    // is aborted for speed — the audit needs handlers, not layout.
    const { url, server } = await serveExport(dirname(indexHtmlPath));
    try {
      const auditPage = await browser.newPage({
        viewport: { width, height },
      });
      await auditPage.route(
        "**/*",
        (route) =>
          void (["image", "media", "font"].includes(route.request().resourceType())
            ? route.abort()
            : route.continue()),
      );
      await auditPage.goto(url, { waitUntil: "load", timeout: 60000 });
      await auditPage.waitForTimeout(800);
      const anchorTargets = await auditAnchors(auditPage);
      await auditPage.close();
      return { html, anchorTargets };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await browser.close();
  }
}
