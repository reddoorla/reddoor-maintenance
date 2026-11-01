<script lang="ts">
  import { postAction } from "./post.js";
  // P1-88: re-test this site's failing checks now. POSTs to the authed
  // /api/sites/:slug/retest endpoint, which dispatches site-retest.yml for this site
  // alone. A pass clears its reason on the next load; the run takes a few minutes.
  let { url, audits }: { url: string; audits: string[] } = $props();
  let label = $state("Re-test now");
  let disabled = $state(false);
  let runsUrl: string | null = $state(null);

  async function trigger() {
    disabled = true;
    label = "Starting…";
    try {
      const res = await postAction(url);
      const body = (await res.json().catch(() => ({}))) as { runsUrl?: string; error?: string };
      if (res.ok) {
        label = "Re-test started: reload in a few minutes";
        runsUrl = body.runsUrl ?? null;
      } else {
        label = body.error === "nothing-to-retest" ? "Nothing to re-test" : "Failed";
        if (body.error !== "nothing-to-retest") disabled = false;
      }
    } catch {
      label = "Failed";
      disabled = false;
    }
  }
</script>

<button
  class="site-retest"
  data-retest-url={url}
  title={`Runs ${audits.join(", ")} for this site only`}
  {disabled}
  onclick={trigger}>{label}</button
>{#if runsUrl}
  <a class="site-retest-runs" href={runsUrl} target="_blank" rel="noopener">watch the run</a>{/if}
<span class="site-retest-audits">({audits.join(", ")})</span>
