<script lang="ts">
  import type { BacklogView } from "./view.js";

  // P1-111: the backlog's top five P1 items, read from the workspace's
  // BACKLOG.md on the server at request time (src/dashboard/backlog-source.ts).
  // `null` while the read is in flight.
  let { view }: { view: BacklogView | null } = $props();
</script>

<section class="backlog" aria-labelledby="backlog-heading">
  <h2 id="backlog-heading">Backlog: the top five</h2>
  {#if view === null}
    <p class="backlog-loading muted">Reading BACKLOG.md…</p>
  {:else if view.kind === "ok"}
    <div class="backlog-meta muted">
      {view.meta} · <a href={view.fileHref}>BACKLOG.md →</a>
    </div>
    {#if view.items.length === 0}
      <p class="muted">The P1 table has no rows.</p>
    {:else}
      <ol class="backlog-list">
        {#each view.items as item (item.id)}
          <li class="backlog-item" data-id={item.id}>
            <div class="backlog-head">
              <span class="backlog-rank">{item.rank}</span>
              <strong class="backlog-id">{item.id}</strong>
              {#if item.tier}<span class="backlog-tier">{item.tier}</span>{/if}
            </div>
            <div class="backlog-title">{item.title}</div>
            {#if item.status}
              <div class="backlog-status">
                <span class="muted">Status {item.status.when}:</span>
                {item.status.sentence}
              </div>
              {#if item.status.refs.length > 0}
                <div class="backlog-refs">
                  {#each item.status.refs as ref (ref.href)}
                    <a href={ref.href}>{ref.label}</a>
                  {/each}
                </div>
              {/if}
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  {:else}
    <p class="backlog-unavailable">
      {view.reason} <a href={view.fileHref}>Open BACKLOG.md →</a>
    </p>
  {/if}
</section>
