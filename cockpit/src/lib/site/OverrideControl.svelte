<script lang="ts">
  import { reportUis } from "./report-ui.svelte.js";

  let { reportId, url }: { reportId: string; url: string } = $props();
  // svelte-ignore state_referenced_locally
  const ui = reportUis().get(reportId);
  let hidden = $state(true);
  let status = $state("");
  let reasonInput: HTMLInputElement | undefined = $state();

  // The submit POSTs the override URL with { reason } — a deliberate action,
  // never a silent default (an empty reason is refused here AND server-side).
  async function submit() {
    const reason = reasonInput ? reasonInput.value.trim() : "";
    if (!reason) {
      status = "Reason required";
      return;
    }
    ui.overrideSubmitDisabled = true;
    status = "Sending…";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        status = "Overridden ✓";
        ui.overrideReasonDisabled = true;
        // Both Approve twins stop implying "waiting on you" once an override has
        // gone through; they stay server-gated disabled.
        ui.approveLabel = "Overridden";
        ui.withdrawDisabled = true;
      } else {
        const data = await res.json().catch(() => null);
        status =
          data && Array.isArray(data.blockers) && data.blockers.length > 0
            ? data.blockers.join("; ")
            : data && data.reason === "override-reason-required"
              ? "Reason required"
              : "Failed";
        ui.overrideSubmitDisabled = false;
      }
    } catch {
      status = "Failed";
      ui.overrideSubmitDisabled = false;
    }
  }
</script>

<div class="override" data-override-for={reportId}>
  <button
    type="button"
    class="override-toggle"
    data-report-id={reportId}
    disabled={ui.overrideToggleDisabled}
    onclick={() => (hidden = !hidden)}>Send anyway…</button
  >
  <div class="override-form" {hidden}>
    <input
      type="text"
      class="override-reason"
      data-report-id={reportId}
      placeholder="Reason for overriding the health gate (required)"
      disabled={ui.overrideReasonDisabled}
      bind:this={reasonInput}
    />
    <button
      type="button"
      class="override-submit"
      data-report-id={reportId}
      data-override-url={url}
      disabled={ui.overrideSubmitDisabled}
      onclick={submit}>Confirm override</button
    >
    <span class="override-status">{status}</span>
  </div>
</div>
