# 2026-10-21 — A Prismic drift ack mutes only the finding it names

**Where it landed:** branch `claude/1608-prismic-ack-scope`, closing #1608. Brief: the workspace's `briefs/2026-10-21-last-three-blind-gates.md`, from the P1-33 next-5 sweep (#1595).

**Why.** `prismicAckIsLive` asked only whether `prismic_ack_until` was in the future. `WebsiteRow` described the ack as muting "the finding the operator actually reviewed", but it muted any `fail`. A site acked through 2026-12-31 for a reviewed remote-only model would swallow a field dropped from another model tonight, and that finding would reach no digest for ten weeks.

**What changed.** A new column, `sites.prismic_ack_drift` (migration `0047`), holds the drift report the ack accepts. The operator copies it from `site_health.prismic_models_drift` in the same statement that sets the date (`PRISMIC_ACK_UPDATE_SQL`). `prismicAckCovers` mutes only while the ack is unexpired and tonight's report is that text, ignoring line endings and the blank space around it. No existing field fits. `accepted_watch_conditions` is a token list with no expiry, and `fleet-cockpit.ts` already refuses to route the Prismic ack through it for exactly that reason. `0046` belongs to #1654's open branch; ids are an applied set, so the gap is safe, and I told that session the number.

**Whole text, not lines.** Matching line by line looked kinder to an operator still modelling, but the report's lines don't say which model they belong to: "field `title` removed" under one model reads the same as under another. A test pins that case. The cost is that any change to the report rings, including one that only resolved part of it. Re-acking is one UPDATE, and a noisy item is the recoverable direction.

**Every ack set before this change now mutes nothing**, because it has no recorded finding. I couldn't count how many are live: the read-only query against production Turso was refused in this session's permissions, and I did not route around it. The PR gives the one query that answers it.

**Not changed.** The cockpit's "Prismic drift accepted until" chip (`src/dashboard/fleet-cockpit.ts:376`) still keys on the date alone. That file belongs to another session today, so the chip can show beside a new finding's item until #1679 switches it to `prismicAckCovers`.

**Belief corrected on contact: the drift report is not on `sites`.** My first push documented `prismic_ack_drift = prismic_models_drift` in an UPDATE of `sites`, in the PR body, the runbook and the row's doc. Review round 1 ran it on a migrated schema and got `no such column: prismic_models_drift`, because the report is a `site_health` column. Every pre-#1608 ack already mutes nothing, so that first push would have left the operator no working way to ack at all. The statement is now one constant; the runbook carries it verbatim and a test runs it, then reads the row back through `listSites`.

**A second hole, found by the same round.** The sweep caps a report at 50,000 characters, and the notice recorded only the full length. Two reports that differed past the cut at the same length (`+ Main.subtitle` against `+ Main.subtytle` at 55,380 characters) stored identical text, so an ack of one muted the other. The notice now carries a SHA-256 of the whole report. A cut report stored before that, with no hash, covers nothing.

**Tests.** Mutations: muting any `fail` again, a blank acked report covering everything, line-set matching, dropping the normalisation, the round-0 SQL, a notice with no hash and dropping the no-hash guard each turn a test red. One case is built from `renderModelReport` through `prismicModelsFields`, the text the sweep really stores.
