<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import { afterNavigate, invalidate } from "$app/navigation";
  import Shell from "../lib/Shell.svelte";
  import { reloadsOnNextNavigation } from "../lib/post.js";
  import { CHECK_EVERY_MS, SNAPSHOT_DEPENDENCY, checkFreshness } from "../lib/freshness.js";
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

  // Freshness (the snapshot brief's PR 2): on coming back to the tab, and about
  // once a minute while it is visible, ask whether the store changed, and read
  // the snapshot again only if it did. One check at a time.
  onMount(() => {
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        await checkFreshness(data.snapshot ?? null, {
          fetch: (input, init) => fetch(input, init),
          refresh: () => invalidate(SNAPSHOT_DEPENDENCY),
          reload: () => location.reload(),
        });
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onFocus = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  });
</script>

<Shell email={data.email} path={data.path}>
  <!-- A fresh mount per page, as when every link was a full page load: no
       button's "working…" state or local filter carries over to the next page
       now that navigation stays in the browser (the snapshot). -->
  {#key data.page ?? data.path}
    {@render children()}
  {/key}
</Shell>
