<script lang="ts">
  import type { SubmissionRow } from "../../../../src/reports/submission-row.js";
  import { relativeTimeFromNow } from "../../../../src/dashboard/relative-time.js";
  import { safeUrl } from "../../../../src/util/html.js";
  import StatusButton from "./StatusButton.svelte";
  import {
    spamReasonTokens,
    reasonChipText,
    fanoutFailures,
    extraFields,
    bounceView,
    spamDetail,
    statusUrl,
  } from "./row.js";

  // A submission row's content WITHOUT the <li>: the /submissions page wraps it
  // with a site link, and <ul> may only contain <li>.
  let { s }: { s: SubmissionRow } = $props();

  const url = $derived(statusUrl(s.id));
  const reasons = $derived(spamReasonTokens(s.spamReason));
  const bounce = $derived(bounceView(s));
  const fanoutBad = $derived(fanoutFailures(s.fanoutStatus));
  const extra = $derived(extraFields(s.extraFields));
  const spam = $derived(spamDetail(s));
  const bounceKinds = $derived([s.bounceType, s.bounceSubType].filter((x) => !!x).join(" / "));
</script>

{#snippet kv(label: string, value: string | number | null | undefined)}
  {#if value !== null && value !== undefined && value !== ""}<div class="subm-kv">
      <span class="k">{label}</span>{" "}{String(value)}
    </div>{/if}
{/snippet}

<details>
  <summary class="subm-head"
    ><strong>{s.formType}</strong> · {s.name || "(no name)"}{" "}<span class="muted"
      >{s.email || ""}</span
    >{" "}<span class="pill subm-{s.status}">{s.status}</span
    >{#if s.status === "spam_auto" && s.spamScore !== null && s.spamScore !== undefined}{" "}<span
        class="subm-provenance"
        title={s.spamReason ?? ""}>auto-spam · {String(s.spamScore)}</span
      >{#if reasons.length > 0}{" "}<span class="subm-reasons">{reasonChipText(reasons)}</span
        >{/if}{/if}{#if bounce}{" "}<span
        class={bounce.acked ? "subm-bounce acked" : "subm-bounce"}
        title={bounce.title}>{bounce.text}</span
      >{/if}{#if fanoutBad.length > 0}{" "}<span
        class="subm-fanout-fail"
        title="This signup did not reach every configured destination"
        >fan-out: {fanoutBad.join(" · ")}</span
      >{/if}{" "}<span class="muted"
      >{s.submittedAt ? relativeTimeFromNow(s.submittedAt) : "—"}</span
    ></summary
  >
  <div class="subm-detail">
    <!-- No whitespace between the rows: the old renderer joined them with "". -->
    {@render kv("Phone", s.phone)}{#if s.message}<div class="subm-kv">
        <span class="k">Message</span>
      </div>
      <div class="subm-msg">{s.message}</div>{/if}{#if s.sourceUrl}<div class="subm-kv">
        <span class="k">Source</span>{" "}<a href={safeUrl(s.sourceUrl)} rel="noopener noreferrer"
          >{s.sourceUrl}</a
        >
      </div>{/if}{@render kv("UTM", s.utm)}{#if extra?.kind === "raw"}<div class="subm-kv">
        <span class="k">Extra fields</span>{" "}<code>{extra.raw}</code>
      </div>{:else if extra?.kind === "pairs"}{#each extra.pairs as [k, v], i (i)}<div
          class="subm-kv"
        >
          <span class="k">{k}</span>{" "}{v}
        </div>{/each}{/if}{@render kv("Spam", spam)}{@render kv(
      "Notify",
      s.notifyStatus,
    )}{@render kv("Bounce", bounceKinds)}{@render kv(
      "Bounce message",
      s.bounceMessage ?? null,
    )}{@render kv("Bounce acknowledged", s.bounceAckAt ?? null)}{@render kv(
      "Fan-out",
      s.fanoutStatus ?? null,
    )}{@render kv("Resend ID", s.resendMessageId)}{@render kv("Submission #", s.submissionId)}
  </div>
</details>
<div class="subm-actions">
  {#if s.status === "spam_auto"}<StatusButton
      id={s.id}
      {url}
      action={{ status: "new" }}
      label="Not spam → new"
    />{/if}{#if s.notifyStatus === "bounced" && !bounce?.acked}<StatusButton
      id={s.id}
      {url}
      action={{ ack: "notify-bounce" }}
      label="Not dead — acknowledge"
    />{/if}<StatusButton id={s.id} {url} action={{ status: "read" }} label="Read" /><StatusButton
    id={s.id}
    {url}
    action={{ status: "archived" }}
    label="Archive"
  /><StatusButton id={s.id} {url} action={{ status: "spam" }} label="Spam" />
</div>
