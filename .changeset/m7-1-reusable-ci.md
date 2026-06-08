---
"@reddoorla/maintenance": minor
---

feat(M7.1): sync-configs `ci` + `renovate-config` templates become thin shims

The `ci` workflow template is now a ~6-line caller of the org reusable workflow
(`reddoorla/.github/.github/workflows/ci.yml@<sha> # v1.0.0`), and `renovate.json` is a
3-line shim that `extends` the org preset (`github>reddoorla/.github:renovate-config`).
The canonical CI gate and dependency policy now live once in `reddoorla/.github`;
Renovate keeps the SHA current. `self-updating` requires the new `ci / ci` check context.
