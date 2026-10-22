<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount, tick, untrack } from "svelte";
  import { afterNavigate, invalidate } from "$app/navigation";
  import Shell from "../lib/Shell.svelte";
  import {
    onPostsSettled,
    postsInFlight,
    reloadOnNextNavigation,
    reloadsOnNextNavigation,
  } from "../lib/post.js";
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

  // The operator is in a field, or a save has not answered yet: a remount now
  // would take the field's text, or the answer's ✓ or ✗, with it.
  const busy = () =>
    typeof document !== "undefined" &&
    (isEditingField(document.activeElement) || postsInFlight() > 0);

  // Freshness (the snapshot brief's PR 2): on coming back to the tab, on focus
  // and about once a minute while it is visible, ask whether the store changed,
  // and read the snapshot again only if it did; never while the operator is in a
  // field (lib/freshness.ts).
  onMount(() => {
    const controller = startFreshness(
      () => data.snapshot ?? null,
      {
        fetch: (input, init) => fetch(input, init),
        refresh: async (own) => {
          if (own) ownReads += 1;
          try {
            await invalidate(SNAPSHOT_DEPENDENCY);
            // SvelteKit hands the page its new data without waiting for the
            // page to take it; count the read down only once it has.
            await tick();
          } finally {
            if (own) ownReads -= 1;
          }
        },
        signedOut: () => reloadOnNextNavigation(),
      },
      {
        isVisible: () => document.visibilityState === "visible",
        isEditing: busy,
        listen: (event, handler) => {
          const target = event === "focus" ? window : document;
          target.addEventListener(event, handler);
          return () => target.removeEventListener(event, handler);
        },
      },
    );
    setActiveFreshness(controller);
    // A remount held for the operator (below) goes ahead once they are done.
    const whenDone = () => setTimeout(() => applyView(dataKey, pageKey), 0);
    document.addEventListener("focusout", whenDone);
    const stopSettled = onPostsSettled(whenDone);
    return () => {
      setActiveFreshness(null);
      controller.stop();
      document.removeEventListener("focusout", whenDone);
      stopSettled();
    };
  });

  // A fresh mount per page, and per change in the store, as when every link was
  // a full page load: no control keeps state built from data the store no longer
  // holds (a button's label, the Approve gate, a field's saved value), now that
  // the page stays in the browser. Keyed on the store's counter, not on each
  // read: a check that finds nothing new, or a refused or failed save, leaves
  // the page as it is, with what the operator typed and the ✗ beside it. Only a
  // snapshot with no counter (the read failed) falls back to its read time.
  //
  // The read after the page's own post is taken in place, never remounted: the
  // control that posted knows what it did, and shows it (its ✓ or error, the
  // form as filled in), and every other control follows the new data. A change
  // a check found elsewhere remounts.
  //
  // A snapshot read can land while the operator has just stepped into a field
  // (a check under way when they clicked in): the remount then waits until they
  // are done, while a navigation (a page of its own) mounts at once.
  const pageKey = $derived(data.page ?? data.path);
  const dataKey = $derived(`${pageKey}@${data.snapshot?.version ?? data.snapshot?.takenAt ?? ""}`);
  let viewKey = $state(untrack(() => dataKey));
  let viewPage = untrack(() => pageKey);
  // The data the page shows: `viewKey`'s, or newer, taken in place.
  let shownKey = untrack(() => dataKey);
  let ownReads = 0;
  function applyView(key: string, page: string): void {
    if (key === shownKey) return;
    if (page === viewPage && ownReads > 0) {
      shownKey = key;
      return;
    }
    if (page === viewPage && busy()) return;
    viewPage = page;
    viewKey = key;
    shownKey = key;
  }
  $effect.pre(() => {
    const key = dataKey;
    const page = pageKey;
    untrack(() => applyView(key, page));
  });

  // A remount on the same page keeps the operator's place (lib/view-keep.ts):
  // recorded before the old page goes, put back once the new one is in.
  let shownPage: string | null = null;
  $effect.pre(() => {
    void viewKey;
    untrack(() => {
      const kept: KeptView | null =
        shownPage === null ? null : captureView(shownPage, document, window.scrollY);
      beginRestore(kept, viewPage);
    });
  });
  $effect(() => {
    void viewKey;
    untrack(() => {
      finishRestore(document, (y) => window.scrollTo(0, y));
      shownPage = viewPage;
    });
  });
</script>

<Shell email={data.email} path={data.path}>
  {#key viewKey}
    {@render children()}
  {/key}
</Shell>
