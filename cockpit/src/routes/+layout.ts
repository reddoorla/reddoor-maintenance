import type { LayoutLoad } from "./$types";

// The path for the Shell's nav, here rather than in the server load so that
// reading it never sends a navigation back to the server. `page` keys the page's
// mount (`+layout.svelte`).
export const load: LayoutLoad = ({ data, url }) => ({
  ...data,
  path: url.pathname,
  page: url.pathname + url.search,
});
