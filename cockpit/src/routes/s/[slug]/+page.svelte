<script lang="ts">
  import type { SiteView, Tile } from "../../../lib/site/view.js";
  import { provideReportUis } from "../../../lib/site/report-ui.svelte.js";
  import ApproveButton from "../../../lib/site/ApproveButton.svelte";
  import WithdrawButton from "../../../lib/site/WithdrawButton.svelte";
  import UnapproveButton from "../../../lib/site/UnapproveButton.svelte";
  import RerenderButton from "../../../lib/site/RerenderButton.svelte";
  import OverrideControl from "../../../lib/site/OverrideControl.svelte";
  import CommentaryEditor from "../../../lib/site/CommentaryEditor.svelte";
  import TriggerRenovateButton from "../../../lib/site/TriggerRenovateButton.svelte";
  import DetailField from "../../../lib/site/DetailField.svelte";
  import SubmissionRow from "../../../lib/submission/SubmissionRow.svelte";
  import "./site.css";
  import "../../../lib/submission/submission.css";

  let { data }: { data: { view: SiteView } } = $props();
  const v = $derived(data.view);
  provideReportUis();
</script>

<svelte:head>
  <title>{data.view.name} — Reddoor maintenance</title>
</svelte:head>

{#snippet tiles(list: Tile[])}
  <div class="tiles">
    {#each list as t (t.label)}
      <div class="tile">
        <div class="tile-value">{t.display}</div>
        <div class="tile-label">{t.label}</div>
        {#if t.sub}<div class="tile-sub">{t.sub}</div>{/if}
      </div>
    {/each}
  </div>
{/snippet}

<h1>{v.name}</h1>
<div class="meta"><a href={v.urlHref}>{v.url}</a></div>
<!-- Consecutive optional blocks are glued together: each one Svelte leaves
     empty still emits the whitespace beside it. -->
{#if v.audited !== null}<div class="audited">
    Last audited {v.audited}
  </div>{/if}{#if v.failingAudits !== null}<div class="audited">
    Lighthouse failing audits: <code>{v.failingAudits}</code>
  </div>{/if}
<div class="setup-line">
  Setup {v.setup.score}/{v.setup.total} — {#if v.setup.missing.length === 0}<span class="setup-ok"
      >complete</span
    >{:else}<span class="setup-missing">Missing: {v.setup.missing.join(", ")}</span>{/if}
</div>
{#if v.alarm}
  <div class="section alarm">
    <h2>{v.alarm.label}</h2>
    <div class="chips">
      {#each v.alarm.chips as chip, i (i)}<span class={chip.cls} title={chip.title ?? undefined}
          >{chip.text}</span
        >{/each}
    </div>
  </div>
{/if}{#if v.pending.length > 0}
  <div class="section pending">
    <h2>Pending your yes ({v.pending.length})</h2>
    <ul class="pending-list">
      {#each v.pending as p (p.id)}
        <li>
          <div class="pending-head">
            <strong>{p.type}</strong> <span class="muted">{p.period}</span>
            <span class={p.preflight.cls} title={p.preflight.title}>{p.preflight.text}</span>
            {#if p.previewHref !== null}<a
                href={p.previewHref}
                rel="noopener noreferrer"
                title="rendered at draft time or at the last refresh preview; edits since then show after the next refresh"
                >draft preview ▸</a
              >{:else}<span class="muted">no preview yet</span>{/if}
            {#if p.rerenderUrl !== null}<RerenderButton url={p.rerenderUrl} />{/if}
            <ApproveButton approve={p.approve} />
            <WithdrawButton reportId={p.id} url={p.withdraw.url} confirmText={p.withdraw.confirm} />
          </div>
          <div class="pending-info">
            {#if p.recipients.missing}<span class="recipients recipients-missing"
                >recipients: none resolve — set the point of contact in the site's details</span
              >{:else}<span class="recipients">{p.recipients.text}</span>{/if}
            <span class="muted">{p.sendLine}</span>
          </div>
          {#if p.checklist}<ul class="checklist" data-checklist-for={p.id}>
              {#each p.checklist.items as item, i (i)}<li class="check-item">
                  <span class="pill {item.cls}" title={item.title}>{item.word}</span>
                  {item.label}{#if item.advisory}{" "}<span class="advisory"
                      >advisory — never blocks</span
                    >{/if}{#if item.note !== null}{" "}<span class="check-note">{item.note}</span
                    >{/if}
                </li>{/each}
            </ul>{/if}{#if p.commentary}<CommentaryEditor
              c={p.commentary}
            />{/if}{#if p.overrideUrl !== null}<OverrideControl
              reportId={p.id}
              url={p.overrideUrl}
            />{/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<div class="section">
  <h2>Lighthouse</h2>
  {#if v.scores === null}
    <div class="empty">
      No lighthouse data yet — run <code>reddoor-maint audit --write-back</code> from the site checkout.
    </div>
  {:else}
    {@render tiles(v.scores)}
  {/if}
</div>

<div class="section">
  <h2>Site Health</h2>
  {#if v.health === null}
    <div class="empty">
      No health data yet — run <code>reddoor-maint audit --write-back</code> from the site checkout.
    </div>
  {:else}
    {@render tiles(v.health)}
  {/if}
</div>

{#if v.advisories.length > 0}
  <div class="section vulns">
    <h2>Vulnerabilities ({v.advisories.length})</h2>
    <ul class="vuln-list">
      {#each v.advisories as a, i (i)}
        <li class="vuln-item">
          <span class="pill sev-{a.severity}">{a.severity}</span>
          <strong>{a.module}</strong>{#if a.dev}{" "}<span class="muted">(dev)</span
            >{/if}{#if a.title !== null}{" "}— {a.title}{/if}{#if a.cves !== null}{" "}<span
              class="muted">({a.cves})</span
            >{/if}{#if a.href !== null}{" "}<a href={a.href} rel="noopener noreferrer">advisory ▸</a
            >{/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<div class="section">
  <h2>Reports</h2>
  {#if v.history.length === 0}
    <div class="empty">No reports yet.</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Completed</th><th>Type</th><th>ID</th><th>GA users</th><th>Search</th><th>Report</th
          ><th></th>
        </tr>
      </thead>
      <tbody>
        {#each v.history as r (r.id)}
          <tr>
            <td>{r.date}</td>
            <td>{r.type}</td>
            <td><code>{r.reportId}</code></td>
            <td
              >{#if r.ga === null}—{:else}{r.ga.current}{#if r.ga.delta !== null}{" "}<span
                    class="muted">({r.ga.delta})</span
                  >{/if}{/if}</td
            >
            <td>{r.search}</td>
            <td
              >{#if r.previewHref !== null}<a href={r.previewHref}>view</a>{:else}<span
                  class="muted">no attachment</span
                >{/if}</td
            >
            <td
              >{#if r.action.kind === "withdrawn"}<span class="muted withdrawn"
                  >Withdrawn {r.action.date}</span
                >{:else if r.action.kind === "approve"}<ApproveButton
                  approve={r.action.approve}
                />{:else if r.action.kind === "approved"}{#if r.action.rerenderUrl !== null}<RerenderButton
                    url={r.action.rerenderUrl}
                  />{/if}
                <UnapproveButton
                  reportId={r.id}
                  url={r.action.unapprove.url}
                  confirmText={r.action.unapprove.confirm}
                />{:else if r.action.kind === "sending"}<span class="muted sending"
                  >Send started {r.action.at}Z</span
                >{/if}</td
            >
          </tr>
          {#if r.commentaryRow}
            <tr class="commentary-row"
              ><td colspan="7"
                >{#if r.commentaryRow.editor}<CommentaryEditor
                    c={r.commentaryRow.editor}
                  />{/if}</td
              ></tr
            >
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<div class="section site-details">
  <h2>
    Site details {#if v.details.triggerUrl !== null}<TriggerRenovateButton
        url={v.details.triggerUrl}
      />{/if}
  </h2>
  <dl class="details">
    {#each v.details.rows as row (row.label)}<DetailField {row} url={v.details.url} />{/each}
  </dl>
</div>
{#if v.spam}
  <div class="section spam-screen">
    <h2>Spam screen (30d)</h2>
    {#each v.spam as s (s.label)}
      <div class="spam-kv"><span class="k">{s.label}</span> {s.n}</div>
    {/each}
  </div>
{/if}{#if v.submissions}
  <div class="section submissions">
    <h2>
      Form submissions ({v.submissions
        .total}){#if v.submissions.total > v.submissions.shown.length}<span class="muted"
          >{" "}— showing {v.submissions.shown.length} of {v.submissions.total}</span
        >{/if}
      <a class="subm-viewall" href={v.submissions.viewAllHref}>View all for this site →</a>
    </h2>
    <ul class="subm-list">
      {#each v.submissions.shown as row (row.id)}<SubmissionRow {row} />{/each}
    </ul>
  </div>
{/if}
