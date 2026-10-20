<script lang="ts">
  import type { StatusAction } from "./row.js";

  // One triage button. POSTs its action as JSON and reports the outcome in its
  // own label: "✓" (and stays disabled), or "Failed" (and re-arms).
  let { id, url, action, label }: { id: string; url: string; action: StatusAction; label: string } =
    $props();
  let text = $state<string | null>(null);
  let disabled = $state(false);

  async function onclick() {
    disabled = true;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify("ack" in action ? { ack: action.ack } : { status: action.status }),
      });
      text = res.ok ? "✓" : "Failed";
      if (!res.ok) disabled = false;
    } catch {
      text = "Failed";
      disabled = false;
    }
  }
</script>

<button
  class="subm-status"
  data-id={id}
  data-status={"status" in action ? action.status : undefined}
  data-ack={"ack" in action ? action.ack : undefined}
  data-url={url}
  {disabled}
  {onclick}>{text ?? label}</button
>
