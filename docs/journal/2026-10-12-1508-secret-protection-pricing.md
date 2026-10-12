## 2026-10-12 — Secret Protection is not worth paying for yet; recommendation in reddoor-workspace (97(a))

The operator went to enable org-wide secret scanning and push protection (97(a)), and GitHub asked for a monthly fee. This session priced the options and changed nothing. The recommendation is `reviews/2026-10-12-secret-scanning/recommendation.md` in reddoor-workspace (`b362778`).

The fee covers only private repos. Public repos get scanning and push protection free, and the 17 COVERED rows in the 10-12 protection audit prove it on this plan. The org has 4 live private repos: reddoor-workspace, claude-skills, reddoor-rfp-analyses and reddoor-prospect-runner. Their only licensed committer in the last 90 days is `tucksravin`. The `claude` author is not an org member. On Free, buying Secret Protection means buying Team first, so the bill is $4 for one seat plus $19 for one committer: $23 a month, $276 a year. It rises to $420 a year if the other three teammates hold seats.

The plan was checked against a second authority: `rulesets` on private reddoor-workspace answers 403 "Upgrade to GitHub Pro", and the same call on public reddoor-maintenance answers with one ruleset.

**Beliefs corrected:**

- 97(a) said the Mantis Blux key "is what push protection stops". It is not. GitHub's push protection blocks only supported provider patterns, and a Blux browser key is not one. Netlify caught it because Netlify also flags values that look like secrets. A free gitleaks run would catch it; GitHub's paid custom patterns would too.
- None of the 13 audit gaps is a private repo, because the audit skips private repos. They break down as follows:
  - 3 are public repos with scanning off: williamson-homes, williamson-construction-co and mantis-landscaping. These three also have no ruleset.
  - 4 are open alerts on public repos (item 13).
  - 5 are pnpm-pin drift.
  - 1 is reddoor-website:staging.

  The fee fixes none of them.

**Incidents counted:** 7 distinct credential exposures since June. All were on public repos, in Netlify builds or in a transcript; none was in a private repo.

**Instrument limit:** the protection audit lists repos through the App installation, and `reddoor-mailer` (archived) is missing from its 37. So "4 private repos" means "4 the App can see". The cloud proxy refuses `orgs/…`, and this session did not use the connector's org-wide search, so the operator's repo page is the remaining check.

Whether the operator's 10-12 apply went through for the public repos is unverified. The audit ran at 06:12Z, before the attempt, and the proxy returns `security_and_analysis: null`. The 10-13 nightly answers it: either the three "secret scanning disabled" lines disappear or they don't.
