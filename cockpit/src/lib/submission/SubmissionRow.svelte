<script lang="ts">
  import type { SubmissionRowView } from "./view.js";
  import SubmissionRowInner from "./SubmissionRowInner.svelte";

  let { row }: { row: SubmissionRowView } = $props();
</script>

<li class="subm-item"><SubmissionRowInner {row} /></li>
