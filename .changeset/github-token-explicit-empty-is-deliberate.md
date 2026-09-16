---
"@reddoorla/maintenance": patch
---

github/config: an explicitly EMPTY `GITHUB_TOKEN` means "no token", and stops falling through to the `gh` keyring (#665 follow-up)

`readGitHubConfig` resolved its token as
`process.env.GITHUB_TOKEN?.trim() || ghAuthToken()`. The empty string is falsy,
so `GITHUB_TOKEN=""` — a deliberate "use no token", written by a shell, an env
block, or a test's `vi.stubEnv` — reached straight past the operator to the
keyring and silently resolved a token anyway.

That made the token gate depend on ambient machine state: the same code was
"configured" on a laptop where `gh auth login` had been run and "unconfigured"
on a CI runner that had never logged in. `tests/cli/prismic-ci-command.test.ts`
stubs `GITHUB_TOKEN` empty precisely so the gate it lands on next is
deterministic, and it therefore passed in CI and failed on every developer
machine with `gh` logged in — a class of defect CI is structurally incapable of
seeing, because reproducing it needs a keyring the runner does not have.

`GITHUB_TOKEN` now has three states rather than two: absent asks
`gh auth token`, a value wins outright, and the empty string resolves to null
without consulting `gh` at all. Whitespace-only still falls through to the
keyring — `GITHUB_TOKEN="   "` is a mis-pasted `credentials.env` line, not an
instruction, and #665 exists so a bad file value cannot override a working
keyring credential.

The new guard in `tests/github/config.test.ts` injects the spawn, so it asserts
`gh` is never asked without needing a keyring — it fails in CI and on a laptop
alike if this regresses.
