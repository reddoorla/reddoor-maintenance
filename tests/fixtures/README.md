# Test Fixtures

Three minimal SvelteKit-shaped trees used across audit and recipe tests.

| Fixture             | Purpose                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `pristine-starter/` | Versions and configs match the baseline. Used to assert audits return `pass`.                      |
| `drifted-configs/`  | Configs are stale and some deps are bumped past the baseline. Used to assert audits surface drift. |
| `pre-svelte5/`      | `svelte: ^4.x` and matching Svelte-4-era deps. Used by the `svelte-4-to-5` recipe tests.           |

Fixtures are checked in. Tests copy them to a tempdir before running mutating recipes; audits read them in place.
