import { onMount } from "svelte";

/**
 * Whether the calling component has mounted, so its event handlers exist. The
 * old pages attached every handler from an inline script at the end of
 * `<body>`, live from first paint; a Svelte handler arrives only at hydration.
 * A control that acts on input renders `disabled={!m.ready}`, so a click,
 * keystroke or submit before then can neither post unconfirmed nor be lost
 * without a ✓/✗ (review rounds 1 and 2 of #582 step 1a). Call it during
 * component initialisation.
 */
export function mounted(): { readonly ready: boolean } {
  const state = $state({ ready: false });
  onMount(() => {
    state.ready = true;
  });
  return state;
}
