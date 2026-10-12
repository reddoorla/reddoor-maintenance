/**
 * Waiting for a SvelteKit page to finish hydrating before touching its DOM.
 *
 * A node the server did not render (form-e2e's hidden `testMode` input) that is
 * present when Svelte 5 claims the tree is a hydration mismatch: Svelte clears
 * the tree and mounts it again, wiping whatever was filled. On Mantis
 * (2026-10-04, #1148) injecting before hydration re-mounted the form 5 times
 * out of 5; filling without the injection, 0 out of 19.
 *
 * The signal is the starter's `html[data-hydrated]` (reddoor-starter#184),
 * written in the root layout's `onMount`. It means "the root layout has
 * mounted", which is what matters here: the tree is no longer being claimed.
 * A site that does not write it cannot be told apart from one that has not
 * hydrated yet, so the wait is capped, and on such a site the cap is the settle.
 */

export const HYDRATED_SELECTOR = "html[data-hydrated]";

/** The marker check as an expression string, for callers that evaluate in the
 *  page without the DOM lib (form-e2e) or emit it into a generated spec (a11y). */
export const HYDRATED_EXPR = `document.documentElement.hasAttribute("data-hydrated")`;

/** Long enough for a cold SvelteKit bundle on a CI runner to start after `load`;
 *  short enough that a site without the marker pays it once per run. */
export const HYDRATION_TIMEOUT_MS = 5000;

export type HydrationWaitPage = {
  waitForLoadState: (state: "load", opts: { timeout: number }) => Promise<unknown>;
  waitForFunction: (expr: string, arg: unknown, opts: { timeout: number }) => Promise<unknown>;
};

/**
 * Wait for `load`, then for `html[data-hydrated]`, both within one `timeoutMs`
 * budget. `"marker"` means the site said it hydrated; `"settled"` means the
 * budget ran out (or the page could not answer) and the caller proceeds anyway.
 * Never throws: a probe that cannot tell must still run.
 */
export async function waitForHydration(
  page: HydrationWaitPage,
  opts: { timeoutMs?: number } = {},
): Promise<"marker" | "settled"> {
  const timeoutMs = opts.timeoutMs ?? HYDRATION_TIMEOUT_MS;
  const start = Date.now();
  await page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => {});
  const left = Math.max(1, timeoutMs - (Date.now() - start));
  return page
    .waitForFunction(HYDRATED_EXPR, null, { timeout: left })
    .then(() => "marker" as const)
    .catch(() => "settled" as const);
}
