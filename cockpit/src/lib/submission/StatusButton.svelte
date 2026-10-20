<script lang="ts">
  import type { SubmissionStatusButton } from "./view.js";

  let { id, url, button }: { id: string; url: string; button: SubmissionStatusButton } = $props();

  // svelte-ignore state_referenced_locally
  let label = $state(button.label);
  let disabled = $state(false);

  /** Post the new status (or the bounce acknowledge), then show ✓ or Failed.
   *  A failure re-enables the button so it can be retried. */
  async function onclick() {
    disabled = true;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify("ack" in button ? { ack: button.ack } : { status: button.status }),
      });
      label = res.ok ? "✓" : "Failed";
      if (!res.ok) disabled = false;
    } catch {
      label = "Failed";
      disabled = false;
    }
  }
</script>

{#if "ack" in button}
  <button class="subm-status" data-id={id} data-ack={button.ack} data-url={url} {disabled} {onclick}
    >{label}</button
  >
{:else}
  <button
    class="subm-status"
    data-id={id}
    data-status={button.status}
    data-url={url}
    {disabled}
    {onclick}>{label}</button
  >
{/if}
