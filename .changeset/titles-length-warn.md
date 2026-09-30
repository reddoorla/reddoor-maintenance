---
"@reddoorla/maintenance": patch
---

The browser audit's titles check no longer fails a page for a long `<title>`. Length is measured without the brand suffix the sampled pages share (e.g. " | Gallery Sonder"), and a title still over 70 characters is a warning in the audit's note and `titleLengthWarnings`, not a "Page Titles & Meta" fail. Empty titles, missing meta descriptions and duplicate titles still fail.
