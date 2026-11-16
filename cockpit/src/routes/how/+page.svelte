<script lang="ts">
  import type { HowView } from "../../lib/how/view.js";
  import { HOW_WE_COUNT } from "../../lib/overview/view.js";
  import PageStyles from "../../lib/PageStyles.svelte";
  import howCss from "../../lib/how/how.css?inline";

  // P1-87: "How this works", five chapters, each a short diagram and a few lines.
  // Every number comes from lib/how/view.ts (the overview's own model); none is
  // typed here. Each number's label carries `data-term`, its line in How we count.
  // The wording is a first draft: the operator edits it after the build.
  let { data }: { data: { view: HowView } } = $props();
  const v = $derived(data.view);
</script>

<svelte:head>
  <title>Reddoor maintenance — how this works</title>
</svelte:head>
<PageStyles sheets={[howCss]} />

<h1>How this works</h1>
<p class="how-lede">
  Every client site in our care is checked, tested, backed up and kept up to date every night, by
  software we built. A person steps in only where judgment is needed.
</p>

<section class="how-chapter" aria-labelledby="how-night">
  <p class="how-kicker">Every night</p>
  <h2 id="how-night">While everyone sleeps, every site gets a full check-up</h2>
  <ol class="how-steps" data-term="Steps">
    {#each v.nightly.steps as s (s.label)}
      <li>
        <strong>{s.short}</strong>
        <span class="how-step-what">{s.label}</span>
        <span class="how-step-last">{v.nightly.nightOf}: {s.outcome}</span>
      </li>
    {/each}
  </ol>
  <p>
    <span data-term="Times"
      >The run starts at {v.nightly.startsAt}, and reports a person has approved go out at {v
        .nightly.sendsAt}.</span
    >
    Each step writes down what it found. Nothing is assumed to have worked: a check that did not run reads
    "not checked", never a pass.
  </p>
  <p class="how-figures">
    <span data-term="Scale">{v.nightly.scale}.</span>
    <span data-term="Runs completed">{v.nightly.reliability}.</span>
  </p>
</section>

<section class="how-chapter" aria-labelledby="how-wrong">
  <p class="how-kicker">When something is wrong</p>
  <h2 id="how-wrong">Problems are sorted by who they affect</h2>
  <ul class="how-ladder" id="how-ladder">
    {#each v.ladder as l (l.tier)}
      <li class={l.tier}><strong>{l.name}</strong> <span>{l.text}</span></li>
    {/each}
  </ul>
  <p>
    Most problems fix themselves: a security update opens its own change, is tested, and merges.
    <span data-term="Dependency updates merged"
      >Dependency updates merged automatically: {v.upkeep.automerged}.</span
    >
    <span data-term="Sites cleared of vulnerabilities"
      >Sites cleared of every critical or high vulnerability: {v.upkeep.vulnsCleared}.</span
    >
    What is left lands on the <a href="/triage">Triage</a> page each morning.
  </p>
</section>

<section class="how-chapter" aria-labelledby="how-lead">
  <p class="how-kicker">A lead's journey</p>
  <h2 id="how-lead">From a visitor's form to the client's inbox</h2>
  {#if v.leads.allTime === null}
    <p class="muted">The submissions could not be read just now. Reload to try again.</p>
  {:else}
    <ol class="how-flow">
      <li><strong>A visitor submits</strong> <span>a form on a client's site</span></li>
      <li data-term="Stopped before storage">
        <strong>Bots stopped</strong>
        <span
          >{v.leads.stoppedAllTime} never stored{#if v.leads.stoppedAsOf}, as of {v.leads
              .stoppedAsOf}{/if}</span
        >
      </li>
      <li data-term="Screened as spam">
        <strong>Spam screened</strong> <span>{v.leads.allTime.screened} set aside</span>
      </li>
      <li data-term="Accepted as real">
        <strong>Kept as real</strong>
        <span>{v.leads.allTime.accepted} leads, signups and RSVPs</span>
      </li>
      <li data-term="Client notified" class="how-end">
        <strong>The client is emailed</strong> <span>{v.leads.allTime.notified} delivered</span>
      </li>
      <li class="how-branch">
        <strong>If the email fails</strong> <span>it is held and retried, never lost</span>
      </li>
    </ol>
    <p data-term="Submissions">
      {v.leads.allTime.submissions}
      {v.leads.allTime.submissions === 1 ? "submission" : "submissions"} in all{#if v.leads.since}&nbsp;since
        {v.leads.since}{/if}. A lead's name, email and message are never shown on these pages.
    </p>
  {/if}
</section>

<section class="how-chapter" aria-labelledby="how-report">
  <p class="how-kicker">The client report</p>
  <h2 id="how-report">Each check in a report is proven by the nightly run</h2>
  <ol class="how-flow">
    <li><strong>Drafted</strong> <span>from the nightly's own results</span></li>
    <li data-term="Reports sent">
      <strong>Read by one of us</strong>
      {#if v.reports.sent === null}
        <span class="muted">the reports could not be read just now</span>
      {:else}
        <span>{v.reports.sent.approvedFirst} of {v.reports.sent.real} approved before sending</span>
      {/if}
    </li>
    <li class="how-end">
      <strong>Sent to the client</strong> <span>with traffic and search results</span>
    </li>
  </ol>
  <p data-term="Checks per report">
    Every maintenance report carries {v.reports.checks.length} checks, each proven by a step of the night
    above:
  </p>
  <dl class="how-checks" data-term="Checks per report">
    {#each v.reports.checks as c (c.name)}
      <dt>{c.name}</dt>
      <dd>{c.proof}</dd>
    {/each}
  </dl>
  <p data-term="Lighthouse">
    Google's Lighthouse audit, the middle score across our sites:
    {#each v.reports.lighthouse as l, i (l.label)}{i > 0 ? " · " : ""}{l.label}
      {l.median}{/each}{#if v.reports.lighthouseAsOf}<span class="muted"
        >, from audits as old as {v.reports.lighthouseAsOf}</span
      >{/if}.
  </p>
</section>

<section class="how-chapter" aria-labelledby="how-ship">
  <p class="how-kicker">How changes ship</p>
  <h2 id="how-ship">Nothing goes live untested</h2>
  <ol class="how-flow">
    <li><strong>A change is written</strong> <span>with its test first</span></li>
    <li>
      <strong>Reviewed</strong> <span>by fresh AI agents, usually over about three rounds</span>
    </li>
    <li><strong>Staging</strong> <span>on a client site, its own copy for checking</span></li>
    <li class="how-end"><strong>Live</strong> <span>when one of us promotes it</span></li>
  </ol>
  <p>
    Each change lands as its own pull request (PR), small enough to undo on its own. A person merges
    every published release.
    <span data-term="PRs merged"
      >PRs merged into the maintenance stack (the code that runs these checks and sends the
      reports): {v.prsMerged}.</span
    >
  </p>
</section>

<details class="how-count" id="how-we-count">
  <summary>How we count</summary>
  <dl>
    {#each HOW_WE_COUNT as h (h.term)}
      <dt>{h.term}</dt>
      <dd>{h.text}</dd>
    {/each}
  </dl>
</details>
