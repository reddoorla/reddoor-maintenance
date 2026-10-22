<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { postAction } from "../post.js";
  import { keepValue, keptValue } from "../view-keep.js";
  import type { CommentaryView } from "./view.js";
  import { mounted } from "../mounted.svelte.js";

  let { c: mountedC }: { c: CommentaryView } = $props();
  // The text it mounted with, as DetailField: a refresh in place must not write
  // the stored text over an edit whose save failed. A fresher stored text is
  // taken by hand, below, only while the editor holds nothing of the operator's.
  // svelte-ignore state_referenced_locally
  const c = mountedC;
  // What the server last accepted, as a textarea shows it: a browser exposes
  // CR LF as LF, so stored CRLF text must not read as an edit (the old page
  // compared against `defaultValue`, which the parser had normalised). A blur
  // saves only when the text differs, and a successful save moves the baseline.
  // svelte-ignore state_referenced_locally
  let saved = c.text.replace(/\r\n?/g, "\n");
  // Text not yet saved, or whose save failed, and the mark, carry over a remount
  // for a change in the store, as DetailField's do (lib/view-keep.ts).
  const keepName = `commentary:${c.id}`;
  const kept = keptValue<{ text: string | null; mark: string } | null>(keepName, null);
  let mark = $state(kept?.mark ?? "");
  onDestroy(
    keepValue(keepName, () => {
      const t = document.getElementById(`commentary-${c.id}`);
      const text = t instanceof HTMLTextAreaElement && t.value !== saved ? t.value : null;
      return text === null ? null : { text, mark };
    }),
  );
  // Disabled until the blur handler exists, so an edit is never lost silently.
  const m = mounted();
  // A refresh in place brings the stored text: taken unless the editor holds
  // unsaved text or a failed save; a ✓ about the old text goes (review round 5).
  $effect(() => {
    const live = mountedC.text;
    untrack(() => {
      const t = document.getElementById(`commentary-${c.id}`);
      if (!(t instanceof HTMLTextAreaElement) || mark === " ✗" || t.value !== saved) return;
      const stored = live.replace(/\r\n?/g, "\n");
      if (stored === saved) return;
      t.value = stored;
      saved = stored;
      mark = "";
    });
  });

  function onblur(e: FocusEvent & { currentTarget: HTMLTextAreaElement }) {
    const t = e.currentTarget;
    if (t.value === saved) return;
    postAction(c.url, {
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
    disabled={!m.ready}
    value={kept?.text ?? c.text}
    {onblur}></textarea><span class="commentary-saved" data-for={c.id}>{mark}</span>
</div>
