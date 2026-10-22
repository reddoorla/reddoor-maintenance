<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { postAction } from "../post.js";
  import { keepValue, keptValue } from "../view-keep.js";
  import type { DetailRowView } from "./view.js";
  import { mounted } from "../mounted.svelte.js";

  let { row: mountedRow, url: mountedUrl }: { row: DetailRowView; url: string } = $props();
  // The field renders the row it mounted with: binding the live prop would let a
  // refresh in place write the stored value over an edit whose save failed
  // (Svelte sets a hydrated input's value on its first update), and the retry
  // on the next blur would have nothing to send. A fresher stored value is
  // taken by hand instead (`follow`, below), only into a field the operator
  // has nothing of their own in.
  // svelte-ignore state_referenced_locally
  const row = mountedRow;
  // svelte-ignore state_referenced_locally
  const url = mountedUrl;

  // An edit not yet saved, or whose save failed, and the last save's mark, carry
  // over a remount for a change in the store (lib/view-keep.ts): what the
  // operator typed stays, with its ✗, and the next blur still retries it.
  const fieldName = row.kind === "readonly" ? row.label : row.field;
  const keepName = `detail:${url}:${fieldName}`;
  const kept = keptValue<{ value: string | null; mark: string } | null>(keepName, null);
  let mark = $state(kept?.mark ?? "");
  // Disabled until the save handlers exist, so an edit is never lost silently.
  const m = mounted();
  // What the server last accepted, for the controls that save on blur. A save
  // needs BOTH a real edit gesture and a value that differs from it: a date input
  // handed a value it cannot represent rewrites `.value` on its own, and an
  // untouched tab-through must never post that as a clear. Kept as a textarea
  // shows it: a browser exposes stored CR LF as LF (the old page compared
  // against `defaultValue`, which the parser had normalised).
  // svelte-ignore state_referenced_locally
  let saved =
    row.kind === "input" || row.kind === "date" || row.kind === "textarea"
      ? row.value.replace(/\r\n?/g, "\n")
      : "";
  let edited = kept?.value != null;
  onDestroy(
    keepValue(keepName, () => {
      const el = document.getElementById(`detail-${fieldName}`);
      const typed =
        edited &&
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        el.type !== "password" &&
        el.value !== saved
          ? el.value
          : null;
      // The mark travels only with the edit it is about: a ✓ or ✗ kept on its
      // own would read as a verdict on whatever the store now holds.
      return typed === null ? null : { value: typed, mark };
    }),
  );

  // A refresh in place (the read after the page's own post, which can carry
  // another writer's change too) brings the stored value: the field takes it
  // unless it holds an edit not yet saved or a save that failed. A value that
  // changed under a ✓ drops the ✓, which was about the old one (review round 5).
  $effect(() => {
    const live = mountedRow;
    untrack(() => follow(live));
  });
  function follow(live: DetailRowView): void {
    if (live.kind === "readonly" || live.kind === "secret" || mark === " ✗") return;
    const el = document.getElementById(`detail-${fieldName}`);
    if (live.kind === "input" || live.kind === "date" || live.kind === "textarea") {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
      if (edited && el.value !== saved) return;
      const stored = live.value.replace(/\r\n?/g, "\n");
      if (stored === saved) return;
      el.value = stored;
      saved = stored;
      mark = "";
    } else if (live.kind === "checkbox") {
      if (el instanceof HTMLInputElement && el.checked !== live.checked) {
        el.checked = live.checked;
        mark = "";
      }
    } else if (el instanceof HTMLSelectElement) {
      const want = (o: HTMLOptionElement) =>
        live.kind === "multi" ? live.selected.includes(o.value) : o.value === live.current;
      let moved = false;
      for (const o of el.options) {
        if (o.value === "" && live.kind === "select") continue;
        if (o.selected !== want(o)) {
          o.selected = want(o);
          moved = true;
        }
      }
      if (moved) mark = "";
    }
  }

  /** The string the control POSTs. A checkbox's `.value` is its content
   *  attribute, never the checked state, and a multiple select's `.value` is its
   *  first selection only; both shipped broken once (#591). */
  function detailValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
    if (el instanceof HTMLInputElement && el.type === "checkbox")
      return el.checked ? "true" : "false";
    if (el instanceof HTMLSelectElement && el.multiple)
      return Array.from(el.selectedOptions)
        .map((o) => o.value)
        .join(",");
    return el.value;
  }

  function save(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, field: string) {
    return postAction(url, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ field, value: detailValue(el) }),
    })
      .then((r) => {
        mark = r.ok ? " ✓" : " ✗";
        // Only on success: a failed save stays dirty so the next blur retries it.
        // Selects save on change and keep no baseline.
        if (r.ok && !(el instanceof HTMLSelectElement)) saved = el.value;
      })
      .catch(() => {
        mark = " ✗";
      });
  }

  function onchange(e: Event & { currentTarget: HTMLInputElement | HTMLSelectElement }) {
    if (row.kind !== "readonly") void save(e.currentTarget, row.field);
  }

  function oninput() {
    edited = true;
  }

  function onblur(e: FocusEvent & { currentTarget: HTMLInputElement | HTMLTextAreaElement }) {
    if (row.kind === "readonly") return;
    if (edited && e.currentTarget.value !== saved) void save(e.currentTarget, row.field);
  }
</script>

{#if row.kind === "readonly"}
  <div class="detail">
    <dt>{row.label}</dt>
    <dd>{mountedRow.kind === "readonly" ? mountedRow.display : row.display}</dd>
  </div>
{:else}
  <div class={row.kind === "multi" || row.kind === "textarea" ? "detail wide" : "detail"}>
    <dt><label for="detail-{row.field}">{row.label}</label></dt>
    <dd>
      {#if row.kind === "select"}
        <select
          id="detail-{row.field}"
          data-detail-field={row.field}
          data-details-url={url}
          disabled={!m.ready}
          {onchange}
          >{#if row.current === null || !row.options.includes(row.current)}<option
              value=""
              disabled
              selected
              hidden>— select —</option
            >{/if}{#each row.options as o (o)}<option value={o} selected={o === row.current}
              >{o}</option
            >{/each}</select
        >
      {:else if row.kind === "multi"}
        <select
          multiple
          id="detail-{row.field}"
          data-detail-field={row.field}
          data-details-url={url}
          disabled={!m.ready}
          {onchange}
          >{#each row.options as o (o)}<option value={o} selected={row.selected.includes(o)}
              >{o}</option
            >{/each}</select
        >
      {:else if row.kind === "checkbox"}
        <input
          type="checkbox"
          id="detail-{row.field}"
          data-detail-field={row.field}
          data-details-url={url}
          disabled={!m.ready}
          checked={row.checked}
          {onchange}
        />
      {:else if row.kind === "secret"}
        <!-- No value: the stored credential never reaches the page. -->
        <input
          type="password"
          autocomplete="off"
          id="detail-{row.field}"
          data-detail-field={row.field}
          data-details-url={url}
          disabled={!m.ready}
          placeholder={row.placeholder}
          {oninput}
          {onblur}
        />
      {:else if row.kind === "textarea"}
        <textarea
          id="detail-{row.field}"
          data-detail-field={row.field}
          data-details-url={url}
          disabled={!m.ready}
          value={kept?.value ?? row.value}
          {oninput}
          {onblur}></textarea>
      {:else}
        <input
          type={row.kind === "date" ? "date" : "text"}
          id="detail-{row.field}"
          data-detail-field={row.field}
          data-details-url={url}
          disabled={!m.ready}
          value={kept?.value ?? row.value}
          {oninput}
          {onblur}
        />
      {/if}<span class="detail-saved" data-for={row.field}>{mark}</span>
    </dd>
  </div>
{/if}
