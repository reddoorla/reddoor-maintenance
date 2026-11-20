<script lang="ts">
  import { onMount } from "svelte";
  import type { HowView } from "../../lib/how/view.js";
  import { LEAD_DOT_MS, nextToLight, STEP_LIGHT_MS, type Tier } from "../../lib/how/view.js";
  import { HOW_WE_COUNT, NOT_YET, UNREADABLE } from "../../lib/overview/view.js";
  import PageStyles from "../../lib/PageStyles.svelte";
  import howCss from "../../lib/how/how.css?inline";

  // P1-87: "How this works", five chapters, each a short diagram and a few lines.
  // Every number comes from lib/how/view.ts (the overview's own model); none is
  // typed here. Each number's label carries `data-term`, its line in How we count.
  // The wording is a first draft: the operator edits it after the build.
  let { data }: { data: { view: HowView } } = $props();
  const v = $derived(data.view);
  /** A count, not a "not yet collected" or "not readable" in its place. */
  const isCount = (x: string) => x !== NOT_YET && x !== UNREADABLE;

  /** PR 8c item 8: the steps not yet lit, by index. Empty on the server and without script,
   *  so every step renders lit; the script sets it in onMount, and only when motion is allowed. */
  let unlit = $state<boolean[]>([]);
  /** Set in onMount, in the same effect that attaches the observer: the browser tests wait for it. */
  let scripted = $state(false);
  let stepsEl: HTMLOListElement | undefined = $state();

  /** PR 8c item 9: the branch disclosure. Open in the server render and without script, so no
   *  visitor loses its sentence; closed in onMount, once the script can toggle it. */
  let branchOpen = $state(true);
  /** Set in onMount, in the same effect that attaches the lead's listeners: the browser tests wait for it. */
  let leadScripted = $state(false);
  let leadEl: HTMLElement | undefined = $state();
  let leadFlowEl: HTMLOListElement | undefined = $state();
  let dotEl: HTMLElement | undefined = $state();
  let replayEl: HTMLButtonElement | undefined = $state();
  let branchEl: HTMLButtonElement | undefined = $state();

  /** PR 8c item 10: each level's panel is open in the server render and without script, so no
   *  visitor loses its sites or the nights line; the script closes them in onMount. */
  let levelOpen = $state<Record<Tier, boolean>>({
    ok: true,
    watch: true,
    attention: true,
    broken: true,
  });
  /** Set in onMount, in the same effect that attaches the ladder's listeners. */
  let ladderScripted = $state(false);
  let ladderEl: HTMLOListElement | undefined = $state();

  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: IntersectionObserver | undefined;
    // Under reduced motion, or with no observer, nothing moves: every step stays lit, and the
    // lead's dot and Replay stay hidden (item 9).
    const motion =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: no-preference)").matches;
    if (motion && typeof IntersectionObserver === "function" && stepsEl !== undefined) {
      const items = Array.from(stepsEl.children) as HTMLElement[];
      const seen = items.map(() => false);
      const lit = items.map(() => false);
      const show = () => {
        unlit = lit.map((l) => !l);
      };
      // A step whose top edge is already above the viewport's bottom at mount is seen and
      // lit at mount, in order. The rest wait for the observer.
      items.forEach((el, i) => {
        seen[i] = el.getBoundingClientRect().top < window.innerHeight;
      });
      for (let k = nextToLight(seen, lit); k !== null; k = nextToLight(seen, lit)) lit[k] = true;
      show();
      // One step at a time: each lights, then the next waits its transition's length.
      const light = () => {
        timer = undefined;
        const k = nextToLight(seen, lit);
        if (k === null) return;
        lit[k] = true;
        show();
        timer = setTimeout(light, STEP_LIGHT_MS);
      };
      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const i = items.indexOf(e.target as HTMLElement);
            if (i !== -1 && e.isIntersecting && e.intersectionRatio >= 0.6) seen[i] = true;
          }
          // A step the visitor has scrolled past counts as seen, even one that never
          // intersected (a jump): the same test as at mount.
          items.forEach((el, i) => {
            if (el.getBoundingClientRect().top < window.innerHeight) seen[i] = true;
          });
          if (timer === undefined) light();
        },
        { threshold: 0.6 },
      );
      items.forEach((el) => observer!.observe(el));
    }
    scripted = true;

    // PR 8c item 10: each level's button opens its panel; Escape closes an open panel and
    // returns focus to its button. Plain listeners, not a delegated attribute (see 8a's rules).
    const ladderCleanups: Array<() => void> = [];
    if (ladderEl !== undefined) {
      for (const li of Array.from(ladderEl.children) as HTMLElement[]) {
        const btn = li.querySelector<HTMLButtonElement>("button.how-level");
        if (btn === null) continue;
        const tier = btn.dataset["level"] as Tier;
        const toggle = () => {
          levelOpen = { ...levelOpen, [tier]: !levelOpen[tier] };
        };
        const onKey = (e: KeyboardEvent) => {
          if (e.key !== "Escape" || !levelOpen[tier]) return;
          e.preventDefault();
          levelOpen = { ...levelOpen, [tier]: false };
          btn.focus();
        };
        btn.addEventListener("click", toggle);
        li.addEventListener("keydown", onKey);
        ladderCleanups.push(() => {
          btn.removeEventListener("click", toggle);
          li.removeEventListener("keydown", onKey);
        });
      }
    }
    levelOpen = { ok: false, watch: false, attention: false, broken: false };
    ladderScripted = true;

    // PR 8c item 9: the lead's journey. The branch starts closed; its button toggles it.
    const cleanups: Array<() => void> = [];
    branchOpen = false;
    if (branchEl !== undefined) {
      const toggle = () => {
        branchOpen = !branchOpen;
      };
      branchEl.addEventListener("click", toggle);
      cleanups.push(() => branchEl?.removeEventListener("click", toggle));
    }
    // The dot and Replay need motion, and a journey to run: the counts must be readable.
    const canRun =
      motion &&
      v.leads.allTime !== null &&
      leadEl !== undefined &&
      leadFlowEl !== undefined &&
      dotEl !== undefined &&
      replayEl !== undefined &&
      typeof IntersectionObserver === "function" &&
      typeof dotEl.animate === "function";
    if (canRun) {
      const section = leadEl!;
      const dot = dotEl!;
      const replay = replayEl!;
      const stages = Array.from(leadFlowEl!.children) as HTMLElement[];
      dot.hidden = false;
      replay.hidden = false;
      let anim: Animation | undefined;
      let passes: ReturnType<typeof setTimeout>[] = [];
      let started = false;
      const clearPasses = () => {
        passes.forEach(clearTimeout);
        passes = [];
      };
      // One run: the dot visits each stage's centre, linearly, in LEAD_DOT_MS. A stage is
      // marked as the dot reaches it; it rests at the inbox when the run ends.
      const run = () => {
        started = true;
        anim?.cancel();
        clearPasses();
        for (const li of stages) li.removeAttribute("data-passed");
        const origin = section.getBoundingClientRect();
        const last = stages.length - 1;
        const frames = stages.map((li, i) => {
          const r = li.getBoundingClientRect();
          const x = r.left + r.width / 2 - origin.left;
          const y = r.top + r.height / 2 - origin.top;
          return { transform: `translate(${x}px, ${y}px)`, offset: i / last };
        });
        anim = dot.animate(frames, {
          duration: LEAD_DOT_MS,
          easing: "linear",
          iterations: 1,
          fill: "forwards",
        });
        stages.slice(1).forEach((li, k) => {
          passes.push(
            setTimeout(
              () => li.setAttribute("data-passed", "true"),
              (LEAD_DOT_MS * (k + 1)) / last,
            ),
          );
        });
      };
      // The run starts once the chapter is at least 0.6 in view, and only once.
      const reveal = new IntersectionObserver(
        (entries) => {
          if (!started && entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.6)) {
            reveal.disconnect();
            run();
          }
        },
        { threshold: 0.6 },
      );
      reveal.observe(section);
      replay.addEventListener("click", run);
      cleanups.push(() => {
        reveal.disconnect();
        replay.removeEventListener("click", run);
        anim?.cancel();
        clearPasses();
      });
    }
    leadScripted = true;

    return () => {
      observer?.disconnect();
      clearTimeout(timer);
      cleanups.forEach((fn) => fn());
      ladderCleanups.forEach((fn) => fn());
    };
  });
</script>

<svelte:head>
  <title>Reddoor maintenance — how this works</title>
</svelte:head>
<PageStyles sheets={[howCss]} />

<h1>How this works</h1>
<p class="how-lede">
  Every client site in our care is checked and tested every night and kept up to date every week,
  and our records for it are backed up nightly, by software we built. A person steps in only where
  judgment is needed.
</p>

<section class="how-chapter" aria-labelledby="how-night">
  <hgroup>
    <p class="how-kicker">Every night</p>
    <h2 id="how-night">While everyone sleeps, every site gets a full check-up</h2>
  </hgroup>
  <ol
    class="how-steps"
    role="list"
    data-term="Steps"
    bind:this={stepsEl}
    data-js={scripted ? "true" : undefined}
  >
    {#each v.nightly.steps as s, i (s.label)}
      <li data-lit={unlit[i] ? "false" : "true"}>
        <strong>
          <span class="how-step-n">{s.n}</span><span aria-hidden="true">{" ·"}</span>{" "}<span
            class="how-step-name"
          >
            {s.short}
          </span>
        </strong>
        <span class="how-step-what">{s.label}</span>
        <span class="how-step-last">
          {v.nightly.nightOf}: {s.outcome}. Last finished: {s.lastFinished}. Reached: {s.sites}.
        </span>
      </li>
    {/each}
  </ol>
  <p>
    <span data-term="Times">
      The run starts at {v.nightly.startsAt}, and reports a person has approved go out at {v.nightly
        .sendsAt}.
    </span>
    Each step writes down what it found. Nothing is assumed to have worked: a check that did not run never
    reads as a pass.
  </p>
  <p class="how-figures">
    <span data-term="Scale">Scale: {v.nightly.scale}.</span>
    <span data-term="Runs completed">Runs completed: {v.nightly.reliability}.</span>
  </p>
</section>

<section class="how-chapter" aria-labelledby="how-wrong">
  <hgroup>
    <p class="how-kicker">When something is wrong</p>
    <h2 id="how-wrong">Problems are sorted by who they affect</h2>
  </hgroup>
  <ol
    class="how-ladder"
    role="list"
    bind:this={ladderEl}
    data-js={ladderScripted ? "true" : undefined}
  >
    {#each v.ladder as l (l.tier)}
      <li class={l.tier}>
        <button
          type="button"
          class="how-level"
          data-level={l.tier}
          aria-expanded={levelOpen[l.tier] ? "true" : "false"}
          aria-controls="how-level-{l.tier}"
        >
          <strong>{l.name}</strong> <span>{l.text}</span>
        </button>
        <div id="how-level-{l.tier}" class="how-level-panel" hidden={!levelOpen[l.tier]}>
          {#if l.sites.length === 0}
            <p>None today</p>
          {:else}
            <ul role="list" class="how-level-sites">
              {#each l.sites as site (site.name)}
                <li>
                  <span class="how-level-site">{site.name}</span>{#if site.reason !== null}:
                    {site.reason}{/if}
                </li>
              {/each}
            </ul>
          {/if}
          <p class="how-level-nights">{l.nights}</p>
        </div>
      </li>
    {/each}
  </ol>
  <p>
    Much of the fixing is done by the system itself: once a week an update bot opens changes for the
    packages a site uses that have new versions (after a short wait, minor ones grouped together),
    and each change is tested before it merges. A fix for a known critical or high vulnerability in
    a package the site uses directly does not wait for the week: it opens the same night. One deeper
    in the tree waits for the weekly lock-file update.
    <span data-term="Dependency updates merged">
      Dependency updates merged: {v.upkeep.automerged}.
    </span>
    <span data-term="Sites cleared of vulnerabilities">
      Sites cleared of every critical or high vulnerability: {v.upkeep.vulnsCleared}.
    </span>
    What is left lands on the <a href="/triage">Triage</a> page each morning.
  </p>
</section>

<section class="how-chapter how-lead" aria-labelledby="how-lead" bind:this={leadEl}>
  <hgroup>
    <p class="how-kicker">A lead's journey</p>
    <h2 id="how-lead">From a visitor's form to the client's inbox</h2>
  </hgroup>
  {#if v.leads.allTime === null}
    <p class="muted">The submissions could not be read just now. Reload to try again.</p>
  {/if}
  <ol
    class="how-flow how-lead-flow"
    role="list"
    bind:this={leadFlowEl}
    data-js={leadScripted ? "true" : undefined}
  >
    <li><strong>A visitor submits</strong> <span>a form on a client's site</span></li>
    <li data-term="Stopped before storage">
      <strong>Bots stopped</strong>
      {#if isCount(v.leads.stoppedAllTime)}
        <span>
          {v.leads.stoppedAllTime} never stored{#if v.leads.stoppedAsOf}, as of {v.leads
              .stoppedAsOf}{/if}
        </span>
      {:else}
        <span class="muted">{v.leads.stoppedAllTime}</span>
      {/if}
    </li>
    {#if v.leads.allTime !== null}
      <li data-term="Screened as spam">
        <strong>Spam screened</strong> <span>{v.leads.allTime.screened} set aside</span>
      </li>
      <li data-term="Accepted as real">
        <strong>Kept as real</strong>
        <span>{v.leads.allTime.accepted} leads, signups and RSVPs</span>
      </li>
      <li data-term="Client notified" class="how-end">
        <strong>The client is emailed</strong> <span>{v.leads.allTime.notified} emailed</span>
      </li>
    {/if}
  </ol>
  <!-- The dot runs the journey once (PR 8c item 9); hidden until the script shows it. -->
  <span class="how-dot" aria-hidden="true" hidden bind:this={dotEl}></span>
  <button type="button" class="how-replay" hidden bind:this={replayEl}>Replay</button>
  <div class="how-branch">
    <button
      type="button"
      class="how-branch-toggle"
      aria-expanded={branchOpen ? "true" : "false"}
      aria-controls="how-branch-text"
      bind:this={branchEl}
    >
      If an email to the client fails
    </button>
    <p id="how-branch-text" class="how-branch-text" hidden={!branchOpen}>
      If an email to the client fails, the lead is still kept in our own inbox, and repeated bounces
      raise an alarm for us.
    </p>
  </div>
  {#if v.leads.allTime !== null}
    <p data-term="Submissions">
      {v.leads.allTime.submissions}
      {v.leads.allTime.submissions === 1 ? "submission" : "submissions"} in all{#if v.leads.since}&nbsp;since
        {v.leads.since}{/if}. A lead's name, email and message are never shown on this page or the
      overview.
    </p>
  {/if}
</section>

<section class="how-chapter" aria-labelledby="how-report">
  <hgroup>
    <p class="how-kicker">The client report</p>
    <h2 id="how-report">Each check in a report is proven by the nightly run</h2>
  </hgroup>
  <ol class="how-flow" role="list">
    <li><strong>Drafted</strong> <span>from the nightly's own results</span></li>
    <li data-term="Reports sent">
      <strong>Approved by one of us</strong>
      {#if v.reports.sent === null}
        <span class="muted">the reports could not be read just now</span>
      {:else}
        <span>
          {v.reports.sent.approvedFirst} of {v.reports.sent.real} approved before sending{#if v.reports.sent.aroundGate > 0};
            {v.reports.sent.aroundGate} went without that yes{/if}
        </span>
      {/if}
    </li>
    <li class="how-end">
      <strong>Sent to the client</strong>
      <span>with traffic and search results where we have them</span>
    </li>
  </ol>
  <p data-term="Checks per report">
    Every maintenance report carries up to {v.reports.checks.length} checks (one that does not apply to
    a site, such as the CMS check on a site without one, is left out), each proven by a step of the night
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
    {#each v.reports.lighthouse as l, i (l.label)}{#if i > 0}<span aria-hidden="true">
          {" ·"}
        </span>{" "}{/if}{l.label}
      {l.median}{/each}{#if v.reports.lighthouseAsOf}<span class="muted">
        , from audits as old as {v.reports.lighthouseAsOf}
      </span>{/if}.
  </p>
</section>

<section class="how-chapter" aria-labelledby="how-ship">
  <hgroup>
    <p class="how-kicker">How changes ship</p>
    <h2 id="how-ship">Nothing we write goes live untested</h2>
  </hgroup>
  <ol class="how-flow" role="list">
    <li><strong>We write a change</strong> <span>with its test first</span></li>
    <li>
      <strong>Reviewed</strong> <span>by fresh AI agents, before it lands</span>
    </li>
    <li><strong>Staging</strong> <span>on a client site with its own copy for checking</span></li>
    <li class="how-end"><strong>Live</strong> <span>when one of us promotes it</span></li>
  </ol>
  <p>
    Each change lands as its own pull request (PR), small enough to undo on its own. That is the
    path on a client site with a staging copy. Small dependency updates skip staging, and go live
    once the site's tests pass. Changes to the maintenance stack itself go live when they merge,
    once tested; the changes we write are also reviewed. Only its published package releases wait
    for a person. The count includes the update bot's own merges.
    <span data-term="PRs merged">
      PRs merged into the maintenance stack (the code that runs these checks and sends the reports): {v.prsMerged}.
    </span>
  </p>
</section>

<details class="how-count" id="how-we-count">
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
