---
"@reddoorla/maintenance": minor
---

New command: `reddoor-maint check-brief <brief.md> [--cwd <dir>]` (P1-33 next-7, #1598).

It reads a worker brief's **Verify first.** section and runs each claim's command, so a worker knows which facts hold before building on them. Each claim is one line in one of two forms:

```
- <claim> — `<command>` → exit <n>[, prints "<text>"] [laptop]
- <claim> [I]
```

An absence claim is followed by a `Control:` line, and passes only when its control passes too.

Only an allowlist of read-only command forms runs: `gh api <path>` with nothing but `--jq` after it; read-only `git` subcommands, run with no optional locks, no textconv and no config-driven programs, and with no option that reads outside the repository; `ls`, `cat`, `head`, `tail`, `wc`, `grep` and `rg` with a short list of harmless flags each (no recursion into hidden or ignored files), `test -e|-f|-d|-s <path>` and `sed -n <a>[,<b>]p <file>`, every path confined to `--cwd` after symlinks resolve; `npm view <pkg>` with no options; and `node`, `pnpm` or `npm` with `--version`. Commands run through `execFile` with no shell, no stdin and a minimal environment, and secret-shaped files (`.env`, `.npmrc`, keys) are refused. The built-in `env-set NAME` says set or unset and never prints the value. It reads the CLI's environment, which includes `~/.config/reddoor-maint/credentials.env`.

Each line gets PASS, FAIL, COULD NOT RUN or NOT RUN, and the report never includes command output. It warns on absence claims with no control and on identifiers that no line covers. It exits 1 when any line fails.
