<script lang="ts">
  import type { OverviewView } from "../lib/overview/view.js";
  import { HOW_WE_COUNT, LADDER_LINES } from "../lib/overview/view.js";
  import PageStyles from "../lib/PageStyles.svelte";
  import healthCss from "../lib/cockpit/health.css?inline";
  import overviewCss from "../lib/overview/overview.css?inline";

  // P1-78g: the overview, top to bottom in the questions Erik and Tim ask. Every
  // string and number comes decided from lib/overview/view.ts; no count is typed
  // here. Each number's label carries `data-term`, its line in "How we count".
  let { data }: { data: { view: OverviewView } } = $props();
  const v = $derived(data.view);
  const okClass = (ok: boolean | null) => (ok === true ? "ok" : ok === false ? "bad" : "unknown");
</script>

<svelte:head>
  <title>Reddoor maintenance — overview</title>
</svelte:head>
<PageStyles sheets={[healthCss, overviewCss]} />

<h1>Overview</h1>

<section class="ov-status {v.status.cls}" aria-labelledby="ov-status">
  <h2 id="ov-status" class="visually-hidden">Status</h2>
  <p class="ov-line">
    {#each v.status.parts as p, i (i)}{i > 0 ? " " : ""}<span data-term={p.term}
        >{#if p.href}<a href={p.href}>{p.text}</a>{:else}{p.text}{/if}</span
      >{/each}
  </p>
  {#if v.status.broken.length > 0}
    <ul class="ov-list broken">
      {#each v.status.broken as b (b.key)}
        <li>
          <a href={b.url}>{b.siteName}</a>: {b.reasons}{#if b.age}<span class="muted"
              >, {b.age}</span
            >{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section aria-labelledby="ov-live">
  <h2 id="ov-live">Is every site live?</h2>
  <table class="ov-table ov-live">
    <thead>
      <tr
        ><th>Site</th><th data-term="Live">Live</th><th data-term="Domain">Domain</th><th
          data-term="Deploy">Deploy</th
        ><th data-term="Forms">Forms</th><th data-term="Level"><a href="#ov-ladder">Level</a></th
        ></tr
      >
    </thead>
    <tbody>
      {#each v.live as r (r.siteId)}
        <tr>
          <th scope="row"><a href={r.url}>{r.siteName}</a></th>
          <td data-label="Live" class={okClass(r.live.ok)}
            >{r.live.text}{#if r.live.at}<span class="muted">, checked {r.live.at}</span>{/if}</td
          >
          <td data-label="Domain" class={okClass(r.domain.ok)}>{r.domain.text}</td>
          <td data-label="Deploy" class={okClass(r.deploy.ok)}>{r.deploy.text}</td>
          <td data-label="Forms" class={okClass(r.forms.ok)}
            >{r.forms.text}<span class="muted">; {r.lastLead}</span></td
          >
          <td data-label="Level"><span class="pill {r.level.tier}">{r.level.text}</span></td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<section aria-labelledby="ov-leads">
  <h2 id="ov-leads">Leads</h2>
  {#if v.leads.allTime === null}
    <p class="muted">The submissions could not be read just now. Reload to try again.</p>
  {:else}
    <p>
      <span data-term="Submissions"
        >{v.leads.allTime.submissions} submissions{#if v.leads.since}&nbsp;since {v.leads
            .since}{/if}.</span
      >
      <span data-term="Accepted as real">{v.leads.allTime.accepted} were accepted as real,</span>
      <span data-term="Client notified"
        >and the client was notified of {v.leads.allTime.notified}.</span
      >
      {#if v.leads.biggest}<span data-term="Biggest share"
          >{v.leads.biggest.submissions} of them ({v.leads.biggest.share}%) came from one site, {v
            .leads.biggest.siteName}; every site's own count is in the table below.</span
        >{/if}
    </p>
    <table class="ov-table ov-leads-totals">
      <thead><tr><th></th><th>This month</th><th>All time</th></tr></thead>
      <tbody>
        <tr
          ><th scope="row" data-term="Accepted as real">Accepted as real</th><td
            data-label="This month">{v.leads.thisMonth?.accepted}</td
          ><td data-label="All time">{v.leads.allTime.accepted}</td></tr
        >
        <tr
          ><th scope="row" data-term="Client notified">Client notified</th><td
            data-label="This month">{v.leads.thisMonth?.notified}</td
          ><td data-label="All time">{v.leads.allTime.notified}</td></tr
        >
        <tr
          ><th scope="row" data-term="Screened as spam">Screened as spam</th><td
            data-label="This month">{v.leads.thisMonth?.screened}</td
          ><td data-label="All time">{v.leads.allTime.screened}</td></tr
        >
        <tr
          ><th scope="row" data-term="Marked spam by hand">Marked spam by hand</th><td
            data-label="This month">{v.leads.thisMonth?.byHand}</td
          ><td data-label="All time">{v.leads.allTime.byHand}</td></tr
        >
        <tr
          ><th scope="row" data-term="Stopped before storage">Stopped before storage</th><td
            data-label="This month">{v.leads.stoppedThisMonth}</td
          ><td data-label="All time"
            >{v.leads.stoppedAllTime}{#if v.leads.stoppedAsOf}<span class="muted"
                >, as of {v.leads.stoppedAsOf}</span
              >{/if}</td
          ></tr
        >
      </tbody>
    </table>
    <h3 data-term="Per site">Per site</h3>
    <table class="ov-table ov-leads-sites">
      <thead>
        <tr
          ><th>Site</th><th>Submissions</th><th>Accepted</th><th>Notified</th><th>Screened</th><th
            >By hand</th
          ></tr
        >
      </thead>
      <tbody>
        {#each v.leads.perSite as s (s.siteId)}
          <tr>
            <th scope="row">{s.siteName}</th>
            <td data-label="Submissions">{s.submissions}</td>
            <td data-label="Accepted">{s.accepted}</td>
            <td data-label="Notified">{s.notified}</td>
            <td data-label="Screened">{s.screened}</td>
            <td data-label="By hand">{s.byHand}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<section aria-labelledby="ov-reports">
  <h2 id="ov-reports">Client reports</h2>
  <p>
    Every maintenance report carries {v.reports.checks.length} checks. Each one is proven by a step of
    the nightly run below.
  </p>
  <dl class="ov-checks">
    {#each v.reports.checks as c (c.name)}
      <dt>{c.name}</dt>
      <dd>{c.proof}</dd>
    {/each}
  </dl>
  <p data-term="Lighthouse">
    Lighthouse (Google's audit of each site, scored out of 100), the middle score across our sites
    for each area on its own:
    {#each v.reports.lighthouse as l, i (l.label)}{i > 0 ? " · " : ""}{l.label}
      {l.median}{/each}.
  </p>
  {#if v.reports.sent === null}
    <p class="muted">The reports could not be read just now. Reload to try again.</p>
  {:else}
    <p data-term="Reports sent">
      {v.reports.sent.real} reports sent to clients: {v.reports.sent.approvedFirst} approved by one of
      us before they went, and {v.reports.sent.aroundGate} without that yes.
    </p>
  {/if}
  <table class="ov-table ov-due">
    <thead
      ><tr
        ><th>Site</th><th data-term="Next report due">Next report due</th><th
          data-term="Waiting for your yes">Waiting for your yes</th
        ></tr
      ></thead
    >
    <tbody>
      {#each v.reports.perSite as r (r.siteId)}
        <tr>
          <th scope="row">{r.siteName}</th>
          <td data-label="Next due">{r.nextDue}</td>
          <td data-label="Waiting">{r.waiting}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<section aria-labelledby="ov-nightly">
  <h2 id="ov-nightly">What runs every night</h2>
  <p>
    <span data-term="Times"
      >The nightly starts at {v.nightly.startsAt}. Approved reports send at {v.nightly
        .sendsAt}.</span
    >
    <span data-term="Scale">Scale: {v.nightly.scale}.</span>
    <span data-term="Runs green">Reliability: {v.nightly.reliability}.</span>
  </p>
  <ol class="ov-steps" data-term="Steps">
    {#each v.nightly.steps as s (s.label)}
      <li>
        <span class="ov-step-name">{s.label}</span>
        <span class="muted"
          >Newest night: {s.outcome}. Last finished: {s.lastFinished}. Reached: {s.sites}.</span
        >
      </li>
    {/each}
  </ol>
</section>

<section aria-labelledby="ov-upkeep">
  <h2 id="ov-upkeep">Upkeep</h2>
  <ul>
    <li data-term="Updates merged automatically">
      Updates merged automatically: {v.upkeep.automerged}.
    </li>
    <li data-term="Vulnerabilities cleared">Vulnerabilities cleared: {v.upkeep.vulnsCleared}.</li>
    <li data-term="Dependencies behind">
      Dependencies behind (a major version): {v.upkeep.depsBehind}.
    </li>
  </ul>
  <h3 data-term="Open now">Open now</h3>
  {#if v.upkeep.open.length > 0}
    <ul>
      {#each v.upkeep.open as o (o.siteId)}
        <li>{o.siteName}: {o.text}.</li>
      {/each}
    </ul>
  {:else}
    <p>No critical or high vulnerability is open.</p>
  {/if}
  <h3 id="ov-ladder">The ladder</h3>
  <ul>
    {#each LADDER_LINES as line, i (i)}
      <li>{line}</li>
    {/each}
  </ul>
</section>

<section aria-labelledby="ov-ship">
  <h2 id="ov-ship">How changes ship</h2>
  <p>
    A change is tested first, then reviewed by fresh AI agents, usually over about three rounds, and
    landed one small change (a PR) at a time. A person merges every published release.
  </p>
  <p>
    On a client site, a change goes from its own branch to staging, then to the live site when you
    promote staging.
  </p>
  <p data-term="PRs merged">
    Changes merged into the maintenance stack (the code that runs these checks and sends the
    reports): {v.prsMerged}.
  </p>
</section>

<details class="ov-how">
  <summary>How we count</summary>
  <p class="muted" data-term="Nights counted">
    {#if v.nightsCollected === null}
      The nightly counts could not be read just now.
    {:else}
      The nightly has written {v.nightsCollected}
      {v.nightsCollected === 1 ? "night" : "nights"} of counts so far.
    {/if}
  </p>
  <dl>
    {#each HOW_WE_COUNT as h (h.term)}
      <dt>{h.term}</dt>
      <dd>{h.text}</dd>
    {/each}
  </dl>
</details>
