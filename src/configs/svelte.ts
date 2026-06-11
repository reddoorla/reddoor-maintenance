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

/**
 * Compose a Svelte/Kit config with reddoor's canonical compilerOptions
 * layered in. Sites pass their site-specific bits (`kit.adapter`,
 * `preprocess`, etc.) and get back a complete config with the canonical
 * warning filter applied.
 *
 * If the site supplies its own `compilerOptions.warningFilter`, the filters
 * compose: a warning is shown only when both filters allow it.
 *
 * @example
 *   import { createSvelteConfig } from "@reddoorla/maintenance/configs/svelte";
 *   import adapter from "@sveltejs/adapter-auto";
 *
 *   export default createSvelteConfig({ kit: { adapter: adapter() } });
 */
export function createSvelteConfig(siteConfig: SvelteConfigLike = {}): SvelteConfigLike & {
  compilerOptions: NonNullable<SvelteConfigLike["compilerOptions"]>;
} {
  const siteCompiler = siteConfig.compilerOptions ?? {};
  const siteFilter = siteCompiler.warningFilter;

  const siteKit = (siteConfig.kit ?? {}) as Record<string, unknown>;
  const siteAlias = (siteKit.alias ?? {}) as Record<string, string>;

  return {
    ...siteConfig,
    kit: {
      ...siteKit,
      // Canonical aliases first, site entries last so a site can override any
      // single alias or add its own without losing the fleet defaults.
      alias: { ...CANONICAL_ALIASES, ...siteAlias },
    },
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
