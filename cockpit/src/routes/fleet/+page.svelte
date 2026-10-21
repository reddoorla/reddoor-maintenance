<script lang="ts">
  import type { FleetTableModel } from "../../../../src/dashboard/fleet-table.js";
  import { safeUrl } from "../../../../src/util/html.js";
  import type { SitesView } from "../../lib/cockpit/view.js";
  import SetupChecklist from "../../lib/SetupChecklist.svelte";
  import { COLUMNS, sortHref, sortArrow, statusOptions } from "./view.js";
  import "../../lib/cockpit/health.css";
  import "./fleet-table.css";

  // Sites: the fleet table with the browse panel merged in (#672 step 3). Sorting
  // and the status and name filters are links and a GET form. The signal chips
  // filter the rows in the browser, as the browse panel filtered its cards: a
  // row matches when its site's card carries that signal, so a row with no card
  // (an archived or building site) shows only under "all".
  let { data }: { data: { model: FleetTableModel; sites: SitesView } } = $props();
  const m = $derived(data.model);
  const s = $derived(data.sites);
  const DASH = "—";
  let filter = $state("all");
  // An own-property read: a slug that names an Object.prototype key
  // ("constructor") must find no card rather than the inherited function.
  const cardOf = (slug: string) => (Object.hasOwn(s.cards, slug) ? s.cards[slug] : undefined);
  const shown = (slug: string) =>
    filter === "all" || (cardOf(slug)?.signals.split(" ").includes(filter) ?? false);
</script>

<svelte:head>
  <title>Sites — Reddoor maintenance</title>
</svelte:head>

{#snippet dateCell(v: string | null)}
  {#if v === null}{DASH}{:else if v.slice(0, 10) === v}{v}{:else}<span title={v}
      >{v.slice(0, 10)}</span
    >{/if}
{/snippet}

<h1>Sites</h1>
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
<div class="signal-filters" role="group" aria-label="Filter sites by signal">
  {#each s.filters as f (f)}<button
      type="button"
      data-filter={f}
      aria-pressed={f === filter ? "true" : "false"}
      onclick={() => (filter = f)}>{f}</button
    >{/each}
</div>
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
          <th>Health</th>
        </tr>
      </thead>
      <tbody>
        {#each m.rows as r (r.slug)}
          {@const url = safeUrl(r.url)}
          {@const c = cardOf(r.slug)}
          <tr
            class="fleet-row"
            data-signals={c?.signals ?? ""}
            style:display={shown(r.slug) ? undefined : "none"}
          >
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
            <td class="health">
              {#if c}
                <span class="pill {c.tier}">{c.pill}</span>
                <!-- The card's own markup for what the table's columns do not
                     already show (#672 step 3). -->
                <span class="setup" title={c.setupTitle}
                  >Setup: <strong>{c.setupScore}</strong></span
                >
                <span class="cluster health">
                  <span class="metric-label">a11y</span> <span class="metric a11y">{c.a11y}</span>
                  <span class="metric-label">deps</span> <span class="metric deps">{c.deps}</span>
                  <span class="metric-label">sec</span> <span class="metric sec">{c.sec}</span>
                  <span class="metric-label">deploy</span>
                  {#if c.deploy.kind === "unknown"}<span
                      class="metric deploy unknown"
                      title="No deploy data">—</span
                    >{:else if c.deploy.kind === "link"}<a
                      class="metric {c.deploy.cls}"
                      href={c.deploy.href}
                      target="_blank"
                      rel="noopener">{c.deploy.label}</a
                    >{:else}<span class="metric {c.deploy.cls}">{c.deploy.label}</span>{/if}
                </span>
                {#if c.chips.length > 0 || c.submissions}<div class="chips">
                    {#each c.chips as chip, i (i)}<span
                        class={chip.cls}
                        title={chip.title ?? undefined}
                        >{#if chip.badge}<span class="badge">{chip.badge}</span
                          >{/if}{chip.text}</span
                      >{/each}{#if c.submissions}<span class="chip">{c.submissions}</span>{/if}
                  </div>{/if}
                <SetupChecklist gaps={c.setupGaps} />
              {:else}<span class="muted">{DASH}</span>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<!-- The Recently and Archived lanes, moved here from / (#672 step 3). -->
{#if s.recently.length > 0}
  <details class="recently">
    <summary>🔧 Recently ({s.recently.length})</summary>
    {#each s.recently as e, i (i)}
      <div class="recent-row" data-type={e.type}>
        <span class="recent-icon">{e.icon}</span>
        <span class="recent-what"
          >{#if e.siteName}<strong>{e.siteName}</strong>{" — "}{/if}{e.summary}</span
        >
        <span class="muted">{e.when}</span>
        {#if e.link}<a href={e.link.href}>{e.link.text}</a>{/if}
      </div>
    {/each}
  </details>
{/if}

{#if s.archived.length > 0}
  <details class="archived">
    <summary>🗄 Archived ({s.archived.length})</summary>
    {#each s.archived as a, i (i)}
      <div class="approve-row">
        <strong>{a.name}</strong> <span class="muted">{a.status}</span>
        <a href="/s/{a.slug}">open ▸</a>
      </div>
    {/each}
  </details>
{/if}
