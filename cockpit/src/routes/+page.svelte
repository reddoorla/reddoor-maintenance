<script lang="ts">
  import type { OverviewView } from "../lib/overview/view.js";
  import { HOW_WE_COUNT, LADDER_LINES } from "../lib/overview/view.js";
  import PageStyles from "../lib/PageStyles.svelte";
  import healthCss from "../lib/cockpit/health.css?inline";
  import overviewCss from "../lib/overview/overview.css?inline";

  // P1-78g: the overview, top to bottom in the questions Erik and Tim ask. Every
  // string and number comes decided from lib/overview/view.ts.
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
  <p class="ov-line"><a href={v.status.link}>{v.status.line}</a></p>
  {#if v.status.broken.length > 0}
    <ul class="ov-list broken">
      {#each v.status.broken as b, i (i)}
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
      <tr><th>Site</th><th>Live</th><th>Domain</th><th>Deploy</th><th>Forms</th><th>Level</th></tr>
    </thead>
    <tbody>
      {#each v.live as r (r.siteName)}
        <tr>
          <th scope="row"><a href={r.url}>{r.siteName}</a></th>
          <td data-label="Live" class={okClass(r.live.ok)}>{r.live.text}</td>
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
      {v.leads.allTime.submissions} submissions{#if v.leads.since}&nbsp;since {v.leads.since}{/if}.
      {v.leads.allTime.accepted} were accepted as real, and the client was notified of {v.leads
        .allTime.notified}.
    </p>
    <table class="ov-table ov-leads-totals">
      <thead><tr><th></th><th>This month</th><th>All time</th></tr></thead>
      <tbody>
        <tr
          ><th scope="row">Accepted as real</th><td data-label="This month"
            >{v.leads.thisMonth?.accepted}</td
          ><td data-label="All time">{v.leads.allTime.accepted}</td></tr
        >
        <tr
          ><th scope="row">Client notified</th><td data-label="This month"
            >{v.leads.thisMonth?.notified}</td
          ><td data-label="All time">{v.leads.allTime.notified}</td></tr
        >
        <tr
          ><th scope="row">Screened as spam</th><td data-label="This month"
            >{v.leads.thisMonth?.screened}</td
          ><td data-label="All time">{v.leads.allTime.screened}</td></tr
        >
        <tr
          ><th scope="row">Marked spam by hand</th><td data-label="This month"
            >{v.leads.thisMonth?.byHand}</td
          ><td data-label="All time">{v.leads.allTime.byHand}</td></tr
        >
        <tr
          ><th scope="row">Stopped before storage</th><td data-label="This month"
            >{v.leads.stoppedThisMonth}</td
          ><td data-label="All time">{v.leads.stoppedAllTime}</td></tr
        >
      </tbody>
    </table>
    <h3>Per site</h3>
    <table class="ov-table ov-leads-sites">
      <thead>
        <tr
          ><th>Site</th><th>Submissions</th><th>Accepted</th><th>Notified</th><th>Screened</th><th
            >By hand</th
          ></tr
        >
      </thead>
      <tbody>
        {#each v.leads.perSite as s (s.siteName)}
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
    Every maintenance report carries six checks. Each one is proven by a step of the nightly run
    below.
  </p>
  <dl class="ov-checks">
    {#each v.reports.checks as c (c.name)}
      <dt>{c.name}</dt>
      <dd>{c.proof}</dd>
    {/each}
  </dl>
  <p>
    Lighthouse, the middle site:
    {#each v.reports.lighthouse as l, i (l.label)}{i > 0 ? " · " : ""}{l.label}
      {l.median}{/each}.
  </p>
  {#if v.reports.sent === null}
    <p class="muted">The reports could not be read just now. Reload to try again.</p>
  {:else}
    <p>
      {v.reports.sent.real} real reports sent: {v.reports.sent.approvedFirst} approved first, and
      {v.reports.sent.aroundGate} sent around the gate.
    </p>
  {/if}
  <table class="ov-table ov-due">
    <thead><tr><th>Site</th><th>Next report due</th><th>Waiting for your yes</th></tr></thead>
    <tbody>
      {#each v.reports.perSite as r (r.siteName)}
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
    The nightly starts at {v.nightly.startsAt}. Approved reports send at {v.nightly.sendsAt}. Scale: {v
      .nightly.scale}. Reliability: {v.nightly.reliability}.
  </p>
  <ol class="ov-steps">
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
    <li>Updates merged automatically: {v.upkeep.automerged}.</li>
    <li>Vulnerabilities cleared: {v.upkeep.vulnsCleared}.</li>
    <li>Dependencies behind (a major version): {v.upkeep.depsBehind}.</li>
  </ul>
  {#if v.upkeep.open.length > 0}
    <h3>Open now</h3>
    <ul>
      {#each v.upkeep.open as o (o.siteName)}
        <li>{o.siteName}: {o.text}.</li>
      {/each}
    </ul>
  {:else}
    <p>No critical or high vulnerability is open.</p>
  {/if}
  <h3>The ladder</h3>
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
  <p>Changes merged into the maintenance stack: {v.prsMerged}.</p>
</section>

<details class="ov-how">
  <summary>How we count</summary>
  <p class="muted">
    The nightly has written {v.nightsCollected}
    {v.nightsCollected === 1 ? "night" : "nights"} of counts so far.
  </p>
  <dl>
    {#each HOW_WE_COUNT as h (h.term)}
      <dt>{h.term}</dt>
      <dd>{h.text}</dd>
    {/each}
  </dl>
</details>
