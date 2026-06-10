# Autonomy contract

How the AI agent (Claude) operates on this repo and the Reddoor fleet with
reduced human intervention. The goal is to drive well-specified milestones
PR-by-PR to green **without per-step approval**, while keeping every
unattended action either reversible or caught by a gate before it can do harm.

This is a **behavioral contract**, not a security boundary. The
`.claude/settings.json` allowlist (see "Permissions" below) reduces prompt noise
and declares intent; it is not a sandbox. The binding controls are (a) the agent
following this contract, (b) CI being required on `main`, and (c) the one
irreversible action — publishing to npm — happening only via a human-merged
release PR + the OIDC release workflow, never an ad-hoc command.

## The model: autonomy scales with reversibility, not permissions

A bad merge to `main` is `git revert`. A bad **`npm publish`** propagates to the
whole fleet (~12 → 200 sites consume `@reddoorla/maintenance` via Renovate) and
cannot be cleanly unpublished. That single chokepoint — changeset → version PR →
**human-merged** release → OIDC publish — is most of the safety. Everything
upstream of it is reversible, so it can move fast.

## Blast-radius tiers

### 🟢 GREEN — fully autonomous, no prompt

Local + reversible-remote. The agent does these freely:

- Edits, branches, commits, push to **feature** branches, PR **create**.
- **Merge of any non-release PR** that is CI-green and adversarial-review-clean
  (see Merge authority).
- Reads of Airtable / GitHub / the fleet; running audits, builds, tests, lint,
  typecheck, `changeset` (authoring, not publishing), the review workflows.

### 🟡 YELLOW — autonomous behind a stronger gate, logged + reversible

- Airtable **writes** (idempotent, restorable) from the audit pipeline.
- Behavior-changing `feat` merges — allowed unattended **only** when CI is green
  AND a 3-lens adversarial review is clean. Logged in the journal so the arc is
  reviewable after the fact.

### 🔴 RED — never autonomous (human checkpoint, every time)

- `npm publish` / `pnpm publish` / `changeset publish`, and **merging a
  `chore(release): version packages` PR** (that is what triggers the publish).
- Production deploys (client Netlify sites; the agent touches them via PRs, never
  direct deploys).
- Secrets (`gh secret set`), branch-protection / org / billing changes.
- **Fleet-wide mutations** — any operation that changes more than one client repo
  in one go (a codemod, a `sync-configs` sweep) lands as **per-repo PRs for
  review**, never an unattended mass push.
- History rewrites (force-push, `reset --hard` on shared branches), deletes of
  data the agent did not create.

## Merge authority (current policy: "everything but releases")

The agent may **auto-merge any PR** once it is CI-green and adversarial-review
clean — including behavior-changing `feat`s — **except**:

- `chore(release): version packages` / any release PR → **always human**.
- Any PR that itself performs a RED action → **always human**.

Squash-merge, delete the branch, and append a journal entry. Patch/`fix` PRs need
no separate sign-off; `feat`s get the 3-lens review before merge.

## Stop conditions — pause regardless of permissions

The agent stops and asks when it hits:

1. A genuine **product / direction / design fork** (what a feature _is_, which
   milestone matters) — these are not the agent's to decide.
2. Any **RED** action.
3. **CI failing > 2 times** on the same change without a clear fix — stop
   thrashing, report, and ask.
4. Anything that **deletes data or rewrites history**.
5. **Scope creep** beyond the agreed milestone — finish the scope, don't expand
   it unprompted.
6. A finding that contradicts how something was described (surface it, don't
   "fix" past it).

## The working loop

Every change follows the same loop, which is what makes broad merge authority
safe:

1. **TDD** — red test first, watch it fail, minimal green, refactor.
2. **Adversarial review** — fresh subagents/workflow review the diff across
   distinct lenses; **every real finding is folded in before merge** (this loop
   has caught a Ctrl-C regression, a stale-`dist` hole, and a misleading-error
   gap in recent work).
3. **Small, single-purpose PRs** — one concern each, so any one is revertable
   without unwinding the arc.
4. **Journal** — append what + why to [`docs/autonomy-journal.md`](docs/autonomy-journal.md)
   so the whole run is reviewable fast.

## Permissions & sandbox

`.claude/settings.json` (local, gitignored) encodes these tiers as allow / ask /
deny rules: GREEN commands are `allow`ed (a broad `Bash(*)`, so command _shape_ —
e.g. `&&`-chains — never reintroduces prompts); RED commands are in `ask`
(publish / release / deploy / secrets — forces a prompt, so they pause for a human
while the operator is away) or `deny` (force-push, `reset --hard`, `rm -rf`,
credential reads — blocked).

The OS-level **sandbox is enabled** (`sandbox.enabled: true`, macOS Seatbelt;
enabled purely via settings — the `/sandbox` panel is a terminal TUI the VS Code
extension doesn't render, and isn't required). It contains every Bash subprocess:
`pnpm install` / `build` / `test` and the dependency code they run get filesystem
access limited to the project + caches (`~/Library/pnpm`,
`~/Library/Caches/ms-playwright`, `~/.npm`) and network limited to an allowlist
(github, npm, airtable, googleapis, resend). This closes the supply-chain hole — an
auto-merged Renovate dependency can't read `~/.ssh` / `~/.aws`, escape the workdir,
or phone home off-allowlist. Two conventions keep the workload functional under it:

- **`gh` is in `excludedCommands`** — Go-based CLIs fail TLS verification under
  Seatbelt (per the docs), so `gh` runs unsandboxed.
- **Audits run with the Bash `dangerouslyDisableSandbox` flag** — they fetch
  arbitrary deployed client domains (incompatible with a tight egress allowlist,
  and a partial allowlist would corrupt scores). An audit is a read-only public
  fetch, so this is low-risk.

Limits (from the docs, not hedging): the proxy filters by hostname without TLS
inspection, so a broad allow like `github.com` is domain-frontable — strong
risk-_reduction_, not a vault. `Bash(*)` also lets the agent self-escape via
`dangerouslyDisableSandbox`, so the sandbox is a hard wall for
**subprocesses/dependencies** and a soft one for the agent (the contract is the
agent's control). For a true hard wall around the agent too, run it in a dev
container / VM.
