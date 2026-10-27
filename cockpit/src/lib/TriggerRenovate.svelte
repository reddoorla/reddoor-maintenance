<script lang="ts">
  import { postAction } from "./post.js";
  // On-demand Renovate dispatch for a repo-backed site: POST to the authed
  // /api/sites/:slug/trigger-renovate endpoint.
  let { url }: { url: string } = $props();
  let label = $state("Trigger Renovate");
  let disabled = $state(false);

  async function trigger() {
    disabled = true;
    label = "Dispatching…";
    try {
      const res = await postAction(url);
      label = res.ok ? "Dispatched" : "Failed";
      if (!res.ok) disabled = false;
    } catch {
      label = "Failed";
      disabled = false;
    }
  }
</script>

<button class="trigger-renovate" data-trigger-url={url} {disabled} onclick={trigger}>{label}</button
>
