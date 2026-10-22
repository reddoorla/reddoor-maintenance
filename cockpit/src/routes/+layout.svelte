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
  import { beginRestore, captureView, finishRestore, type KeptView } from "../lib/view-keep.js";
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

  // A fresh mount per page, and per change in the store, as when every link was
  // a full page load: no control keeps state built from data the store no longer
  // holds (a button's label, the Approve gate, a field's saved value), now that
  // the page stays in the browser. Keyed on the store's counter, not on each
  // read: a check that finds nothing new, or a refused or failed save, leaves
  // the page as it is, with what the operator typed and the ✗ beside it. Only a
  // snapshot with no counter (the read failed) falls back to its read time.
  const pageKey = $derived(data.page ?? data.path);
  const viewKey = $derived(`${pageKey}@${data.snapshot?.version ?? data.snapshot?.takenAt ?? ""}`);

  // A remount on the same page keeps the operator's place (lib/view-keep.ts):
  // recorded before the old page goes, put back once the new one is in.
  let shownPage: string | null = null;
  $effect.pre(() => {
    void viewKey;
    const kept: KeptView | null =
      shownPage === null ? null : captureView(shownPage, document, window.scrollY);
    beginRestore(kept, pageKey);
  });
  $effect(() => {
    void viewKey;
    finishRestore(document, (y) => window.scrollTo(0, y));
    shownPage = pageKey;
  });
</script>

<Shell email={data.email} path={data.path}>
  {#key viewKey}
    {@render children()}
  {/key}
</Shell>
