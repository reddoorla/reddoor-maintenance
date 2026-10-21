---
"@reddoorla/maintenance": minor
---

New command: `reddoor-maint check-brief <brief.md> [--cwd <dir>]` (P1-33 next-7, #1598).

It reads a worker brief's **Verify first.** section, where each claim is one line, `<claim> — \`<command>\` → exit <n>[, prints "<text>"]`or`<claim> [I]`, and runs each command so a worker knows which facts hold before building on them. Only an allowlist of read-only command forms runs (`gh api`with nothing but`--jq`after the path, read-only`git`subcommands,`grep`, `rg`, `ls`, `cat`, `head`, `tail`, `wc`, `test`, `sed -n <a>[,<b>]p`, `npm view`, `--version`), through `execFile`with no shell; a built-in`env-set NAME`says set or unset and never prints the value. Each line gets PASS, FAIL, COULD NOT RUN or NOT RUN, with no command output in the report, and the command warns on absence claims with no`Control:` line and on identifiers that no line covers. Exit 1 when any line fails.
