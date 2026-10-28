<script lang="ts">
  import type { OverviewView } from "../lib/overview/view.js";
  import { HOW_WE_COUNT, LADDER_LINES, trendGeometry } from "../lib/overview/view.js";
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
    <ul class="ov-list broken" data-term="Broken, attention, watch">
      {#each v.status.broken as b (b.key)}
        <li>
          <a href={b.url}>{b.siteName}</a>{#if b.age}{" "}<span class="muted">({b.age})</span>{/if}: {b.reasons}
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
        ><th>Site</th><th data-term="Live">Live</th><th data-term="Certificate">Certificate</th><th
          data-term="Deploy">Deploy</th
        ><th data-term="Forms">Forms</th><th data-term="Level"><a href="#ov-ladder">Level</a></th
        ></tr
      >
    </thead>
    <tbody>
      {#each v.live as r (r.siteId)}
        <tr>
          <th scope="row"><a href={r.url}>{r.siteName}</a></th>
          <td data-label="Live" data-term="Live" class={okClass(r.live.ok)}
            >{r.live.text}{#if r.live.at}<span class="muted">, checked {r.live.at}</span>{/if}</td
          >
          <td data-label="Certificate" data-term="Certificate" class={okClass(r.domain.ok)}
            >{r.domain.text}</td
          >
          <td data-label="Deploy" data-term="Deploy" class={okClass(r.deploy.ok)}
            >{r.deploy.text}</td
          >
          <td data-label="Forms" data-term="Forms" class={okClass(r.forms.ok)}
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
        >{v.leads.allTime.submissions}
        {v.leads.allTime.submissions === 1
          ? "submission"
          : "submissions"}{#if v.leads.since}&nbsp;since {v.leads.since}{/if}.</span
      >
      <span data-term="Accepted as real"
        >{v.leads.allTime.accepted}
        {v.leads.allTime.accepted === 1 ? "was" : "were"} accepted as real,</span
      >
      <span data-term="Client notified"
        >and the client was notified of {v.leads.allTime.notified}.</span
      >
      {#if v.leads.biggest}<span data-term="Biggest share"
          >Of the {v.leads.allTime.submissions} submissions, {v.leads.biggest.submissions} ({v.leads
            .biggest.share}%) came from one site, {v.leads.biggest.siteName}, through {v.leads
            .biggest.formKind}; {v.leads.biggest.accepted} of the {v.leads.allTime.accepted} accepted
          {v.leads.biggest.accepted === 1 ? "is" : "are"} from it. Every site's own count is in the table
          below.</span
        >{/if}
    </p>
    <table class="ov-table ov-leads-totals">
      <thead><tr><td></td><th>This month</th><th>All time</th></tr></thead>
      <tbody>
        <tr data-term="Accepted as real"
          ><th scope="row">Accepted as real</th><td data-label="This month"
            >{v.leads.thisMonth?.accepted}</td
          ><td data-label="All time">{v.leads.allTime.accepted}</td></tr
        >
        <tr data-term="Client notified"
          ><th scope="row">Client notified</th><td data-label="This month"
            >{v.leads.thisMonth?.notified}</td
          ><td data-label="All time">{v.leads.allTime.notified}</td></tr
        >
        <tr data-term="Screened as spam"
          ><th scope="row">Screened as spam</th><td data-label="This month"
            >{v.leads.thisMonth?.screened}</td
          ><td data-label="All time">{v.leads.allTime.screened}</td></tr
        >
        <tr data-term="Marked spam by hand"
          ><th scope="row">Marked spam by hand</th><td data-label="This month"
            >{v.leads.thisMonth?.byHand}</td
          ><td data-label="All time">{v.leads.allTime.byHand}</td></tr
        >
        <tr data-term="Stopped before storage"
          ><th scope="row">Stopped before storage</th><td data-label="This month"
            >{v.leads.stoppedThisMonth}</td
          ><td data-label="All time"
            >{v.leads.stoppedAllTime}{#if v.leads.stoppedAsOf}<span class="muted"
                >, as of {v.leads.stoppedAsOf}</span
              >{/if}</td
          ></tr
        >
      </tbody>
    </table>
    <h3 data-term="Per site">Per site</h3>
    <table class="ov-table ov-leads-sites" data-term="Per site">
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
  <p data-term="Checks per report">
    Every maintenance report carries {v.reports.checks.length} checks. Each one is proven by a step of
    the nightly run below.
  </p>
  <dl class="ov-checks" data-term="Checks per report">
    {#each v.reports.checks as c (c.name)}
      <dt>{c.name}</dt>
      <dd>{c.proof}</dd>
    {/each}
  </dl>
  <p data-term="Lighthouse">
    Lighthouse (Google's audit of each site, scored out of 100), the middle score across our sites
    for each area on its own:
    {#each v.reports.lighthouse as l, i (l.label)}{i > 0 ? " · " : ""}{l.label}
      {l.median}{/each}{#if v.reports.lighthouseAsOf}<span class="muted"
        >, from audits as old as {v.reports.lighthouseAsOf}</span
      >{/if}.
  </p>
  {#if v.reports.sent === null}
    <p class="muted">The reports could not be read just now. Reload to try again.</p>
  {:else}
    <p data-term="Reports sent">
      {v.reports.sent.real}
      {v.reports.sent.real === 1 ? "report" : "reports"} sent to clients: {v.reports.sent
        .approvedFirst} approved by one of us before sending, and {v.reports.sent.aroundGate} without
      that yes.
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
          <td data-label="Next due" data-term="Next report due">{r.nextDue}</td>
          <td data-label="Waiting" data-term="Waiting for your yes">{r.waiting}</td>
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
    <span data-term="Runs completed">Runs completed: {v.nightly.reliability}.</span>
  </p>
  <ol class="ov-steps" data-term="Steps">
    {#each v.nightly.steps as s (s.label)}
      <li>
        <span class="ov-step-name">{s.label}</span>
        <span class="muted"
          >{v.nightly.nightOf}: {s.outcome}. Last finished: {s.lastFinished}. Reached: {s.sites}.</span
        >
      </li>
    {/each}
  </ol>
</section>

<section aria-labelledby="ov-upkeep">
  <h2 id="ov-upkeep">Upkeep</h2>
  <ul>
    <li data-term="Dependency updates merged">
      Dependency updates merged (opened by Renovate, our update bot): {v.upkeep.automerged}.
    </li>
    <li data-term="Sites cleared of vulnerabilities">
      Sites cleared of every critical or high vulnerability: {v.upkeep.vulnsCleared}.
    </li>
    <li data-term="Major-version upgrades waiting">
      Major-version upgrades waiting: {v.upkeep.depsBehind}.
    </li>
  </ul>
  <h3 data-term="Open now">Open now</h3>
  {#if v.upkeep.open.length > 0}
    <ul data-term="Open now">
      {#each v.upkeep.open as o (o.siteId)}
        <li>{o.siteName} {o.text}.</li>
      {/each}
    </ul>
  {:else}
    <!-- Only when every site in our care has a fresh security check and none is open:
         a stale or missing check is listed above (review round 4, C2). -->
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
    landed one small change at a time, each as a pull request (PR). A person merges every published
    release.
  </p>
  <p>
    On a client site, a change goes from its own branch to staging, then to the live site when one
    of us promotes staging.
  </p>
  <p data-term="PRs merged">
    PRs merged into the maintenance stack (the code that runs these checks and sends the reports): {v.prsMerged}.
  </p>
</section>

<section aria-labelledby="ov-trends" data-term="Trends">
  <h2 id="ov-trends">Trends</h2>
  <p>{v.trends.status}.</p>
  {#if v.trends.charts}
    <div class="ov-trends">
      {#each v.trends.charts as c, ci (c.title)}
        {@const g = trendGeometry(c)}
        <figure class="ov-trend">
          <figcaption id="ov-trend-{ci}">{c.title}</figcaption>
          {#if c.series.length > 1}
            <ul class="ov-key">
              {#each c.series as s, si (s.name)}
                <li>
                  <svg class="ov-key-mark" viewBox="0 0 16 10" aria-hidden="true"
                    >{#if s.bars}<rect
                        x="3"
                        y="1"
                        width="10"
                        height="9"
                        rx="2"
                        class="ov-bar"
                      />{:else}<line
                        x1="0"
                        y1="5"
                        x2="16"
                        y2="5"
                        class="ov-line-mark {s.broken ? 'broken' : ''} {si > 0 ? 'second' : ''}"
                      />{/if}</svg
                  >{s.name}
                </li>
              {/each}
            </ul>
          {/if}
          <svg
            class="ov-chart"
            viewBox="0 0 {g.width} {g.height}"
            role="img"
            aria-labelledby="ov-trend-{ci} ov-trend-{ci}-desc"
          >
            <desc id="ov-trend-{ci}-desc">{c.summary}</desc>
            {#each g.earlier as e, ei (ei)}
              <rect
                class="ov-earlier"
                x={e.x}
                y={g.top}
                width={e.width}
                height={g.baseline - g.top}
              />
            {/each}
            <line class="ov-grid" x1={g.plotLeft} x2={g.plotRight} y1={g.top} y2={g.top} />
            <line class="ov-axis" x1={g.plotLeft} x2={g.plotRight} y1={g.zero} y2={g.zero} />
            <text class="ov-tick" x={g.plotLeft - 4} y={g.top + 4} text-anchor="end">{c.high}</text>
            <text class="ov-tick" x={g.plotLeft - 4} y={g.baseline + 4} text-anchor="end"
              >{c.low}</text
            >
            <text class="ov-tick" x={g.plotLeft} y={g.height - 4}>{c.nights[0]}</text>
            <text class="ov-tick" x={g.plotRight} y={g.height - 4} text-anchor="end"
              >{c.nights.at(-1)}</text
            >
            {#each g.bars as b, bi (bi)}
              <path class="ov-bar" d={b.d} />
            {/each}
            {#each g.lines as l, li (li)}
              <path
                class="ov-line-mark {l.broken ? 'broken' : ''} {l.series > 0 ? 'second' : ''}"
                d={l.d}
              />
            {/each}
            {#each g.dots as d, di (di)}
              <circle
                class="ov-dot {d.broken ? 'broken' : ''} {d.series > 0 ? 'second' : ''}"
                cx={d.x}
                cy={d.y}
                r="4"
              />
            {/each}
            {#each g.slots as t, ti (ti)}
              <rect class="ov-hit" x={t.left} y={g.top} width={t.width} height={g.baseline - g.top}
                ><title>{t.title}</title></rect
              >
            {/each}
          </svg>
          {#if c.earlierNote}<p class="muted ov-trend-note">{c.earlierNote}</p>{/if}
          <details class="ov-trend-table">
            <summary>As a table</summary>
            <table class="ov-table">
              <thead
                ><tr
                  ><th>Night</th>{#each c.series as s (s.name)}<th>{s.name}</th>{/each}</tr
                ></thead
              >
              <tbody>
                {#each c.nights as night, pi (pi)}
                  <tr>
                    <th scope="row">{night}</th>
                    {#each c.series as s (s.name)}
                      {@const q = s.points[pi]!}
                      <td data-label={s.name} class={q.value === null ? "unknown" : ""}
                        >{q.value === null ? q.note : q.value}</td
                      >
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </details>
        </figure>
      {/each}
    </div>
  {/if}
</section>

<details class="ov-how">
  <summary>How we count</summary>
  <p class="muted" data-term="Nights counted">
    {#if v.nightsCollected === null}
      The nightly counts could not be read just now.
    {:else}
      The nightly has written {v.nightsCollected} of counts so far.
    {/if}
  </p>
  <dl>
    {#each HOW_WE_COUNT as h (h.term)}
      <dt>{h.term}</dt>
      <dd>{h.text}</dd>
    {/each}
  </dl>
</details>
