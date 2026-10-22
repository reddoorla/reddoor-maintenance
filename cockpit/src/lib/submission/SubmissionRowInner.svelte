<script lang="ts">
  import type { SubmissionRowView } from "./view.js";
  import StatusButton from "./StatusButton.svelte";

  /** A submission row's content WITHOUT the <li>: /submissions wraps rows with a
   *  site link, and a ul may only contain li, so the wrapper owns the li. */
  let { row }: { row: SubmissionRowView } = $props();
</script>

<details>
  <summary class="subm-head"
    ><strong>{row.formType}</strong> · {row.who} <span class="muted">{row.email}</span>
    <span class="pill subm-{row.status}">{row.status}</span>{#if row.provenance}{" "}<span
        class="subm-provenance"
        title={row.provenance.title}>auto-spam · {row.provenance.score}</span
      >{#if row.provenance.reasons !== null}{" "}<span class="subm-reasons"
          >{row.provenance.reasons}</span
        >{/if}{/if}{#if row.bounce}{" "}<span
        class={row.bounce.acked ? "subm-bounce acked" : "subm-bounce"}
        title={row.bounce.title}>{row.bounce.text}</span
      >{/if}{#if row.fanout !== null}{" "}<span
        class="subm-fanout-fail"
        title="This signup did not reach every configured destination">fan-out: {row.fanout}</span
      >{/if}
    <span class="muted">{row.when}</span></summary
  >
  <div class="subm-detail">
    {#each row.details as d, i (i)}
      {#if d.kind === "kv"}
        <div class="subm-kv"><span class="k">{d.label}</span> {d.value}</div>
      {:else if d.kind === "message"}
        <div class="subm-kv"><span class="k">Message</span></div>
        <div class="subm-msg">{d.text}</div>
      {:else if d.kind === "source"}
        <div class="subm-kv">
          <span class="k">Source</span> <a href={d.href} rel="noopener noreferrer">{d.text}</a>
        </div>
      {:else}
        <div class="subm-kv"><span class="k">Extra fields</span> <code>{d.raw}</code></div>
      {/if}
    {/each}
  </div>
</details>
<div class="subm-actions">
  {#each row.buttons as button ("ack" in button ? `ack:${button.ack}` : button.status)}<StatusButton
      id={row.id}
      url={row.url}
      {button}
    />{/each}
</div>
