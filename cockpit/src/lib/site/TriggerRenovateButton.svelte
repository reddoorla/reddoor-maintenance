<script lang="ts">
  let { url }: { url: string } = $props();
  let label = $state("Trigger Renovate");
  let disabled = $state(false);

  // Async on-demand dispatch of the site's Renovate run.
  async function onclick() {
    disabled = true;
    label = "Dispatching…";
    try {
      const res = await fetch(url, { method: "POST" });
      label = res.ok ? "Dispatched ✓" : "Failed";
      if (!res.ok) disabled = false;
    } catch {
      label = "Failed";
      disabled = false;
    }
  }
</script>

<button class="trigger-renovate" data-trigger-url={url} {disabled} {onclick}>{label}</button>
