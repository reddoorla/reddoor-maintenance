<script lang="ts">
  import type { CommentaryView } from "./view.js";

  let { c }: { c: CommentaryView } = $props();
  // What the server last accepted, as a textarea shows it: a browser exposes
  // CR LF as LF, so stored CRLF text must not read as an edit (the old page
  // compared against `defaultValue`, which the parser had normalised). A blur
  // saves only when the text differs, and a successful save moves the baseline.
  // svelte-ignore state_referenced_locally
  let saved = c.text.replace(/\r\n?/g, "\n");
  let mark = $state("");

  function onblur(e: FocusEvent & { currentTarget: HTMLTextAreaElement }) {
    const t = e.currentTarget;
    if (t.value === saved) return;
    fetch(c.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: t.value }),
    })
      .then((r) => {
        mark = r.ok ? " ✓" : " ✗";
        if (r.ok) saved = t.value;
      })
      .catch(() => {
        mark = " ✗";
      });
  }
</script>

<div class="commentary">
  <label for="commentary-{c.id}"
    >Commentary <span class="muted">(re-rendered into the email at send)</span></label
  ><textarea
    id="commentary-{c.id}"
    data-commentary-for={c.id}
    data-commentary-url={c.url}
    rows="3"
    value={c.text}
    {onblur}></textarea><span class="commentary-saved" data-for={c.id}>{mark}</span>
</div>
