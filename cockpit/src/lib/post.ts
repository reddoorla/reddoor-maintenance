/**
 * Every change the cockpit's pages make goes through here: a POST to one of its
 * `/api/*` routes. The pages derive from the layout's snapshot, which the change
 * has just made stale, so once it is sent (whatever its answer) the next
 * navigation is a full page load, with a fresh snapshot: what every navigation
 * was before the snapshot, when each link reloaded the page. The page in view
 * keeps showing what the control itself reports (its ✓ or ✗), as it always did.
 */
export async function postAction(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(input, { ...init, method: "POST" });
  } finally {
    reloadOnNextNavigation();
  }
}

/** SvelteKit's own opt-out, set on <body>: every link and GET form under it is
 *  then a full page load. */
export function reloadOnNextNavigation(): void {
  if (typeof document !== "undefined") document.body.setAttribute("data-sveltekit-reload", "");
}
