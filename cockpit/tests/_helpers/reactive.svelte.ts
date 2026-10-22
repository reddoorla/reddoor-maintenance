/** A `$state` object for a test to hand `mount` as props and change later: runes
 *  compile only in `.svelte` and `.svelte.ts` files, not in a test file. */
export function reactive<T extends object>(value: T): T {
  const s = $state(value);
  return s;
}
