<script lang="ts">
  import { postAction } from "../post.js";
  import { reportUis } from "./report-ui.svelte.js";

  let { reportId, url, confirmText }: { reportId: string; url: string; confirmText: string } =
    $props();
  // svelte-ignore state_referenced_locally
  const ui = reportUis().get(reportId);

  // "Don't send": confirm, then withdraw. On success every Approve twin for the
  // report goes dead too, since the server now refuses to approve it.
  async function onclick() {
    if (!confirm(confirmText)) return;
    ui.acted = true;
    ui.withdrawDisabled = true;
    try {
      const res = await postAction(url);
      if (res.ok) {
        ui.withdrawLabel = "Withdrawn";
        ui.approveLabel = "Withdrawn";
        ui.approveDisabled = true;
        ui.disableOverride();
      } else {
        const data = await res.json().catch(() => null);
        const reason = data && typeof data.reason === "string" ? data.reason : null;
        // Approved or sent meanwhile: withdrawing can never succeed now, so say
        // which and leave the button dead.
        if (reason === "already-approved") {
          ui.withdrawLabel = "Already approved";
          ui.approveLabel = "Approved";
          ui.approveDisabled = true;
        } else if (reason === "already-sent") {
          ui.withdrawLabel = "Already sent";
        } else {
          ui.withdrawLabel = reason ? "Failed: " + reason : "Failed";
          ui.withdrawDisabled = false;
        }
      }
    } catch {
      ui.withdrawLabel = "Failed";
      ui.withdrawDisabled = false;
    }
  }
</script>

<button
  class="withdraw"
  data-report-id={reportId}
  data-withdraw-url={url}
  data-confirm={confirmText}
  disabled={ui.withdrawDisabled}
  {onclick}>{ui.withdrawLabel}</button
>
