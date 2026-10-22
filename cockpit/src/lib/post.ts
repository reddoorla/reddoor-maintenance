import { invalidate } from "$app/navigation";
import { SNAPSHOT_DEPENDENCY, requestSnapshotRefresh } from "./freshness.js";

/**
 * Every change the cockpit's pages make goes through here: a POST to one of its
 * `/api/*` routes. The pages derive from the layout's snapshot, which the change
 * has just made stale, so once it is sent (whatever its answer: a refused change
 * leaves the store as it was, and a fresh read shows that too) the snapshot is
 * read again, and the page takes it in place: the control that posted keeps
 * what it shows (its ✓, its error, the form the operator filled in). It never
 * shows the state from before a change the operator just made. While they are
 * in a field, or another save is still on its way, the refresh waits
 * (`startFreshness`).
 *
 * Two answers read nothing. A 401 or 403 means the session ended: a read would
 * follow the auth gate's redirect to sign-in at once and take the page, and
 * whatever the operator typed, with it; the next navigation is a full load
 * instead, as every navigation after a post was before. And a post that has
 * not answered in `POST_DEADLINE_MS` fails (a dropped connection never answers,
 * and a fetch has no deadline of its own), so its control shows ✗ and the
 * page's freshness, which waits for it, goes on.
 */
export async function postAction(input: string, init: RequestInit = {}): Promise<Response> {
  inFlight += 1;
  let signedOut = false;
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new DOMException("The change took too long to answer.", "TimeoutError")),
    POST_DEADLINE_MS,
  );
  const signal = init.signal ? AbortSignal.any([init.signal, deadline.signal]) : deadline.signal;
  try {
    const res = await fetch(input, { ...init, method: "POST", signal });
    signedOut = res.status === 401 || res.status === 403;
    return res;
  } finally {
    clearTimeout(timer);
    inFlight -= 1;
    if (signedOut) reloadOnNextNavigation();
    else requestSnapshotRefresh(() => invalidate(SNAPSHOT_DEPENDENCY));
    if (inFlight === 0) for (const f of [...settled]) f();
  }
}

/** How long a change may take to answer before it counts as failed: longer than
 *  any function Netlify lets run. */
export const POST_DEADLINE_MS = 30_000;

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
