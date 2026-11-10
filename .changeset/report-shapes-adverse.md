---
"@reddoorla/maintenance": patch
---

`scripts/gen-report-shapes.mts` also writes two adverse report fixtures, `adverse-unmeasured.json` and `adverse-blocked.json`. They are runs of today's producer whose stubbed dependencies drive the branches the five shapes never reach: a stage that ran and failed, an unmeasured robots.txt, a robots.txt that blocks GPTBot, a sitemap with a real URL count, and a category probe that died, so `attempted` differs from `answered` (#893). The five existing fixtures come out byte-identical. The generator now refuses to write an adverse file that no longer reaches its branch (a skip in place of the failure, a robots read that no longer blocks), and its `http` stub carries the `error: null` the producer's type requires, a type error `tsc` never saw because `scripts/` is outside `tsconfig.json`'s `include`.
