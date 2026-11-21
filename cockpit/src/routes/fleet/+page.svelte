<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import type { FleetTableModel } from "../../../../src/dashboard/fleet-table.js";
  import { safeUrl } from "../../../../src/util/html.js";
  import type { SitesView } from "../../lib/cockpit/view.js";
  import type { SiteFacts } from "../../lib/overview/view.js";
  import SetupChecklist from "../../lib/SetupChecklist.svelte";
  import {
    allSitesHref,
    CHECK_COLUMN,
    COLUMNS,
    FACT_COLUMNS,
    failingLine,
    sitesTitle,
    okClass,
    showHiddenHref,
    sortHref,
    sortArrow,
    statusOptions,
    type CheckFilter,
  } from "./view.js";
  import PageStyles from "../../lib/PageStyles.svelte";
  import healthCss from "../../lib/cockpit/health.css?inline";
  import fleetTableCss from "./fleet-table.css?inline";

  // Sites: the fleet table with the browse panel merged in (#672 step 3). Sorting
  // and the status and name filters are links and a GET form. The signal chips
  // filter the rows in the browser, as the browse panel filtered its cards: a
  // row matches when its site's card carries that signal, so a row with no card
  // (an archived or building site) shows only under "all". SvelteKit keeps this
  // component across client navigations, so the chip is reset after each one:
  // the GET form and "Clear" start from "all", not from a chip the new rows
  // were never filtered by (#1589).
  let {
    data,
  }: {
    data: {
      model: FleetTableModel;
      sites: SitesView;
      facts?: Record<string, SiteFacts>;
      check?: CheckFilter | null;
    };
  } = $props();
  const m = $derived(data.model);
  const s = $derived(data.sites);
  // The health check the list is narrowed to, if the URL names a known one (P1-87, PR 8b).
  // An unknown one is named above the table, and the table is the whole one.
  const check = $derived(data.check ?? null);
  const known = $derived(check !== null && "name" in check ? check : null);
  const unknownSlug = $derived(check !== null && "unknown" in check ? check.unknown : null);
  // The fact column that shows the check's own cell, marked as the one filtered.
  const filteredColumn = $derived(known === null ? undefined : CHECK_COLUMN[known.name]);
  // The live checks and the level, both keyed by site id (review round 3): a
  // slug is shared by namesakes ("Foo" and "FOO"), an id is not. A site with no
  // card has neither.
  const factsOf = (id: string) =>
    data.facts !== undefined && Object.hasOwn(data.facts, id) ? data.facts[id] : undefined;
  const levelOf = (id: string) => (Object.hasOwn(s.levels, id) ? s.levels[id] : undefined);
  const DASH = "—";
  let filter = $state("all");
  // An own-property read: a slug that names an Object.prototype key
  // ("constructor") must find no card rather than the inherited function.
  const cardOf = (slug: string) => (Object.hasOwn(s.cards, slug) ? s.cards[slug] : undefined);
  const shown = (slug: string) =>
    filter === "all" || (cardOf(slug)?.signals.split(" ").includes(filter) ?? false);
  const shownCount = $derived(m.rows.filter((r) => shown(r.slug)).length);
  afterNavigate(() => {
    filter = "all";
  });
</script>

<svelte:head>
  <title>{sitesTitle(known)}</title>
</svelte:head>
<PageStyles sheets={[healthCss, fleetTableCss]} />

{#snippet dateCell(v: string | null)}
  {#if v === null}{DASH}{:else if v.slice(0, 10) === v}{v}{:else}<span title={v}>
      {v.slice(0, 10)}
    </span>{/if}
{/snippet}

<h1>Sites</h1>
<div class="meta">
  {m.rows.length} of {m.totalSites} site{m.totalSites === 1 ? "" : "s"}
  {#if filter !== "all"}· {shownCount} shown{/if}
  {#if m.hiddenCount > 0}
    · {m.hiddenCount} archived or external hidden · <a href={showHiddenHref(m)}>Show all</a>
  {/if}
</div>
{#if known !== null}
  <p class="check-filter">
    {failingLine(known, m.rows.length)}{#if known.unread > 0}
      {" "}· {known.unread} more {known.unread === 1
        ? "neither passes nor fails"
        : "neither pass nor fail"}{/if}
    · <a href={allSitesHref(m)}>Show all sites</a>
  </p>
{:else if unknownSlug !== null}
  <p class="check-filter">No check is called "{unknownSlug}". Showing all sites.</p>
{/if}
<!-- The chip count for a screen reader (#1636): `.meta` is not a live region,
     so this one, always in the page, carries the count and a chip press
     changes its text. -->
<div class="visually-hidden" role="status">
  {shownCount} site{shownCount === 1 ? "" : "s"} shown
</div>
<form class="filters" method="get" action="/fleet">
  <!-- The sort rides along as hidden inputs, so Apply never silently drops the
       operator's ranking on a filter change. -->
  <input type="hidden" name="sort" value={m.query.sort} />
  <input type="hidden" name="dir" value={m.query.dir} />
  {#if known !== null}<input type="hidden" name="check" value={known.slug} />{/if}
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
      onclick={() => (filter = f)}
    >
      {f}
    </button>{/each}
</div>
{#if m.rows.length === 0}
  <!-- hiddenCount is non-zero only on the default view, where an empty table
       means every site was hidden, not that a filter matched nothing (#1619). -->
  <div class="empty">
    {m.hiddenCount > 0 ? "Every site is archived or external." : "No sites match these filters."}
  </div>
{:else}
  {#if filter !== "all" && shownCount === 0}
    <div class="empty" role="status">No sites carry this signal.</div>
  {/if}
  <!-- The table scrolls sideways, and a scrolling region must take keyboard
       focus or a keyboard cannot reach its far columns (axe's
       scrollable-region-focusable; P1-87 PR 2 review). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="fleet-table-wrap"
    role="region"
    aria-label="Sites table"
    tabindex="0"
    style:display={shownCount === 0 ? "none" : undefined}
  >
    <table class="fleet">
      <thead>
        <tr>
          {#each COLUMNS as col (col.key)}
            {#if col.key === "level"}
              {#each FACT_COLUMNS as label (label)}
                <th class:filtered-col={label === filteredColumn}>
                  {label}{#if label === filteredColumn}{" "}<span class="visually-hidden">
                      (filtered)
                    </span>{/if}
                </th>
              {/each}
            {/if}
            <th class={col.numeric ? "num" : undefined}>
              <a href={sortHref(m, col.key)}>{col.label}</a>{sortArrow(m, col.key)}
            </th>
          {/each}
          <th>Health</th>
        </tr>
      </thead>
      <tbody>
        {#each m.rows as r (r.id)}
          {@const url = safeUrl(r.url)}
          {@const c = cardOf(r.slug)}
          {@const f = factsOf(r.id)}
          {@const lv = levelOf(r.id)}
          <tr
            class="fleet-row"
            data-signals={c?.signals ?? ""}
            style:display={shown(r.slug) ? undefined : "none"}
          >
            <td><a href="/s/{r.slug}">{r.name}</a></td>
            <td>
              {#if url === "#"}<span class="muted">{DASH}</span>{:else}<a
                  href={url}
                  rel="noopener noreferrer"
                >
                  {r.url}
                </a>{/if}
            </td>
            <td>{r.status === null ? DASH : r.status}</td>
            {#if f}
              <td class="fact {okClass(f.live.ok)}" data-label="Live">
                {f.live.text}{#if f.live.at}<span class="muted">, checked {f.live.at}</span>{/if}
              </td>
              <td class="fact {okClass(f.domain.ok)}" data-label="Certificate">{f.domain.text}</td>
              <td class="fact {okClass(f.deploy.ok)}" data-label="Deploy">{f.deploy.text}</td>
              <td class="fact {okClass(f.forms.ok)}" data-label="Forms">
                {f.forms.text}<span class="muted">; {f.lastLead}</span>
              </td>
            {:else}
              {#each FACT_COLUMNS as label (label)}<td class="muted" data-label={label}>
                  {DASH}
                </td>{/each}
            {/if}
            <td data-label="Level">
              {#if lv}<span class="pill {lv.tier}">{lv.pill}</span>{:else}<span class="muted">
                  {DASH}
                </span>{/if}
            </td>
            <td class="num">{r.pScore === null ? DASH : r.pScore}</td>
            <td class="num">{r.rScore === null ? DASH : r.rScore}</td>
            <td class="num">{r.bpScore === null ? DASH : r.bpScore}</td>
            <td class="num">{r.seoScore === null ? DASH : r.seoScore}</td>
            <td>{@render dateCell(r.nextMaintenanceAt)}</td>
            <td>{@render dateCell(r.nextTestingAt)}</td>
            <td>{@render dateCell(r.lastLighthouseAuditAt)}</td>
            <td class="health">
              {#if c}
                <!-- The card's own markup for what the table's columns do not
                     already show (#672 step 3). -->
                <span class="setup" title={c.setupTitle}>
                  Setup: <strong>{c.setupScore}</strong>
                </span>
                <span class="cluster health">
                  <span class="metric-label">a11y</span> <span class="metric a11y">{c.a11y}</span>
                  <span class="metric-label">deps</span> <span class="metric deps">{c.deps}</span>
                  <span class="metric-label">sec</span> <span class="metric sec">{c.sec}</span>
                  <span class="metric-label">deploy</span>
                  {#if c.deploy.kind === "unknown"}<span
                      class="metric deploy unknown"
                      title="No deploy data"
                    >
                      —
                    </span>{:else if c.deploy.kind === "link"}<a
                      class="metric {c.deploy.cls}"
                      href={c.deploy.href}
                      target="_blank"
                      rel="noopener"
                    >
                      {c.deploy.label}
                    </a>{:else}<span class="metric {c.deploy.cls}">{c.deploy.label}</span>{/if}
                </span>
                {#if c.chips.length > 0 || c.submissions}<div class="chips">
                    {#each c.chips as chip, i (i)}<span
                        class={chip.cls}
                        title={chip.title ?? undefined}
                      >
                        {#if chip.badge}<span class="badge">{chip.badge}</span>{/if}{chip.text}
                      </span>{/each}{#if c.submissions}<span class="chip">
                        {c.submissions}
                      </span>{/if}
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
    <summary>Recently ({s.recently.length})</summary>
    {#each s.recently as e, i (i)}
      <div class="recent-row" data-type={e.type}>
        <span class="recent-what">
          {#if e.siteName}<strong>{e.siteName}</strong>{" — "}{/if}{e.summary}
        </span>
        <span class="muted">{e.when}</span>
        {#if e.link}<a href={e.link.href}>{e.link.text}</a>{/if}
      </div>
    {/each}
  </details>
{/if}

{#if s.archived.length > 0}
  <details class="archived">
    <summary>Archived ({s.archived.length})</summary>
    {#each s.archived as a, i (i)}
      <div class="approve-row">
        <strong>{a.name}</strong> <span class="muted">{a.status}</span>
        <a href="/s/{a.slug}">open →</a>
      </div>
    {/each}
  </details>
{/if}
