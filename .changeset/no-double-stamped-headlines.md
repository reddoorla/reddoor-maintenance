---
"@reddoorla/maintenance": patch
---

Never stamp a headline onto a header that already has one. A header built on the
old baked plate is canvas-sized, so nothing stopped it being stamped — the new
headline printed directly over the baked one and the two overprinted into
unreadable text, which shipped in a real announcement. The headline band is now
measured first: it is empty on a clean-plate header and holds ~62k red px on a
baked one, so such headers are sent as stored and self-heal on the next draft.

Also stops Airtable attachment fields from silently serving a stale file.
Airtable's uploadAttachment endpoint APPENDS, while readers take attachment [0]
— the oldest — so repeated header regeneration stacked four images and kept
sending the first. `uploadAttachment` takes `{ replace: true }`, used for the
site header, which prunes back to the file just uploaded.
