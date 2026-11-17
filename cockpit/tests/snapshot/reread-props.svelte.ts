/**
 * The props the layout re-read test changes under a mounted layout: a `$state`
 * holder, so the layout sees a new `data` the way a SvelteKit re-read gives it one.
 * A `.svelte.ts` module, because runes are only allowed in one.
 */
export const holder = $state<{ data: Record<string, unknown> }>({ data: {} });
