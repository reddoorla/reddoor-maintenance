import type { LayoutLoad } from "./$types";
import { reloadOnNextNavigation } from "../lib/post.js";

// The path for the Shell's nav, here rather than in the server load so that
// reading it never sends a navigation back to the server. `page` keys the page's
// mount (`+layout.svelte`). `clockOffsetMs` puts the pages' windows and relative
// times on the server's clock, as when they were computed there: the snapshot's
// `takenAt` against this machine's clock when it arrived.
/** The offset for the snapshot in hand, measured once, when it arrived: this load
 *  re-runs on every navigation (it reads the url), and re-measuring then would
 *  freeze every page's "now" at the snapshot's `takenAt`. */
let measured: { takenAt: string; offsetMs: number } | null = null;
function clockOffset(takenAt: string): number {
  if (measured?.takenAt !== takenAt) {
    measured = { takenAt, offsetMs: Date.parse(takenAt) - Date.now() };
  }
  return measured.offsetMs;
}

export const load: LayoutLoad = ({ data, url }) => {
  // No snapshot (the error page of a path no page owns, or a store failure): the
  // next navigation loads in full, and reads one.
  if (data.snapshot === null) reloadOnNextNavigation();
  return {
    ...data,
    path: url.pathname,
    page: url.pathname + url.search,
    clockOffsetMs: data.snapshot === null ? 0 : clockOffset(data.snapshot.takenAt),
  };
};
