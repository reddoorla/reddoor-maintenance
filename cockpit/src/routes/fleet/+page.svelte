<script lang="ts">
  import type { FleetTableModel } from "../../../../src/dashboard/fleet-table.js";
  import { safeUrl } from "../../../../src/util/html.js";
  import { COLUMNS, sortHref, sortArrow, statusOptions } from "./view.js";
  import "./fleet-table.css";

  // Sorting and filtering are links and a GET form — the page ships no script of
  // its own, as it never did.
  let { data }: { data: { model: FleetTableModel } } = $props();
  const m = $derived(data.model);
  const DASH = "—";
</script>

<svelte:head>
  <title>Fleet table — Reddoor maintenance</title>
</svelte:head>

{#snippet dateCell(v: string | null)}
  {#if v === null}{DASH}{:else if v.slice(0, 10) === v}{v}{:else}<span title={v}
      >{v.slice(0, 10)}</span
    >{/if}
{/snippet}

<h1>Fleet table</h1>
<div class="meta">{m.rows.length} of {m.totalSites} site{m.totalSites === 1 ? "" : "s"}</div>
<form class="filters" method="get" action="/fleet">
  <!-- The sort rides along as hidden inputs, so Apply never silently drops the
       operator's ranking on a filter change. -->
  <input type="hidden" name="sort" value={m.query.sort} />
  <input type="hidden" name="dir" value={m.query.dir} />
  <select name="status">
    {#each statusOptions(m) as o, i (i)}
      <option value={o.value} selected={o.selected}>{o.label}</option>
    {/each}
  </select>
  <input type="search" name="q" placeholder="Filter by name or slug" value={m.query.q} />
  <button type="submit">Apply</button>
  <a class="muted" href="/fleet">Clear</a>
</form>
{#if m.rows.length === 0}
  <div class="empty">No sites match these filters.</div>
{:else}
  <div class="fleet-table-wrap">
    <table class="fleet">
      <thead>
        <tr>
          {#each COLUMNS as col (col.key)}
            <th class={col.numeric ? "num" : undefined}
              ><a href={sortHref(m, col.key)}>{col.label}</a>{sortArrow(m, col.key)}</th
            >
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each m.rows as r (r.slug)}
          {@const url = safeUrl(r.url)}
          <tr class="fleet-row">
            <td><a href="/s/{r.slug}">{r.name}</a></td>
            <td>
              {#if url === "#"}<span class="muted">{DASH}</span>{:else}<a
                  href={url}
                  rel="noopener noreferrer">{r.url}</a
                >{/if}
            </td>
            <td>{r.status === null ? DASH : r.status}</td>
            <td class="num">{r.pScore === null ? DASH : r.pScore}</td>
            <td class="num">{r.rScore === null ? DASH : r.rScore}</td>
            <td class="num">{r.bpScore === null ? DASH : r.bpScore}</td>
            <td class="num">{r.seoScore === null ? DASH : r.seoScore}</td>
            <td>{@render dateCell(r.nextMaintenanceAt)}</td>
            <td>{@render dateCell(r.nextTestingAt)}</td>
            <td>{@render dateCell(r.lastLighthouseAuditAt)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
