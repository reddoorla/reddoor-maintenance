<script lang="ts">
  import type { AuditRowView } from "../../lib/audits/view.js";
  import RunForm from "../../lib/audits/RunForm.svelte";
  import "./audits.css";

  // Frozen by the operator (2026-10-20): ported as it was, nothing added.
  let { data }: { data: { audits: AuditRowView[] } } = $props();
</script>

<svelte:head>
  <title>Prospect audits — Reddoor maintenance</title>
</svelte:head>

<h1>Prospect audits</h1>
<div class="meta">Run a Lighthouse + AI-visibility audit against a prospect's site.</div>

<RunForm />
<p class="run-note">
  A run takes a few minutes and the result arrives by email — there is nothing to watch here, so
  feel free to close this page.
</p>

<h2>Recent audits</h2>
{#if data.audits.length === 0}
  <div class="empty">No audits yet — run one above.</div>
{:else}
  <div class="audit-list">
    {#each data.audits as a (a.id)}
      <div class="audit-row">
        <div class="audit-row-head">
          {#if a.business}<span class="audit-business">{a.business}</span>{:else}<span
              class="audit-business muted">(no business name)</span
            >{/if}
          <span class="pill {a.pill.cls}">{a.pill.label}</span>
          <span class="audit-when">{a.when}</span>
        </div>
        <div class="audit-url">
          {#if a.urlHref}<a href={a.urlHref}>{a.url}</a>{:else}{a.url}{/if}
        </div>
        {#if a.chosenTerms}<div class="audit-chosen muted">
            searches chosen by hand
          </div>{/if}{#if a.edited || a.opened}<div class="edit-state">
            {#if a.edited}Edited {a.edited}{/if}{#if a.edited && a.opened}{" · "}{/if}{#if a.opened}Opened
              {a.opened}{/if}{#if a.readSinceEdit}{" · "}<strong class="edit-state-warn"
                >read since you edited</strong
              >{/if}
          </div>{/if}
        <div class="audit-row-foot">
          {#if a.report.kind === "link"}<a href={a.report.href}>View report →</a>{:else}<span
              class="muted">{a.report.text}</span
            >{/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
