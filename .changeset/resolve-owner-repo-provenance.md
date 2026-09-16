---
"@reddoorla/maintenance": patch
---

resolveOwnerRepo proves the GitHub write identity instead of deriving one (#712)

`parseOwnerRepo` stripped `^https?://[^/]+/` — discarding the HOST — and
returned the last two path segments of whatever was left. Every one of these
produced a correctly-shaped GitHub `owner/repo` for a repository the code was
not in: `https://gitlab.com/acme/site.git` → `acme/site` (written on GitHub),
`https://user@evil.example.com/attacker/target` → `attacker/target`,
`https://github.com/ok/repo/../../evil/target` → `evil/target`,
`https://github.com/ok/repo?x=/evil/other` → `evil/other`, and a local-path
origin — not exotic in a bootstrap flow that clones from a template —
→ `GitHub/reddoor-starter`. The remote is now parsed: the host must be
`github.com` (or GitHub's `ssh.github.com` / `www.github.com`), the path must be
exactly two segments, and a `..` anywhere is refused rather than normalised,
because https and ssh disagree about which repository such a URL names.

`resolveOwnerRepo` also stopped inferring in two other ways. `git remote
get-url` walks UP, so a site directory with no clone in it yet — what the
positional `/new-site` route points at — resolved to whatever repository
enclosed it; run from under the maintenance checkout, the token secret and
ruleset landed on `reddoorla/reddoor-maintenance`. It now refuses unless
`site.path` is the work tree root, naming both the directory asked about and
the checkout git walked up to. And the catch no longer collapses every git
failure to `null`: only "not a work tree" and "no origin configured" are the
benign nothing-wired state, while ENOENT, EACCES and dubious-ownership now
throw instead of printing "add an origin remote".

Callers that already catch and report keep working; a blank or space-padded
Airtable `Git repo` cell is now trimmed rather than failing closed.
