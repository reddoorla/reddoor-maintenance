<script lang="ts">
  import type { OverviewView } from "../lib/overview/view.js";
  import {
    launchingClauses,
    listWords,
    sparkGeometry,
    trendGeometry,
  } from "../lib/overview/view.js";
  import { tickerSeconds } from "../lib/overview/ticker.js";
  import PageStyles from "../lib/PageStyles.svelte";
  import healthCss from "../lib/cockpit/health.css?inline";
  import overviewCss from "../lib/overview/overview.css?inline";

  // P1-78g, P1-87 PR 3: the overview. The first screen is the status strip and two
  // panels (fleet health, and how much is happening); the leads, client reports and
  // trends follow. Every string and number comes decided from lib/overview/view.ts.
  let { data }: { data: { view: OverviewView } } = $props();
  const v = $derived(data.view);
  const allOk = $derived(
    v.health.tiers.watch + v.health.tiers.attention + v.health.tiers.broken === 0,
  );
  const launching = $derived(launchingClauses(v.health.launching));
  // P1-87 PR 5b: the ticker moves until a visitor pauses it (or points at it, in CSS).
  let paused = $state(false);
  // P1-87 PR 5b review r4 A: the ticker's still layout is a state this component holds, not a
  // CSS guess. `still` is on from a keyboard focus that arrives from outside the window until
  // focus leaves the window, and also once a focused link is in view with the pointer gone.
  // `pressing` is set by a press in the window and cleared by a release anywhere, so a mouse
  // focus (which Chromium gives without :focus-visible) never stills the row under the pointer.
  // `js` marks a page with script: the CSS's no-script fallback keys on its absence.
  let still = $state(false);
  let js = $state(false);
  let pressing = false;
  // The last counted release: a press that began in the window and ended with a pointerup or
  // pointercancel. A tap's focus arrives after its pointerup, when pressing is already false, so a
  // touch or pen release is a press for 1000 ms. A release whose press began outside the window, or
  // whose press contextmenu or blur already cleared, is not counted and never opens that window.
  let lastRelease = { type: "", at: -Infinity };
  const pressed = () =>
    pressing || (lastRelease.type !== "mouse" && performance.now() - lastRelease.at < 1000);
  let windowEl: HTMLElement | undefined = $state();
  $effect(() => {
    const el = windowEl;
    js = true;
    // Still once the focus is a visible one inside the window, the pointer is not over the
    // window, and no press is in progress. Chromium updates :focus-visible after a key, so the
    // key re-check waits a frame. The pointer re-check (pointerleave) waits a frame only for
    // symmetry with the key one.
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    // The type of the last pointer on the page. A touch leaves :hover on the element it tapped, and
    // no pointer leaves to clear it, so a touch's :hover does not count as a pointer over the window.
    let lastPointer = "";
    const notePointer = (e: PointerEvent) => {
      lastPointer = e.pointerType;
    };
    const recheck = () => {
      if (!el || still || pressed()) return;
      const a = document.activeElement;
      if (!a || !el.contains(a) || !a.matches(":focus-visible")) return;
      if (lastPointer !== "touch" && el.matches(":hover")) return;
      still = true;
    };
    const onKey = () => {
      requestAnimationFrame(recheck);
    };
    const onFocusIn = (e: FocusEvent) => {
      const from = e.relatedTarget;
      if (!(from instanceof Node) || !el?.contains(from)) still = !pressed();
    };
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget;
      if (to instanceof Node && el?.contains(to)) return;
      // A press on text in the still row takes focus to nowhere: the layout holds until the release.
      if (pressing && !(to instanceof Node)) return;
      still = false;
    };
    const onPress = () => {
      pressing = true;
    };
    // Only a release whose press began in the window counts. A counted touch or pen release also
    // schedules a re-check for when its 1000 ms ends, so a focus taken during it is stood still then
    // (recheck still refuses a focus that is not :focus-visible, or one under the pointer).
    const onRelease = (e: PointerEvent) => {
      const counted = pressing;
      pressing = false;
      if (counted) {
        lastRelease = { type: e.pointerType, at: performance.now() };
        clearTimeout(releaseTimer);
        releaseTimer = undefined;
        if (e.pointerType !== "mouse") releaseTimer = setTimeout(recheck, 1000 + 50);
      }
      // Focus that went nowhere during the press leaves the row moving, not stuck still.
      if (
        still &&
        !(document.activeElement instanceof Node && el?.contains(document.activeElement))
      )
        still = false;
    };
    // A press with no release (a context menu, a window that loses focus) must not stick.
    const onAbandon = () => {
      pressing = false;
    };
    const onLeave = () => {
      requestAnimationFrame(recheck);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerover", notePointer);
    document.addEventListener("pointerdown", notePointer);
    document.addEventListener("pointerup", onRelease);
    document.addEventListener("pointercancel", onRelease);
    el?.addEventListener("focusin", onFocusIn);
    el?.addEventListener("focusout", onFocusOut);
    el?.addEventListener("pointerdown", onPress);
    el?.addEventListener("pointerleave", onLeave);
    el?.addEventListener("contextmenu", onAbandon);
    addEventListener("blur", onAbandon);
    // A focus made before this script ran (keyboard, before hydration) gets the still layout.
    requestAnimationFrame(recheck);
    return () => {
      clearTimeout(releaseTimer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerover", notePointer);
      document.removeEventListener("pointerdown", notePointer);
      document.removeEventListener("pointerup", onRelease);
      document.removeEventListener("pointercancel", onRelease);
      el?.removeEventListener("focusin", onFocusIn);
      el?.removeEventListener("focusout", onFocusOut);
      el?.removeEventListener("pointerdown", onPress);
      el?.removeEventListener("pointerleave", onLeave);
      el?.removeEventListener("contextmenu", onAbandon);
      removeEventListener("blur", onAbandon);
    };
  });
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

<div class="ov-first">
  <section class="ov-health" aria-labelledby="ov-health">
    <h2 id="ov-health">
      Fleet health · {v.health.sites}
      {v.health.sites === 1 ? "site" : "sites"}
    </h2>
    <div class="ov-tierbar" aria-hidden="true">
      {#if v.health.tiers.ok > 0}<span class="ov-seg ok" style="flex-grow: {v.health.tiers.ok}"
          >{#if allOk}<span class="ov-tier-inside"
              >{v.health.tiers.ok} OK · {v.health.tiers.watch} watch · {v.health.tiers.attention} attention
              · {v.health.tiers.broken} broken</span
            >{/if}</span
        >{/if}
      {#if v.health.tiers.watch > 0}<span
          class="ov-seg watch"
          style="flex-grow: {v.health.tiers.watch}"
        ></span>{/if}
      {#if v.health.tiers.attention > 0}<span
          class="ov-seg attention"
          style="flex-grow: {v.health.tiers.attention}"
        ></span>{/if}
      {#if v.health.tiers.broken > 0}<span
          class="ov-seg broken"
          style="flex-grow: {v.health.tiers.broken}"
        ></span>{/if}
    </div>
    <p class="ov-tier-counts" class:visually-hidden={allOk}>
      {v.health.tiers.ok} OK · {v.health.tiers.watch} watch · {v.health.tiers.attention} attention · {v
        .health.tiers.broken} broken
    </p>
    {#if launching.length > 0}<p class="ov-tier-counts">
        plus {#each launching as c, i (i)}{i > 0 ? " and " : ""}<span data-term={c.term}
            >{c.text}</span
          >{/each}
      </p>{/if}
    <h3>Sites passing each check</h3>
    <ul class="ov-checks-list" data-term="Sites passing each check">
      {#each v.health.checks as c (c.name)}
        <li class="ov-check">
          <span class="ov-check-name">{c.name}</span>
          <span class="ov-check-bar" aria-hidden="true"
            >{#if c.pass > 0}<span class="ov-check-fill" style="width: {(100 * c.pass) / c.total}%"
              ></span>{/if}{#if c.unknown > 0}<span
                class="ov-check-unknown"
                style="left: {c.total === 0 ? 0 : (100 * c.pass) / c.total}%; width: {(100 *
                  c.unknown) /
                  c.total}%"
              ></span>{/if}</span
          >
          <span class="ov-check-count"
            >{c.pass}{" "}<span class="visually-hidden">of {c.total}</span>{c.fail > 0
              ? ` · ${c.fail} failing`
              : ""}{c.testFailed > 0
              ? ` · ${c.testFailed} test failed, not yet a verdict`
              : ""}{c.noVerdict > 0 ? ` · ${c.noVerdict} no verdict` : ""}{c.notChecked > 0
              ? ` · ${c.notChecked} not checked`
              : ""}</span
          >
        </li>
      {/each}
    </ul>
    <dl class="ov-medians">
      {#each v.reports.lighthouse as l (l.label)}
        <div>
          <dt>{l.label}</dt>
          <dd>{l.median}</dd>
        </div>
      {/each}
    </dl>
    <p class="muted ov-lighthouse-line">
      Google Lighthouse, the middle score across our sites{#if v.reports.lighthouseAsOf}, from
        audits as old as {v.reports.lighthouseAsOf}{/if}.
    </p>
  </section>

  <section class="ov-happening" aria-labelledby="ov-happening-h">
    <h2 id="ov-happening-h">How much is happening</h2>
    <div class="ov-tiles">
      {#each v.numbers as n (n.key)}
        <div class="ov-tile">
          <p class="ov-num{n.measured ? '' : ' unknown'}">{n.value}</p>
          <p class="ov-label">{n.label}</p>
          {#if n.context}<p class="muted ov-context">{n.context}</p>{/if}
          {#if n.spark}
            {@const g = sparkGeometry(n.spark)}
            <svg class="ov-spark" viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden="true"
              >{#each g.lines as l, li (li)}<polyline
                  points={l}
                />{/each}{#each g.dots as d, di (di)}<circle
                  cx={d.x}
                  cy={d.y}
                  r="1.5"
                />{/each}</svg
            >
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <section class="ov-lately" aria-labelledby="ov-lately-h">
    <h2 id="ov-lately-h">Lately</h2>
    {#if v.lately.unreadable.length > 0}
      <p>Could not read {listWords(v.lately.unreadable)} just now.</p>
    {:else if v.lately.lines.length === 0}
      <p class="muted">Nothing recorded in the last 7 days.</p>
    {/if}
    {#if v.lately.lines.length > 0}
      <ol data-term="Lately">
        {#each v.lately.lines as l, i (i)}
          <li>
            <time datetime={l.atIso}><span>{l.whenDate}</span> <span>{l.whenTime}</span></time>
            <span
              >{l.text}{#if l.site !== null}<span aria-hidden="true">{" · "}</span><span
                  class="visually-hidden">{", "}</span
                >{l.site}{/if}</span
            >
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>

<section class="ov-ticker" aria-labelledby="ov-ticker-h" data-term="Every site (the ticker)">
  <h2 id="ov-ticker-h">Every site</h2>
  {#if v.ticker.length === 0}
    <p class="muted">No sites in our care yet.</p>
  {:else}
    <button
      type="button"
      class="ov-ticker-pause"
      aria-pressed={paused}
      onclick={() => (paused = !paused)}>Pause the ticker</button
    >
    <div
      class="ov-ticker-window"
      bind:this={windowEl}
      data-js={js ? "true" : null}
      data-still={still ? "true" : null}
    >
      <div class="ov-ticker-run" class:paused style="--ov-ticker-s: {tickerSeconds(v.ticker)}s">
        <ul class="ov-ticker-list">
          {#each v.ticker as t (t.key)}
            <li>
              {#if t.href}<a href={t.href}>{t.name}</a>{:else}<span>{t.name}</span>{/if}
              <span class="pill {t.tier === 'ok' ? 'healthy' : t.tier}">{t.tierWord}</span>
              <span class="ov-ticker-fact">{t.fact}</span>
            </li>
          {/each}
        </ul>
        <ul class="ov-ticker-list copy" aria-hidden="true" inert>
          {#each v.ticker as t (t.key)}
            <li>
              <span>{t.name}</span>
              <span class="pill {t.tier === 'ok' ? 'healthy' : t.tier}">{t.tierWord}</span>
              <span class="ov-ticker-fact">{t.fact}</span>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}
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

<!-- Kept below the first screen on the operator's word (11-16, the workspace's
     decisions/2026-11-16-2301-p1-87-pr3-upkeep-open-now.md): the two facts no other
     page shows. The ladder and the counts on the first screen's tiles are not repeated. -->
<section aria-labelledby="ov-upkeep">
  <h2 id="ov-upkeep">Upkeep</h2>
  <p data-term="Major-version upgrades waiting">
    Major-version upgrades waiting: {v.upkeep.depsBehind}.
  </p>
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
            {#each g.breaks as x, bi (bi)}
              <line class="ov-break" x1={x} x2={x} y1={g.top} y2={g.baseline} />
            {/each}
            <line class="ov-grid" x1={g.plotLeft} x2={g.plotRight} y1={g.top} y2={g.top} />
            <line class="ov-axis" x1={g.plotLeft} x2={g.plotRight} y1={g.zero} y2={g.zero} />
            <text class="ov-tick" x={g.plotLeft - 4} y={g.top + 4} text-anchor="end">{c.high}</text>
            {#if c.mid !== null && g.midY !== null}
              <line class="ov-grid" x1={g.plotLeft} x2={g.plotRight} y1={g.midY} y2={g.midY} />
              <text class="ov-tick" x={g.plotLeft - 4} y={g.midY + 4} text-anchor="end"
                >{c.mid}</text
              >
            {/if}
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
                stroke-linejoin="round"
                stroke-linecap="round"
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
          {#if c.note}<p class="muted ov-trend-note">{c.note}</p>{/if}
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

<p class="ov-closing"><a href="/how">How this works</a></p>
