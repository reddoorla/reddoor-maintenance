# Test Fixtures

Five minimal SvelteKit-shaped trees used across audit and recipe tests.

| Fixture             | Purpose                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pristine-starter/` | Versions and configs match the baseline. Used to assert audits return `pass`.                              |
| `drifted-configs/`  | Configs are stale and some deps are bumped past the baseline. Used to assert audits surface drift.         |
| `pre-svelte5/`      | `svelte: ^4.x` and matching Svelte-4-era deps. Used by the `svelte-4-to-5` recipe tests.                   |
| `sync-clean/`       | All four `sync-configs` templates already present and matching. Used to assert the recipe returns `noop`.  |
| `sync-drift/`       | None of the templates match (or are missing entirely). Used to assert the recipe applies all four.         |

Fixtures are checked in. Tests copy them to a tempdir before running mutating recipes; audits read them in place.
