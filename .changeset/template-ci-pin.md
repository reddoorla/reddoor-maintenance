---
"@reddoorla/maintenance": patch
---

Fix the `sync-configs` CI template pinning the reusable workflow three minor versions behind the fleet.

The `ci-action` template pinned `reddoorla/.github/.github/workflows/ci.yml@78c4da64` (v1.0.0) while every fleet repo carries `@4a32c3d0` (v1.3.0). Running `sync-configs` would have silently regressed each repo's CI — including past the v1.3.0 fix that bumps `pnpm/action-setup` for the pnpm 11.12+ self-installer break.
