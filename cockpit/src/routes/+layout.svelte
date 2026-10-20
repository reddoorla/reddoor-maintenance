<script lang="ts">
  import type { Snippet } from "svelte";
  import Shell from "../lib/Shell.svelte";

  let { data, children }: { data: { email: string | null; path: string }; children: Snippet } =
    $props();
</script>

<Shell email={data.email} path={data.path}>
  {@render children()}
</Shell>
