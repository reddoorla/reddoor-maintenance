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
 * createSvelteConfig.
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
type CspObject = { mode?: string; directives?: CspDirectives; [k: string]: unknown };

/**
 * Baseline CSP for the reddoor stack (Prismic + Vimeo). Opt-in only — a CSP is
 * breakage-prone, so it is never injected unless a site asks via `csp`. Extend
 * per project by passing `csp: { directives: { ... } }`; named directives
 * replace the baseline entry, unnamed ones are kept. SvelteKit adds
 * nonces/hashes for the inline scripts/styles it emits.
 */
const BASELINE_CSP = {
  mode: "auto",
  directives: {
    "default-src": ["self"],
    "script-src": ["self", "https://static.cdn.prismic.io", "https://player.vimeo.com"],
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

/** Build a `kit.csp` block from the `csp` option, layering over the baseline. */
function buildCsp(option: true | CspObject): CspObject {
  const baseDirectives = BASELINE_CSP.directives ?? {};
  if (option === true) {
    return { mode: BASELINE_CSP.mode, directives: cloneDirectives(baseDirectives) };
  }
  const { directives: siteDirectives, ...rest } = option;
  return {
    mode: BASELINE_CSP.mode,
    ...rest, // allow `mode` override, `reportOnly`, etc.
    directives: cloneDirectives({ ...baseDirectives, ...(siteDirectives ?? {}) }),
  };
}

type PrerenderErrorDetails = {
  path?: string;
  status?: number;
  message?: string;
  referrer?: string;
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
  csp?: boolean | CspObject;
  /** Tolerate 404s during prerender — for un-wired placeholder clones only. */
  placeholder?: boolean;
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
 *  - `placeholder: true` tolerates 404s during prerender (for an un-wired
 *    placeholder clone only); the site computes the placeholder signal itself.
 *
 * @example
 *   import { createSvelteConfig } from "@reddoorla/maintenance/configs/svelte";
 *   import adapter from "@sveltejs/adapter-netlify";
 *
 *   export default createSvelteConfig({
 *     kit: { adapter: adapter() },
 *     csp: true,
 *     placeholder: process.env.VITE_PRISMIC_ENVIRONMENT === "your-prismic-repo-name",
 *   });
 */

export function createSvelteConfig(
  siteConfig: SvelteConfigLike & ReddoorSvelteOptions = {},
): SvelteConfigLike & {
  compilerOptions: NonNullable<SvelteConfigLike["compilerOptions"]>;
} {
  // Strip the reddoor-only options so they never leak onto the returned config.
  const { csp, placeholder, ...rest } = siteConfig;

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
    kit.csp = buildCsp(csp === true ? true : csp);
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
