<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import Shell from "../lib/Shell.svelte";
  import { reloadOnNextNavigation, reloadsOnNextNavigation } from "../lib/post.js";
  import { startFreshness } from "../lib/freshness.js";
  import type { CockpitSnapshot } from "../../../src/dashboard/snapshot-views.js";

  let {
    data,
    children,
  }: {
    data: {
      email: string | null;
      path: string;
      page?: string;
      snapshot?: CockpitSnapshot | null;
    };
    children: Snippet;
  } = $props();

  // SvelteKit reads `data-sveltekit-reload` for links and GET forms, never for
  // Back and Forward, which would re-derive the page from the snapshot the change
  // made stale. So a history step taken while it is stale loads the page it
  // landed on in full, as each page was its own document before.
  afterNavigate(({ type }) => {
    if (type === "popstate" && reloadsOnNextNavigation()) location.reload();
  });

  // Freshness (the snapshot brief's PR 2, cut down to a notice by the operator's
  // decision 2026-10-22-1541): on coming back to the tab, on focus and about once
  // a minute while it is visible, ask whether the store changed since this
  // snapshot was read. If it has, say so; the page never changes under the
  // operator, and they reload when they choose (lib/freshness.ts).
  let newer = $state(false);
  onMount(() => {
    const controller = startFreshness(
      () => data.snapshot ?? null,
      {
        fetch: (input, init) => fetch(input, init),
        signedOut: () => reloadOnNextNavigation(),
      },
      {
        isVisible: () => document.visibilityState === "visible",
        listen: (event, handler) => {
          const target = event === "focus" ? window : document;
          target.addEventListener(event, handler);
          return () => target.removeEventListener(event, handler);
        },
      },
      () => {
        newer = true;
        // A navigation from here reads the store afresh too.
        reloadOnNextNavigation();
      },
    );
    return () => controller.stop();
  });
</script>

<Shell email={data.email} path={data.path}>
  {#if newer}
    <div class="cockpit-newer" role="status">
      The store has changed since this page was read.
      <button type="button" onclick={() => location.reload()}>Reload</button>
    </div>
  {/if}
  <!-- A fresh mount per page, as when every link was a full page load: no
       button's "working…" state or local filter carries over to the next page
       now that navigation stays in the browser (the snapshot). -->
  {#key data.page ?? data.path}
    {@render children()}
  {/key}
</Shell>

<style>
  .cockpit-newer {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 10;
    display: flex;
    gap: 0.75rem;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border: 1px solid currentColor;
    border-radius: 6px;
    background: Canvas;
    color: CanvasText;
    font-size: 0.875rem;
  }
</style>
