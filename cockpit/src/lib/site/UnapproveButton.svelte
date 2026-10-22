<script lang="ts">
  import { postAction } from "../post.js";
  let { reportId, url, confirmText }: { reportId: string; url: string; confirmText: string } =
    $props();
  let label = $state("Unapprove");
  let disabled = $state(false);

  // "Unapprove": confirm, then take the approval back. On success the page
  // reloads, because the report now belongs in the pending list with its
  // approve, refresh and "Don't send" actions.
  async function onclick() {
    if (!confirm(confirmText)) return;
    disabled = true;
    try {
      const res = await postAction(url);
      if (res.ok) {
        label = "Unapproved";
        if (typeof location !== "undefined") location.reload();
      } else {
        const data = await res.json().catch(() => null);
        const reason = data && typeof data.reason === "string" ? data.reason : null;
        // Sent, mid-send or withdrawn meanwhile: unapproving can never succeed now.
        if (reason === "already-sent") {
          label = "Already sent";
        } else if (reason === "sending") {
          label = "Sending now";
        } else if (reason === "withdrawn") {
          label = "Withdrawn";
        } else {
          label = reason ? "Failed: " + reason : "Failed";
          disabled = false;
        }
      }
    } catch {
      label = "Failed";
      disabled = false;
    }
  }
</script>

<button
  class="unapprove"
  data-report-id={reportId}
  data-unapprove-url={url}
  data-confirm={confirmText}
  {disabled}
  {onclick}>{label}</button
>
