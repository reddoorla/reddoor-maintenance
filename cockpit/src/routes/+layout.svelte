<script lang="ts">
  import type { Snippet } from "svelte";
  import Shell from "../lib/Shell.svelte";

  let {
    data,
    children,
  }: { data: { email: string | null; path: string; page?: string }; children: Snippet } = $props();
</script>

<Shell email={data.email} path={data.path}>
  <!-- A fresh mount per page, as when every link was a full page load: no
       button's "working…" state or local filter carries over to the next page
       now that navigation stays in the browser (the snapshot). -->
  {#key data.page ?? data.path}
    {@render children()}
  {/key}
</Shell>
