/**
 * The props the overview identity tests change under a mounted page: a `$state` holder, so the
 * page sees a new `data` the way a SvelteKit re-read gives it one (as the layout's
 * `reread-props.svelte.ts`). A `.svelte.ts` module, because runes are only allowed in one.
 */
export const page = $state<{ data: Record<string, unknown> }>({ data: {} });
