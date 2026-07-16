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

/** What a plain (non-browser) GET of a route observed. `status: null` = network error/timeout. */
export type PageFetch = {
  status: number | null;
  title: string | null;
  metaDescription: string | null;
};

/** Injected plain-fetch re-verification IO (see reverifyRoutes). Tests pass a fake. */
export type VerifyDeps = {
  fetchPage: (url: string) => Promise<PageFetch>;
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
  /** The confirmed-failing routes behind a reachableOk=false, as "url → status" strings, so the
   *  operator sees WHICH url failed, not just "fail". Empty when reachableOk is true. */
  unreachableUrls: string[];
  /** The per-route findings behind a titleMetaOk=false ("url: missing meta description",
   *  'duplicate title "X": urlA + urlB', …). Empty when titleMetaOk is true. */
  titleMetaProblems: string[];
  brokenLinks: number;
  routesChecked: number;
  note: string;
};

/** A link status counts as broken when it didn't return a 2xx/3xx (null = unreachable). */
function isBroken(status: number | null): boolean {
  return status === null || status >= 400;
}

/** True for a 2xx/3xx observation (the "reachable" bar routes must clear). */
function isOkStatus(status: number | null): status is number {
  return status !== null && status >= 200 && status < 400;
}

/** Decode the handful of HTML entities that show up in real `<title>`s so lengths/duplicate
 *  comparisons match what `page.title()` (which decodes) would have reported. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

/** Pull `<title>` + `meta[name="description"]` out of raw HTML (SSR truth — what crawlers see).
 *  Tolerant regex parse: attribute order-independent for the meta tag. PURE; exported for tests. */
export function extractTitleMeta(html: string): {
  title: string | null;
  metaDescription: string | null;
} {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = t?.[1] ? decodeEntities(t[1]).trim() || null : null;
  let metaDescription: string | null = null;
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    if (!/\bname\s*=\s*["']description["']/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const raw = content?.[2] ?? content?.[3] ?? "";
    metaDescription = decodeEntities(raw).trim() || null;
    break;
  }
  return { title, metaDescription };
}

/** One plain-fetch re-check of a browser-probed route: what the browser saw vs what a plain GET
 *  (no browser) saw. Kept in the audit details so a WAF-challenged run is visible, not silent. */
export type Reverification = {
  url: string;
  browserStatus: number | null;
  fetchedStatus: number | null;
};

/** Cooldown-retry schedule for the reachability re-check. Live measurement 2026-07-16: right
 *  after the ~75-navigation probe burst, the WAF rate-flags the runner's IP so even the plain
 *  fetch briefly 403s — but a plain fetch ~60s later is 200 again. A fail only persists when the
 *  URL stays bad across these waits (total ~60s). Definitive answers (404/410) skip the retries. */
const REVERIFY_RETRY_DELAYS_MS = [15_000, 45_000];

/** A status worth a cooldown retry: WAF-challenge/rate-limit shapes (403/408/429), server errors,
 *  and null (timeout / network error) can all be transient. 404/410 are definitive. */
function isRetryableStatus(status: number | null): boolean {
  return status === null || status === 403 || status === 408 || status === 429 || status >= 500;
}

/**
 * Re-verify browser observations with a plain fetch BEFORE any fail verdict can persist.
 * WHY (2026-07-16): hosts' bot protection (Netlify WAF et al.) intermittently serves 403
 * challenge interstitials to the headless-browser probe burst — status 403, `<title>` = the bare
 * domain, no meta — while the site is perfectly up for real visitors (plain fetch → 200). That
 * poisoned Uptime-Reachable AND Titles-&-Meta on most of the fleet. So:
 * - a route whose browser status was non-2xx/3xx (or null) is re-fetched plainly, with cooldown
 *   retries for transient shapes; only a CONFIRMED non-2xx/timeout keeps the bad status. A
 *   confirmed-ok route also takes its title/meta from the served HTML (the browser DOM was a
 *   challenge page — worthless).
 * - a route that loaded fine but is missing title/meta (capture flake / challenge variants)
 *   gets the missing fields re-read from the served HTML; a genuinely absent meta stays absent.
 * Never mutates its input; returns fresh RouteResults + the reachability re-checks performed.
 */
export async function reverifyRoutes(
  routes: RouteResult[],
  verify: VerifyDeps,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ routes: RouteResult[]; reverified: Reverification[] }> {
  const statusIdx: number[] = [];
  const titleMetaIdx: number[] = [];
  routes.forEach((r, i) => {
    if (!isOkStatus(r.status)) statusIdx.push(i);
    else if (!(r.title ?? "").trim() || !(r.metaDescription ?? "").trim()) titleMetaIdx.push(i);
  });

  const fetchedByIdx = new Map<number, PageFetch>();
  for (const i of [...statusIdx, ...titleMetaIdx]) {
    fetchedByIdx.set(i, await verify.fetchPage(routes[i]!.url));
  }
  // Cooldown retries for reachability re-checks that came back with a transient-looking status
  // (the IP may still be WAF-flagged from the probe burst itself).
  for (const delayMs of REVERIFY_RETRY_DELAYS_MS) {
    const pending = statusIdx.filter((i) => {
      const f = fetchedByIdx.get(i)!;
      return !isOkStatus(f.status) && isRetryableStatus(f.status);
    });
    if (pending.length === 0) break;
    await sleep(delayMs);
    for (const i of pending) fetchedByIdx.set(i, await verify.fetchPage(routes[i]!.url));
  }

  const out = [...routes];
  const reverified: Reverification[] = [];
  for (const i of statusIdx) {
    const r = routes[i]!;
    const fetched = fetchedByIdx.get(i)!;
    reverified.push({ url: r.url, browserStatus: r.status, fetchedStatus: fetched.status });
    // The plain fetch is the reachability truth. When it's ok, the challenge-page title/meta
    // the browser captured are discarded for the served HTML's; when the fail is CONFIRMED,
    // title/meta go null (a dead route has no page — don't let a 404 page's "Not found" title
    // masquerade as content).
    const ok = isOkStatus(fetched.status);
    out[i] = {
      ...r,
      status: fetched.status,
      title: ok ? fetched.title : null,
      metaDescription: ok ? fetched.metaDescription : null,
    };
  }
  for (const i of titleMetaIdx) {
    const r = routes[i]!;
    const fetched = fetchedByIdx.get(i)!;
    // Browser loaded the page but captured no title/meta: trust the served HTML for the
    // MISSING fields only (never overwrite what the browser did capture). A failed plain
    // fetch changes nothing — the browser observation stands.
    if (!isOkStatus(fetched.status)) continue;
    out[i] = {
      ...r,
      title: (r.title ?? "").trim() ? r.title : fetched.title,
      metaDescription: (r.metaDescription ?? "").trim()
        ? r.metaDescription
        : fetched.metaDescription,
    };
  }
  return { routes: out, reverified };
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
  // The failing routes are NAMED (url → status) so a fail is actionable, never a bare "fail".
  const unreachableUrls = routes
    .filter((r) => !isOkStatus(r.status))
    .map((r) => `${r.url} → ${r.status ?? "no response"}`);
  const reachableOk = routes.length > 0 && unreachableUrls.length === 0;

  // titleMetaOk (chromium-only signals): every route has a non-empty title ≤ 70 chars + a non-empty
  // meta description, AND no two routes share a title. Empty observations → false (fail-safe).
  // Each violated sub-check is recorded per-URL; duplicate detection runs on NON-empty titles only
  // (an empty title is already its own finding — two blank routes aren't a "duplicate" insight).
  const titleMetaProblems: string[] = [];
  for (const r of routes) {
    const t = (r.title ?? "").trim();
    const desc = (r.metaDescription ?? "").trim();
    if (t.length === 0) titleMetaProblems.push(`${r.url}: empty title`);
    else if (t.length > 70) titleMetaProblems.push(`${r.url}: title ${t.length} chars (max 70)`);
    if (desc.length === 0) titleMetaProblems.push(`${r.url}: missing meta description`);
  }
  const byTitle = new Map<string, string[]>();
  for (const r of routes) {
    const t = (r.title ?? "").trim();
    if (t.length === 0) continue;
    byTitle.set(t, [...(byTitle.get(t) ?? []), r.url]);
  }
  for (const [t, urls] of byTitle) {
    if (urls.length > 1) titleMetaProblems.push(`duplicate title "${t}": ${urls.join(" + ")}`);
  }
  const titleMetaOk = routes.length > 0 && titleMetaProblems.length === 0;

  const engines = [...new Set(desktopChecks.map((d) => d.engine))];
  const devices = [...new Set(mobileChecks.map((m) => m.device))];
  const families = Object.entries(familyCounts)
    .map(([f, n]) => (f === "/" ? "/" : `${f} ×${n}`))
    .join(", ");
  // Surface the first offenders right in the note (full lists ride in details/unreachableUrls +
  // details/titleMetaProblems) so the evidence line answers "which url?" without a JSON dig.
  const firstOf = (xs: string[], n: number) =>
    xs.slice(0, n).join("; ") + (xs.length > n ? ` (+${xs.length - n} more)` : "");
  const note =
    `${routes.length} routes (${families}); ` +
    `desktop ${engines.join("/") || "—"}; mobile ${devices.join("/") || "—"}; ` +
    `${links.length} links, ${brokenLinks} broken` +
    (unreachableUrls.length > 0 ? `; unreachable: ${firstOf(unreachableUrls, 3)}` : "") +
    (titleMetaProblems.length > 0 ? `; title/meta: ${firstOf(titleMetaProblems, 3)}` : "");

  return {
    desktopOk,
    mobileOk,
    linksOk,
    reachableOk,
    titleMetaOk,
    unreachableUrls,
    titleMetaProblems,
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
  const verifyDeps = ctx.verifyDeps ?? defaultVerifyDeps();
  const runner = ctx.browserRunner ?? (await defaultBrowserRunner());
  try {
    const discovered: DiscoveredRoutes = await discoverRoutes(site.deployedUrl, discoverDeps);
    const probed = await runner.probe(discovered.routes);
    // Plain-fetch re-verification BEFORE any verdict: a browser-side 4xx/timeout (WAF challenge,
    // engine flake) must not persist a fail the site doesn't deserve — see reverifyRoutes.
    const { routes: routeResults, reverified } = await reverifyRoutes(probed, verifyDeps);
    const internalLinks = [...new Set(routeResults.flatMap((r) => r.links))];
    const linkResults = await runner.checkLinks(internalLinks);
    const summary = summarizeBrowser(
      routeResults,
      linkResults,
      discovered.familyCounts ?? familyCountsOf(discovered.routes),
    );
    // Cleared re-checks are surfaced (note + details) so a challenge-heavy run is visible even
    // when every verdict lands green; confirmed fails are already named in unreachableUrls.
    const cleared = reverified.filter((v) => isOkStatus(v.fetchedStatus));
    const reverifiedUrls = cleared.map(
      (v) =>
        `${v.url}: browser saw ${v.browserStatus ?? "no response"}, plain fetch ${v.fetchedStatus}`,
    );
    const note =
      summary.note +
      (cleared.length > 0
        ? `; ${cleared.length} route(s) re-verified reachable by plain fetch after a browser-side challenge/flake`
        : "");
    const status: AuditResult["status"] =
      summary.desktopOk && summary.mobileOk && summary.linksOk ? "pass" : "warn";
    return {
      audit: "browser",
      site: label,
      status,
      summary: note,
      details: { ...summary, note, reverifiedUrls, checkedAt: now.toISOString() },
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

/** Real re-verification fetch: one plain GET (no browser — precisely the point: WAFs that
 *  challenge headless browsers leave a plain fetch alone). Parses title/meta out of the served
 *  HTML when the response is ok + HTML; any error/timeout degrades to a null status (= the fail
 *  is CONFIRMED without a browser to blame). */
export function defaultVerifyDeps(): VerifyDeps {
  return {
    fetchPage: async (url) => {
      try {
        const res = await fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        const isHtml = (res.headers.get("content-type") ?? "").includes("html");
        if (!res.ok || !isHtml) {
          return { status: res.status, title: null, metaDescription: null };
        }
        return { status: res.status, ...extractTitleMeta(await res.text()) };
      } catch {
        return { status: null, title: null, metaDescription: null };
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

          results.push({
            url,
            desktop,
            mobile,
            links: [...linkSet],
            status,
            title,
            metaDescription,
          });
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
