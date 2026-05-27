---
"@reddoorla/maintenance": patch
---

fix(codemod, audit): dollar-restprops trailing-comma corruption + a11y spawn timeout

**Codemod (`dollar-restprops`):** when the input `$props()` destructuring had a multi-line shape with a trailing comma (`{ foo, bar, }`), the codemod's `${trimmed}, ...rest` template emitted `bar,, ...rest` — invalid syntax. Surfaced when running init against caltex on 2026-05-27: Accordian.svelte was committed with a double comma and ESLint/prettier choked. Fix strips any trailing comma before insertion; new regression test pins both the plain-JS and TS-annotated forms.

**a11y audit:** spawn was inheriting the shared 30 s default from `runAudits`. On cold trees, playwright needs to download Chrome + boot the dev server, easily 2-3 min — same failure mode the lighthouse audit had before its 5-min override. a11y now gets the same `timeoutMs: 5 * 60_000` treatment.

Both bugs surfaced in the same `init` smoke test run; bundling them since they're equally small + same severity (both rendered the chain unable to complete cleanly on a real site).
