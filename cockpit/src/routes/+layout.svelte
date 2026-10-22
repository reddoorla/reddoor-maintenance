<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import { afterNavigate, invalidate } from "$app/navigation";
  import Shell from "../lib/Shell.svelte";
  import { reloadsOnNextNavigation } from "../lib/post.js";
  import {
    SNAPSHOT_DEPENDENCY,
    isEditingField,
    setActiveFreshness,
    startFreshness,
  } from "../lib/freshness.js";
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
  // Back and Forward, which would re-derive the page from a snapshot that could
  // not be read whole. So a history step taken while it is set loads the page it
  // landed on in full, as each page was its own document before.
  afterNavigate(({ type }) => {
    if (type === "popstate" && reloadsOnNextNavigation()) location.reload();
  });

  // Freshness (the snapshot brief's PR 2): on coming back to the tab, on focus
  // and about once a minute while it is visible, ask whether the store changed,
  // and read the snapshot again only if it did; never while the operator is in a
  // field (lib/freshness.ts).
  onMount(() => {
    const controller = startFreshness(
      () => data.snapshot ?? null,
      {
        fetch: (input, init) => fetch(input, init),
        refresh: () => invalidate(SNAPSHOT_DEPENDENCY),
        reload: () => location.reload(),
      },
      {
        isVisible: () => document.visibilityState === "visible",
        isEditing: () => isEditingField(document.activeElement),
        listen: (event, handler) => {
          const target = event === "focus" ? window : document;
          target.addEventListener(event, handler);
          return () => target.removeEventListener(event, handler);
        },
      },
    );
    setActiveFreshness(controller);
    return () => {
      setActiveFreshness(null);
      controller.stop();
    };
  });
</script>

<Shell email={data.email} path={data.path}>
  <!-- A fresh mount per page, and per snapshot read, as when every link was a
       full page load: no control keeps state from before a navigation or a
       refresh (a button's label, the Approve gate, a field's saved value), now
       that the page stays in the browser (the snapshot). -->
  {#key `${data.page ?? data.path}@${data.snapshot?.takenAt ?? ""}`}
    {@render children()}
  {/key}
</Shell>
