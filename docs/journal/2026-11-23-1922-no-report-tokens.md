# 2026-11-23 — No report token in a tracked file (this PR, `claude/b06-no-report-tokens`)

A prospect report's 22-character token is the whole credential for reading it (`netlify/functions/audit-report-json.mts`: "the 128-bit token IS the credential"), and this repo is public. One client's live token sat in `docs/journal/2026-11-05-1520-prospect-dns-resolver-proof.md` from 11-05 to 11-23. Anyone could open that report, and each visit would have overwritten its `opened_at` read receipt. This is finding B-06 of the 11-23 audit-system review.

**Rotated first, scrubbed second.** Git history keeps the old token, so a scrub alone would hide nothing. The row's `token` column was given a new `generateToken()` value. It was a single-column `UPDATE` guarded on the old value, with the old and new values recorded in the private workspace before the write. Through the live JSON route, with the edit-session header so no read receipt was stamped, the old token now answers 404 and the new one 200, and `opened_at` is unchanged. Reddoor's own report token, which sits in reddoor-website's public journal, was rotated the same way. The line here now says the token was rotated and where the record is. That edit is the one deliberate exception to "history is never edited": it removes a credential and asserts nothing new, and the rest of the entry is untouched.

**The check.** `tests/docs/no-report-tokens.test.ts` reads every tracked text file (`git ls-files`). It fails on exactly 22 token characters after any route that takes a token (`/audit/`, the `/r/` redirect, `/api/audit-report/`), with slashes optionally JSON-escaped, or after a stored row's `"token": "`. It prints only the first six characters. Fake tokens pass: the shared fixture token, and one character repeated (the cockpit snapshots' `AAAA…`), which `generateToken()` never makes. Review round 1 widened it from `/audit/` alone. Before it was trusted, it was proved both ways:

- On a synthetic token built at runtime, and on placeholders and wrong lengths, it found the token and ignored the rest.
- On the unscrubbed tree it failed, naming exactly the one line above.
- After the scrub it passes.

It lives in the vitest suite, so the required `ci` job runs it on every PR.

**Left alone on purpose.** `docs/workJournal.md` holds Reddoor's own token as a bare word (the `{token}/print` entry). That file is frozen by `tests/docs/journal-frozen.test.ts`, which allows only a `> Superseded` pointer, and the token is dead after rotation. Weakening the freeze to remove a dead string was not worth it. The pattern needs the `/audit/` prefix, so a bare token is not caught. A bare 22-character base64url string is too common a shape to fail CI on. Nor does it see commit messages or PR bodies, which are not tracked files.
