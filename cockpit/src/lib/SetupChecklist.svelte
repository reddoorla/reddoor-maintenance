<script lang="ts">
  import type { SetupGapView } from "./cockpit/view.js";

  // A site's Setup checklist (#672 step 2): the roster cells still to fill.
  // Not a verdict, so it sits apart from the tier pill and the alarm chips.
  // Each gap names the exact text that marks it accepted, as a watch chip does.
  let { gaps }: { gaps: SetupGapView[] } = $props();
</script>

{#if gaps.length > 0}
  <ul class="setup-gaps" aria-label="Setup">
    {#each gaps as g (g.acceptKey)}
      <li title="Fill this in, or add the accept text to the site's Accepted Watch Conditions">
        {g.reason} · accept: "{g.acceptKey}"
      </li>
    {/each}
  </ul>
{/if}
