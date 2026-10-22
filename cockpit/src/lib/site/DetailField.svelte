<script lang="ts">
  import { postAction } from "../post.js";
  import type { DetailRowView } from "./view.js";
  import { mounted } from "../mounted.svelte.js";

  let { row: mountedRow, url: mountedUrl }: { row: DetailRowView; url: string } = $props();
  // The field shows the row it mounted with. The layout remounts the page when
  // the store changes, so a refresh in place carries these same values; binding
  // the live prop would let that refresh write the stored value over an edit
  // whose save failed (Svelte sets a hydrated input's value on its first
  // update), and the retry on the next blur would have nothing to send.
  // svelte-ignore state_referenced_locally
  const row = mountedRow;
  // svelte-ignore state_referenced_locally
  const url = mountedUrl;

  let mark = $state("");
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
  let edited = false;

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
    <dd>{row.display}</dd>
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
          value={row.value}
          {oninput}
          {onblur}></textarea>
      {:else}
        <input
          type={row.kind === "date" ? "date" : "text"}
          id="detail-{row.field}"
          data-detail-field={row.field}
          data-details-url={url}
          disabled={!m.ready}
          value={row.value}
          {oninput}
          {onblur}
        />
      {/if}<span class="detail-saved" data-for={row.field}>{mark}</span>
    </dd>
  </div>
{/if}
