/**
 * GA4 tag bootstrap for fleet sites — the one mechanism, replacing four.
 *
 * Before this existed, nine repos carried analytics in four different shapes:
 * a raw inline snippet in `app.html` (seven sites, firing on `localhost` and
 * every deploy preview), a hand-rolled deferred loader (two), a Svelte
 * component with a hostname gate (one, and the only one with a test), and GTM
 * behind a consent banner (one, deliberately left alone). A per-repo copy is
 * what produced that spread, so the tag ships from the package instead.
 *
 * Framework-free on purpose: a Svelte component exported from here would
 * couple ~20 repos to one Svelte version for nine lines of DOM work. The
 * site's root layout calls this from a client-side effect.
 *
 * SSR-safe: with no DOM present it returns "no-dom" and does nothing, so it
 * can be called unguarded from universal code.
 *
 * Local structural types stand in for DOM lib types because this package
 * compiles with `lib: ["ES2022"]` and no DOM — the same approach as
 * src/client/page-ready.ts and src/configs/svelte.ts.
 */

import { isSiteHost } from "./site-host.js";

type ScriptLike = {
  async: boolean;
  src: string;
  setAttribute(name: string, value: string): void;
};

type DocumentLike = {
  createElement(tagName: string): ScriptLike;
  head: { appendChild(node: ScriptLike): void };
  querySelector(selectors: string): unknown;
};

type LocationLike = { hostname: string };

type WindowLike = {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

/** Injected DOM for tests; production callers omit it and the globals are used. */
export type AnalyticsEnv = {
  document?: DocumentLike | undefined;
  window?: WindowLike | undefined;
  location?: LocationLike | undefined;
};

export type InitAnalyticsOptions = {
  /**
   * The GA4 web-stream measurement ID, `G-XXXXXXXXXX`. Public by design — it
   * ships in the page. Absent or empty means analytics is OFF for this site,
   * which is the starter's shipped state and NOT an error.
   *
   * Not to be confused with the numeric property ID the Data API reads, which
   * lives on the Turso site row. The two fail asymmetrically: a wrong
   * measurement ID collects into nothing and looks fine, a wrong property ID
   * errors loudly. `reddoor-maint audit analytics` checks both ends so the
   * silent direction cannot hide.
   */
  measurementId?: string | null | undefined;
  /**
   * The site's canonical production hostname. The tag loads only there or on
   * its apex/www twin, so `localhost`, the matching dev server, Netlify
   * deploy previews and branch deploys never reach the property.
   *
   * This is not a nicety. Reddoor's own property holds 13,312 `localhost`
   * users against 105 real ones for the 30 days to 2026-09-14 — the smoke
   * suite tripping the tag's interaction gate, once per fresh browser
   * context. The report's hostname filter keeps that out of the client's
   * numbers, but the property itself is permanently polluted. This gate is
   * what stops a new property going the same way.
   */
  productionHost: string;
  /**
   * Optional extra condition, ANDed with the hostname gate. The fleet ships no
   * consent banner (a US small-business and nonprofit fleet), but a site whose
   * counsel asks for one supplies the predicate here rather than growing a
   * second mechanism.
   */
  gate?: ((ctx: { hostname: string }) => boolean) | undefined;
  env?: AnalyticsEnv | undefined;
};

/**
 * Why `initAnalytics` did what it did. Returned rather than logged so a caller
 * — and the package's own tests — can assert the inert paths, which are the
 * ones that matter: "the tag did not load" must be distinguishable from "the
 * tag loaded and the property is wrong".
 */
export type AnalyticsOutcome =
  /** Loader appended and `config` sent. */
  | "loaded"
  /** A gtag loader was already in the document; nothing appended (idempotent). */
  | "already-loaded"
  /** No measurement ID — the site is off, not broken. */
  | "no-id"
  /** Not the production hostname or its twin. */
  | "off-host"
  /** The caller's `gate` predicate returned false. */
  | "gated"
  /** No document/window/location — SSR, or a non-browser runtime. */
  | "no-dom";

const LOADER_ORIGIN = "https://www.googletagmanager.com";

/**
 * Matches OUR loader and any legacy inline snippet's loader, so a site part-way
 * through the sweep cannot end up with two tags feeding one property and
 * double-counting every session.
 *
 * Deliberately `/gtag/js` and not a bare host match: GTM loads `/gtm.js`, and
 * gallerysonder's GTM container is out of scope and must not be silenced by a
 * selector that was aimed at something else.
 */
const LOADER_SELECTOR = 'script[src*="googletagmanager.com/gtag/js"]';

/** The gtag.js loader URL for a measurement ID. Exported for the audit, which
 *  asserts the live site requests exactly this. */
export function gtagLoaderUrl(measurementId: string): string {
  return `${LOADER_ORIGIN}/gtag/js?id=${encodeURIComponent(measurementId)}`;
}

/**
 * Install the GA4 tag, or explain why it was not installed.
 *
 * Idempotent: a layout effect can re-run, and a second call finds the loader
 * already in the document and returns "already-loaded" without appending a
 * second one.
 */
export function initAnalytics(opts: InitAnalyticsOptions): AnalyticsOutcome {
  const env = opts.env ?? {};
  const g = globalThis as {
    document?: DocumentLike;
    window?: WindowLike;
    location?: LocationLike;
  };
  const doc = env.document ?? g.document;
  const win = env.window ?? g.window;
  const loc = env.location ?? g.location;
  if (!doc || !win || !loc) return "no-dom";

  const id = (opts.measurementId ?? "").trim();
  if (id === "") return "no-id";

  const hostname = loc.hostname;
  if (!isSiteHost(hostname, opts.productionHost)) return "off-host";
  if (opts.gate && !opts.gate({ hostname })) return "gated";

  if (doc.querySelector(LOADER_SELECTOR)) return "already-loaded";

  const layer = win.dataLayer ?? [];
  win.dataLayer = layer;

  // gtag.js reads the LIVE `arguments` object: it tells commands from data by
  // their type, and a spread array is pushed as data instead — the command is
  // swallowed and the tag silently records nothing. The rest parameter exists
  // only to satisfy the signature; the body must not use it.
  function gtag(..._args: unknown[]): void {
    // eslint-disable-next-line prefer-rest-params
    layer.push(arguments);
  }
  win.gtag = gtag;

  // Commands first, loader second. The queue is drained when gtag.js arrives,
  // so this order means a slow or blocked loader delays the pageview rather
  // than losing the configuration that describes it.
  gtag("js", new Date());
  gtag("config", id);

  const script = doc.createElement("script");
  script.async = true;
  script.src = gtagLoaderUrl(id);
  script.setAttribute("data-reddoor-analytics", id);
  doc.head.appendChild(script);

  return "loaded";
}
