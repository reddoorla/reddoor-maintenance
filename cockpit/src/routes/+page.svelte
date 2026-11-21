<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { invalidate } from "$app/navigation";
  import type { HealthCheck, OverviewView } from "../lib/overview/view.js";
  import {
    CHECK_SLUGS,
    launchingClauses,
    listWords,
    sparkGeometry,
    tickLabel,
    trendGeometry,
  } from "../lib/overview/view.js";
  import { tickerSeconds } from "../lib/overview/ticker.js";
  import { markerAt, untilWords } from "../lib/overview/cycle.js";
  import { startCycleClock } from "../lib/overview/cycle-clock.js";
  import {
    BAR_MS,
    BAR_STAGGER_MS,
    FEED_MS,
    SPARK_MS,
    countable,
    countUp,
    INTRO_MS,
    introPlayed,
    markIntroPlayed,
    trendKey,
    trendReadout,
  } from "../lib/overview/motion.js";
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
  // P1-87 PR 8a: the intro (items 3 and 4) plays on a full load only. Read once, at init: the server
  // render and the hydration both see it on, and a client return (a new component) sees it off.
  // Cleared in onMount after INTRO_MS, so a refresh that inserts a bar or a figure plays nothing on it
  // (P1-87 PR 8a, review round 1, F2).
  let intro = $state(!introPlayed());
  // Set in onMount: the browser tests wait on it, so they act only once the script has run.
  let motionReady = $state(false);
  // P1-87 PR 5b review r4 A: the ticker's still layout is a state this component holds, not a
  // CSS guess. `still` is on from a keyboard focus that arrives from outside the window until
  // focus leaves the window, and also once a focused link is in view with the pointer gone.
  // `pressing` is set by a press in the window and cleared by a release anywhere, so a mouse
  // focus (which Chromium gives without :focus-visible) never stills the row under the pointer.
  // `js` marks a page with script: the CSS's no-script fallback keys on its absence.
  let still = $state(false);
  let js = $state(false);
  // P1-87 PR 8a, item 5, and round 2 (G): two nights per chart, by chart index (absent or null:
  // none). `keySel` is the night the keys, a click or a tap chose: the slider reports it, and it is
  // the one announcement. `hoverSel` is a pointer's preview of another night: the readout and the
  // cursor show it while the pointer rests on a night, and it never moves the slider (R1). A key
  // step or a click ends it (setKeyNight), so after a key step the readout follows the key night.
  // `keySel` is kept as the night's label ("Oct 26", unique in a window), not its place, so a
  // refresh that moves the window on keeps a chart on the same night, and a night that left the
  // window is no selection (P1-87 minors, #2174). `hoverSel` stays a place: it is where the pointer
  // rests, so after a refresh it previews the night now under the pointer (#2174 review round 1).
  // A hover past a chart's last night (a window that shrank under a resting pointer) is no preview,
  // so the readout falls back to the key night (review round 2, nit).
  let keySel = $state<Record<number, string | null>>({});
  let hoverSel = $state<Record<number, number | null>>({});
  /** The place of night `label` in chart `nights`, or null when it is none or not in the window. */
  const placeOf = (nights: readonly string[], label: string | null | undefined): number | null => {
    const i = label == null ? -1 : nights.indexOf(label);
    return i === -1 ? null : i;
  };
  const TREND_IDLE = "Point at a night, or focus the chart and use the arrow keys, to read it.";
  // A key night set by a key, a click, a blur or Escape ends the chart's preview: a key step is an
  // act, so the readout and the cursor follow the key night until the pointer moves to another night
  // (P1-87 PR 8a, round 3 I). A click clears it too, so a tap cannot leave a preview stuck.
  const setKeyNight = (ci: number, k: string | null) => {
    keySel[ci] = k;
    hoverSel[ci] = null;
  };
  // An action, not onkeydown: Svelte delegates onkeydown to the document, which would add a
  // document listener on the first overview visit that outlives it (the ticker's listener count).
  const trendKeys = (node: SVGElement, handler: (e: KeyboardEvent) => void) => {
    let current = handler;
    const listen = (e: KeyboardEvent) => current(e);
    node.addEventListener("keydown", listen);
    return {
      update(next: (e: KeyboardEvent) => void) {
        current = next;
      },
      destroy() {
        node.removeEventListener("keydown", listen);
      },
    };
  };
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
    // A mouse or pen is over the ticker. Chromium keeps :hover on the element a touch tapped, and a
    // mouse that rests fires no pointerover, so the flag is set only by the window's own pointer
    // events (a touch never sets it) and cleared when a pointer leaves the window. A drag fires a
    // cancel and a leave while the pointer stays over the window; dragend settles the flag from
    // the drop point instead. After a drag Chromium sends the window no leave for the first move out,
    // so the next mouse or pen event on the page settles the flag (onDocPointer). A move straight off
    // the page after a drag sends no pointer event at all, but it does send a mouseout with no related
    // target, so that clears the flag (onDocOut).
    let finePointerOver = false;
    const onFinePointer = (e: PointerEvent) => {
      if (e.pointerType !== "touch") finePointerOver = true;
    };
    // Armed by a drag's end: the first mouse or pen pointerover or pointermove anywhere on the page
    // says whether the pointer is over the window, then the listener disarms. A touch leaves it armed.
    let docArmed = false;
    const onDocPointer = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      finePointerOver = el !== undefined && el.contains(e.target as Node);
      disarmDoc();
      requestAnimationFrame(recheck);
    };
    // While armed, a mouseout with no related target means the pointer has left the page: the flag clears.
    const onDocOut = (e: MouseEvent) => {
      if (e.relatedTarget !== null) return;
      finePointerOver = false;
      disarmDoc();
      requestAnimationFrame(recheck);
    };
    const armDoc = () => {
      if (docArmed) return;
      docArmed = true;
      document.addEventListener("pointerover", onDocPointer, true);
      document.addEventListener("pointermove", onDocPointer, true);
      document.addEventListener("mouseout", onDocOut, true);
    };
    const disarmDoc = () => {
      docArmed = false;
      document.removeEventListener("pointerover", onDocPointer, true);
      document.removeEventListener("pointermove", onDocPointer, true);
      document.removeEventListener("mouseout", onDocOut, true);
    };
    const onDragEnd = (e: DragEvent) => {
      // Chromium was never seen reporting a dragend at 0,0 (0 of 1021 logged). The guard stays as a
      // safety for an unknown position: the flag stays as it is there.
      if (e.clientX !== 0 || e.clientY !== 0) {
        const drop = document.elementFromPoint(e.clientX, e.clientY);
        finePointerOver = drop !== null && el !== undefined && el.contains(drop);
      }
      armDoc();
      requestAnimationFrame(recheck);
    };
    const recheck = () => {
      if (!el || still || pressed()) return;
      const a = document.activeElement;
      if (!a || !el.contains(a) || !a.matches(":focus-visible")) return;
      // A mouse or pen over the ticker keeps it moving under the pointer (rounds 3 and 4).
      if (finePointerOver) return;
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
    // A touch leaves the window after its release, while a mouse may still rest over it: only a mouse
    // or pen leaving clears the flag.
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== "touch") finePointerOver = false;
      requestAnimationFrame(recheck);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerup", onRelease);
    document.addEventListener("pointercancel", onRelease);
    el?.addEventListener("focusin", onFocusIn);
    el?.addEventListener("focusout", onFocusOut);
    el?.addEventListener("pointerdown", onPress);
    el?.addEventListener("pointerleave", onLeave);
    el?.addEventListener("pointerover", onFinePointer);
    el?.addEventListener("pointerenter", onFinePointer);
    el?.addEventListener("pointermove", onFinePointer);
    el?.addEventListener("dragend", onDragEnd);
    el?.addEventListener("contextmenu", onAbandon);
    addEventListener("blur", onAbandon);
    // A focus made before this script ran (keyboard, before hydration) gets the still layout.
    requestAnimationFrame(recheck);
    return () => {
      clearTimeout(releaseTimer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerup", onRelease);
      document.removeEventListener("pointercancel", onRelease);
      el?.removeEventListener("focusin", onFocusIn);
      el?.removeEventListener("focusout", onFocusOut);
      el?.removeEventListener("pointerdown", onPress);
      el?.removeEventListener("pointerleave", onLeave);
      el?.removeEventListener("pointerover", onFinePointer);
      el?.removeEventListener("pointerenter", onFinePointer);
      el?.removeEventListener("pointermove", onFinePointer);
      el?.removeEventListener("dragend", onDragEnd);
      el?.removeEventListener("contextmenu", onAbandon);
      removeEventListener("blur", onAbandon);
      disarmDoc();
    };
  });

  // P1-87 PR 8a, item 7: a line the last render did not have is new, and slides in for FEED_MS. The
  // first render marks nothing; `known` (plain, not state) holds the keys the page last rendered.
  let known: Set<string> | null = null;
  // A refresh adds its new lines to `fresh`, and each line has its own timer, restarted when the line
  // is new again, so a second refresh within FEED_MS never cuts a slide short (P1-87 minors, #2166).
  let fresh = $state<Set<string>>(new Set());
  const freshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  $effect.pre(() => {
    const keys = v.lately.lines.map((l) => l.key);
    const prev = known;
    known = new Set(keys);
    if (prev === null) return;
    const added = keys.filter((k) => !prev.has(k));
    if (added.length === 0) return;
    fresh = new Set([...untrack(() => fresh), ...added]);
    for (const k of added) {
      clearTimeout(freshTimers.get(k));
      freshTimers.set(
        k,
        setTimeout(() => {
          freshTimers.delete(k);
          const left = new Set(fresh);
          left.delete(k);
          fresh = left;
        }, FEED_MS),
      );
    }
  });
  // P1-87 PR 5a: the nightly bar's clock. Until the page mounts, the view's own instant
  // is the clock, so the server render says what the view says; then the clock moves the
  // marker once a minute and the bar re-reads the snapshot while the run is writing.
  // The view is made on the server's clock, so the page's clock carries the offset
  // between the two, read once at mount (P1-87 PR 5a, review round 1).
  let clock = $state<number | null>(null);
  let offsetMs = 0;
  const nowMs = $derived(clock ?? Date.parse(v.cycle.nowIso));
  const marker = $derived(
    v.cycle.marker === null
      ? null
      : clock === null
        ? v.cycle.marker
        : markerAt(v.cycle, v.cycle.windowEndIso, clock),
  );
  const cycleRunning = $derived(v.cycle.steps.some((x) => x.state === "running"));
  onMount(() => {
    markIntroPlayed();
    motionReady = true;
    // P1-87 minors, #2164: the intro's timer starts once the page is visible. A page loaded in a
    // background tab holds its CSS animations until it is shown, so a timer started at mount would
    // cut the bars' fill short (shown 0.3 to 2 s later) or drop it (shown later still). The intro
    // waits instead, and plays whole when the tab is first shown. A re-read the cycle clock asks
    // for while the intro is on (a tab shown with its view due, which the clock re-reads on that
    // show, or due within the intro) waits for the intro's end, so a re-read never inserts a row
    // or a figure under it (F2: a refresh plays no intro on what it inserts).
    let introTimer: ReturnType<typeof setTimeout> | undefined;
    let rereadHeld = false;
    const endIntro = () => {
      intro = false;
      if (rereadHeld) {
        rereadHeld = false;
        void invalidate("cockpit:snapshot");
      }
    };
    const startIntro = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", startIntro);
      introTimer = setTimeout(endIntro, INTRO_MS);
    };
    document.addEventListener("visibilitychange", startIntro);
    startIntro();
    offsetMs = Date.parse(v.cycle.nowIso) - Date.now();
    clock = Date.now() + offsetMs;
    const cycle = startCycleClock({
      getView: () => v.cycle,
      nowMs: () => Date.now() + offsetMs,
      isVisible: () => document.visibilityState === "visible",
      listenVisible: (handler) => {
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
      },
      invalidate: () => {
        if (!intro) return invalidate("cockpit:snapshot");
        rereadHeld = true;
        return Promise.resolve();
      },
      onTick: (t) => {
        clock = t;
      },
      setInterval,
      clearInterval,
    });
    return () => {
      cycle.stop();
      document.removeEventListener("visibilitychange", startIntro);
      clearTimeout(introTimer);
      for (const t of freshTimers.values()) clearTimeout(t);
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
    {#each v.status.parts as p, i (i)}{i > 0 ? " " : ""}<span data-term={p.term}>
        {#if p.href}<a href={p.href}>{p.text}</a>{:else}{p.text}{/if}
      </span>{/each}
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

<div class="ov-first" data-motion-ready={motionReady ? "true" : undefined}>
  <section class="ov-health" aria-labelledby="ov-health">
    <h2 id="ov-health">
      Fleet health · {v.health.sites}
      {v.health.sites === 1 ? "site" : "sites"}
    </h2>
    <div class="ov-tierbar" aria-hidden="true">
      {#if v.health.tiers.ok > 0}<span class="ov-seg ok" style="flex-grow: {v.health.tiers.ok}">
          {#if allOk}<span class="ov-tier-inside">
              {v.health.tiers.ok} OK · {v.health.tiers.watch} watch · {v.health.tiers.attention} attention
              · {v.health.tiers.broken} broken
            </span>{/if}
        </span>{/if}
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
        plus {#each launching as c, i (i)}{i > 0 ? " and " : ""}<span data-term={c.term}>
            {c.text}
          </span>{/each}
      </p>{/if}
    <h3>Sites passing each check</h3>
    {#snippet checkParts(c: HealthCheck)}
      <span class="ov-check-name">{c.name}</span>
      <span class="ov-check-bar" aria-hidden="true">
        {#if c.pass > 0}<span class="ov-check-fill" style="width: {(100 * c.pass) / c.total}%"
          ></span>{/if}{#if c.unknown > 0}<span
            class="ov-check-unknown"
            style="left: {c.total === 0 ? 0 : (100 * c.pass) / c.total}%; width: {(100 *
              c.unknown) /
              c.total}%"
          ></span>{/if}
      </span>
      <span class="ov-check-count">
        {c.pass}{" "}<span class="visually-hidden">of {c.total}</span>{c.fail > 0
          ? ` · ${c.fail} failing`
          : ""}{c.testFailed > 0
          ? ` · ${c.testFailed} test failed, not yet a verdict`
          : ""}{c.noVerdict > 0 ? ` · ${c.noVerdict} no verdict` : ""}{c.notChecked > 0
          ? ` · ${c.notChecked} not checked`
          : ""}
      </span>
    {/snippet}
    <ul
      class="ov-checks-list"
      data-term="Sites passing each check"
      data-intro={intro ? "" : undefined}
      style="--bar-ms: {BAR_MS}ms; --bar-stagger: {BAR_STAGGER_MS}ms"
    >
      {#each v.health.checks as c, i (c.name)}
        <li class="ov-check" style="--i: {i}">
          <!-- A failing check opens the sites that failed it (P1-87, PR 8b). A bar with none
               stays as it was: no link. -->
          {#if c.fail > 0}
            <a class="ov-check-link" href="/fleet?check={CHECK_SLUGS[c.name]}">
              {@render checkParts(c)}{" "}<span class="visually-hidden">Show them on Sites.</span>
            </a>
          {:else}
            {@render checkParts(c)}
          {/if}
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
    <div class="ov-tiles" data-intro={intro ? "" : undefined} style="--spark-ms: {SPARK_MS}ms">
      {#each v.numbers as n (n.key)}
        {@const long = n.measured && n.value.length > 7}
        <div class="ov-tile">
          <!-- The model's value, for assistive tech from the first render: the figure below counts up
               and is hidden from readers while it does (P1-87 PR 8a, item 4). -->
          <p class="visually-hidden">{n.value}</p>
          <p
            class="ov-num{n.measured ? '' : ' unknown'}{long ? ' long' : ''}"
            aria-hidden="true"
            data-countable={n.measured && countable(n.value) ? "" : undefined}
            use:countUp={{ to: n.value, enabled: intro }}
          >
            <span class="ov-num-final">
              {#if long}
                {@const parts = n.value.split(",")}
                <span>
                  {#each parts as part, i (i)}{#if i > 0},<wbr />{/if}{part}{/each}
                </span>
              {:else}
                {n.value}
              {/if}
            </span><span class="ov-num-count"></span>
          </p>
          <p class="ov-label">{n.label}</p>
          {#if n.context}<p class="muted ov-context">{n.context}</p>{/if}
          {#if n.spark}
            {@const g = sparkGeometry(n.spark)}
            <svg
              class="ov-spark"
              viewBox="0 0 120 24"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {#each g.lines as l, li (li)}<polyline
                  points={l}
                  pathLength="1"
                />{/each}{#each g.dots as d, di (di)}<circle cx={d.x} cy={d.y} r="1.5" />{/each}
            </svg>
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
      <ol data-term="Lately" style="--feed-ms: {FEED_MS}ms">
        {#each v.lately.lines as l (l.key)}
          <li data-new={fresh.has(l.key) ? "" : undefined}>
            <time datetime={l.atIso}><span>{l.whenDate}</span> <span>{l.whenTime}</span></time>
            <span>
              {l.text}{#if l.site !== null}<span aria-hidden="true">{" · "}</span><span
                  class="visually-hidden"
                >
                  {", "}
                </span>{l.site}{/if}
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  <section class="ov-cycle" aria-labelledby="ov-cycle-h" data-term="The nightly audit bar">
    <h2 id="ov-cycle-h">The nightly audit</h2>
    <p class="ov-cycle-line">{v.cycle.line}</p>
    {#if cycleRunning}
      <!-- One pattern per page: the running bars fill with it (decision 1, an SVG pattern,
           not a gradient). -->
      <svg class="ov-cycle-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <pattern
            id="ov-cycle-stripes"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="8" />
          </pattern>
        </defs>
      </svg>
    {/if}
    <ol class="ov-cycle-track">
      {#each v.cycle.steps as step, i (i)}
        <li class="ov-cycle-seg {step.state}">
          <span class="ov-cycle-bar" aria-hidden="true">
            {#if step.state === "running"}<svg
                class="ov-cycle-stripes"
                width="100%"
                height="100%"
                focusable="false"
              >
                <rect width="100%" height="100%" fill="url(#ov-cycle-stripes)" />
              </svg>{/if}
          </span>
          <span class="ov-cycle-name">{step.short}</span><span class="visually-hidden">
            : {step.words}
          </span>
          <!-- The time is read once, in the hidden words after the name (P1-87 PR 5a). -->
          <span class="ov-cycle-time" aria-hidden="true">{step.time ?? ""}</span>
        </li>
      {/each}
      <li class="ov-cycle-seg wait">
        <span class="ov-cycle-bar" aria-hidden="true">
          {#if marker !== null}<span class="ov-cycle-marker" style="left: {marker * 100}%"
            ></span>{/if}
        </span>
        <span class="ov-cycle-name">Next run</span><span class="visually-hidden">,</span>
        <span class="ov-cycle-time">
          <span class="ov-cycle-when">{v.cycle.next.startsAt}</span>
          {#if clock !== null}<span class="ov-cycle-until">
              {untilWords(v.cycle.next.startIso, nowMs)}
            </span>{/if}
        </span>
      </li>
    </ol>
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
      onclick={() => (paused = !paused)}
    >
      Pause the ticker
    </button>
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
      <span data-term="Submissions">
        {v.leads.allTime.submissions}
        {v.leads.allTime.submissions === 1
          ? "submission"
          : "submissions"}{#if v.leads.since}&nbsp;since {v.leads.since}{/if}.
      </span>
      <span data-term="Accepted as real">
        {v.leads.allTime.accepted}
        {v.leads.allTime.accepted === 1 ? "was" : "were"} accepted as real,
      </span>
      <span data-term="Client notified">
        and the client was notified of {v.leads.allTime.notified}.
      </span>
      {#if v.leads.biggest}<span data-term="Biggest share">
          Of the {v.leads.allTime.submissions} submissions, {v.leads.biggest.submissions} ({v.leads
            .biggest.share}%) came from one site, {v.leads.biggest.siteName}, through {v.leads
            .biggest.formKind}; {v.leads.biggest.accepted} of the {v.leads.allTime.accepted} accepted
          {v.leads.biggest.accepted === 1 ? "is" : "are"} from it. Every site's own count is in the table
          below.
        </span>{/if}
    </p>
    <table class="ov-table ov-leads-totals">
      <thead><tr><td></td><th>This month</th><th>All time</th></tr></thead>
      <tbody>
        <tr data-term="Accepted as real">
          <th scope="row">Accepted as real</th><td data-label="This month">
            {v.leads.thisMonth?.accepted}
          </td><td data-label="All time">{v.leads.allTime.accepted}</td>
        </tr>
        <tr data-term="Client notified">
          <th scope="row">Client notified</th><td data-label="This month">
            {v.leads.thisMonth?.notified}
          </td><td data-label="All time">{v.leads.allTime.notified}</td>
        </tr>
        <tr data-term="Screened as spam">
          <th scope="row">Screened as spam</th><td data-label="This month">
            {v.leads.thisMonth?.screened}
          </td><td data-label="All time">{v.leads.allTime.screened}</td>
        </tr>
        <tr data-term="Marked spam by hand">
          <th scope="row">Marked spam by hand</th><td data-label="This month">
            {v.leads.thisMonth?.byHand}
          </td><td data-label="All time">{v.leads.allTime.byHand}</td>
        </tr>
        <tr data-term="Stopped before storage">
          <th scope="row">Stopped before storage</th><td data-label="This month">
            {v.leads.stoppedThisMonth}
          </td><td data-label="All time">
            {v.leads.stoppedAllTime}{#if v.leads.stoppedAsOf}<span class="muted">
                , as of {v.leads.stoppedAsOf}
              </span>{/if}
          </td>
        </tr>
      </tbody>
    </table>
    <h3 data-term="Per site">Per site</h3>
    <table class="ov-table ov-leads-sites" data-term="Per site">
      <thead>
        <tr>
          <th>Site</th><th>Submissions</th><th>Accepted</th><th>Notified</th><th>Screened</th><th>
            By hand
          </th>
        </tr>
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
    <thead>
      <tr>
        <th>Site</th><th data-term="Next report due">Next report due</th><th
          data-term="Waiting for your yes"
        >
          Waiting for your yes
        </th>
      </tr>
    </thead>
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
    {#if v.trends.charts.some((c) => trendGeometry(c).lag.length > 0)}
      <!-- One hatch pattern for the trends: the days Search Console has no data for yet. -->
      <svg class="ov-lag-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <pattern
            id="ov-lag-hatch"
            class="ov-lag-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" />
          </pattern>
        </defs>
      </svg>
    {/if}
    <div class="ov-trends">
      {#each v.trends.charts as c, ci (c.title)}
        {@const g = trendGeometry(c)}
        {@const sel = placeOf(c.nights, keySel[ci])}
        {@const titles = g.slots.map((t) => t.title)}
        {@const shown = sel ?? titles.length - 1}
        {@const hover = hoverSel[ci] ?? null}
        {@const show = hover !== null && hover < g.slots.length ? hover : sel}
        <figure class="ov-trend">
          <figcaption id="ov-trend-{ci}">{c.title}</figcaption>
          {#if c.series.length > 1}
            <ul class="ov-key">
              {#each c.series as s, si (s.name)}
                <li>
                  <svg class="ov-key-mark" viewBox="0 0 16 10" aria-hidden="true">
                    {#if s.bars}<rect
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
                      />{/if}
                  </svg>{s.name}
                </li>
              {/each}
            </ul>
          {/if}
          <!-- P1-87 PR 8a, item 5: the chart is a slider for assistive tech (round 2, n5: no longer an
               image); its keys and its pointer readout are the extra reading, and the table below has
               every night. -->
          <!-- A slider: its value is the key night (the newest when none is), and its text is that
               night's words. Its value is the one announcement: a hover previews a night without it. -->
          <svg
            class="ov-chart"
            viewBox="0 0 {g.width} {g.height}"
            role="slider"
            tabindex="0"
            aria-labelledby="ov-trend-{ci}"
            aria-describedby="ov-trend-{ci}-desc ov-trend-{ci}-hint"
            aria-valuemin="1"
            aria-valuemax={titles.length}
            aria-valuenow={shown + 1}
            aria-valuetext={trendReadout(titles, shown)}
            use:trendKeys={(e: KeyboardEvent) => {
              const next = trendKey(e.key, placeOf(c.nights, keySel[ci]), g.slots.length);
              if (next === undefined) return;
              e.preventDefault();
              setKeyNight(ci, next === null ? null : c.nights[next]!);
            }}
            onblur={() => setKeyNight(ci, null)}
            onpointerleave={() => (hoverSel[ci] = null)}
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
            <text class="ov-tick" x={g.plotLeft - 4} y={g.top + 4} text-anchor="end">
              {tickLabel(c.high)}
            </text>
            {#if c.mid !== null && g.midY !== null}
              <line class="ov-grid" x1={g.plotLeft} x2={g.plotRight} y1={g.midY} y2={g.midY} />
              <text class="ov-tick" x={g.plotLeft - 4} y={g.midY + 4} text-anchor="end">
                {tickLabel(c.mid)}
              </text>
            {/if}
            <text class="ov-tick" x={g.plotLeft - 4} y={g.baseline + 4} text-anchor="end">
              {tickLabel(c.low)}
            </text>
            <text class="ov-tick" x={g.plotLeft} y={g.height - 4}>{c.nights[0]}</text>
            <text class="ov-tick" x={g.plotRight} y={g.height - 4} text-anchor="end">
              {c.nights.at(-1)}
            </text>
            {#each g.bars as b, bi (bi)}
              <path class="ov-bar{b.partial ? ' partial' : ''}" d={b.d} />
            {/each}
            {#each g.lag as l, li (li)}
              <rect
                class="ov-lag"
                fill="url(#ov-lag-hatch)"
                x={l.x}
                y={g.top}
                width={l.width}
                height={g.baseline - g.top}
              />
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
            <!-- P1-87 minors: a mouse's or a pen's hover previews its night (#2169: a pen is a pointer, as a
                 mouse is; a touch has no hover, and its tap is the click). Leaving a night ends its own
                 preview, so a pointer moved off the columns onto the chart's empty area keeps none
                 (#2171). The preview is the chart's, not a pointer's: a leave ends it only while it is
                 the night left, so a pen leaving another night keeps a resting mouse's, and a pen and
                 a mouse on the same night share one preview, which either's leave ends until the
                 other moves. A move over a night with no key
                 night (after Escape, a blur, or a Tab away and back) restores the preview the pointer
                 rests on (#2172); after a key step or a click the readout still follows the key night
                 until the pointer enters another night (round 3 I). -->
            {#each g.slots as t, ti (ti)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <rect
                class="ov-hit"
                x={t.left}
                y={g.top}
                width={t.width}
                height={g.baseline - g.top}
                data-title={t.title}
                onpointerenter={(e) => {
                  if (e.pointerType !== "touch") hoverSel[ci] = ti;
                }}
                onpointermove={(e) => {
                  if (e.pointerType !== "touch" && placeOf(c.nights, keySel[ci]) === null)
                    hoverSel[ci] = ti;
                }}
                onpointerleave={() => {
                  if (hoverSel[ci] === ti) hoverSel[ci] = null;
                }}
                onclick={() => setKeyNight(ci, c.nights[ti]!)}
              />
            {/each}
            {#if show !== null && g.slots[show]}
              <line
                class="ov-trend-cursor"
                x1={g.slots[show]!.x}
                x2={g.slots[show]!.x}
                y1={g.top}
                y2={g.baseline}
              />
            {/if}
          </svg>
          <!-- The visible readout: a hover's night, else the key night. It is hidden from assistive
               tech, which reads the slider's value instead. -->
          <p id="ov-trend-{ci}-readout" class="muted ov-trend-readout" aria-hidden="true">
            {show === null ? TREND_IDLE : trendReadout(titles, show)}
          </p>
          <span id="ov-trend-{ci}-hint" class="visually-hidden">{TREND_IDLE}</span>
          {#if c.note}<p class="muted ov-trend-note">{c.note}</p>{/if}
          <details class="ov-trend-table">
            <summary>As a table</summary>
            <table class="ov-table">
              <thead>
                <tr>
                  <th>{c.slotHeading}</th>{#each c.series as s (s.name)}<th>{s.name}</th>{/each}
                </tr>
              </thead>
              <tbody>
                {#each c.nights as night, pi (pi)}
                  <tr>
                    <th scope="row">{night}</th>
                    {#each c.series as s (s.name)}
                      {@const q = s.points[pi]!}
                      <td data-label={s.name} class={q.value === null ? "unknown" : ""}>
                        {q.value === null ? q.note : q.note ? `${q.value}, ${q.note}` : q.value}
                      </td>
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
