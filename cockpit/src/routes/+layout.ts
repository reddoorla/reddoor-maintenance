import type { LayoutLoad } from "./$types";
import { reloadOnNextNavigation } from "../lib/post.js";

// The path for the Shell's nav, here rather than in the server load so that
// reading it never sends a navigation back to the server. `page` keys the page's
// mount (`+layout.svelte`). `clockOffsetMs` puts the pages' windows and relative
// times on the server's clock, as when they were computed there: the snapshot's
// `takenAt` against this machine's clock when it arrived.
export const load: LayoutLoad = ({ data, url }) => {
  // No snapshot (the error page of a path no page owns, or a store failure): the
  // next navigation loads in full, and reads one.
  if (data.snapshot === null) reloadOnNextNavigation();
  return {
    ...data,
    path: url.pathname,
    page: url.pathname + url.search,
    clockOffsetMs: data.snapshot === null ? 0 : Date.parse(data.snapshot.takenAt) - Date.now(),
  };
};
