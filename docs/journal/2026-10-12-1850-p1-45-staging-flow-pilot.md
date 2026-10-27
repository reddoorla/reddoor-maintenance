## 2026-10-12 — The staging flow and kit 3 reach `staging` on vida and mantis; the Renovate rule ships as a proven patch (P1-45, #545, Operator decisions 113 and 116)

The worker for Operator decisions 113, as answered at 17:40Z. The operator's rule:

- Only he promotes `staging` → `main`.
- Renovate's patches and minors fast-track to `main`; its majors go to `staging`.
- Each repo's kit 3 migration lands on `staging` first, one repo at a time.

Where it stands:

- **vida-legacy-foundation** and **mantis-landscaping** are on `staging`, smoke-green against the staging URL, with promotion PRs open: vida-legacy-foundation#101 and mantis-landscaping#44.
- **The Renovate rule** is `docs/patches/2026-10-12-github-renovate-staging-flow.patch`, and the per-repo template is `docs/runbooks/staging-flow.md`.
- **williamson-construction-co** is held until after its 10-14 cutover (116(b)).
- **The three factory-shaped sites** wait for `@reddoorla/maintenance` 0.107.0, which was not on npm at 18:48Z.

**The rulesets are the operator's, and that was not a choice.** A cloud session's GitHub proxy refuses `POST rulesets`, and also `POST git/refs` ("Write access to this GitHub API path is not permitted"). A plain `git push origin <sha>:refs/heads/staging` works, so the branches were created that way. Rulesets are red tier in `AUTONOMY.md` anyway. So each promotion PR names the rulesets to create before the merge. The order matters twice:

- **Before the promotion merge:** a promotion's head _is_ `staging`, and vida has `delete_branch_on_merge` on.
- **After the promotion merge:** `main-gate` runs on `pull_request_target`, which runs `main`'s copy, so requiring it earlier would block the PR that delivers it.

**mantis's `main` was unprotected.** It had no ruleset and read `protected: false`, against `true` on vida as the control. The fleet preset's invariant (3), swept on 09-21, says every default branch Renovate merges into has a required check. mantis was bootstrapped after that sweep. Its promotion PR carries a `main` ruleset, `docs/runbooks/staging-flow/main-ruleset.json`, which is vida's minus its id.

**The Renovate rule was proven by Renovate, not by reading it.**

- **Shape.** It is an opt-in preset, `renovate-staging-flow`, not a change to `renovate-config`, because disabling majors on `main` in a repo with no `staging` would leave majors nowhere. A missing base branch is only a `warn` (`Base branch does not exist - skipping`).
- **Proof.** A draft PR on vida (#99, closed) ran the fleet's own action, with the reddoor-renovate token and `dryRun: full`, in two arms.
  - **With the preset:**
    - The patch and minor group would open on `main` as `renovate/main-all-minor-patch` with the `fast-track` label.
    - Kit 3, adapter 7, the vitest major, lock-file maintenance and a digest would open on `staging`.
    - The open Renovate PRs would be autoclosed and reopened under base-prefixed names.
  - **The control,** the fleet preset alone, saw only `main` and no label.
- **Why it ran in Actions.** A cloud session cannot run Renovate's GitHub platform: `initRepo` calls GraphQL, and the proxy refuses it. The local platform skips base branches (`platform !== "local"`).
- **`renovate-config-validator` proves nothing about update-type names.** A preset with `pinnDigest` validated clean, so the ten names were checked against `allowedValues` in Renovate 44.151.2's source, the version the fleet's action runs. `.github`'s `validate.yml` now holds the preset to its shape, and six mutations turned each of its assertions red.
- **Read from the source:**
  - Grouped PRs take the union of their upgrades' `addLabels`, which is why one rule marks the group.
  - Vulnerability alerts are packageRules with `force: {enabled: true}`. They override the preset's `enabled: false`, so the sharp fixes open on both bases, and only patch or minor ones carry the label.

**`main-gate` took the two review rounds the asking rule allows, then the operator's answer.**

- **Round 1:** `author.login` comes from a commit's email, and the bot's email is published in every repo's `renovate.yml`. The gate now requires `web-flow`-committed, verified commits, and restricts files to manifests. Separately, `|| true` under `pipefail` had swallowed a failed API read.
- **Round 2:** a writer can have GitHub create and sign a bot-authored commit with `PUT contents` and an author override, so no commit metadata proves who pushed.
- **The fix:** the repository activity log. The first version read the whole log and would have failed legitimate PRs. `renovate/npm-sharp-vulnerability` carries a human `branch_deletion` from 09-16, an earlier life of a reused branch name. It now reads back to the latest `branch_creation` only.
- **Answered 116(a):** fix and land, no third round. The final matrix is 18 cases: 5 against real vida PRs, and 13 against a stubbed `gh` that includes a forged push and a previous life.

**Two instruments were wrong before they were right.**

- **Smoke against a remote URL.** The fleet Playwright config always starts a local server, so a throwaway wrapper pointed it at each URL. Its first run failed every test, production included: the browser had never launched, because vida's pinned Playwright wanted a headless shell the image lacks. With `/opt/pw-browsers/chromium-1234` it passed. Staging then matched production on both sites (68 passed on vida, 53 on mantis), and the only failures, the same on both targets, were tests that load `/dev/a11y-fixtures`, which is never deployed.
- **Unit-green while broken.** vida's unit suite was green twice while the change was broken.
  - `src/params.ts` imported `$lib`, which kit 3 resolves outside Vite. The build failed while 765 tests passed.
  - `prismic-barrel.test.ts` read kit 2's generated path, so `built` was false, and its guard skips rather than fails outside CI. CI caught it.

**The defect class the starter's migration did not have.** vida prerenders `robots.txt` and `sitemap.xml`. These, and its layout's hreflang and JSON-LD, read `url.origin`. Kit 2 filled that from `prerender.origin`. Kit 3, with `paths.origin` deliberately unset, would have shipped `http://sveltekit-prerender/sitemap.xml` in production's `robots.txt`. All five now take `siteOrigin`. Built with `URL` set, no `.html`, `.xml` or `.txt` carries the placeholder, and with the layout mutated back, six did. mantis's robots and sitemap are per request, so it had none.

**Not done, and why.**

- **The fast/full CI split** (#545's 09-28 comment) needs a `mode` input on the reusable `ci.yml`. That is a `.github` change for its own PR. Both lanes run full CI meanwhile.
- **Turnstile** does not mint a token on `staging--…` hosts until each widget lists them.
- **Three merged head branches remain on mantis-landscaping.** It does not auto-delete them, and the proxy refuses the delete: `claude/staging-flow`, `claude/kit-3` and `claude/kit-3-journal`.
- **vida-legacy-foundation `claude/renovate-dryrun-probe`** is a closed probe branch that no PR merged, and it is still there.
