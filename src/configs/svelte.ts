/**
 * Minimal shape we touch — the full type lives in @sveltejs/kit's `Config`.
 * We don't import it directly to avoid a peer dependency for what amounts
 * to a small config helper. Sites get full type-checking from their own
 * `@sveltejs/kit` install when they invoke createSvelteConfig.
 */
type WarningFilter = (warning: { code?: string; message?: string }) => boolean;

export type SvelteConfigLike = {
  kit?: unknown;
  preprocess?: unknown;
  compilerOptions?: {
    warningFilter?: WarningFilter;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

/** Compiler-level warnings the canonical reddoor stack treats as noise. */
const SILENCED_WARNING_CODES = new Set<string>([
  // `<div ... />` shorthand is widely used across reddoor codebases; the
  // Svelte 5 strictness change for non-void self-closing tags would flood
  // dev logs with no actionable signal.
  "element_invalid_self_closing_tag",
]);

function isSilenced(warning: { code?: string }): boolean {
  return warning.code !== undefined && SILENCED_WARNING_CODES.has(warning.code);
}

/**
 * Canonical `$lib` aliases shared across the reddoor fleet. Injecting these as
 * defaults means a synced site no longer has to redeclare them (and the
 * sync-configs svelte template no longer clobbers them with a thinner config).
 * Sites can override any entry or add their own — see the merge in
 * createSvelteConfig. Override an alias's bare and `/*` forms together: setting
 * only `$components` while leaving the canonical `$components/*` in place would
 * split `import "$components"` and `import "$components/Foo"` across two roots.
 */
const CANONICAL_ALIASES: Record<string, string> = {
  $components: "src/lib/components",
  "$components/*": "src/lib/components/*",
  $utils: "src/lib/utils",
  "$utils/*": "src/lib/utils/*",
  $stores: "src/lib/stores",
  "$stores/*": "src/lib/stores/*",
  $assets: "src/lib/assets",
  "$assets/*": "src/lib/assets/*",
};

type CspDirectives = Record<string, string[]>;
type CspObject = {
  mode?: string;
  directives?: CspDirectives;
  /** Fold {@link ANALYTICS_CSP} into the directives. Set by the analytics recipe;
   *  a site with no GA4 tag leaves it off so its policy does not allow a script
   *  host it never loads. */
  analytics?: boolean;
  [k: string]: unknown;
};

/**
 * SHA-256 of Svelte's SSR event-replay stub, `this.__e=event`.
 *
 * Svelte emits `onload`/`onerror="this.__e=event"` on any load/error element
 * (`<img>`, `<iframe>`, …) that carries a spread attribute or a `use:`
 * directive — i.e. every `<img {...getImageProps(field)} />` the Prismic
 * helpers produce. The stub stashes an event that fires BEFORE hydration so the
 * component can replay it once it is alive.
 *
 * Hashes do not apply to inline event handlers unless `'unsafe-hashes'` is
 * present, so without both of these the browser refuses to run the stub: the
 * pre-hydration `load`/`error` is silently dropped (anything keyed on it — a
 * fade-in, a fallback swap — can strand) and a `script-src-attr` violation is
 * reported per image on every page view, burying real violations and hammering
 * the report endpoint. Measured on beachfront-dentistry 2026-08-13: 12
 * violations on `/` alone.
 *
 * `'unsafe-hashes'` widens hash matching to event handlers; it does NOT permit
 * arbitrary inline handlers, so only this exact one-liner is allowed. Pair it
 * with `'unsafe-inline'` and that guarantee is gone — the test asserts we do
 * not. The stub itself only assigns the event to a property, so an injected
 * element carrying identical text achieves nothing.
 *
 * Verified in Chrome 2026-08-17 against a page served with this policy: the
 * handler runs and `img.__e.type === "error"`; under the previous baseline it
 * did not run at all. Re-derive with:
 *   node -e 'console.log(require("crypto").createHash("sha256").update("this.__e=event").digest("base64"))'
 */
export const SVELTE_EVENT_REPLAY_HASH = "sha256-7dQwUgLau1NFCCGjfn9FsYptB6ZtWxJin6VohGIu20I=";

/**
 * Baseline CSP for the reddoor stack (Prismic + Vimeo). Opt-in only — a CSP is
 * breakage-prone, so it is never injected unless a site asks via `csp`. Extend
 * per project by passing `csp: { directives: { ... } }`; named directives
 * replace the baseline entry, unnamed ones are kept. SvelteKit adds
 * nonces/hashes for the inline scripts/styles it emits.
 *
 * NOTE: a site overriding `script-src` replaces this entry wholesale, so it must
 * carry `'unsafe-hashes'` + SVELTE_EVENT_REPLAY_HASH itself or it reintroduces
 * the violation above.
 *
 * The toolbar also frames `https://<repo>.prismic.io`. That host is not here:
 * it is added by the `prismicRepository` option, so a site frames its own
 * repository and no other.
 */
const BASELINE_CSP = {
  mode: "auto",
  directives: {
    "default-src": ["self"],
    "script-src": [
      "self",
      "https://static.cdn.prismic.io",
      // The Prismic toolbar (previews, edit button) loads toolbar.js from this
      // path and, for its Share button, this one html2canvas file. Both are
      // path-scoped so neither host is allowed wholesale for a direct load (CSP
      // ignores paths after a redirect) (williamson-homes#7, reddoor-starter#164).
      "https://prismic.io/prismic-toolbar/",
      "https://html2canvas.hertzen.com/dist/html2canvas.min.js",
      "https://player.vimeo.com",
      "unsafe-hashes",
      SVELTE_EVENT_REPLAY_HASH,
    ],
    "style-src": ["self", "unsafe-inline"],
    "img-src": ["self", "data:", "https://images.prismic.io", "https://*.prismic.io"],
    "media-src": ["self", "https://*.vimeocdn.com"],
    "frame-src": ["self", "https://player.vimeo.com"],
    "connect-src": ["self", "https://*.prismic.io", "https://static.cdn.prismic.io"],
    "font-src": ["self", "data:"],
    "base-uri": ["self"],
    "form-action": ["self"],
    "frame-ancestors": ["self"],
    "report-uri": ["/api/csp-report"],
  },
} satisfies CspObject;

/**
 * Copy a directives map and each of its arrays, so the returned config shares
 * no array reference with the module-level BASELINE_CSP (or with a caller's
 * input). Without this, mutating one config's directive array would poison the
 * shared baseline for every later call.
 */
function cloneDirectives(directives: CspDirectives): CspDirectives {
  return Object.fromEntries(
    Object.entries(directives).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]),
  );
}

/**
 * Append {@link ANALYTICS_CSP} to a directives map, skipping hosts already
 * present so a site that also lists one by hand does not get it twice.
 * Directives the map does not have are created: a site overriding `img-src`
 * without a beacon host still gets one.
 */
function withAnalytics(directives: CspDirectives): CspDirectives {
  const out = cloneDirectives(directives);
  for (const [name, hosts] of Object.entries(ANALYTICS_CSP)) {
    // `svelte.config.js` is untyped, so a site may legally write
    // `"script-src": "self"`. Spreading a STRING shreds it into characters —
    // ["s","e","l","f",…] — and only when analytics is on, which is a corruption
    // this fold would have introduced rather than found. Leave a non-array
    // alone; the audit will notice the missing host.
    const existing = out[name];
    if (existing !== undefined && !Array.isArray(existing)) continue;
    const list = existing ?? [];
    out[name] = [...list, ...hosts.filter((h) => !list.includes(h))];
  }
  return out;
}

/**
 * A Prismic repository name is written verbatim into `frame-src`, so anything
 * beyond letters, digits and hyphens (a `;`, a space, a `*`) could widen or
 * inject a directive. Same rule as the starter's svelte.config.js, narrowed to
 * one DNS label: at most 63 characters, no hyphen at either end.
 */
const PRISMIC_REPOSITORY_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function prismicFrameHost(repository: unknown): string {
  if (typeof repository !== "string" || !PRISMIC_REPOSITORY_NAME.test(repository)) {
    throw new Error(
      `prismicRepository ${typeof repository === "string" ? JSON.stringify(repository) : `(a ${typeof repository})`} is not a Prismic repository name; ` +
        "it is written into the CSP frame-src, so it must be letters, digits and hyphens only.",
    );
  }
  return `https://${repository}.prismic.io`;
}

/**
 * Append the repository's toolbar host to `frame-src`, after the merge for the
 * same reason as {@link withAnalytics}: a site that overrides `frame-src` keeps
 * exactly its own list plus this one host. A string directive is left alone.
 *
 * A site that unset `frame-src` has its frames governed by `child-src`, then
 * `default-src`, as a browser reads it. The new `frame-src` is seeded from that
 * directive so every frame it allowed still loads; `'none'` is dropped, since
 * beside a host it would mean nothing. With no fallback at all, frames are
 * already unrestricted, and with a string fallback there is no list to extend:
 * either way `frame-src` stays unset.
 */
function withPrismicFrame(directives: CspDirectives, host: string): CspDirectives {
  const existing = directives["frame-src"];
  if (existing !== undefined && !Array.isArray(existing)) return directives;
  let list = existing;
  if (list === undefined) {
    const fallback = directives["child-src"] ?? directives["default-src"];
    if (!Array.isArray(fallback)) return directives;
    list = fallback.filter((source) => source !== "none");
  }
  return { ...directives, "frame-src": list.includes(host) ? list : [...list, host] };
}

/** Build a `kit.csp` block from the `csp` option, layering over the baseline. */
function buildCsp(option: true | CspObject, prismicHost?: string): CspObject {
  const baseDirectives = BASELINE_CSP.directives ?? {};
  const withRepository = (d: CspDirectives) => (prismicHost ? withPrismicFrame(d, prismicHost) : d);
  if (option === true) {
    return { mode: BASELINE_CSP.mode, directives: withRepository(cloneDirectives(baseDirectives)) };
  }
  // `analytics` is a reddoor option, not a CSP field: destructured out here so
  // it can never leak into the emitted policy object as a stray key.
  const { directives: siteDirectives, analytics, ...rest } = option;
  const merged = cloneDirectives({ ...baseDirectives, ...(siteDirectives ?? {}) });
  return {
    mode: BASELINE_CSP.mode,
    ...rest, // allow `mode` override, `reportOnly`, etc.
    // Applied LAST, on purpose. A site that overrides `script-src` replaces the
    // baseline entry wholesale, so folding the analytics hosts in before the
    // merge would lose them on exactly the sites most likely to need them.
    directives: withRepository(analytics === true ? withAnalytics(merged) : merged),
  };
}

type PrerenderErrorDetails = {
  path?: string;
  status?: number;
  message?: string;
  referrer?: string;
};

/**
 * The hosts a GA4 tag needs, by directive.
 *
 * Google's own list for "Google Analytics without any Ads features", from
 * https://developers.google.com/tag-platform/security/guides/csp (read
 * 2026-09-29): `script-src-elem` www.googletagmanager.com; `img-src`
 * www.googletagmanager.com and *.google-analytics.com; `connect-src`
 * www.googletagmanager.com, *.google-analytics.com and *.google.com. The
 * script host goes in `script-src`, which `script-src-elem` falls back to. The
 * fleet's properties run no Ads features and no Google Signals; turning either
 * on needs that page's wider list (*.g.doubleclick.net, *.google.<TLD>, …).
 *
 * Exported as data and folded in by `csp: { analytics: true }` rather than
 * written into each site's `svelte.config.js`, for the same reason
 * {@link SVELTE_EVENT_REPLAY_HASH} is imported and never transcribed: a copied
 * host list cannot be told apart from a stale one, and a CSP that is stale in
 * the direction of MISSING a host fails silently — the loader is refused, the
 * property records nothing, and the page looks fine.
 *
 * `script-src` is required and not optional. The emitted policy carries no
 * `'strict-dynamic'` (measured on reddoor-starter, 2026-09-22), so the host
 * allowlist governs the loader `initAnalytics` injects from bundle JS exactly
 * as it governs one typed into `app.html`.
 */
export const ANALYTICS_CSP: Readonly<Record<string, readonly string[]>> = {
  "script-src": ["https://www.googletagmanager.com"],
  "img-src": ["https://www.googletagmanager.com", "https://*.google-analytics.com"],
  "connect-src": [
    "https://www.googletagmanager.com",
    "https://*.google-analytics.com",
    "https://*.google.com",
  ],
};

/**
 * Prerender error handler for an un-wired placeholder clone: every Prismic-backed
 * route 404s until the clone points at a real repo, so tolerate 404 to let
 * `pnpm build` / Netlify CI pass. Any other status still throws loudly, and a
 * real site never opts in (so its 404s fail the build as they should).
 */
function placeholderHttpErrorHandler({
  path,
  status,
  message,
  referrer,
}: PrerenderErrorDetails): void {
  if (status === 404) return;
  throw new Error(`${status} ${path}${referrer ? ` (linked from ${referrer})` : ""}: ${message}`);
}

/** reddoor-specific options that get transformed into `kit.*`, not passed through. */
export type ReddoorSvelteOptions = {
  /** Inject the baseline CSP (`true`) or the baseline extended with these fields. */
  csp?: true | CspObject;
  /** Tolerate 404s during prerender — for un-wired placeholder clones only. */
  placeholder?: boolean;
  /** The site's Prismic repository name. With `csp`, frames
   *  `https://<name>.prismic.io` for the toolbar; unset, no Prismic host is framed. */
  prismicRepository?: string;
};

/**
 * Compose a Svelte/Kit config with the reddoor fleet's canonical pieces layered
 * in. Sites pass their site-specific bits (`kit.adapter`, `preprocess`, etc.)
 * and get back a complete config.
 *
 * Always applied:
 *  - the canonical `compilerOptions.warningFilter` (composes with a site's own:
 *    a warning shows only when both filters allow it);
 *  - the canonical `$components/$utils/$stores/$assets` `kit.alias` entries
 *    (a site's own `kit.alias` overrides per key and may add more).
 *
 * Opt-in (NOT applied unless requested, so adoption never silently changes a
 * site's behavior):
 *  - `csp: true` injects the baseline Prismic+Vimeo CSP; `csp: { directives }`
 *    extends it per-directive. A CSP is breakage-prone, so it is opt-in — a site
 *    that wants the starter's CSP parity must pass `csp`. An explicit `kit.csp`
 *    always wins as an escape hatch.
 *  - `prismicRepository: "<name>"` adds that repository's toolbar iframe host
 *    to `frame-src` when `csp` is on; it is validated whether or not it is used.
 *  - `placeholder: true` tolerates 404s during prerender (for an un-wired
 *    placeholder clone only) — like `csp`, a site that wants the starter's
 *    prerender-tolerance parity must pass it; the site computes the signal itself.
 *
 * @example
 *   import { createSvelteConfig } from "@reddoorla/maintenance/configs/svelte";
 *   import adapter from "@sveltejs/adapter-netlify";
 *
 *   export default createSvelteConfig({
 *     kit: { adapter: adapter() },
 *     csp: true,
 *     prismicRepository: "williamson-homes",
 *     placeholder: process.env.VITE_PRISMIC_ENVIRONMENT === "your-prismic-repo-name",
 *   });
 */

export function createSvelteConfig(
  siteConfig: SvelteConfigLike & ReddoorSvelteOptions = {},
): SvelteConfigLike & {
  compilerOptions: NonNullable<SvelteConfigLike["compilerOptions"]>;
} {
  // Strip the reddoor-only options so they never leak onto the returned config.
  const { csp, placeholder, prismicRepository, ...rest } = siteConfig;
  const prismicHost =
    prismicRepository === undefined ? undefined : prismicFrameHost(prismicRepository);

  const siteCompiler = rest.compilerOptions ?? {};
  const siteFilter = siteCompiler.warningFilter;

  const siteKit = (rest.kit ?? {}) as Record<string, unknown>;
  const siteAlias = (siteKit.alias ?? {}) as Record<string, string>;

  const kit: Record<string, unknown> = {
    ...siteKit,
    // Canonical aliases first, site entries last so a site can override any
    // single alias or add its own without losing the fleet defaults.
    alias: { ...CANONICAL_ALIASES, ...siteAlias },
  };

  // CSP: opt-in. An explicit `kit.csp` always wins as an escape hatch.
  if (siteKit.csp !== undefined) {
    kit.csp = siteKit.csp;
  } else if (csp) {
    kit.csp = buildCsp(csp, prismicHost);
  }

  // Prerender placeholder tolerance: opt-in. A site-provided handler wins.
  if (placeholder) {
    const sitePrerender = (siteKit.prerender ?? {}) as Record<string, unknown>;
    kit.prerender = { handleHttpError: placeholderHttpErrorHandler, ...sitePrerender };
  }

  return {
    ...rest,
    kit,
    compilerOptions: {
      ...siteCompiler,
      warningFilter: (warning) => {
        if (isSilenced(warning)) return false;
        return siteFilter ? siteFilter(warning) : true;
      },
    },
  };
}

export default createSvelteConfig;
