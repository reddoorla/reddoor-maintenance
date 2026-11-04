# 2026-11-03 — A certificate inside Netlify's renewal window is not an alarm

Opened as reddoorla/reddoor-maintenance#1908 and held for the operator's word on the number. Part of the operator's 11-03 ask, "get the overview clean in the dashboard".

**Why.** On 11-03, Data Dynamiq and MSOT went to Attention with "TLS certificate expires in 30 days". The nightly read both at `cert 30d remaining` at 6:43am PT. By the time I read them (about 12:20pm PT, with `openssl s_client`), both carried new Let's Encrypt certificates: Data Dynamiq's notBefore was 15:33Z on 11-03 and MSOT's 05:43Z, both with notAfter 2027-02-01. Renewal is healthy. Netlify renews its 90-day certificates at about 30 days left, and the 09-29 journal saw the same with Sonder and 1836dig. The alarm's line was also 30 days, so it fired on the normal renewal day. The overview copy said so in as many words: "At Attention we confirm it renews; we act only if it does not." That is a just-wait item, which the operator ruled out on 10-05.

**The change.** Attention now starts at 20 days or fewer, which means renewal is at least ten days late, with 13 more days before Broken at 7. The cell and the glossary follow the constant. Review round 1 was minors only. Its wording minor was folded in: I had called 21 to 30 "renewal not yet due", which is false, because renewal is due at about 30. ERP read 30 on 10-08 without renewing, and Espada and Beachfront read 31 and 32 on 09-29. So that band is renewal's usual lag, and the copy says that now.

**Not lost at deploy.** `certUrgency` is `CERT_ATTENTION_DAYS + 1 - days`, so the metric of a cert already mailed at Attention drops by 10 at deploy, and it would read WORSE again only later. No certificate sits at 8 to 20 days today (the live cockpit, 11:24am PT), so no item loses its WORSE.

**Belief corrected.** I expected a renewal "around 30" to mean "before 30". It means "at about 30, sometimes a few days after". A threshold at 25 would still have alarmed on ERP's 10-08 lag.

**Mutations.** 3 of 3 red (`tests/alerts/cert-renewal-window.mutations.json`).
