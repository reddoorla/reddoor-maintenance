<script lang="ts">
  import type { ApproveView } from "./view.js";
  import { reportUis } from "./report-ui.svelte.js";

  let { approve }: { approve: ApproveView } = $props();
  // svelte-ignore state_referenced_locally
  const ui = reportUis().get(approve.reportId, approve.disabled);
  // The spinner is this button's alone; the label and gate are shared with its twin.
  let loading = $state(false);

  async function onclick() {
    ui.approveDisabled = true;
    loading = true;
    try {
      const res = await fetch(approve.url, { method: "POST" });
      if (res.ok) {
        // Terminal success: they stay disabled (approving twice is a no-op
        // server-side, but the button should not invite the second click).
        ui.approveLabel = "Approved";
        ui.approved = true;
        ui.withdrawDisabled = true;
      } else {
        // A 409 carries { reason, blockers } — surface WHY instead of a bare
        // "Failed". Text and title only, so server strings stay inert.
        const data = await res.json().catch(() => null);
        // A withdrawn report can never be approved: say so, and leave the
        // buttons dead rather than inviting a retry that will be refused too.
        const withdrawn = !!data && data.reason === "withdrawn";
        const label = withdrawn
          ? "Withdrawn"
          : data && data.reason === "send-blocked"
            ? "Blocked"
            : "Failed";
        const title = data && Array.isArray(data.blockers) ? data.blockers.join("\n") : null;
        ui.approveLabel = label;
        if (title !== null) ui.approveTitle = title;
        ui.approveDisabled = withdrawn;
        if (withdrawn) {
          ui.withdrawDisabled = true;
          ui.disableOverride();
        }
      }
    } catch {
      // Network rejection: never leave the buttons disabled reading "Approve".
      ui.approveLabel = "Failed";
      ui.approveDisabled = false;
    } finally {
      loading = false;
    }
  }
</script>

<button
  class={["approve", loading && "is-loading", ui.approved && "is-approved"]}
  data-report-id={approve.reportId}
  data-approve-url={approve.url}
  data-send-blocked={approve.blocked ? "1" : undefined}
  aria-busy={loading ? "true" : undefined}
  title={ui.approveTitle ?? undefined}
  disabled={ui.approveDisabled}
  {onclick}>{ui.approveLabel}</button
>
