<script lang="ts">
  import { mounted } from "../../lib/mounted.svelte.js";
  import { SUBMISSION_STATUSES } from "../../../../src/reports/submission-row.js";
  import { SUBMISSION_FORM_TYPES } from "../../../../src/forms/types.js";
  import SubmissionRowInner from "../../lib/submission/SubmissionRowInner.svelte";
  import type { SubmissionsPageData } from "./data.js";
  import { pageHref, maxPage, markReadConfirmText } from "./view.js";
  import PageStyles from "../../lib/PageStyles.svelte";
  import submissionsCss from "./submissions.css?inline";

  let { data }: { data: SubmissionsPageData } = $props();
  const m = $derived(data.model);
  const f = $derived(m.filter);
  const pages = $derived(maxPage(m));
  const facets = $derived(data.facets);
  // The hidden fields the bulk form posts back, in the order the old form had
  // them; an empty value is left out.
  const bulkFields = $derived(
    (
      [
        ["site", f.site],
        ["type", f.type],
        ["status", f.status],
        ["q", f.q],
        ["from", f.from],
        ["to", f.to],
        ["reason", f.reason],
      ] as const
    ).filter(([, v]) => v !== ""),
  );

  // The bulk button waits for `confirmMarkRead`: the old form's inline confirm
  // held from first paint, and a mark-read must never post unconfirmed.
  const m0 = mounted();

  function confirmMarkRead(e: SubmitEvent) {
    if (!confirm(markReadConfirmText(m.markableNewCount))) e.preventDefault();
  }
</script>

<svelte:head>
  <title>Submissions — Reddoor maintenance</title>
</svelte:head>
<PageStyles sheets={[submissionsCss]} />

<h1>Submissions</h1>
<form class="filters" method="get" action="/submissions">
  <select name="site">
    <option value="">All sites</option>
    {#each m.sites as s (s.slug)}
      <option value={s.slug} selected={s.slug === f.site}>{s.name}</option>
    {/each}
  </select>
  <select name="type">
    <option value="">All types</option>
    {#each SUBMISSION_FORM_TYPES as t (t)}
      <option value={t} selected={t === f.type}>{t}</option>
    {/each}
  </select>
  <select name="status">
    <option value="">All statuses</option>
    {#each SUBMISSION_STATUSES as s (s)}
      <option value={s} selected={s === f.status}>{s}</option>
    {/each}
  </select>
  <input type="search" name="q" placeholder="Search name / email / phone / message" value={f.q} />
  <input type="date" name="from" value={f.from} />
  <input type="date" name="to" value={f.to} />
  <button type="submit">Apply</button>
  <a class="muted" href="/submissions">Clear</a>
</form>
{#if m.total === 0}
  <div class="empty">No submissions match these filters.</div>
{:else if m.rows.length === 0}
  <!-- Paged past the last page: a clear notice and a link back to the last real
       page, not an empty list under the total with an impossible pager. -->
  <div class="empty">
    No submissions on page {m.page} (only {pages} page{pages === 1 ? "" : "s"}).
    <a href={pageHref(m, pages)}>Go to last page →</a>
  </div>
{:else}
  <div class="meta">{m.total} submission{m.total === 1 ? "" : "s"}</div>
  {#if m.markableNewCount > 0}
    <form class="bulk-read" method="post" action="/submissions" onsubmit={confirmMarkRead}>
      <input type="hidden" name="action" value="mark-read" />
      {#each bulkFields as [name, value] (name)}
        <input type="hidden" {name} {value} />
      {/each}
      <button type="submit" disabled={!m0.ready}
        >Mark all {m.markableNewCount} filtered as read</button
      >
    </form>{/if}{#if facets.length > 0}
    <div class="spam-facets muted">
      {#each facets as c, i (c.token)}{#if i > 0}{" "}{/if}<a
          class={c.active ? "facet-chip active" : "facet-chip"}
          href={c.href}
          title="Filter to rows carrying this reason{c.active ? ' (click to clear)' : ''}"
          >{c.token} ×{c.count}</a
        >{/each}
    </div>{/if}
  <ul class="subm-list">
    {#each m.rows as r (r.id)}
      <li class="subm-item">
        <div class="subm-row-wrap">
          {#if r.slug}<a class="subm-site" href="/s/{r.slug}">{r.siteName}</a>{:else}<span
              class="subm-site muted">{r.siteName}</span
            >{/if}
          <div class="subm-row-main"><SubmissionRowInner row={data.rowViews[r.id]!} /></div>
        </div>
      </li>
    {/each}
  </ul>
  {#if pages > 1}
    <div class="pager">
      {#if m.page > 1}<a href={pageHref(m, m.page - 1)}>← Prev</a>{:else}<span class="muted"
          >← Prev</span
        >{/if}<span class="muted">Page {m.page} of {pages}</span>{#if m.page < pages}<a
          href={pageHref(m, m.page + 1)}>Next →</a
        >{:else}<span class="muted">Next →</span>{/if}
    </div>
  {/if}
{/if}
