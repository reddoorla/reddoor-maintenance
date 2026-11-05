# 2026-11-05 — The prospect audit's DNS checks now prove their resolver before a "none" counts

Landed in: this PR (`claude/prospect-dns-resolver-check`). The saved MSOT report (`/audit/VHC0-mqgh8Nq9WYIeLSXbw`) was corrected in place in Turso; before/after `result_json` is in the workspace at `briefs/2026-11-04-msot-phase-1/evidence/`.

The 11-04 audit of medicalsolutionsoftx.com told the prospect it had no MX record ("email sent to any address at it is rejected") and no `v=spf1` record. Both were false: dns.google and Cloudflare's resolver answer `MX 0 medicalsolutionsoftx-com.mail.protection.outlook.com` and `v=spf1 include:spf.protection.outlook.com include:_spf.google.com -all`. The MSOT client letter stopped linking the report because of it.

**The cause was not the one guessed.** `dns.ts` already kept a failed lookup apart from a confirmed absence: a timeout or a refusal came back `undefined` and rendered as unmeasured. What it trusted was the code. In a cloud session the container's resolver (`8.8.8.8` in `/etc/resolv.conf`, unreachable past the egress proxy) answers **ENODATA for every name**, gmail.com and google.com included (measured 15:11 UTC today). ENODATA is the code that means "the name exists and carries no such record", so the module read our blind resolver as their missing records, with full confidence and no error. The code-based rule could not catch it: the lie came with the right code.

**The fix proves the instrument first.** Before a DNS question is answered, `defaultDnsDeps` asks its resolver for gmail.com's MX (`CONTROL_MX_DOMAIN`). A resolver that cannot find that tells us nothing about anyone else, so the next candidate is tried: DNS over HTTPS through dns.google's JSON API, which goes out as an ordinary HTTPS request and so works wherever the audit could fetch the site at all. If no candidate passes, every question throws `EUNPROVEN` and the report says "couldn't check" (unmeasured) for SPF, DMARC, MX and the contact-address check. A positive record is never thrown away; only a "none" needs the proof. The control is asked once per audit.

**Proved on known-good input before trusting any FAIL** (15:14 UTC, this container). With the default deps: reddoorla.com MX passes (`aspmx.l.google.com, alt2…`), medicalsolutionsoftx.com MX and SPF pass. With the system resolver alone, which is the broken instrument, all three DNS verdicts on both domains are unmeasured, where the old code had said "fail".

**Two FAILs that survived the fix are real**, checked against both Google and Cloudflare: medicalsolutionsoftx.com has no DMARC (NXDOMAIN at `_dmarc`), and **reddoorla.com has no SPF record**; its only apex TXT is a `google-site-verification`. That second one is our own domain.

**Mutations** against the new tests, each turning at least one red: the control always passing (4 red), no fall-through to the second resolver (1), DoH SERVFAIL read as ENODATA (1), a network error read as ENODATA (1), the control not cached (1), `EUNPROVEN` replaced with ENODATA (1).

**The MSOT correction** replaced only `dns` and the four `dns-*` entries of `siteChecks` in the stored `result_json`, recomputed by the fixed code against live DNS, with an `UPDATE … WHERE result_json = <the original>` guard. Scores do not read DNS. `expiresAt` was kept from the original run. The live page re-renders from the row and now shows the Outlook MX and the SPF record; "no MX record" and "no v=spf1" are gone from it. DMARC still fails, which is correct. The page shows a check's `why` only on a fail, so `WHY_MX` (worded as the failure) does not appear beside the pass. One caveat in the record: the mutation run shared the worktree's `dns.ts` while the correction script ran, so the correction may have run on a mutated copy (M3 to M5 change only failure paths). The written values match dns.google and Cloudflare character for character, so the row is right either way.

**Not touched:** `src/audits/domain.ts` (fleet audit) uses `dns.lookup` and was not checked against a blind resolver; it is out of this task's scope.

Usage: not readable
