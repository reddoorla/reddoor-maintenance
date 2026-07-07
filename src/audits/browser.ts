import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";
import {
  discoverRoutes,
  familyCountsOf,
  type DiscoverDeps,
  type DiscoveredRoutes,
} from "./route-discovery.js";

/** One route probed across desktop engines + mobile devices, plus the internal links found on it,
 *  plus the chromium-derived reachability + SEO signals (captured on the page chromium already
 *  opened — no extra navigation). */
export type RouteResult = {
  url: string;
  /** Per desktop engine (chromium/firefox/webkit): loaded with no JS error + a visible main landmark. */
  desktop: Array<{ engine: string; ok: boolean }>;
  /** Per mobile device: loaded with no JS error and no horizontal overflow. */
  mobile: Array<{ device: string; ok: boolean }>;
  /** Same-origin links discovered on the page (absolute URLs), for the Links check. */
  links: string[];
  /** HTTP status of the chromium navigation (2xx/3xx = reachable). null = the nav failed/threw. */
  status: number | null;
  /** The chromium `<title>` (trimmed by the reducer), or null when not captured. */
  title: string | null;
  /** The chromium `meta[name="description"]` content, or null when absent/not captured. */
  metaDescription: string | null;
};

export type LinkResult = { url: string; status: number | null };

/** Injected browser IO. The real impl drives Playwright; tests pass a fake. */
export type BrowserRunner = {
  probe: (urls: string[]) => Promise<RouteResult[]>;
  checkLinks: (urls: string[]) => Promise<LinkResult[]>;
  close?: () => Promise<void>;
};

export type BrowserSummary = {
  desktopOk: boolean;
  mobileOk: boolean;
  linksOk: boolean;
  /** Every sampled route returned a 2xx/3xx status (point-in-time uptime). */
  reachableOk: boolean;
  /** Every sampled route has a non-empty `<title>` ≤ 70 chars + a non-empty meta description, and
   *  no two routes share a title. */
  titleMetaOk: boolean;
  brokenLinks: number;
  routesChecked: number;
  note: string;
};

/** A link status counts as broken when it didn't return a 2xx/3xx (null = unreachable). */
function isBroken(status: number | null): boolean {
  return status === null || status >= 400;
}

/**
 * Reduce raw per-route observations to the three checklist verdicts. PURE.
 * - desktopOk: EVERY route loaded cleanly in EVERY desktop engine.
 * - mobileOk: EVERY route loaded cleanly (no overflow / error) on EVERY mobile device.
 * - linksOk: NO internal link is broken.
 * Empty observations (a probe that produced nothing) → not ok (fail-safe: prove, don't assume).
 */
export function summarizeBrowser(
  routes: RouteResult[],
  links: LinkResult[],
  familyCounts: Record<string, number>,
): BrowserSummary {
  const desktopChecks = routes.flatMap((r) => r.desktop);
  const mobileChecks = routes.flatMap((r) => r.mobile);
  // Per-route completeness: EVERY route must carry observations AND every observation must be ok.
  // (Guarding only the flattened array would excuse a route that produced no observations at all —
  // a false green.) A route with an empty desktop[]/mobile[] (never rendered) → not ok.
  const desktopOk =
    routes.length > 0 && routes.every((r) => r.desktop.length > 0 && r.desktop.every((d) => d.ok));
  const mobileOk =
    routes.length > 0 && routes.every((r) => r.mobile.length > 0 && r.mobile.every((m) => m.ok));
  const brokenLinks = links.filter((l) => isBroken(l.status)).length;
  // linksOk requires links to have ACTUALLY been checked — zero links checked is "not proven",
  // never a pass (e.g. a JS-rendered page whose hrefs weren't in the DOM, or a chromium evaluate
  // that threw → []). Otherwise the box would assert "all links resolve" having checked nothing.
  const linksOk = links.length > 0 && brokenLinks === 0;

  // reachableOk: every sampled route returned 2xx/3xx. Empty observations → false (fail-safe).
  const reachableOk =
    routes.length > 0 && routes.every((r) => r.status !== null && r.status >= 200 && r.status < 400);

  // titleMetaOk (chromium-only signals): every route has a non-empty title ≤ 70 chars + a non-empty
  // meta description, AND no two routes share a title. Empty observations → false (fail-safe).
  const trimmedTitles = routes.map((r) => (r.title ?? "").trim());
  const eachTitleMetaValid =
    routes.length > 0 &&
    routes.every((r, i) => {
      const t = trimmedTitles[i]!;
      const desc = (r.metaDescription ?? "").trim();
      return t.length > 0 && t.length <= 70 && desc.length > 0;
    });
  const noDuplicateTitles = new Set(trimmedTitles).size === trimmedTitles.length;
  const titleMetaOk = eachTitleMetaValid && noDuplicateTitles;

  const engines = [...new Set(desktopChecks.map((d) => d.engine))];
  const devices = [...new Set(mobileChecks.map((m) => m.device))];
  const families = Object.entries(familyCounts)
    .map(([f, n]) => (f === "/" ? "/" : `${f} ×${n}`))
    .join(", ");
  const note =
    `${routes.length} routes (${families}); ` +
    `desktop ${engines.join("/") || "—"}; mobile ${devices.join("/") || "—"}; ` +
    `${links.length} links, ${brokenLinks} broken`;

  return {
    desktopOk,
    mobileOk,
    linksOk,
    reachableOk,
    titleMetaOk,
    brokenLinks,
    routesChecked: routes.length,
    note,
  };
}

/**
 * Deployed-URL browser audit: discovers a representative route set (incl. CMS templates), probes
 * each across desktop engines + mobile devices, and checks internal links — all against the LIVE
 * url (checkout-free). Skips a site with no deployed URL. Produces ONE AuditResult whose details
 * carry the three verdicts (Crossbrowser / Mobile / Links); the Airtable layer fans them out and
 * the auto-tick rule gates each on freshness.
 */
export async function browserAudit(ctx: AuditContext): Promise<AuditResult> {
  const { site } = ctx;
  const label = siteLabel(site);
  if (!site.deployedUrl) {
    return { audit: "browser", site: label, status: "skip", summary: "no deployed URL" };
  }
  const now = ctx.now ?? new Date();
  const discoverDeps = ctx.discoverDeps ?? defaultDiscoverDeps();
  const runner = ctx.browserRunner ?? (await defaultBrowserRunner());
  try {
    const discovered: DiscoveredRoutes = await discoverRoutes(site.deployedUrl, discoverDeps);
    const routeResults = await runner.probe(discovered.routes);
    const internalLinks = [...new Set(routeResults.flatMap((r) => r.links))];
    const linkResults = await runner.checkLinks(internalLinks);
    const summary = summarizeBrowser(
      routeResults,
      linkResults,
      discovered.familyCounts ?? familyCountsOf(discovered.routes),
    );
    const status: AuditResult["status"] =
      summary.desktopOk && summary.mobileOk && summary.linksOk ? "pass" : "warn";
    return {
      audit: "browser",
      site: label,
      status,
      summary: summary.note,
      details: { ...summary, checkedAt: now.toISOString() },
    };
  } finally {
    await runner.close?.();
  }
}

/** Bound the plain fetch()es (route-discovery GET + link HEAD/GET) so a host that hangs
 *  WITHOUT erroring can't stall the sequential fleet audit indefinitely. Playwright's
 *  page.goto already has PAGE_TIMEOUT_MS; these fetches had no ceiling. On abort the existing
 *  catch path treats it exactly like a network error (→ null), so a slow host degrades, never throws. */
const FETCH_TIMEOUT_MS = 10_000;

/** Real route-discovery fetch: GET text, null on any non-2xx / error / timeout. */
export function defaultDiscoverDeps(): DiscoverDeps {
  return {
    fetchText: async (url) => {
      try {
        const res = await fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        return await res.text();
      } catch {
        return null;
      }
    },
  };
}

const DESKTOP_VIEWPORT = { width: 1366, height: 900 };
const PAGE_TIMEOUT_MS = 30_000;

/**
 * Real Playwright runner. Launches chromium/firefox/webkit (desktop) + mobile-emulated chromium &
 * webkit, probes each route, and HEAD/GET-checks internal links. Every failure degrades to a
 * `false`/`null` (never throws past the audit), so a flaky run yields a non-pass (→ the box stays
 * manual) rather than a false green. Imported lazily so unit tests (which inject a fake runner)
 * never load Playwright.
 */
export async function defaultBrowserRunner(): Promise<BrowserRunner> {
  const { chromium, firefox, webkit, devices } = await import("@playwright/test");
  const desktopEngines = [
    { engine: "chromium", type: chromium },
    { engine: "firefox", type: firefox },
    { engine: "webkit", type: webkit },
  ];
  const mobileTargets = [
    { device: "Pixel 7", descriptor: devices["Pixel 7"] },
    { device: "iPhone 14", descriptor: devices["iPhone 14"] },
  ];

  return {
    async probe(urls) {
      const results: RouteResult[] = [];
      const browsers = await Promise.all(desktopEngines.map((e) => e.type.launch()));
      const mobileBrowsers = await Promise.all(mobileTargets.map(() => chromium.launch()));
      try {
        for (const url of urls) {
          const desktop: RouteResult["desktop"] = [];
          const linkSet = new Set<string>();
          let status: number | null = null;
          let title: string | null = null;
          let metaDescription: string | null = null;
          for (let i = 0; i < desktopEngines.length; i++) {
            const engine = desktopEngines[i]!.engine;
            const browser = browsers[i]!;
            const ctx = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
            const page = await ctx.newPage();
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(String(e)));
            let ok = false;
            try {
              const resp = await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: PAGE_TIMEOUT_MS,
              });
              const hasMain = await page
                .locator("main, [role=main]")
                .first()
                .isVisible()
                .catch(() => false);
              ok = !!resp && resp.ok() && errors.length === 0 && hasMain;
              if (engine === "chromium") {
                status = resp ? resp.status() : null;
                title = ((await page.title().catch(() => "")) as string).trim() || null;
                metaDescription =
                  (
                    ((await page
                      .evaluate(
                        "document.querySelector('meta[name=\"description\"]')?.getAttribute('content') || ''",
                      )
                      .catch(() => "")) as string) || ""
                  ).trim() || null;
                // Link discovery runs on chromium only (cost). Links coverage therefore depends on
                // chromium loading this route + the evaluate succeeding; if it yields nothing, the
                // Links verdict is "not proven" (links.length===0 ⇒ linksOk false), never a pass.
                // String-form evaluate so the browser-context code isn't type-checked against the
                // Node lib (no DOM globals in this project's tsconfig). Returns absolute hrefs.
                const hrefs = (await page
                  .evaluate("Array.from(document.querySelectorAll('a[href]')).map((a) => a.href)")
                  .catch(() => [])) as string[];
                const origin = new URL(url).origin;
                for (const h of hrefs) {
                  try {
                    if (new URL(h).origin === origin) linkSet.add(new URL(h).href);
                  } catch {
                    /* skip */
                  }
                }
              }
            } catch {
              ok = false;
            } finally {
              await ctx.close().catch(() => {});
            }
            desktop.push({ engine, ok });
          }

          const mobile: RouteResult["mobile"] = [];
          for (let i = 0; i < mobileTargets.length; i++) {
            const { device, descriptor } = mobileTargets[i]!;
            const browser = mobileBrowsers[i]!;
            const ctx = await browser.newContext({ ...descriptor });
            const page = await ctx.newPage();
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(String(e)));
            let ok = false;
            try {
              const resp = await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: PAGE_TIMEOUT_MS,
              });
              const overflow = (await page
                .evaluate("document.documentElement.scrollWidth > window.innerWidth + 2")
                .catch(() => true)) as boolean;
              ok = !!resp && resp.ok() && errors.length === 0 && !overflow;
            } catch {
              ok = false;
            } finally {
              await ctx.close().catch(() => {});
            }
            mobile.push({ device, ok });
          }

          results.push({ url, desktop, mobile, links: [...linkSet], status, title, metaDescription });
        }
      } finally {
        await Promise.all([...browsers, ...mobileBrowsers].map((b) => b.close().catch(() => {})));
      }
      return results;
    },

    async checkLinks(urls) {
      const out: LinkResult[] = [];
      for (const url of urls) {
        let status: number | null;
        try {
          let res = await fetch(url, {
            method: "HEAD",
            redirect: "follow",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          // Some servers reject HEAD (405/501) — retry GET before declaring it broken.
          if (res.status === 405 || res.status === 501) {
            res = await fetch(url, {
              method: "GET",
              redirect: "follow",
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
          }
          status = res.status;
        } catch {
          status = null;
        }
        out.push({ url, status });
      }
      return out;
    },
  };
}
