<script lang="ts">
  import type { CommentaryView } from "./view.js";

  let { c }: { c: CommentaryView } = $props();
  // What the server last accepted. A blur saves only when the text differs, and
  // a successful save moves the baseline, so a later focus+blur does not repost.
  // svelte-ignore state_referenced_locally
  let saved = c.text;
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
