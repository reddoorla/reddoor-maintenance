---
"@reddoorla/maintenance": patch
---

github/config: fall back to `gh auth token` when GITHUB_TOKEN is unset (#665)

`readGitHubConfig` returned null whenever `GITHUB_TOKEN` was unset, so the
only way to run the recipes was a token in `credentials.env` — and `gh.ts`
hands that token to `gh` as `GH_TOKEN`, so a set-but-dead file value actively
overrode the keyring `gh auth login` had populated. Every recipe 401'd
(`gh: Bad credentials`) on a machine where `gh` itself was authenticated the
whole time, and the workaround — a file COPY of the keyring token — goes
stale on the next `gh auth login/refresh/logout`.

When `GITHUB_TOKEN` is unset or blank the token now comes from
`gh auth token`, run with `GITHUB_TOKEN` and `GH_TOKEN` stripped from the
child env (gh echoes either back when set, which is how the original failure
was misdiagnosed once). A thrown or empty result is still null — the
"not configured" signal every consumer already understands. Nothing pings an
endpoint to validate the token: a fine-grained token can be refused by
`/user` and still work for the calls it is scoped to. The spawn is injected
so the suite never shells out. `GITHUB_TOKEN` may now be left out of
`credentials.env`, and the setup docs say so.
