# Skills Repo (reddoorla/claude-skills) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the seven fleet Claude Code skills into one private, versioned, tested repo whose `install.sh` symlinks each directory into `~/.claude/skills`, with every machine-specific path and every symlink-fragile entry-point check fixed before the first commit.

**Architecture:** `reddoorla/claude-skills` holds `skills/<name>/` for all seven, plus `install.sh`, a root `package.json` with a zero-dependency `node --test test/` suite, and `docs/workJournal.md`. `matching-a-page` and `rfp-analyze` come in through `git subtree add` so their commit SHAs survive; the other five have no git history anywhere and are imported flat, one commit each. Skills stay discoverable exactly as they are today — `~/.claude/skills/<name>/SKILL.md` — so every `node ~/.claude/skills/<skill>/x.mjs` invocation in a SKILL.md and in Beachfront's `matching/gate.sh` keeps working; the plugin/marketplace layout is deliberately not used because it would namespace and version-path every one of those.

**Tech Stack:** git (incl. `git subtree`, present at `/Library/Developer/CommandLineTools/usr/libexec/git-core/git-subtree`), `gh` CLI (`/opt/homebrew/bin/gh`), Node 24 (`node --test`, zero deps), bash.

**Depends on:** Nothing. This is plan A, first in the order (A → BC → E → F; D independent). Plans BC and E depend on **this** plan having produced: (1) `REPORT_SCHEMA` exported from `skills/matching-a-page/lib/report.mjs` and stamped into every `report.json`'s `meta.schemaVersion`; (2) `page-diff.mjs --version` printing `page-diff <version> report-schema <REPORT_SCHEMA>`; (3) the seven symlinks live in `~/.claude/skills`, so `MATCHING_SKILL_DIR` defaulting to `$HOME/.claude/skills/matching-a-page` resolves.

**Repos touched:**

| Repo                                                                         | Branch                                     | Why                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reddoorla/claude-skills` (NEW; clone at `~/Documents/GitHub/claude-skills`) | **`main` directly, no PR**                 | A squash merge flattens history. The whole point of `git subtree add` is that `4912eaf` and `c7cf716` survive as real commits; squashing the PR that carries them destroys exactly what the import was for. New private repo, no protection, no CI — land on `main`. |
| `~/Documents/GitHub/rfp-analyze`                                             | `chore/work-journal` (already checked out) | Two commits: the pending `SKILL.md` edit (so the subtree import is of a clean tree), and a closing journal entry after the import.                                                                                                                                   |

No file in `reddoor-starter`, `reddoor-maintenance` or `beachfront-dentistry` is modified by this plan. Beachfront is **read** and **exercised** at cut-over.

**Assumptions:**

- `gh` is authenticated with rights to create a repo in the `reddoorla` org. Not verified — no mutating or network command was run while writing this plan. If `gh repo create` fails on auth, that is an operator step (`gh auth status`), not a plan defect.
- Claude Code discovers a symlinked skill directory. Proven since 2026-05-18 by `~/.claude/skills/rfp-analyze -> ~/Documents/GitHub/rfp-analyze`, which is in this session's skill list. Re-verified at cut-over.
- **`text-diff.mjs` and `markup.mjs` have no entry-point guard at all** — verified: `text-diff.mjs`'s CLI body is top-level from line 23 to the closing `process.exit` at line 140, and `markup.mjs`'s from line 230 to the end. Making them "realpath-safe" is therefore a no-op, and _adding_ a guard to `text-diff.mjs` would need a real refactor (`grab()` at line 63 closes over `VW`, which is declared in the body that would move inside the guard block). Both get a comment recording why there is no guard, so a later session does not "fix" it by introducing a broken one. Only `page-diff.mjs` and `style-census.mjs` actually have a guard to correct.
- `page-diff --version` reads the version out of the skill's own `package.json` (`"version": "0.1.0"`), so the printed string is `page-diff 0.1.0 report-schema 1`.
- **The matching-a-page Phase 0 / Workspace rewrite is PLAN E's, not this plan's.** This plan touches `skills/matching-a-page/SKILL.md` at exactly one place — the probe import at lines 166–173. Lines 98–109 (Workspace) and 123–126 / 163–164 (Phase 0 steps 1 and 8) are left alone.
- The repo gets no CI workflow in v1; `npm test` at the root is the gate, run locally. Adding CI is a follow-up, noted in the README.
- **Divergence from spec C1, recorded deliberately.** C1's gate says "extend `skill-frontmatter.test.mjs` to run over every skill". That file is `skills/matching-a-page/skill-frontmatter.test.mjs` (one of the 28 imported files); it hard-codes `name:\s*matching-a-page` plus a `page-diff` string check, and it lives **inside a skill directory that the root `node --test test/` suite does not descend into** — it only ever runs under the skill's own `npm test`, which needs that skill's `node_modules`. It therefore cannot be the repo-level gate. The generic frontmatter check (name equals directory, description present, for all seven) is instead in `test/skills.test.mjs`, Task 8. The skill-local test is **retained unchanged**: its `page-diff` assertion is matching-a-page-specific and not generalisable, so deleting it would lose a real check. Two overlapping frontmatter tests is the accepted cost; the spec's intent — every skill's frontmatter parses, in the gate that actually runs — is met.
- `matching-a-page`'s dependencies are installed into the clone at **Task 6 Step 0**, before any task runs code that imports them. `lib/report.mjs:3` pulls `lib/image.mjs`, which imports `pngjs`; `node_modules/` is gitignored so the subtree import brings none, and there is no `node_modules` anywhere up the tree from `~/Documents/GitHub` (checked). Tasks 5, 7 and 8 are all zero-dependency and unaffected.

---

## File structure

**Created — `~/Documents/GitHub/claude-skills/`**

```
.gitignore                                    node_modules/, out*/, .claude/, .DS_Store, test-output/
package.json                                  {"test": "node --test test/"}, NO dependencies
README.md                                     what it is, install, REDDOOR_REPOS, the no-squash trap
install.sh                                    symlinks skills/<name> -> ~/.claude/skills/<name>
test/skills.test.mjs                          frontmatter (all 7) · no /Users/ · install+readlink · usage through the symlink · isMain adoption (source)
docs/workJournal.md                           dated entry, this session
skills/matching-a-page/                       subtree import, 30 commits, 28 files
skills/rfp-analyze/                           subtree import, 23 commits, 47 files
skills/new-site/SKILL.md                      flat import
skills/figma-slices/SKILL.md                  flat import
skills/markup-review/{SKILL.md,markup.mjs}    flat import
skills/evening-review/SKILL.md                flat import
skills/svelte4-to-5-upgrade/SKILL.md          flat import
skills/matching-a-page/lib/is-main.mjs        NEW — the realpath entry-point check
skills/matching-a-page/lib/is-main.test.mjs   NEW
```

**Modified (inside the new repo, after import)**

```
skills/matching-a-page/page-diff.mjs          :3 imports · :8 imports · :183-189 guard · --version branch
skills/matching-a-page/style-census.mjs       :148-153 guard
skills/matching-a-page/text-diff.mjs          comment after :21 (no guard, on purpose)
skills/matching-a-page/lib/report.mjs         REPORT_SCHEMA export + meta.schemaVersion stamp
skills/matching-a-page/lib/report.test.mjs    + writeArtifacts schemaVersion test
skills/matching-a-page/page-diff.test.mjs     + --version spawn test
skills/matching-a-page/SKILL.md               :166-173 probe import
skills/markup-review/markup.mjs               :4-5 comment · :10 comment · :12 ENV_FILE · apiKey() :24-41 · USAGE :224
skills/markup-review/SKILL.md                 :3 description
skills/rfp-analyze/{SKILL.md,README.md,CLAUDE.md}   $SKILL_DIR / $REDDOOR_REPOS
skills/new-site/SKILL.md                      :20,:71,:84 $REDDOOR_REPOS + convention line
skills/svelte4-to-5-upgrade/SKILL.md          :18,:21,:239,:279-281 $REDDOOR_REPOS · :90 pnpm pin
```

**Modified (outside)**

```
~/Documents/GitHub/rfp-analyze/SKILL.md            commit the pending edit (already in the working tree)
~/Documents/GitHub/rfp-analyze/docs/workJournal.md tombstone entry
~/.claude/skills/*                                 six real dirs moved to a backup, seven symlinks created
```

---

### Task 1: Repo skeleton

**Files:** Create: `~/Documents/GitHub/claude-skills/{.gitignore,package.json,docs/workJournal.md}` · Verify: `gh repo view`

- [ ] **Step 1: Create the local repo and its three scaffold files**

```bash
mkdir -p ~/Documents/GitHub/claude-skills/{skills,test,docs}
cd ~/Documents/GitHub/claude-skills
git init -b main

cat > .gitignore <<'EOF'
node_modules/
out*/
.claude/
.DS_Store
test-output/
EOF

cat > package.json <<'EOF'
{
  "name": "reddoor-claude-skills",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": { "test": "node --test test/" }
}
EOF

cat > docs/workJournal.md <<'EOF'
# Work journal — claude-skills

Newest at the bottom. History is never edited to be right: an entry that stops
being true is corrected by a later entry, not rewritten.
EOF
```

- [ ] **Step 2: Verify the scaffold** — `ls -a ~/Documents/GitHub/claude-skills && node -e "console.log(require('/Users/tuckerlemos/Documents/GitHub/claude-skills/package.json').scripts.test)"` → prints `node --test test/`.

- [ ] **Step 3: Create the private remote and attach it (no push yet)**

```bash
cd ~/Documents/GitHub/claude-skills
gh repo create reddoorla/claude-skills --private \
  --description "The seven fleet Claude Code skills, one directory each, symlinked into ~/.claude/skills by install.sh" \
  --source=. --remote=origin
```

Network: if the sandbox blocks github.com, re-run the same command unsandboxed.

- [ ] **Step 4: Verify the remote exists and is private** — `gh repo view reddoorla/claude-skills --json isPrivate,name -q '.name + " private=" + (.isPrivate|tostring)'` → `claude-skills private=true`; `git remote -v` → two `origin` lines.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/claude-skills
git add .gitignore package.json docs/workJournal.md
git commit -m "$(cat <<'EOF'
chore: scaffold the skills repo

Seven skills have lived as loose directories under ~/.claude/skills with no
remote; two of them were local git repos nobody could clone. This is the home.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Import matching-a-page with its history

**Files:** Create: `skills/matching-a-page/` (28 files, 30 commits)

The live directory is 354 MB and its `.git` carries 71.1 MiB of unreachable objects plus a `tmp_obj` garbage file from an aborted `git add` (commit `564f01d`, "the git-add hang"). Never `git add` inside it and never clone it with hardlinks — `git clone --no-local` forces the transport path, which sends only reachable objects.

**Staging path.** Both steps below name the SAME directory, and they run in two
separate Bash calls. Do **not** use `$TMPDIR`: this harness rewrites it to a
sandbox-writable path under sandboxed execution and lets it revert to the OS
default (`/var/folders/…`) whenever a command runs unsandboxed — and this plan
does toggle the sandbox (Task 1 Step 3, Task 6 Step 0, Task 10). A mid-task
toggle would silently point Step 2 at a directory that does not exist, and
`git subtree add` fails late, after the repo already has commits on it. Use one
explicit absolute path, outside the new repo so no `.gitignore` entry is needed:

```
STAGE="$HOME/Documents/GitHub/.claude-skills-import"
```

- [ ] **Step 1: Clone reachable history only, and prove it is small**

```bash
STAGE="$HOME/Documents/GitHub/.claude-skills-import"
rm -rf "$STAGE"
git clone --no-local --quiet "$HOME/.claude/skills/matching-a-page" "$STAGE"
git -C "$STAGE" gc --prune=now --quiet
du -sh "$STAGE/.git"
git -C "$STAGE" rev-list --count HEAD
git -C "$STAGE" branch --show-current
git -C "$STAGE" fsck --unreachable --no-reflogs
```

Expected: `.git` around **216K** (must be under 2M), `30` commits, branch `main`, and `fsck` prints nothing. Measured while writing this plan on the same source.

- [ ] **Step 2: Subtree-add it**

```bash
cd ~/Documents/GitHub/claude-skills
git subtree add --prefix=skills/matching-a-page \
  "$HOME/Documents/GitHub/.claude-skills-import" main
```

(The path is written out in full rather than reused from `$STAGE`: shell state
does not persist between Bash calls in this harness either.)

- [ ] **Step 3: Verify the original SHAs survived** — this is the whole reason for the subtree:

```bash
cd ~/Documents/GitHub/claude-skills
git cat-file -t 4912eaf   # -> commit   (style-census: separate a real mismatch…)
git cat-file -t 564f01d   # -> commit   (chore: ignore all out*/ capture dirs)
git cat-file -t 8d6c203   # -> commit   (harden: kill the silent-degradation paths)
git log --oneline | wc -l # -> 32       (1 scaffold + 30 imported + 1 subtree merge)
git ls-files skills/matching-a-page | wc -l   # -> 28
```

Note `git log -- skills/matching-a-page` shows only the merge: `subtree add` merges the source history with its _original_ paths. `git log --oneline` (no pathspec) is where the 30 commits are.

- [ ] **Step 4: Delete the staging clone, then confirm nothing heavy came along**

```bash
rm -rf "$HOME/Documents/GitHub/.claude-skills-import"
test ! -d "$HOME/Documents/GitHub/.claude-skills-import" && echo "stage removed"
du -sh ~/Documents/GitHub/claude-skills
git -C ~/Documents/GitHub/claude-skills ls-files skills/matching-a-page | grep -c '^skills/matching-a-page/out'
```

Expected: `stage removed`; repo under 3M; `0`.

- [ ] **Step 5: Commit** — `git subtree add` already committed. Nothing to do; record the SHA: `git log --oneline -1`.

---

### Task 3: Import rfp-analyze with its history

**Files:** Modify: `~/Documents/GitHub/rfp-analyze/SKILL.md` (commit the pending edit) · Create: `skills/rfp-analyze/` (47 files, 23 commits)

- [ ] **Step 1: Commit the pending SKILL.md edit in the standalone repo**

The working tree carries an uncommitted two-line change from another session (verified: ` M SKILL.md`, lines 16 and 82, moving `rfp-handbook.md` out of `reddoor-starter/docs/` and into the estimates repo root). Import a clean tree, not a dirty one.

```bash
cd ~/Documents/GitHub/rfp-analyze
git diff --stat            # 1 file changed, 2 insertions(+), 2 deletions(-)
git add SKILL.md
git commit -m "$(cat <<'EOF'
docs(SKILL): rfp-handbook lives in the estimates repo, not the starter's docs

The handbook is analysis input, not template documentation; it moved to
reddoor-rfp-analyses' root. Two references (Reference docs, Step 1.3).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git status --short         # clean
```

- [ ] **Step 2: Verify the branch to import from** — `git -C ~/Documents/GitHub/rfp-analyze log --oneline -1 chore/work-journal` and `git -C ~/Documents/GitHub/rfp-analyze rev-list --count chore/work-journal` → `23`. `chore/work-journal` is `main` plus the two journal commits plus this one; it is the superset, so it is the import ref.

- [ ] **Step 3: Subtree-add it**

```bash
cd ~/Documents/GitHub/claude-skills
git subtree add --prefix=skills/rfp-analyze \
  /Users/tuckerlemos/Documents/GitHub/rfp-analyze chore/work-journal
```

- [ ] **Step 4: Verify** — `git cat-file -t c7cf716` → `commit` (the symlink fix this whole repo depends on); `git ls-files skills/rfp-analyze | wc -l` → `47`; `git ls-files skills/rfp-analyze | grep -c '\.claude/'` → `0` (its `.claude/settings.json` is a permission allowlist full of absolute paths, kept out today only by the global `~/.config/git/ignore` rule `**/.claude/`; the repo's own `.gitignore` now covers it).

- [ ] **Step 5: Commit** — already committed by `subtree add`; record: `git log --oneline -1`.

---

### Task 4: Import the other five, flat

**Files:** Create: `skills/{new-site,figma-slices,markup-review,evening-review,svelte4-to-5-upgrade}/`

None of these five is a git repo — no `.git` anywhere under them (verified). There is no history to preserve, so each gets one honest first commit.

- [ ] **Step 1: Copy them in**

```bash
cd ~/Documents/GitHub/claude-skills
for s in new-site figma-slices markup-review evening-review svelte4-to-5-upgrade; do
  mkdir -p "skills/$s"
  cp -R "$HOME/.claude/skills/$s/." "skills/$s/"
done
find skills/new-site skills/figma-slices skills/markup-review \
     skills/evening-review skills/svelte4-to-5-upgrade -type f | sort
```

Expected exactly six files: one `SKILL.md` each, plus `skills/markup-review/markup.mjs`.

- [ ] **Step 2: Commit them one at a time**

```bash
cd ~/Documents/GitHub/claude-skills
TRAILER="Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"

# The blank line before $TRAILER is load-bearing: git only parses a trailer
# block separated from the body by a blank line. Without it Co-Authored-By
# becomes body prose and the attribution is lost.

git add skills/new-site && git commit -m "chore: import the new-site skill

No git history existed for it — this is its first commit.

$TRAILER"

git add skills/figma-slices && git commit -m "chore: import the figma-slices skill

No git history existed for it — this is its first commit.

$TRAILER"

git add skills/markup-review && git commit -m "chore: import the markup-review skill

No git history existed for it — this is its first commit. Its design record is
reddoor-maintenance docs/superpowers/specs/2026-08-10-markup-review-skill-design.md,
whose Non-goals deliberately kept it out of @reddoorla/maintenance; a private
skills repo is the home that decision implied and never got.

$TRAILER"

git add skills/evening-review && git commit -m "chore: import the evening-review skill

No git history existed for it — this is its first commit.

$TRAILER"

git add skills/svelte4-to-5-upgrade && git commit -m "chore: import the svelte4-to-5-upgrade skill

No git history existed for it — this is its first commit. It overlaps the
maintenance recipe svelte-4-to-5 (src/recipes/svelte-5/); keep-or-retire is an
open question recorded in the README, not decided here.

$TRAILER"
```

- [ ] **Step 3: Verify all seven are present, and that the attribution parsed as a trailer**

```bash
cd ~/Documents/GitHub/claude-skills
git ls-files skills | cut -d/ -f2 | sort -u
git log --format='%(trailers:key=Co-Authored-By,valueonly)' -5 | grep -c 'Claude Opus 5'
```

Expected: seven names — `evening-review figma-slices markup-review matching-a-page new-site rfp-analyze svelte4-to-5-upgrade` — and `5`. A count below 5 means a message lost its blank line before `$TRAILER`; git then read the trailer as body prose. Fix with `git rebase` or `git commit --amend`, do not leave it.

---

### Task 5: The realpath entry-point check

**Files:** Create: `skills/matching-a-page/lib/is-main.mjs`, `skills/matching-a-page/lib/is-main.test.mjs` · Modify: `skills/matching-a-page/page-diff.mjs:3,8,183-189`, `skills/matching-a-page/style-census.mjs:148-153`, `skills/matching-a-page/text-diff.mjs:22`, `skills/markup-review/markup.mjs:11`

Measured on this machine (Node 24.16.0): with a symlinked directory, `process.argv[1]` keeps the symlink path while `import.meta.url` is the _real_ path, so `import.meta.url === pathToFileURL(process.argv[1]).href` is **false** and the CLI silently exits 0 having done nothing. It is false even for a direct invocation whose path merely traverses a symlink (`$TMPDIR` → `/private/var/...`). `realpathSync(argv[1]) === fileURLToPath(import.meta.url)` was true in both cases. This is the `c7cf716` class that rfp-analyze already hit.

- [ ] **Step 1: Write the failing test** — `skills/matching-a-page/lib/is-main.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isMain } from "./is-main.mjs";

/** A real file plus a symlinked route to it — the ~/.claude/skills shape. */
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "is-main-")));
  const real = join(root, "real");
  mkdirSync(real);
  const file = join(real, "cli.mjs");
  writeFileSync(file, "export {};\n");
  symlinkSync(real, join(root, "link"));
  return { file, viaLink: join(root, "link", "cli.mjs") };
}

test("true when invoked through a symlinked directory — the c7cf716 class", () => {
  const { file, viaLink } = fixture();
  const importMetaUrl = pathToFileURL(file).href;
  assert.equal(isMain(importMetaUrl, viaLink), true);
  // The naive compare page-diff shipped is false here. That IS the bug: the
  // guard never fires, the CLI does nothing, and the exit code is 0.
  assert.notEqual(pathToFileURL(viaLink).href, importMetaUrl);
});

test("true when invoked directly", () => {
  const { file } = fixture();
  assert.equal(isMain(pathToFileURL(file).href, file), true);
});

test("false for an unrelated argv[1], a missing path, and no argv[1]", () => {
  const { file } = fixture();
  const url = pathToFileURL(file).href;
  assert.equal(isMain(url, join(file, "..", "other.mjs")), false);
  assert.equal(isMain(url, "/nope/does/not/exist.mjs"), false);
  assert.equal(isMain(url, undefined), false);
});
```

- [ ] **Step 2: Run it and watch it fail** — `cd ~/Documents/GitHub/claude-skills && node --test skills/matching-a-page/lib/is-main.test.mjs` → `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../skills/matching-a-page/lib/is-main.mjs' imported from .../is-main.test.mjs`.

- [ ] **Step 3: Implement** — create `skills/matching-a-page/lib/is-main.mjs`:

```js
/**
 * Is this module the process entry point?
 *
 * `import.meta.url` is the module's REAL path — Node resolves symlinks unless
 * --preserve-symlinks — while `process.argv[1]` is whatever the caller typed.
 * These skills are invoked as ~/.claude/skills/<name>/x.mjs, and that is a
 * symlink into the claude-skills checkout, so comparing the two directly is
 * always false: the guard never fires, the CLI does nothing, and the exit code
 * is 0. rfp-analyze shipped that bug and fixed it in c7cf716; this is the same
 * fix, factored out so it can be tested instead of retyped.
 *
 * `argv1` is a parameter (not read from process directly) so a test can drive
 * the symlink case without spawning.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMain(importMetaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === fileURLToPath(importMetaUrl);
  } catch {
    return false; // argv[1] does not exist on disk
  }
}
```

Then edit `skills/matching-a-page/page-diff.mjs`. Line 3 today:

```js
import { pathToFileURL } from "node:url";
```

becomes (it is used nowhere else in the file — verified, only lines 184 and 188 mention it):

```js
import { isMain } from "./lib/is-main.mjs";
```

Lines 183–189 today:

```js
// CLI entry (only when run directly, not when imported by tests).
// pathToFileURL handles paths that need percent-encoding — the old template-
// string compare silently no-op'd (exit 0!) from any such path.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
```

become:

```js
// CLI entry (only when run directly, not when imported by tests).
// The pathToFileURL compare that replaced the old template string is still
// false whenever ANY component of the invoked path is a symlink — which is
// how this skill is installed now (~/.claude/skills/matching-a-page -> the
// claude-skills checkout). isMain() resolves the real path on both sides.
if (isMain(import.meta.url)) {
```

Then `skills/matching-a-page/style-census.mjs`, lines 148–153 today:

```js
// CLI (guarded so the pure helpers stay importable by tests).
import { pathToFileURL } from "node:url";
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
```

become:

```js
// CLI (guarded so the pure helpers stay importable by tests).
import { isMain } from "./lib/is-main.mjs";
if (isMain(import.meta.url)) {
```

Then record why the other two have no guard. In `skills/matching-a-page/text-diff.mjs`, after line 21 (`import { parseArgs } from "./lib/args.mjs";`) insert:

```js
// No isMain() guard here, deliberately: this file exports nothing and its CLI
// body is top-level, so it always runs — which is symlink-safe by
// construction. Adding a guard would mean moving VW inside the block, and
// grab() below closes over it. If this file ever grows exports, add the guard
// AND pass VW as a parameter.
```

In `skills/markup-review/markup.mjs`, after line 10 (`import { join } from "node:path";`) insert:

```js
// No entry-point guard: nothing imports this file and its CLI body is
// top-level, so it always runs — symlink-safe by construction. Do not add a
// naive `import.meta.url === ...argv[1]` guard; through the ~/.claude/skills
// symlink that compare is false and the CLI would silently do nothing.
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd ~/Documents/GitHub/claude-skills
node --test skills/matching-a-page/lib/is-main.test.mjs   # -> # pass 3  # fail 0
node --check skills/matching-a-page/page-diff.mjs
node --check skills/matching-a-page/style-census.mjs
node --check skills/matching-a-page/text-diff.mjs
node --check skills/markup-review/markup.mjs
grep -c pathToFileURL skills/matching-a-page/page-diff.mjs   # -> 0
```

(`node --check` parses `.mjs` as a module — verified on this machine.)

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/claude-skills
git add skills/matching-a-page skills/markup-review
git commit -m "$(cat <<'EOF'
fix: resolve the real path in CLI entry checks, so symlinked skills still run

Installed as ~/.claude/skills/<name> -> this checkout, argv[1] keeps the
symlink path while import.meta.url is the real one, so the old compare is
false and page-diff/style-census exit 0 having done nothing. Measured on Node
24: false through a symlink, and false even for a direct call whose path
crosses one ($TMPDIR). text-diff and markup.mjs have no guard at all and are
safe as they stand — each now says so, so nobody adds a broken one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: REPORT_SCHEMA and `page-diff --version`

**Files:** Modify: `skills/matching-a-page/lib/report.mjs`, `skills/matching-a-page/lib/report.test.mjs`, `skills/matching-a-page/page-diff.mjs`, `skills/matching-a-page/page-diff.test.mjs`

Plans BC and E need a version identity a site can pin: `matching/gate.sh` compares `page-diff --version`'s schema number against `harness.json`, and `next.mjs` exits 2 rather than blanking a page when a report was written by a different schema.

- [ ] **Step 0: Install matching-a-page's own dependencies — UNSANDBOXED**

Everything in this task runs real code from `lib/report.mjs`, and `report.mjs:3`
is `import { toBuffer, compositeH } from "./image.mjs"`, whose first line is
`import { PNG } from "pngjs"`. `node_modules/` is gitignored, so the subtree
import brought none, and there is no `node_modules` anywhere up the tree
(checked: `~/Documents/GitHub`, `~/Documents`, `~`, `/`). Without this step
Step 2's run dies with `ERR_MODULE_NOT_FOUND: Cannot find package 'pngjs'` —
an unrelated resolution error the executor cannot tell apart from the RED it is
looking for — and Step 4 can never be green. `npm install` also runs
playwright's postinstall, which fetches browsers from a CDN the sandbox blocks,
so **run this with the sandbox disabled**.

```bash
cd ~/Documents/GitHub/claude-skills/skills/matching-a-page
npm install
node -e "import('pngjs').then(()=>console.log('pngjs ok'))"
git -C ~/Documents/GitHub/claude-skills status --short -- skills/matching-a-page
```

Expected: `npm install` completes; the third line prints exactly `pngjs ok`; the `git status` prints **nothing**.

`package-lock.json` is one of the 28 tracked files (verified), and `node_modules/` and `out*/` are the skill's own `.gitignore` — so the only thing `npm install` can dirty here is the lockfile. If `git status` shows ` M skills/matching-a-page/package-lock.json`, this npm rewrote it (a `lockfileVersion` or integrity refresh). Decide before Step 5: `git checkout -- skills/matching-a-page/package-lock.json` to keep the imported lockfile, or commit the rewrite as its own commit with a message saying which npm produced it (`npm --version`). Do **not** let it ride along inside Step 5's `git add skills/matching-a-page`, where it would be an unexplained diff in a commit about report schemas.

- [ ] **Step 1: Write the failing test** — append to `skills/matching-a-page/lib/report.test.mjs` (it currently ends at line 40 with the `summarise` tests; keep them):

```js
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeArtifacts, REPORT_SCHEMA } from "./report.mjs";

test("every report stamps the schema version into meta", () => {
  const out = mkdtempSync(join(tmpdir(), "report-"));
  writeArtifacts(
    [
      {
        viewport: 1440,
        label: "hero",
        mismatchFraction: 0.01,
        meanDeltaE: 1,
        pass: true,
      },
    ],
    out,
    { threshold: 0.1, ref: "https://ref.example", cand: "http://localhost:5173" },
  );
  const json = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  assert.equal(json.meta.schemaVersion, REPORT_SCHEMA);
  assert.equal(typeof REPORT_SCHEMA, "number");
  assert.equal(json.meta.threshold, 0.1); // caller meta survives the stamp
});
```

- [ ] **Step 2: Run it and watch it fail** — `cd ~/Documents/GitHub/claude-skills && node --test skills/matching-a-page/lib/report.test.mjs` → `SyntaxError: The requested module './report.mjs' does not provide an export named 'REPORT_SCHEMA'`.

- [ ] **Step 3: Implement** — in `skills/matching-a-page/lib/report.mjs`, after the imports at lines 1–3 insert:

```js
/** Version of the report.json shape. Bump when a consumer would misread an
 * older report — not for additive fields. It is written into every report's
 * meta and printed by `page-diff --version`, so a site's gate can refuse a
 * report a newer skill wrote rather than silently scoring it. */
export const REPORT_SCHEMA = 1;
```

and in `writeArtifacts`, line 68 today reads `    meta,` inside the `json` object literal; replace with:

```js
    meta: { ...meta, schemaVersion: REPORT_SCHEMA },
```

Then in `skills/matching-a-page/page-diff.mjs`: line 8 today

```js
import { summarise, writeArtifacts } from "./lib/report.mjs";
```

becomes

```js
import { summarise, writeArtifacts, REPORT_SCHEMA } from "./lib/report.mjs";
```

and add `import { readFileSync } from "node:fs";` beside it. Inside the CLI block, line 190 today is `  const a = parseArgs(process.argv.slice(2));` and line 191 begins `  if (!a.ref || !a.cand) {`. Insert between them:

```js
if (a.version) {
  const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  console.log(`page-diff ${version} report-schema ${REPORT_SCHEMA}`);
  process.exit(0);
}
```

(`parseArgs` turns a trailing bare `--version` into `true` — verified at `lib/args.mjs:19`.)

Finally append to `skills/matching-a-page/page-diff.test.mjs` (this file already needs the skill's own `node_modules`, so it belongs here and not in the root suite):

```js
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("--version prints the tool version and the report schema", () => {
  const cli = fileURLToPath(new URL("./page-diff.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /^page-diff \d+\.\d+\.\d+ report-schema \d+$/);
});
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd ~/Documents/GitHub/claude-skills
node --test skills/matching-a-page/lib/report.test.mjs   # -> # pass 3  # fail 0
node --check skills/matching-a-page/page-diff.mjs
node skills/matching-a-page/page-diff.mjs --version
```

Expected: `# pass 3  # fail 0` (two existing `summarise` tests plus the new one — verified: `lib/report.test.mjs` has exactly two `test(` calls today), `node --check` silent, and the last line exactly:

```
page-diff 0.1.0 report-schema 1
```

That string is the artefact plans BC and E consume, so it is proved **here**, in the task that creates it — not deferred to Task 10. Step 0's install is what makes it runnable (playwright is a top-level import at `page-diff.mjs:2`). The `page-diff.test.mjs` addition, which spawns the CLI, runs with the skill's full suite in Task 10.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/claude-skills
git add skills/matching-a-page
git commit -m "$(cat <<'EOF'
feat(matching-a-page): a report schema version, stamped and printable

The gate tools had no version identity across repos: a site could not tell
whether a report.json it was scoring came from the skill it expected. meta
now carries schemaVersion and `page-diff --version` prints it, which is what
match-harness's gate.sh compares and next.mjs refuses on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Machine independence

**Files:** Create: `test/skills.test.mjs` · Modify: `skills/matching-a-page/SKILL.md:166-173`, `skills/markup-review/{markup.mjs,SKILL.md}`, `skills/rfp-analyze/{SKILL.md,README.md,CLAUDE.md}`, `skills/new-site/SKILL.md`, `skills/svelte4-to-5-upgrade/SKILL.md`

- [ ] **Step 1: Write the failing test** — create `test/skills.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("no tracked file hard-codes one machine's home directory", () => {
  const files = execFileSync("git", ["-C", REPO, "ls-files"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.(md|mjs|js|ts|sh|json)$/.test(f))
    .filter((f) => f !== "test/skills.test.mjs"); // this file names the pattern
  const offenders = [];
  for (const f of files) {
    readFileSync(join(REPO, f), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/\/Users\/[^/\s"']+\//.test(line))
          offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 110)}`);
      });
  }
  assert.deepEqual(
    offenders,
    [],
    `hard-coded home paths (use $HOME / $REDDOOR_REPOS / $SKILL_DIR):\n${offenders.join("\n")}`,
  );
});
```

- [ ] **Step 2: Run it and watch it fail** — `cd ~/Documents/GitHub/claude-skills && node --test test/` → one failure listing exactly one offender:

```
skills/matching-a-page/SKILL.md:173: import { chromium } from "file:///Users/tuckerlemos/.claude/skills/matching-a-page/node_modules/playwright/index.mjs";
```

(Verified: that is the only `/Users/` hit across all 83 tracked skill files.)

- [ ] **Step 3a: Implement — the matching-a-page probe** — replace `skills/matching-a-page/SKILL.md` lines 166–173, today:

````
Probe pattern (write probes to `matching/` or the scratchpad; run with the
sandbox disabled; import playwright from this skill's own node_modules by
absolute `file://` URL — adjust the home path if this skill is ever copied
elsewhere). ALWAYS `try/finally` the close — a thrown `evaluate` otherwise
leaks a headless chromium, and enough of those starve test runners:

```js
import { chromium } from "file:///Users/tuckerlemos/.claude/skills/matching-a-page/node_modules/playwright/index.mjs";
````

with:

````
Probe pattern (write probes to `matching/` and run them **from the site
root**, with the sandbox disabled). Import chromium from the site's own
`@playwright/test` — reddoor-starter has carried it since `package.json:30`
(`"@playwright/test": "^1.60.0"`), and Beachfront too — so the probe needs no
path into this skill and travels with the repo. ALWAYS `try/finally` the
close — a thrown `evaluate` otherwise leaks a headless chromium, and enough of
those starve test runners:

```js
import { chromium } from "@playwright/test";
````

Leave lines 250, 251, 277 and 322 (`node ~/.claude/skills/matching-a-page/*.mjs`) alone — those resolve through the symlink. Leave the Workspace block (98–109) and Phase 0 steps 1 and 8 alone: **plan E owns those.**

- [ ] **Step 3b: Implement — markup-review's credentials** — in `skills/markup-review/markup.mjs`, lines 4–5 today read:

```js
// Verbs: list | threads | resolve | unresolve. Key: MARKUP_API_KEY in
// ~/Documents/GitHub/reddoor-maintenance/.env (headers only, never printed).
```

replace with:

```js
// Verbs: list | threads | resolve | unresolve. Key: MARKUP_API_KEY from the
// environment, else the fleet credentials file (headers only, never printed).
```

Line 12 today:

```js
const ENV_FILE = join(homedir(), "Documents/GitHub/reddoor-maintenance/.env");
```

replace with:

```js
// Key resolution, most specific first. CONFIG_ENV mirrors reddoor-maint's own
// defaultCredentialsPath() (src/util/credentials.ts:7-10) so one file serves
// the whole fleet; LEGACY_ENV is where the key lived before 2026-09-08 and is
// kept so an un-migrated machine keeps working.
const CONFIG_ENV = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "reddoor-maint",
  "credentials.env",
);
const LEGACY_ENV = join(homedir(), "Documents/GitHub/reddoor-maintenance/.env");
```

`apiKey()` — **lines 24–41 today**, `function apiKey() {` at :24 through its closing `}` at :41 (re-counted against the file; line 22 is `let cachedKey;`, line 23 blank). Replace the whole function, signature and closing brace included:

```js
function apiKey() {
  if (cachedKey !== undefined) return cachedKey;
  const fromEnv = process.env.MARKUP_API_KEY?.trim();
  if (fromEnv) return (cachedKey = fromEnv);
  for (const file of [CONFIG_ENV, LEGACY_ENV]) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const line = text.split("\n").find((l) => l.startsWith("MARKUP_API_KEY="));
    const key = line?.slice("MARKUP_API_KEY=".length).trim();
    if (key) return (cachedKey = key);
  }
  die(
    2,
    `No MARKUP_API_KEY. Export it, or add a MARKUP_API_KEY= line to ${CONFIG_ENV}. ` +
      `Create the key in MarkUp (Workspace settings → Developer Settings, scopes ` +
      `threads:read + threads:write).`,
  );
}
```

and the `USAGE` line **at :224** — `Key: MARKUP_API_KEY in ${ENV_FILE}`, inside the template literal opened at :217 — becomes:

```js
Key: MARKUP_API_KEY — from the environment, else ${CONFIG_ENV}
```

Then in `skills/markup-review/SKILL.md`, line 3 ends `Requires MARKUP_API_KEY in ~/Documents/GitHub/reddoor-maintenance/.env.` — change to `Requires MARKUP_API_KEY in the environment or ~/.config/reddoor-maint/credentials.env.`

- [ ] **Step 3c: Implement — rfp-analyze paths** (sed first, then insert the definition, or the sed rewrites the definition itself):

```bash
cd ~/Documents/GitHub/claude-skills/skills/rfp-analyze
sed -i '' -e 's|~/\.claude/skills/rfp-analyze|$SKILL_DIR|g' \
          -e 's|~/Documents/GitHub|$REDDOOR_REPOS|g' SKILL.md README.md
```

Then insert this immediately **before** the `**Skill scripts:**` line in `SKILL.md`:

```
**Paths:** set `SKILL_DIR="${SKILL_DIR:-$HOME/.claude/skills/rfp-analyze}"` and
`REDDOOR_REPOS="${REDDOOR_REPOS:-$HOME/Documents/GitHub}"` at the start of a
run. Everything below is written against them, so nothing here is pinned to one
machine's home.
```

`CLAUDE.md` is edited by hand, not sed — its lines 15–19 are prose _about_ the symlink and must keep the literal path. Replace `**The repo is symlinked into `~/.claude/skills/rfp-analyze`**, so scripts are` with:

```
**This skill now lives in `reddoorla/claude-skills` at `skills/rfp-analyze`**,
symlinked to `~/.claude/skills/rfp-analyze` by that repo's `install.sh`, so
scripts are
```

- [ ] **Step 3d: Implement — svelte4-to-5-upgrade**

```bash
cd ~/Documents/GitHub/claude-skills/skills/svelte4-to-5-upgrade
sed -i '' -e 's|~/Documents/GitHub|$REDDOOR_REPOS|g' \
          -e 's|pnpm@10\.33\.1|pnpm@11.11.0|' SKILL.md
```

(The pin is verified stale: `reddoor-starter/package.json:56` and `beachfront-dentistry/package.json:50` are both `"packageManager": "pnpm@11.11.0"`.) Then insert after the `## Canonical reference` heading:

```
Paths below use `$REDDOOR_REPOS` — `REDDOOR_REPOS="${REDDOOR_REPOS:-$HOME/Documents/GitHub}"`.
```

- [ ] **Step 3e: Implement — new-site**

```bash
cd ~/Documents/GitHub/claude-skills/skills/new-site
sed -i '' -e 's|~/Documents/GitHub|$REDDOOR_REPOS|g' SKILL.md
```

That rewrites lines 20, 71 and 84 only. **Leave `node dist/cli/bin.js` alone — plan E owns new-site's command forms.** Then insert before the `## Scriptable steps (do these)` heading:

```
Clone paths below use `$REDDOOR_REPOS` — `REDDOOR_REPOS="${REDDOOR_REPOS:-$HOME/Documents/GitHub}"`.
```

- [ ] **Step 4: Run it and watch it pass, and show the markup artefact**

```bash
cd ~/Documents/GitHub/claude-skills
node --test test/            # -> # pass 1  # fail 0
node --check skills/markup-review/markup.mjs   # the whole-function replacement parses
XDG_CONFIG_HOME=/tmp/xdg-probe node skills/markup-review/markup.mjs --help | grep '^Key:'
```

Expected last line, exactly: `Key: MARKUP_API_KEY — from the environment, else /tmp/xdg-probe/reddoor-maint/credentials.env`

```bash
grep -c 'REDDOOR_REPOS' skills/new-site/SKILL.md skills/svelte4-to-5-upgrade/SKILL.md skills/rfp-analyze/SKILL.md
grep -c 'SKILL_DIR' skills/rfp-analyze/SKILL.md
grep -n 'pnpm@' skills/svelte4-to-5-upgrade/SKILL.md    # -> pnpm@11.11.0
```

Each count must be non-zero.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/claude-skills
git add -A
git commit -m "$(cat <<'EOF'
fix: no skill is pinned to one machine's home directory any more

One absolute path (the matching-a-page probe's file:// playwright import) and
~25 ~/Documents/GitHub references assumed this laptop's clone layout. Probes
now import the SITE's @playwright/test, which is already a starter dependency
and travels with the repo; the rest go through $REDDOOR_REPOS / $SKILL_DIR,
defaulted in each skill. markup.mjs reads MARKUP_API_KEY from the environment
or the fleet credentials file, with the old sibling-checkout .env kept as a
last resort so an un-migrated machine keeps working. A test enforces the class.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: install.sh and the installability suite

**Files:** Create: `install.sh` · Modify: `test/skills.test.mjs`

- [ ] **Step 1: Write the failing tests** — append to `test/skills.test.mjs`:

```js
import { mkdtempSync, mkdirSync, readlinkSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SKILLS = readdirSync(join(REPO, "skills"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

/** Run install.sh against a throwaway HOME and return it. */
function installToTempHome() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "skills-home-")));
  const r = spawnSync("bash", [join(REPO, "install.sh")], {
    env: { ...process.env, HOME: home },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return home;
}

test("all seven skills declare a frontmatter name equal to their directory", () => {
  assert.equal(SKILLS.length, 7, `expected 7 skills, found: ${SKILLS.join(", ")}`);
  for (const name of SKILLS) {
    const md = readFileSync(join(REPO, "skills", name, "SKILL.md"), "utf8");
    const fm = md.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, `${name}: no YAML frontmatter block`);
    const declared = fm[1].match(/^name:\s*(\S+)\s*$/m);
    assert.ok(declared, `${name}: frontmatter has no name:`);
    assert.equal(declared[1], name, `${name}: frontmatter name must equal the directory`);
    assert.match(fm[1], /^description:\s*\S/m, `${name}: frontmatter has no description`);
  }
});

test("install.sh links every skill into a fresh HOME, twice, and refuses a real dir", () => {
  const home = installToTempHome();
  for (const name of SKILLS) {
    const link = join(home, ".claude", "skills", name);
    assert.equal(readlinkSync(link), join(REPO, "skills", name));
    assert.equal(realpathSync(link), realpathSync(join(REPO, "skills", name)));
    assert.ok(readFileSync(join(link, "SKILL.md"), "utf8").startsWith("---"));
  }
  // idempotent
  const again = spawnSync("bash", [join(REPO, "install.sh")], {
    env: { ...process.env, HOME: home },
    encoding: "utf8",
  });
  assert.equal(again.status, 0, again.stderr);

  // a real directory is refused, never clobbered
  const home2 = realpathSync(mkdtempSync(join(tmpdir(), "skills-home-")));
  mkdirSync(join(home2, ".claude", "skills", SKILLS[0]), { recursive: true });
  const refused = spawnSync("bash", [join(REPO, "install.sh")], {
    env: { ...process.env, HOME: home2 },
    encoding: "utf8",
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /REFUSED: .* is a real directory/);
});

test("a CLI reaches its argument parser when invoked through the symlink", () => {
  const home = installToTempHome();
  const markup = join(home, ".claude", "skills", "markup-review", "markup.mjs");
  const r = spawnSync(process.execPath, [markup], { encoding: "utf8" });
  assert.equal(r.status, 1); // no verb -> usage
  assert.match(r.stderr, /markup\.mjs — MarkUp\.io review rounds/);

  const help = spawnSync(process.execPath, [markup, "--help"], {
    env: { ...process.env, XDG_CONFIG_HOME: join(home, "cfg") },
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /reddoor-maint\/credentials\.env/);
});

test("the entry-point check holds through the symlinked install path", async () => {
  const home = installToTempHome();
  const { isMain } = await import(
    pathToFileURL(join(REPO, "skills/matching-a-page/lib/is-main.mjs")).href
  );
  const real = join(REPO, "skills", "matching-a-page", "page-diff.mjs");
  const viaLink = join(home, ".claude", "skills", "matching-a-page", "page-diff.mjs");
  assert.equal(isMain(pathToFileURL(real).href, viaLink), true);
  assert.notEqual(pathToFileURL(viaLink).href, pathToFileURL(real).href);
});

// The test above proves is-main.mjs is CORRECT; it says nothing about whether
// page-diff.mjs and style-census.mjs actually ADOPTED it — it would stay green
// with Task 5's edits reverted. The whole point of Task 5 is the adoption, and
// the end-to-end proof (a bare `page-diff` printing usage, exit 2, through the
// symlink) needs playwright + browsers and so cannot live in this zero-dep
// suite. This is the dependency-free stand-in: it reads the source. Mutating
// either file back to the old compare turns it red.
test("the two guarded CLIs use isMain, and the two unguarded ones say why", () => {
  for (const rel of [
    "skills/matching-a-page/page-diff.mjs",
    "skills/matching-a-page/style-census.mjs",
  ]) {
    const src = readFileSync(join(REPO, rel), "utf8");
    assert.match(
      src,
      /import \{ isMain \} from "\.\/lib\/is-main\.mjs"/,
      `${rel}: must import isMain`,
    );
    assert.doesNotMatch(
      src,
      /import\.meta\.url === pathToFileURL/,
      `${rel}: the naive compare is false through a symlink — exit 0, no output`,
    );
  }
  assert.match(
    readFileSync(join(REPO, "skills/matching-a-page/text-diff.mjs"), "utf8"),
    /No isMain\(\) guard here, deliberately/,
    "text-diff.mjs: keep the comment, or someone adds a broken guard",
  );
  assert.match(
    readFileSync(join(REPO, "skills/markup-review/markup.mjs"), "utf8"),
    /No entry-point guard/,
    "markup.mjs: keep the comment, or someone adds a broken guard",
  );
});
```

- [ ] **Step 2: Run them and watch them fail** — `cd ~/Documents/GitHub/claude-skills && node --test test/` → three failures; the install ones report `bash: .../install.sh: No such file or directory` with `r.status` `127`, e.g. `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 127 !== 0`. The frontmatter test and the isMain-adoption test should already pass (7 skills with matching names; Task 5 already made the edits) — the adoption test is proved non-vacuous by mutation in Step 4, not here.

- [ ] **Step 3: Implement** — create `install.sh`:

```bash
#!/usr/bin/env bash
# Symlink every skill in this repo into ~/.claude/skills.
#
# Claude Code discovers a personal skill at ~/.claude/skills/<name>/SKILL.md,
# and a symlink there is discovered exactly like a real directory (proven since
# 2026-05-18 by rfp-analyze). That is why the source of truth can be a git repo
# while every `node ~/.claude/skills/<skill>/x.mjs` in a SKILL.md — and
# beachfront-dentistry's matching/gate.sh:31 and census.sh:18 — keeps working.
# The plugin/marketplace layout would namespace the skills (reddoor:<name>) and
# install them at a versioned cache path, breaking all of those.
#
# Idempotent: re-running relinks. It REFUSES to replace a real directory. On a
# machine that still has the pre-repo copies, that directory may be the only
# copy of a skill that has no remote — the message says how to move it aside.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEST="${HOME}/.claude/skills"
mkdir -p "$DEST"

linked=0
for dir in "$REPO"/skills/*/; do
  [ -f "${dir}SKILL.md" ] || continue
  name="$(basename "$dir")"
  target="$DEST/$name"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "REFUSED: $target is a real directory, not a symlink." >&2
    echo "  Move it aside first:  mv '$target' '$target.backup-$(date +%Y%m%d)'" >&2
    exit 1
  fi
  ln -sfn "${REPO}/skills/${name}" "$target"
  echo "$name -> $(readlink "$target")"
  linked=$((linked + 1))
done

if [ "$linked" -eq 0 ]; then
  echo "REFUSED: no skills found under $REPO/skills" >&2
  exit 1
fi
echo "linked $linked skill(s) into $DEST"
```

Then `chmod +x install.sh`.

- [ ] **Step 4: Run them and watch them pass, then break the adoption test on purpose**

```bash
cd ~/Documents/GitHub/claude-skills
node --test test/            # -> # pass 6  # fail 0
H="$(mktemp -d)"; HOME="$H" bash install.sh
```

Expected: `# pass 6  # fail 0`, then seven lines of the form `matching-a-page -> /Users/…/claude-skills/skills/matching-a-page` and `linked 7 skill(s) into <H>/.claude/skills`.

Now mutate, so the adoption test is known to measure the thing it names:

```bash
cd ~/Documents/GitHub/claude-skills
sed -i '' 's|^import { isMain } from "./lib/is-main.mjs";|import { pathToFileURL } from "node:url";|' \
  skills/matching-a-page/page-diff.mjs
node --test test/ 2>&1 | grep -E '^# (pass|fail)'
git checkout -- skills/matching-a-page/page-diff.mjs
node --test test/ 2>&1 | grep -E '^# (pass|fail)'
```

Expected: `# pass 5` / `# fail 1` with `page-diff.mjs: must import isMain`, then `# pass 6` / `# fail 0` again after the restore. If the mutated run stays green the test is measuring nothing — fix it before continuing.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/claude-skills
git add install.sh test/skills.test.mjs
git commit -m "$(cat <<'EOF'
feat: install.sh, and a suite that proves a fresh install actually works

The gate is an artefact only a working install produces: seven readlinks into
this checkout, a SKILL.md readable through each, and a CLI reaching its
argument parser when invoked through the symlink. install.sh refuses to
replace a real directory — on this machine six of the seven still are one, and
five have no other copy anywhere. One more test reads page-diff.mjs and
style-census.mjs and asserts they import isMain: proving is-main.mjs correct
says nothing about whether the CLIs adopted it, and the end-to-end proof needs
browsers this zero-dependency suite cannot have.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: README and first push

**Files:** Create: `README.md`

- [ ] **Step 1: Write the README** — run this command as given. The README's own body contains fenced code blocks, so it must be written through a quoted heredoc, not pasted out of a fence: a copy that stops at the first inner ``` writes a truncated README, and nothing in the suite would catch it.

````bash
cat > ~/Documents/GitHub/claude-skills/README.md <<'READMEEOF'
# claude-skills

The seven Claude Code skills the Reddoor fleet runs on, one directory each
under `skills/`. Private.

## Install

```bash
git clone git@github.com:reddoorla/claude-skills.git ~/Documents/GitHub/claude-skills
cd ~/Documents/GitHub/claude-skills
bash install.sh          # symlinks each skills/<name> into ~/.claude/skills/<name>
npm test                 # zero dependencies; proves the install
```

`install.sh` refuses to replace a real directory under `~/.claude/skills`. If
you are migrating a machine that still has the pre-repo copies, move them aside
first (`mv ~/.claude/skills/<name> ~/.claude/skills/<name>.backup-YYYYMMDD`).

Two skills carry their own dependencies and are installed per-skill, not by
this repo's root `package.json`. Each line is a subshell so both start from the
repo root — chaining bare `cd`s leaves you inside the first skill and the
second one fails with `No such file or directory`:

```bash
(cd skills/matching-a-page && npm install)   # playwright + browsers
(cd skills/rfp-analyze && npm install && npx playwright install chromium)
```

Both need the sandbox disabled: playwright's postinstall downloads browsers
from a CDN the Claude Code sandbox blocks.

## Conventions

- `REDDOOR_REPOS` — where the fleet's clones live; defaults to
  `$HOME/Documents/GitHub`. Every skill that reads a sibling repo goes through
  it. No skill hard-codes an absolute home path; `test/skills.test.mjs`
  enforces that.
- `SKILL_DIR` — a skill's own directory, defaulting to
  `$HOME/.claude/skills/<name>`. Scripts are invoked through it.
- Credentials — from the environment, else
  `~/.config/reddoor-maint/credentials.env`, the file `reddoor-maint` reads. No
  secret value is ever committed or printed.
- Entry points — every CLI that guards "am I the entry point?" uses
  `skills/matching-a-page/lib/is-main.mjs` (`realpathSync(argv[1])`). Through a
  symlink the naive `import.meta.url === pathToFileURL(argv[1]).href` compare
  is always false and the CLI exits 0 having done nothing. `text-diff.mjs` and
  `markup-review/markup.mjs` have no guard on purpose — top-level CLI bodies —
  and each says so in a comment.

## Traps

- **Never squash a subtree import.** `skills/matching-a-page` (30 commits) and
  `skills/rfp-analyze` (23) came in via `git subtree add`, which preserves
  their original SHAs — `4912eaf`, `564f01d`, `8d6c203`, `c7cf716` all resolve
  here. A squash merge of a PR carrying them destroys exactly that. Land
  history-bearing work on `main` directly, or merge with a real merge commit.
- **Symlinks, not a plugin.** A plugin would namespace these as
  `reddoor:<name>` and install them under
  `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, breaking every
  `node ~/.claude/skills/<skill>/x.mjs` in the SKILL.md files and in
  beachfront-dentistry's `matching/gate.sh:31` / `census.sh:18`. `skills/` at
  the repo root is already the plugin layout, so `.claude-plugin/plugin.json`
  can be added later without moving files; `claude --plugin-dir <path>` is the
  session-only way to try it.
- **Project-scope `.claude/skills/` is unusable here** — the global ignore
  `~/.config/git/ignore:1` is `**/.claude/`.

## Open

- `svelte4-to-5-upgrade` overlaps the maintenance recipe `svelte-4-to-5`
  (`src/recipes/svelte-5/`). Keep as narrative, or retire into the recipe's
  docs? Undecided.
- No CI. `npm test` is the whole gate and runs locally.
READMEEOF
````

- [ ] **Step 2: Verify the README landed whole and the suite still passes**

```bash
cd ~/Documents/GitHub/claude-skills
grep -c '^## ' README.md      # -> 4   (Install, Conventions, Traps, Open)
tail -1 README.md
node --test test/             # -> # pass 6  # fail 0
```

Expected: `4`; the last line exactly ``- No CI. `npm test` is the whole gate and runs locally.``; and `# pass 6  # fail 0` (the README uses `$HOME`, never `/Users/`, so the machine-path test stays green). A `grep` count below 4 means the heredoc was truncated — rewrite it, do not patch the tail.

- [ ] **Step 3: Commit and push**

```bash
cd ~/Documents/GitHub/claude-skills
git add README.md
git commit -m "$(cat <<'EOF'
docs: README — install, the two path conventions, and the no-squash trap

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin main
```

- [ ] **Step 4: Verify the push landed with the history intact**

```bash
gh api repos/reddoorla/claude-skills/commits/4912eaf --jq .sha
gh api repos/reddoorla/claude-skills/commits/c7cf716 --jq .sha
gh repo view reddoorla/claude-skills --json isPrivate,defaultBranchRef \
  -q '"private=" + (.isPrivate|tostring) + " branch=" + .defaultBranchRef.name'
```

Expected: both SHAs echo back (the imported commits are on the remote, not just locally), and `private=true branch=main`.

---

### Task 10: Cut over this machine

**Files:** Modify: `~/.claude/skills/*` (six real directories moved aside, seven symlinks created)

**UNSANDBOXED:** every write in this task lands under `~/.claude/skills`, which the Bash sandbox denies (`denyWithinAllow`). Run these with the sandbox disabled. They are non-destructive: directories are **moved**, never deleted, and the backup path is printed.

- [ ] **Step 1: Back up the six real directories and drop the old rfp-analyze symlink**

```bash
BK="$HOME/.claude/skills-backup-$(date +%Y%m%d)"
mkdir -p "$BK"
for s in matching-a-page new-site figma-slices markup-review evening-review svelte4-to-5-upgrade; do
  mv "$HOME/.claude/skills/$s" "$BK/$s"
done
unlink "$HOME/.claude/skills/rfp-analyze"
ls -la "$HOME/.claude/skills"   # empty
du -sh "$BK"                    # ~354M, dominated by matching-a-page's out*/ dirs
```

The backup keeps the 17 `out*/` capture directories and both `node_modules` trees, none of which were imported. Do not delete it in this session.

- [ ] **Step 2: Install**

```bash
bash ~/Documents/GitHub/claude-skills/install.sh
```

Expected: seven `<name> -> /Users/tuckerlemos/Documents/GitHub/claude-skills/skills/<name>` lines, then `linked 7 skill(s) into /Users/tuckerlemos/.claude/skills`.

- [ ] **Step 3: Verify all seven resolve into the clone**

```bash
for s in evening-review figma-slices markup-review matching-a-page new-site rfp-analyze svelte4-to-5-upgrade; do
  printf '%-24s %s\n' "$s" "$(readlink "$HOME/.claude/skills/$s")"
  head -2 "$HOME/.claude/skills/$s/SKILL.md" | tail -1
done
```

Expected: seven target paths under `~/Documents/GitHub/claude-skills/skills/`, each followed by `name: <that same name>`.

- [ ] **Step 4: Re-verify matching-a-page's dependencies and prove the tools run through the symlink**

Task 6 Step 0 already ran `npm install` here; this is a re-verify (idempotent, and it confirms the cut-over did not move anything out from under `node_modules`). It still downloads playwright browsers from a CDN the sandbox blocks — run it with the sandbox disabled.

```bash
cd ~/Documents/GitHub/claude-skills/skills/matching-a-page
npm install
npm test                                     # the skill's own suite, incl. the new --version test
node "$HOME/.claude/skills/matching-a-page/page-diff.mjs" --version
node "$HOME/.claude/skills/matching-a-page/page-diff.mjs"
```

Expected: `npm test` green; `--version` prints exactly `page-diff 0.1.0 report-schema 1`; the bare invocation prints `usage: page-diff --ref <url> --cand <url> …` and exits 2. That last pair is the positive evidence that the realpath guard fires through the symlink — before Task 5 it would have printed nothing and exited 0.

Note: `node_modules/` and `out/` under `skills/matching-a-page` are ignored by the repo's `.gitignore`; confirm with `git -C ~/Documents/GitHub/claude-skills status --short` → clean.

- [ ] **Step 5: Prove the paths Beachfront's scripts use resolve to a runnable tool**

`matching/gate.sh:31` is `PD="$HOME/.claude/skills/matching-a-page/page-diff.mjs"` and `census.sh:18` is `SC="$HOME/.claude/skills/matching-a-page/style-census.mjs"` (both verified by `grep -n` while writing this plan). Both hosts in `gate.sh` are dead (D11), so a real gate run is impossible; run the **resolution** instead.

Do **not** use `bash matching/gate.sh` as the evidence. `PD=` is a bare shell assignment — it succeeds whether or not the file exists — and `gate.sh:41` is `TAG="${1:?usage: gate.sh <round-tag> [page ...]}"`, which aborts before `PD` is ever used. Its output is identical with the whole skills directory deleted: a green granted by the absence of an error, under a name for something it cannot observe. That is the shape this project bans.

```bash
cd ~/Documents/GitHub/beachfront-dentistry
grep -n '^PD=' matching/gate.sh          # PD="$HOME/.claude/skills/matching-a-page/page-diff.mjs"
grep -n '^SC=' matching/census.sh        # SC="$HOME/.claude/skills/matching-a-page/style-census.mjs"

PD="$HOME/.claude/skills/matching-a-page/page-diff.mjs"
test -f "$PD" && node "$PD" --version

SC="$HOME/.claude/skills/matching-a-page/style-census.mjs"
node "$SC" --ref x ; echo "exit=$?"
```

Expected: the two `grep`s echo those exact assignments (so the paths being exercised are the ones the scripts use, not a paraphrase); `test -f` succeeds and prints `page-diff 0.1.0 report-schema 1`; then `usage: node style-census.mjs --ref <url> --cand <url> [--vw 1440]` with `exit=2`.

The `style-census` line is the differential one: **before** Task 5, that guard was false through the symlink, so the CLI printed nothing and exited 0. A usage string plus `exit=2` is an artefact only the fixed, correctly-linked tool produces.

- [ ] **Step 6: OPERATOR — confirm discovery in a fresh session.** There is no `claude skills list` subcommand (checked against 2.1.92 `--help`). Open a **new** Claude Code session and ask "What Skills are available?"; all seven of `matching-a-page`, `new-site`, `figma-slices`, `markup-review`, `evening-review`, `svelte4-to-5-upgrade`, `rfp-analyze` must be listed, and `/matching-a-page` must invoke. Paste the list into the journal entry in Task 11. If a skill is missing, the symlink is not the cause to assume — check `readlink` first (Step 3), then the frontmatter `name:`.

---

### Task 11: Records

**Files:** Create/modify: `~/Documents/GitHub/claude-skills/docs/workJournal.md`, `~/Documents/GitHub/rfp-analyze/docs/workJournal.md`

- [ ] **Step 1: Append the claude-skills journal entry** to `docs/workJournal.md`:

```markdown
## 2026-09-08 — Seven skills stop being loose directories (`reddoorla/claude-skills`)

Why now: the matching harness that plan BC installs into a site repo has to
locate `page-diff.mjs` somewhere, and until today "somewhere" was a directory
on one laptop with no remote, no version and no way for a site to say which
version of the report format it was scoring. Five of the seven skills existed
in exactly one place on earth. That is the thing this repo fixes; the tidiness
is a side effect.

`matching-a-page` and `rfp-analyze` came in through `git subtree add`, so
`4912eaf`, `564f01d`, `8d6c203` and `c7cf716` still resolve here — those commit
messages carry the design rationale for the gate tools and are the only record
of it. The other five had no git history anywhere, so they got one honest first
commit each. **Do not squash a PR that carries a subtree import**; that
destroys precisely what the import was for, which is why the whole import
landed on `main` directly rather than through a PR.

The import needed one trick. `~/.claude/skills/matching-a-page` is 354 MB, and
71.1 MiB of its `.git` is unreachable objects left by an aborted `git add` (its
own commit `564f01d` calls it "the git-add hang"). `git clone --no-local`
forces the transport path, which sends only reachable objects: the clone's
`.git` measured **216K** with all 30 commits, versus a hardlinking local clone
that would have carried the garbage in. `git gc --prune=now` afterwards is
belt-and-braces.

Two defects fixed on the way in, both of which would have shipped silently.
First, the entry-point checks. Measured on Node 24: reached through a symlink,
`process.argv[1]` keeps the symlink path while `import.meta.url` is the real
one, so `import.meta.url === pathToFileURL(process.argv[1]).href` is **false**
and the CLI exits 0 having done nothing, with no error to notice — and it is
false even for a direct call whose path merely crosses a symlink, so `$TMPDIR`
reproduces it. rfp-analyze hit this and fixed it in `c7cf716`; `page-diff.mjs`
and `style-census.mjs` had the same shape and had simply never been run through
a symlink. The fix is factored into `lib/is-main.mjs` and tested against a real
symlinked fixture rather than retyped a third time. `text-diff.mjs` and
`markup.mjs` turned out to have **no** guard at all — top-level CLI bodies,
symlink-safe by construction — so each now says why, because the obvious
"consistency" fix would break them.

Second, machine dependence. Exactly one absolute `/Users/…` path existed across
all 83 tracked skill files: the probe pattern at `matching-a-page/SKILL.md:173`,
importing playwright from this laptop's `node_modules` by `file://` URL. It is
now `import { chromium } from "@playwright/test"` run from the site root —
`reddoor-starter/package.json:30` has carried that dependency since before
Beachfront — so the probe travels with the repo. The ~25 `~/Documents/GitHub`
references were not caught by that class and went through `$REDDOOR_REPOS` /
`$SKILL_DIR` by hand. `markup.mjs` now reads its key from the environment or
`~/.config/reddoor-maint/credentials.env`, with the old sibling-checkout `.env`
kept as a last resort so an un-migrated machine keeps working.

`REPORT_SCHEMA` (currently 1) is exported from `lib/report.mjs`, stamped into
every report's `meta`, and printed by `page-diff --version`. Nothing consumes
it yet; plans BC and E do. It is here because the skill is the only place a
version identity can honestly live.

Belief corrected on contact: the plan assumed all four CLIs had a guard to make
realpath-safe. Two did. Reading them was the difference between a two-line fix
and a refactor of `text-diff.mjs` that would have moved `VW` out of `grab()`'s
closure for no benefit.

Not done here, deliberately: the `matching-a-page` Workspace and Phase 0
rewrite (plan E's — it replaces the hand-created `matching/` tree with the
`match-harness` recipe invocation), a CI workflow, and the
`svelte4-to-5-upgrade` keep-or-retire question, which is in the README's Open
section.

Cut-over: the six real directories under `~/.claude/skills` moved to
`~/.claude/skills-backup-<date>` (kept — 354 MB of capture dirs and two
`node_modules` trees that were never imported), the old `rfp-analyze` symlink
replaced, `install.sh` linked all seven. Evidence: seven `readlink`s into the
clone, `page-diff --version` printing `page-diff 0.1.0 report-schema 1` through
the symlink, and bare `page-diff` / `style-census --ref x` printing their usage
and exiting 2 (before today's fix, through a symlink: no output, exit 0).

One piece of evidence was rejected while writing this down. The obvious check —
`bash matching/gate.sh` in Beachfront, "does it still load?" — proves nothing.
`gate.sh:31` `PD=…` is a bare shell assignment that succeeds whether or not the
file exists, and `gate.sh:41` `TAG="${1:?usage…}"` aborts before `PD` is ever
used, so the output is byte-identical with `~/.claude/skills` deleted. It is
the banned shape: a green granted by the absence of an error, named after
something it cannot observe. What replaced it is `test -f "$PD" && node "$PD"
--version` on the exact string the script assigns.
```

- [ ] **Step 2: Commit and push it**

```bash
cd ~/Documents/GitHub/claude-skills
git add docs/workJournal.md
git commit -m "$(cat <<'EOF'
docs: journal the import, the two defects it surfaced, and the cut-over

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

- [ ] **Step 3: Append the rfp-analyze tombstone entry** to `~/Documents/GitHub/rfp-analyze/docs/workJournal.md`:

```markdown
## 2026-09-08 — This repo moved into `reddoorla/claude-skills`

All 23 commits through `56d4d25` — including `c7cf716`, the symlink fix every
other skill in the fleet has now inherited — went in with `git subtree add
--prefix=skills/rfp-analyze`, so those SHAs still resolve there.
`~/.claude/skills/rfp-analyze` now points at `claude-skills/skills/rfp-analyze`.

The uncommitted `SKILL.md` change this journal flagged on 2026-09-05 (the
handbook moving to the estimates repo root) was committed first, so the import
took a clean tree. `SKILL.md` and `README.md` were then rewritten to
`$SKILL_DIR` / `$REDDOOR_REPOS` **in the new repo** — this clone still has the
old paths and is a tombstone, not a fork to sync.
```

- [ ] **Step 4: Commit it**

```bash
cd ~/Documents/GitHub/rfp-analyze
git add docs/workJournal.md
git commit -m "$(cat <<'EOF'
docs: this repo is now a subtree of reddoorla/claude-skills

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git log --oneline -3
```

- [ ] **Step 5: Verify** — `git -C ~/Documents/GitHub/rfp-analyze status --short` is clean, and `git -C ~/Documents/GitHub/claude-skills log --oneline origin/main -1` matches the local `main`.

---

## Verification

C1's acceptance gate from the spec — "on this machine, `~/.claude/skills/<name>` resolves into the clone for all seven, each `SKILL.md` frontmatter parses, and `/matching-a-page` still invokes" — as commands and the artefacts they must produce:

```bash
# 1. All seven resolve into the clone, and each declares its own name.
for s in evening-review figma-slices markup-review matching-a-page \
         new-site rfp-analyze svelte4-to-5-upgrade; do
  printf '%-24s %s | %s\n' "$s" \
    "$(readlink "$HOME/.claude/skills/$s")" \
    "$(sed -n '2p' "$HOME/.claude/skills/$s/SKILL.md")"
done
```

→ seven rows, each target under `~/Documents/GitHub/claude-skills/skills/`, each second field `name: <that same name>`.

```bash
# 2. The suite passes from a clean checkout state.
cd ~/Documents/GitHub/claude-skills && npm test
```

→ `# pass 6  # fail 0`.

```bash
# 3. The gate tools run THROUGH the symlink and identify their schema.
node "$HOME/.claude/skills/matching-a-page/page-diff.mjs" --version
node "$HOME/.claude/skills/matching-a-page/page-diff.mjs" ; echo "exit=$?"
```

→ `page-diff 0.1.0 report-schema 1`; then `usage: page-diff --ref <url> …` and `exit=2`. (An exit 0 with no output is the pre-fix failure this replaces.)

```bash
# 4. The imported histories are real, locally and on the remote.
git -C ~/Documents/GitHub/claude-skills cat-file -t 4912eaf   # commit
git -C ~/Documents/GitHub/claude-skills cat-file -t c7cf716   # commit
gh api repos/reddoorla/claude-skills/commits/4912eaf --jq .sha
gh api repos/reddoorla/claude-skills/commits/c7cf716 --jq .sha
```

→ `commit`, `commit`, then both full SHAs echoed by the API.

```bash
# 5. The paths gate.sh/census.sh use resolve to a runnable tool.
cd ~/Documents/GitHub/beachfront-dentistry
grep -n '^PD=' matching/gate.sh ; grep -n '^SC=' matching/census.sh
PD="$HOME/.claude/skills/matching-a-page/page-diff.mjs"; test -f "$PD" && node "$PD" --version
SC="$HOME/.claude/skills/matching-a-page/style-census.mjs"; node "$SC" --ref x ; echo "exit=$?"
```

→ `31:PD="$HOME/.claude/skills/matching-a-page/page-diff.mjs"` and `18:SC="$HOME/.claude/skills/matching-a-page/style-census.mjs"`; then `page-diff 0.1.0 report-schema 1`; then `usage: node style-census.mjs --ref <url> --cand <url> [--vw 1440]` and `exit=2`. (`bash matching/gate.sh` is **not** the gate: `PD=` is a bare assignment and `gate.sh:41` aborts on the missing tag before `PD` is used, so its output is identical with the skills directory deleted.)

```bash
# 6. Nothing heavy or secret got committed.
git -C ~/Documents/GitHub/claude-skills ls-files | wc -l              # 89 (83 skill + 6 root)
git -C ~/Documents/GitHub/claude-skills ls-files | grep -c 'out.*/'   # 0
git -C ~/Documents/GitHub/claude-skills ls-files | grep -c 'node_modules'  # 0
git -C ~/Documents/GitHub/claude-skills ls-files | grep -c '\.claude/'     # 0
git -C ~/Documents/GitHub/claude-skills grep -nIE 'MARKUP_API_KEY=[^"]' -- skills
```

→ `89`, `0`, `0`, `0`, and the last command prints **exactly one line** — the die() message, which names the variable and never a value:

```
skills/markup-review/markup.mjs:<n>:      `No MARKUP_API_KEY. Export it, or add a MARKUP_API_KEY= line to ${CONFIG_ENV}. ` +
```

(The two `startsWith("MARKUP_API_KEY=")` / `"MARKUP_API_KEY=".length` occurrences are already excluded by `[^"]`, which is why the old `| grep -v startsWith` filter was dead and has been dropped. Any second line is a real finding: read it before continuing.)

**OPERATOR (RED tier):** none in this plan. Every step is a local file operation, a commit, or a private-repo create in an org the operator already owns. The two non-GREEN notes are Task 10's UNSANDBOXED writes under `~/.claude/skills` and Task 10 Step 6's fresh-session discovery check, which cannot be performed from inside this session.
