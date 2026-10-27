<script lang="ts">
  import { onMount } from "svelte";
  import { THEME_LABEL, applyTheme, nextTheme, readTheme, type ThemeChoice } from "./theme.js";

  // The server cannot see localStorage, so it renders "system" and the browser
  // corrects the label on mount; the page's colours were already right, set by
  // app.html's inline script before first paint.
  let choice = $state<ThemeChoice>("system");

  function storage(): Storage | undefined {
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  }

  onMount(() => {
    choice = readTheme(storage());
  });

  function cycle() {
    choice = nextTheme(choice);
    applyTheme(choice, document.documentElement, storage());
  }
</script>

<button type="button" class="theme-toggle" data-theme-toggle onclick={cycle}
  >{THEME_LABEL[choice]}</button
>
