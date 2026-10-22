import { invalidate } from "$app/navigation";
import { SNAPSHOT_DEPENDENCY, requestSnapshotRefresh } from "./freshness.js";

/**
 * Every change the cockpit's pages make goes through here: a POST to one of its
 * `/api/*` routes. The pages derive from the layout's snapshot, which the change
 * has just made stale, so once it is sent (whatever its answer: a refused change
 * leaves the store as it was, and a fresh read shows that too) the snapshot is
 * read again, and the page in view remounts from it, as a fresh load would. It
 * never shows the state from before a change the operator just made. While they
 * are in a field, or another save is still on its way, the refresh waits
 * (`startFreshness`), so the page never remounts under a save it has not heard
 * back from.
 */
export async function postAction(input: string, init: RequestInit = {}): Promise<Response> {
  inFlight += 1;
  try {
    return await fetch(input, { ...init, method: "POST" });
  } finally {
    inFlight -= 1;
    requestSnapshotRefresh(() => invalidate(SNAPSHOT_DEPENDENCY));
    if (inFlight === 0) for (const f of [...settled]) f();
  }
}

let inFlight = 0;
const settled = new Set<() => void>();

/** How many of this page's posts have not answered yet. */
export function postsInFlight(): number {
  return inFlight;
}

/** Call `f` each time the last post in flight answers; returns its removal. */
export function onPostsSettled(f: () => void): () => void {
  settled.add(f);
  return () => settled.delete(f);
}

/** SvelteKit's own opt-out, set on <body>: every link and GET form under it is
 *  then a full page load (and Back and Forward too, through `+layout.svelte`).
 *  For a snapshot that could not be read whole (a gap, or the store failing): the
 *  next navigation reads it again in full, as every navigation did before. */
export function reloadOnNextNavigation(): void {
  if (typeof document !== "undefined") document.body.setAttribute("data-sveltekit-reload", "");
}

/** Whether the snapshot in hand is stale, so the next navigation loads in full. */
export function reloadsOnNextNavigation(): boolean {
  return typeof document !== "undefined" && document.body.hasAttribute("data-sveltekit-reload");
}
