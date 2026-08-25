# The private prospect-audit runner

`prospect-audit.yml` in this directory is not run by this repo. It belongs in a
**private** repo, and it is kept here so it lives next to the code it runs and
gets reviewed with it.

## Why it is not in this repo

`reddoor-maintenance` is public. A public repo's Actions tab is world-readable —
including `workflow_dispatch` inputs and every log line. Running prospect audits
here would publish the URL of every company we are about to pitch, which is a
live feed of the sales pipeline. Secrets are masked; input values are not.

The code stays public. Only the knowledge of _who we are auditing_ moves.

The workflow checks out this public repo at a ref, so there is nothing to
publish to npm and an unreleased branch can be audited against by passing `ref`.

## One-time setup

**1. Create the private repo and add the workflow.**

```bash
gh repo create reddoorla/reddoor-prospect-runner --private \
  --description "Private runner for prospect audits (see reddoor-maintenance/docs/private-runner)"

tmp=$(mktemp -d) && git -C "$tmp" init -q && mkdir -p "$tmp/.github/workflows"
cp docs/private-runner/prospect-audit.yml "$tmp/.github/workflows/"
cp docs/private-runner/README.md "$tmp/README.md"
git -C "$tmp" add -A
git -C "$tmp" commit -qm "ci: prospect audit runner"
git -C "$tmp" branch -M main
git -C "$tmp" remote add origin https://github.com/reddoorla/reddoor-prospect-runner.git
git -C "$tmp" push -qu origin main
```

**2. Set its secrets.** The Turso pair mirrors what the fleet workflows already
use. `PROSPECT_AUDIT_RECIPIENTS` is a comma-separated list — this is the only
place the recipients are configured, so adding someone later is one command.

```bash
R=reddoorla/reddoor-prospect-runner
gh secret set TURSO_DATABASE_URL       --repo "$R"
gh secret set TURSO_AUTH_TOKEN         --repo "$R"
gh secret set RESEND_API_KEY           --repo "$R"
gh secret set PROSPECT_AUDIT_RECIPIENTS --repo "$R"   # tucker@…,tim@…,erik@…
gh secret set ANTHROPIC_API_KEY        --repo "$R"    # when it exists
gh secret set PERPLEXITY_API_KEY       --repo "$R"    # when it exists
gh variable set DASHBOARD_BASE_URL     --repo "$R" --body "https://reddoor-maintenance.netlify.app"
```

Without `ANTHROPIC_API_KEY` and `PERPLEXITY_API_KEY` the audit still runs,
persists and emails — the answerability and AI-visibility sections simply read
"not measured", which is the behaviour the whole tool is built around.

**3. Point the cockpit at it.** On the `reddoor-maintenance` Netlify site:

```bash
netlify env:set PROSPECT_AUDIT_DISPATCH_REPO reddoorla/reddoor-prospect-runner \
  --context production branch-deploy deploy-preview
```

**4. Give the cockpit a token that can dispatch it.** The dashboard already
holds a GitHub token for the Renovate trigger. It needs `actions: write` on the
private runner repo — a fine-grained PAT scoped to that one repo is the
tightest option. Set it as the same variable the trigger endpoint reads.

## Checking it works

Dispatch once from the command line before wiring the button:

```bash
gh workflow run prospect-audit.yml --repo reddoorla/reddoor-prospect-runner \
  -f url=https://reddoorla.com/ -f business="Reddoor Creative"
```

Then watch it, and confirm the email arrives and its link opens the report.

## If you ever move off GitHub Actions

The cockpit dispatches through a narrow interface in
`src/dashboard/prospect-audit-trigger.ts` — it hands over a repo, a workflow
file and three inputs, and gets back ok-or-error. Swapping in a container job
means replacing that one function, not the page or the endpoint.
