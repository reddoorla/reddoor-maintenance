<script lang="ts">
  import type { CockpitView } from "./view.js";
  import TriggerRenovate from "./TriggerRenovate.svelte";

  // The fleet browser: one collapsed <details> holding the filter chips and a
  // single flat card grid (already ordered attention → watch → healthy).
  // Flat on purpose: a filtered card can never hide inside a collapsed tier.
  let { browse }: { browse: CockpitView["browse"] } = $props();
  let filter = $state("all");

  const shown = (signals: string) => filter === "all" || signals.split(" ").includes(filter);
</script>

<details class="fleet-browse">
  <summary>Fleet ({browse.total})</summary>
  <div class="filters">
    {#each browse.filters as f (f)}<button
        type="button"
        data-filter={f}
        aria-pressed={f === filter ? "true" : "false"}
        onclick={() => (filter = f)}>{f}</button
      >{/each}
  </div>
  {#if browse.total === 0}
    <div class="empty">No sites on the fleet view yet.</div>
  {:else}
    <div class="cards">
      {#each browse.cards as c (c.key)}
        <article
          class="card"
          data-signals={c.signals}
          style:display={shown(c.signals) ? undefined : "none"}
        >
          <header class="card-head">
            <a class="site" href={c.href}>{c.name}</a>
            <a class="url" href={c.siteHref} target="_blank" rel="noopener">{c.visibleUrl}</a>
            <span class="setup" title={c.setupTitle}>Setup: <strong>{c.setupScore}</strong></span>
            <span class="audited">Audited: <strong>{c.audited}</strong></span>
          </header>
          <div class="card-metrics">
            <span class="cluster lighthouse">
              <span class="metric-label">Perf</span> <span class="score perf">{c.perf}</span>
              <span class="metric-label">Access</span> <span class="score a11y-lh">{c.a11yLh}</span>
              <span class="metric-label">BP</span> <span class="score bp">{c.bp}</span>
              <span class="metric-label">SEO</span> <span class="score seo">{c.seo}</span>
            </span>
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
          </div>
          <span class="pill {c.tier}">{c.pill}</span>{#if c.chips.length > 0}<div class="chips">
              {#each c.chips as chip, i (i)}<span class={chip.cls} title={chip.title ?? undefined}
                  >{#if chip.badge}<span class="badge">{chip.badge}</span>{/if}{chip.text}</span
                >{/each}
            </div>{/if}{#if c.submissions}<span class="chip">{c.submissions}</span
            >{/if}{#if c.triggerUrl}<TriggerRenovate url={c.triggerUrl} />{/if}
        </article>
      {/each}
    </div>
  {/if}
</details>
