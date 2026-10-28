<script lang="ts">
  import type { CockpitView } from "../../lib/cockpit/view.js";
  import AuditFleet from "../../lib/cockpit/AuditFleet.svelte";
  import SetupChecklist from "../../lib/SetupChecklist.svelte";
  import PageStyles from "../../lib/PageStyles.svelte";
  import healthCss from "../../lib/cockpit/health.css?inline";
  import cockpitCss from "../cockpit.css?inline";

  // The fleet cockpit, a start page: verdict bar, the per-site Needs-you feed,
  // the Setup count, and the quiet lanes (Cardless, Inbox). The per-site cards
  // and the Recently and Archived lanes moved to Sites (/fleet, #672 step 3).
  // Every string comes decided from the server (lib/cockpit/view.ts).
  let { data }: { data: { view: CockpitView } } = $props();
  const v = $derived(data.view);
</script>

<svelte:head>
  <title>Reddoor maintenance — fleet cockpit</title>
</svelte:head>
<PageStyles sheets={[healthCss, cockpitCss]} />

<h1>Reddoor fleet cockpit</h1>
<div class="meta">
  {v.total} site{v.total === 1 ? "" : "s"} on the Reddoor stack. <a href="/fleet">Sites →</a>
</div>

<div class="verdict {v.verdict.cls}">
  <div class="verdict-line">{v.verdict.line}</div>
  <div class="verdict-meta">{v.verdict.meta}</div>
  <AuditFleet />
</div>

{#if v.feedCount > 0}
  <section class="needs-you">
    <h2>Needs you ({v.feedCount})</h2>
    <!-- P1-78g: each group has an id, the overview's counts link to it (#broken, …). -->
    {#each v.feed as g (g.group)}
      <div class="feed-group" id={g.group}>
        <div class="feed-group-label">{g.label}</div>
        {#each g.rows as row, i (i)}
          <div class="feed-row" data-group={row.group}>
            <span class="dot {row.group}"></span>
            <span class="feed-what"
              ><strong>{row.siteName}</strong> — {row.reasons}{#if row.age}
                <span class="muted feed-age">&nbsp;· {row.age}</span>{/if}</span
            >
            <a class="feed-open" href={row.url}>Open →</a>
          </div>
        {/each}
      </div>
    {/each}
  </section>
{/if}

<!-- #672 step 2: roster gaps. Counted apart from the verdict, because Setup
     never moves a site's tier. -->
{#if v.setup}
  <details class="setup-lane">
    <summary>Setup ({v.setup.count} site{v.setup.count === 1 ? "" : "s"})</summary>
    {#each v.setup.rows as row, i (i)}
      <div class="setup-row">
        <a href={row.href}><strong>{row.name}</strong></a>
        <SetupChecklist gaps={row.gaps} />
      </div>
    {/each}
  </details>
{/if}

<!-- #786: attention items that belong to no site card. A dead letter for a
     site with no card links its page; a slug that resolves to no site has no
     page, so it gets no link (OD 87, #1575). -->
{#if v.cardless.length > 0}
  <!-- Open when it holds an alarm: the verdict counts these rows. -->
  <details class="cardless" open={v.cardless.some((c) => c.level !== "watch")}>
    <summary id="cardless">Not on any site card ({v.cardless.length})</summary>
    {#each v.cardless as item, i (i)}
      <div class="approve-row" data-level={item.level}>
        <span class="pill {item.level}">{item.levelLabel}</span>
        <strong
          >{#if item.href}<a href={item.href}>{item.siteName}</a>{:else}{item.siteName}{/if}</strong
        > <span class="muted">{item.title}</span>{#if item.age}<span class="muted feed-age"
            >&nbsp;· {item.age}</span
          >{/if}
      </div>
    {/each}
  </details>
{/if}

<!-- Submissions are a separate work stream: they never raise the verdict. -->
{#if v.inbox}
  <details class="inbox">
    <summary>{v.inbox.summary}</summary>
    {#each v.inbox.rows as sub (sub.key)}
      <div class="approve-row" data-signal="submissions">
        <strong>{sub.siteName}</strong>
        <span class="muted">{sub.what}</span>
        <span class="muted">{sub.when}</span>
        <a href={sub.href}>open →</a>
      </div>
    {/each}
    {#if v.inbox.more}
      <div class="approve-row subm-more muted">
        <a href="/submissions">{v.inbox.more.text}</a>
      </div>
    {/if}
    {#if v.inbox.spamLine}
      <div class="spam-rollup muted">{v.inbox.spamLine}</div>
    {/if}
    {#if v.inbox.autoFiltered !== null}
      <div class="spam-rollup muted">
        {v.inbox.autoFiltered} auto-filtered this week —
        <a href="/submissions?status=spam_auto">review</a>
      </div>
    {/if}
  </details>
{/if}
