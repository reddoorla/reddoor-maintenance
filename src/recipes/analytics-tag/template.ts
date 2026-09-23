/** Where the tag call lands. Chosen over `src/routes/+layout.svelte` because no
 *  fleet site has this file today (checked across the fleet 2026-09-22), so the
 *  recipe writes rather than edits — and the root layouts it would otherwise
 *  have to patch run from 2.7KB to 9.7KB of hand-maintained, per-site markup. */
export const HOOKS_CLIENT_RELATIVE = "src/hooks.client.ts";

/** `G-` followed by the 10-character stream suffix Google issues. Checked before
 *  anything is written: a malformed ID collects into nothing and looks fine, so
 *  it is the one input worth refusing up front. */
export const MEASUREMENT_ID_RE = /^G-[A-Z0-9]{10}$/;

/**
 * The client hook that starts analytics.
 *
 * Uses SvelteKit's `init` export rather than a bare top-level side effect.
 * Both run — `write_client_manifest.js` namespace-imports this module, so its
 * top level executes either way — but `init` is the documented entry point and
 * runs at a defined moment before the app starts, rather than whenever the
 * module graph happens to evaluate. Verified against the installed
 * @sveltejs/kit 2.70.3, which wires `init: client_hooks.init` at
 * src/core/sync/write_client_manifest.js:173.
 */
export function hooksClientTemplate(opts: {
  measurementId: string;
  productionHost: string;
}): string {
  return `import type { ClientInit } from "@sveltejs/kit";
import { initAnalytics } from "@reddoorla/maintenance/client";

/**
 * GA4, started once when the client app boots.
 *
 * The tag is INERT anywhere but the production hostname and its apex/www twin:
 * localhost, the dev server, Netlify deploy previews and branch deploys never
 * reach the property. That is not tidiness. Reddoor's own property holds 13,312
 * localhost users against 105 real ones for the 30 days to 2026-09-14, from the
 * smoke suite tripping the tag's interaction gate, and GA4 cannot delete that
 * after the fact.
 *
 * The measurement ID below is public by design — it ships in the page. The
 * NUMERIC property ID the monthly report reads is a different value and lives
 * on the site's Websites row. \`reddoor-maint audit analytics\` checks that the
 * two still describe the same site.
 */
export const init: ClientInit = () => {
  initAnalytics({
    measurementId: ${JSON.stringify(opts.measurementId)},
    productionHost: ${JSON.stringify(opts.productionHost)},
  });
};
`;
}
