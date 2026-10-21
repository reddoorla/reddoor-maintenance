---
"@reddoorla/maintenance": minor
---

New command: `reddoor-maint check-brief <brief.md> [--cwd <dir>]` (P1-33 next-7, #1598).

It reads a worker brief's **Verify first.** section and runs each claim's command, so a worker knows which facts hold before building on them. Each claim is one line in one of two forms:

```
- <claim> — `<command>` → exit <n>[, prints "<text>"] [laptop]
- <claim> [I]
```

An absence claim is followed by a `Control:` line: an absence that passes while its control does not is reported as COULD NOT RUN, and an absence with no control line still runs but is warned on. `prints` matches a whole token of the output, so `0` is not found in `10`, while a leading `v` may stand before a version.

Only an allowlist of read-only command forms runs:

- `gh api <path>` with nothing but `--jq` after it (no URL, and no `$`, `env` or `input` in the expression);
- `git` for metadata only: `log` (no patches, pickaxe or stats), `rev-parse`, `ls-files`, `merge-base`, `describe` and `status`, each with its own short list of flags. An option's value is written `--opt=value`, never as the next word, and `--format`/`--pretty` take a fixed set of placeholders (ids, names, emails, dates, subject, body, refs). Every git command runs with no optional locks and no config-driven programs. Git's content readers (`grep`, `diff`, `show`, `cat-file`, `blame`) are not allowed, and neither are the stash or the reflog, which hold uncommitted content. Check a quoted position with `rg -F` or `grep -F` instead;
- `ls`, `cat`, `head`, `tail`, `wc`, `grep` and `rg`, each with a short list of harmless flags (no recursion into hidden or ignored files), plus `test -e|-f|-d|-s <path>` and `sed -n <a>[,<b>]p <file>`. Every path is confined to `--cwd` after symlinks resolve;
- `node`, `pnpm` or `npm` with `--version`.

Commands run through `execFile` with no shell, no stdin and a minimal environment. Secret-shaped files (`.env` and its kin, `.npmrc`, keys, credentials, anything under `.git/`) are refused, including inside a recursive `rg`. `git status` and `git ls-files -m` can still say that a secret-shaped file was modified, but not what it holds. Content already committed to the repository is out of scope: whoever reads the PR can read the repository. The built-in `env-set NAME` says set or unset and never prints the value. It reads the CLI's environment, which includes `~/.config/reddoor-maint/credentials.env`.

Each line gets PASS, FAIL, COULD NOT RUN or NOT RUN, and the report never includes command output. It warns on absence claims with no control and on identifiers that no line covers. It exits 1 when any line fails.
