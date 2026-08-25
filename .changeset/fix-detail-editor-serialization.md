---
"@reddoorla/maintenance": patch
---

Fix: the site editor's checkbox and multi-select could not save.

#591 added `Require Turnstile` (a checkbox) and `Accepted Watch Conditions` (a
multi-select) to the dashboard site editor. Both rendered correctly and neither
could actually save, because the inline script posted `el.value`:

- a checkbox's `.value` is its `value` content attribute (`"on"` by default),
  never the checked state — and its listener was the text-input one, guarded by
  `value !== defaultValue`, which for a checkbox compares `"on"` to `"on"`, so it
  never fired at all;
- a `multiple` select's `.value` is the first selected option only, so all but
  one accepted condition would have been silently dropped.

The serializer is now a named function exported as source, so tests execute the
exact text the page serves — the inline script is a template string and the suite
runs without a DOM, which is why nothing caught this. Checkboxes bind on `change`
and are excluded from the blur path.
