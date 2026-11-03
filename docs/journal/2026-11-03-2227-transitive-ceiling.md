# 2026-11-03 — A transitive vuln flagged through 4 lockfile windows is Attention again

Landed as reddoorla/reddoor-maintenance#1920. A follow-up to #1899, from the operator's answer the same day.

**Why.** #1899 put the 10-29 rule ("transitives should be watch not attention") into the ladder, and in doing so left a transitive-only vuln no road back. It is never "exhausted", and it has no age ceiling like a red Renovate PR's 7 days. A vuln that no lockfile refresh can fix, such as an upstream pin, would sit at Watch for good. Asked on 11-03, the operator answered "After 4 lockfile windows" (workspace `decisions/2026-11-03-2110-overview-clean-cert-window-transitive-ceiling.md`). `markWaiting` now marks such an item `transitiveStuck` from the close of its fourth window plus the two settle days. The ladder reads that as Attention, the digest mails it, and the item arrives badged WORSE on the day it rises.

**Measured.** Live `pm-cockpit.mts` on the branch at 2:20pm PT read `broken=2 attention=2 watch=14`, the same as `main`. Nothing is stuck yet. If still present, 29 Navy (first window 10-19) rises 11-11, and the sites whose first window was 10-26 rise 11-18.

**Belief corrected in review.** I wrote the title as "still present after 4 lockfile windows". Review showed the clock is the site's `vuln:` key's first sighting, not any one advisory's. A site with a direct vuln since 08-20 that turns transitive-only on 09-15 rises on 09-16. That rise is defensible, since the site has been flagged for a month, but "still present after" was false for that vuln. The title now says what is measured: "flagged since <date> and through 4 lockfile windows". Counting from the day a site turned transitive-only would need a new snapshot field, which was not built.

**Mutations.** Six of six red (`tests/alerts/transitive-ceiling.mutations.json`). #1899's sidecar had two `find` strings this change rewrote, so they were updated to keep it runnable.
