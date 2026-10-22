import { onMount } from "svelte";
import type { AfterNavigate } from "@sveltejs/kit";

/**
 * `$app/navigation` for the cockpit's vitest projects, which run Svelte
 * without SvelteKit's plugin, so the real module (it needs `$app/paths` and
 * the client router) cannot load. `afterNavigate` registers on mount and is
 * gone on destroy, so a server render never registers it, as with SvelteKit's;
 * unlike SvelteKit's, it does not fire once after mount (the "enter"
 * navigation), so a test that needs that must call `navigate()` itself.
 * `navigate()` stands in for a client navigation finishing (vitest.config.ts
 * aliases the module here).
 */
const after = new Set<(n: AfterNavigate) => void>();

export function afterNavigate(callback: (n: AfterNavigate) => void): void {
  onMount(() => {
    after.add(callback);
    return () => {
      after.delete(callback);
    };
  });
}

/** Run every mounted `afterNavigate` callback, as a finished navigation does. */
export function navigate(to = "/fleet"): void {
  const url = new URL(to, "http://localhost");
  const n = {
    from: null,
    to: { url, params: {}, route: { id: "/fleet" } },
    type: "link",
    willUnload: false,
    complete: Promise.resolve(),
  } as unknown as AfterNavigate;
  for (const cb of after) cb(n);
}

/** Every dependency `invalidate` was called with, in order; tests reset it. */
export const invalidated: string[] = [];

/** `invalidate` as a recorder: the vitest projects have no router to re-run loads. */
export async function invalidate(
  dependency: string | URL | ((url: URL) => boolean),
): Promise<void> {
  invalidated.push(String(dependency));
}
