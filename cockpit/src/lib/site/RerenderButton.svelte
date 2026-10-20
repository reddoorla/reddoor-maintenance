<script lang="ts">
  let { url }: { url: string } = $props();
  let label = $state("refresh preview");
  let disabled = $state(false);

  // Dispatch the re-render workflow, then tell the operator to reload once it
  // lands. No polling — the run takes a minute or two and a spinner that long
  // reads as a hang.
  async function onclick() {
    disabled = true;
    label = "Refreshing…";
    try {
      const res = await fetch(url, { method: "POST" });
      label = res.ok ? "Queued ✓ reload in ~2 min" : "Failed";
      if (!res.ok) disabled = false;
    } catch {
      label = "Failed";
      disabled = false;
    }
  }
</script>

<button
  class="rerender"
  data-rerender-url={url}
  title="Re-render this report from its current row and, until it is approved, re-check its health evidence and take the site's current audit scores; approved or not, re-run the site's Search Console lookup (runs in Actions; takes a minute or two)"
  {disabled}
  {onclick}>{label}</button
>
