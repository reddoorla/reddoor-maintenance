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
    return await ownWrite(() => fetch(input, { ...init, method: "POST" }));
  } finally {
    reloadOnNextNavigation();
  }
}

type OwnWrite = <T>(write: () => Promise<T>) => Promise<T>;
const direct: OwnWrite = (write) => write();
let ownWrite: OwnWrite = direct;

/** The layout's freshness check wraps each post here, so the page's own change
 *  does not raise "Newer data is available" (#1700). `null` removes it. */
export function setOwnWrite(wrap: OwnWrite | null): void {
  ownWrite = wrap ?? direct;
}

/** SvelteKit's own opt-out, set on <body>: every link and GET form under it is
 *  then a full page load (and Back and Forward too, through `+layout.svelte`). */
export function reloadOnNextNavigation(): void {
  if (typeof document !== "undefined") document.body.setAttribute("data-sveltekit-reload", "");
}

/** Whether the snapshot in hand is stale, so the next navigation loads in full. */
export function reloadsOnNextNavigation(): boolean {
  return typeof document !== "undefined" && document.body.hasAttribute("data-sveltekit-reload");
}
