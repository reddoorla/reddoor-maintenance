# 2026-11-23 — The accuracy stage says who a statement is about, and a contradiction shows its two values (W2, maintenance half)

Landed in this PR, stacked on the B-02 PR that stops code upgrading a verdict to `confirmed`. Brief: the workspace's `briefs/2026-11-23-audit-w2-accuracy-own-words/worker-brief.md`; evidence in its `audits/2026-11-23-audit-system-review/`.

**Why.** The report's "What the AI says about you" printed the accuracy model's paraphrase (`claim`), not the assistant's words. Where the assistant hedged that a different firm was the "most likely match" and then described that firm, the paraphrase began "The business…", so Reddoor's page said it of the prospect. The stage had no notion of subject, and the only check on a statement was that its quote appeared in the answer, which it did. This half records what the website needs to stop that: `subject` and `otherName` on each statement, and a `topic` so ratings, complaints, accreditation, legal entity, ownership, named people, revenue and headcount, and street addresses can be withheld behind a count. The website half does the printing.

**Contradictions.** `contradicted` was held to the same two-shared-words bar as `confirmed`. A passage that contradicts a claim differs from it in the one word that matters (a year against a different year), so the bar threw away the true ones: across the 86 stored statements one `contradicted` survived, from before the B-02 flip existed. Now the model names the attribute and both values, and code checks each value is in its own quote as whole words (so "20" is not found in "2022") and that the two differ. A contradiction without values comes down to `unverified`.

**Absent.** `siteFullyRead` meant "every page the crawl took reached the prompt". The crawl stops at 20, so a site whose sitemap lists 95 was "read whole" at 20 and `absent` went out about 75 pages nobody opened. It now needs a sitemap count, an untruncated sitemap, and pages read at or above it. On most sites over 20 pages this means `absent` cannot be claimed at all until the crawl reads more; that is the rule the file's own header states.

**Own name.** A claim listing a firm's services was `confirmed` on a passage sharing only the firm's name and one trade word. The support test now drops the business's name, taken from the branded query.

**Reviews probe.** "<name> reviews" is off by default and `--reviews` turns it on. For B2B firms it returned employee ratings, and an assistant not finding reviews came back as a statement that none exist.

**Tests changed, because the brief changes what they pin.** The `buildQueries` default no longer contains the reviews query; the runner tests that count two branded queries now pass `reviews: true`; the "names who the engine read instead" fixture gained a two-URL sitemap so its `absent` can stand; the "keeps a supported contradiction" fixture now carries both values and a site quote that holds the site's value.

**Instrument note.** A mutation that fails to typecheck makes the whole vitest run error in its global build, which prints no test line at all. The first run of the no-sitemap mutation looked silent for that reason, not because no test caught it; rewritten to typecheck, two tests went red.

**Not done here.** Re-judging the 8 stored rows is a paid call and a table write, and waits on the operator. The website half follows in reddoor-website.
