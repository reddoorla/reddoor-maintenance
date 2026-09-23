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
  querySelectorAll(selectors: string): ArrayLike<{ src?: string }>;
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
 * Matches a loader for THIS measurement ID, and only this one.
 *
 * ID-aware deliberately. Double-counting is one property loaded twice, not two
 * different properties each loaded once, so the guard has to be about the ID.
 * An ID-blind guard stands down whenever ANY gtag loader is present, which
 * fails in two ways that both read as success:
 *
 * - A GTM container with a GA4 config tag injects `/gtag/js` at runtime, so on
 *   a GTM site an ID-blind guard would silently never configure our own ID.
 * - A legacy inline snippet carrying the WRONG ID would likewise suppress the
 *   right one, and `initAnalytics` would report "already-loaded", which reads
 *   as done.
 *
 * Installing alongside a foreign loader is the safe direction: both properties
 * then count correctly, and `reddoor-maint audit analytics` warns about the
 * second loader, so the situation is visible instead of silent.
 */
const LOADER_SELECTOR = 'script[src*="googletagmanager.com/gtag/js"]';

/**
 * Is a loader for exactly this measurement ID already in the document?
 *
 * The ID is compared in JS against each `src`, and never interpolated into the
 * selector. Interpolating it was wrong twice over: an ID containing `"` or `]`
 * makes `querySelector` THROW a SyntaxError — uncaught, during client boot, out
 * of a public API a site calls directly — and for any ID needing
 * percent-encoding the raw selector could never match the encoded `src` this
 * same module writes, so every re-run of the layout effect appended another
 * loader. That is the double-counting the ID-aware check was introduced to
 * prevent, reintroduced by the way it was spelled.
 */
function loaderPresentFor(doc: DocumentLike, measurementId: string): boolean {
  const found = doc.querySelectorAll(LOADER_SELECTOR);
  for (let i = 0; i < found.length; i++) {
    const src = found[i]?.src;
    if (src !== undefined && loaderIdOf(src) === measurementId) return true;
  }
  return false;
}

/**
 * The `id` a gtag loader URL names, or null.
 *
 * Parsed rather than string-compared against `gtagLoaderUrl(id)`. A browser
 * reflects `script.src` through the WHATWG URL parser, whose special-query
 * percent-encode set escapes `'` — the one character `encodeURIComponent`
 * leaves raw. So `G-tick'q` was written as `…?id=G-tick'q` and read back as
 * `…?id=G-tick%27q`, the equality failed, and every re-run of the layout effect
 * appended another loader for the same property: the double-counting this guard
 * exists to prevent, surviving inside the guard. Parsing makes the comparison
 * immune to any such normalisation, now and later.
 *
 * Falls back to a manual scan when `URL` is unavailable, so this never throws
 * in a runtime that lacks it.
 */
function loaderIdOf(src: string): string | null {
  try {
    return new URL(src, "https://x.invalid").searchParams.get("id");
  } catch {
    const m = /[?&]id=([^&]*)/.exec(src);
    return m?.[1] !== undefined ? decodeURIComponent(m[1]) : null;
  }
}

/** The gtag.js loader URL for a measurement ID. Exported for the audit, which
 *  asserts the live site requests exactly this. */
export function gtagLoaderUrl(measurementId: string): string {
  // `encodeURIComponent` THROWS a URIError on a lone surrogate, and this is
  // reached after the gtag shim is installed and two commands are queued — so a
  // malformed ID took the page down during client boot, out of a public API a
  // site calls directly. Same failure class this module already documents
  // fixing for `querySelector`. An ID that cannot be encoded simply cannot
  // name a loader, and `initAnalytics` treats that as "no ID".
  let encoded: string;
  try {
    encoded = encodeURIComponent(measurementId);
  } catch {
    return "";
  }
  return `${LOADER_ORIGIN}/gtag/js?id=${encoded}`;
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

  if (loaderPresentFor(doc, id)) return "already-loaded";

  // Aliased so the closure below has a non-optional reference to the WINDOW.
  // `.dataLayer` is still read off it at call time, which is the point.
  const w: WindowLike = win;
  w.dataLayer = w.dataLayer ?? [];

  // Two things here are load-bearing and both look like style.
  //
  // `w.dataLayer` is read at CALL time, not captured. The canonical snippet
  // references the live global for a reason: gtag.js and any tag manager may
  // REPLACE the array rather than mutate it, and a captured reference would
  // leave our commands queued on an orphan nobody drains.
  //
  // `arguments` is the live arguments object. gtag.js tells commands from data
  // by their type, so a spread array is pushed as data instead: the command is
  // swallowed and the tag records nothing while looking healthy. The rest
  // parameter exists only to satisfy the signature; the body must not use it.
  function gtag(..._args: unknown[]): void {
    // eslint-disable-next-line prefer-rest-params
    (w.dataLayer as unknown[]).push(arguments);
  }
  w.gtag = gtag;

  // Commands first, loader second. The queue is drained when gtag.js arrives,
  // so this order means a slow or blocked loader delays the pageview rather
  // than losing the configuration that describes it.
  gtag("js", new Date());
  gtag("config", id);

  const loader = gtagLoaderUrl(id);
  if (loader === "") return "no-id";

  const script = doc.createElement("script");
  script.async = true;
  script.src = loader;
  script.setAttribute("data-reddoor-analytics", id);
  doc.head.appendChild(script);

  return "loaded";
}
