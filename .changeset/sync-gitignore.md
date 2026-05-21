---
"@reddoorla/maintenance": minor
---

`sync-configs` now manages `.gitignore` across the fleet and untracks build artifacts.

A new canonical config target — `gitignore` — joins the five existing ones (`eslint`, `prettier`, `lighthouse`, `playwright-a11y`, `svelte`). Unlike the others, it **merges** rather than overwrites: the recipe layers in any missing canonical entries while leaving site-specific lines (custom dirs, editor files, OS junk) untouched.

In the same commit, the recipe also runs `git rm -r --cached` for any tracked paths that fall under a canonical _directory_ entry — typically `build/`, `dist/`, `.svelte-kit/`, `coverage/`, `playwright-report/`, `test-results/`, `.lighthouseci/`, `.vercel/`, `.netlify/`, `node_modules/`. So sites that accidentally committed build output (espada has, caltex has) get cleaned up the next time sync-configs runs.

### Canonical entries

```gitignore
node_modules/
build/
dist/
.svelte-kit/
coverage/
.vitest-cache/
playwright-report/
test-results/
.lighthouseci/
.tsbuildinfo
.env
.env.*
!.env.example
.DS_Store
*.log
.vercel/
.netlify/
```

File-pattern entries (`.env`, `*.log`, `.DS_Store`, `.tsbuildinfo`) are **not** auto-untracked. They may contain user-meaningful data, and `git rm --cached` cannot scrub secrets from history regardless. Surfaced via the `.gitignore` rule itself; manual cleanup if needed.

### Merge semantics

- Existing entries in any normalized form (`build`, `/build`, `build/`, `/build/`) count as present — no duplicates appended.
- Blank lines and comments are preserved.
- Missing canonical entries are appended under a `# canonical entries from @reddoorla/maintenance sync-configs` marker.
- All-present → noop, no commit.

### Re-running against onboarded sites

Sites previously synced under ≤ 0.4.0 will see one new commit: `chore: sync gitignore from @reddoorla/maintenance` — adds the rule, untracks any matching build artifacts. Idempotent: re-running is a noop.

### CLI

```sh
# whole site (all six config targets)
reddoor-maint sync-configs /path/to/site

# just the gitignore + untrack pass
reddoor-maint sync-configs /path/to/site --only gitignore
```
