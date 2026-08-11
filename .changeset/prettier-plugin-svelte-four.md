---
"@reddoorla/maintenance": minor
---

Update prettier-plugin-svelte to v4 (resolves 4.1.1). v4 changes Svelte
formatting output — notably it now preserves whitespace inside `<textarea>`
(like `<pre>`) — so any formatting this package's tooling performs on Svelte
files now emits v4 style. This aligns the tool's own plugin with the fleet
baseline in `baseline-versions.ts`, which has advertised `^4.0.1` since #456;
until now the tool itself ran v3 and could fight sites already on v4. This
repo's only .svelte files are prettier-ignored test fixtures, so no source
reformat was needed here.
