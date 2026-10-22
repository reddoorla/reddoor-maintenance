<script lang="ts">
  import type { Snippet } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import Shell from "../lib/Shell.svelte";
  import { reloadsOnNextNavigation } from "../lib/post.js";

  let {
    data,
    children,
  }: { data: { email: string | null; path: string; page?: string }; children: Snippet } = $props();

  // SvelteKit reads `data-sveltekit-reload` for links and GET forms, never for
  // Back and Forward, which would re-derive the page from the snapshot the change
  // made stale. So a history step taken while it is stale loads the page it
  // landed on in full, as each page was its own document before.
  afterNavigate(({ type }) => {
    if (type === "popstate" && reloadsOnNextNavigation()) location.reload();
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
