# 10 — The token meter

Run 2026-09-14 (Tasks 7 and 8 of `docs/superpowers/plans/2026-09-14-token-meter.md`;
the plan's template said 2026-09-15, the runs happened on the 14th).
Reads every Claude Code transcript on this machine; `scripts/meta-week/token-meter.mjs`.

Every number below names the file in `_data/` it came from. A handful of numbers do
not come from a committed file; each is marked **(one-off probe)** and was printed by
a throwaway script run on 2026-09-14. They exist to rule out explanations, not to be
quoted onward.

## What it measures, and how

The meter streams every `.jsonl` under `~/.claude/projects` — 3,294 files at the first run and 3,295 by the
last, ~748,000 lines, 2.7 GB on the day of the run — and emits three kinds of event: deduplicated
API usage, compaction boundaries, and account-limit blocks.

**A model limit is a block of its own kind.** Besides the account's session and weekly
blocks, the corpus holds a per-model cap: a synthetic `assistant` record (`message.model`
`<synthetic>`, zero usage, `error: "rate_limit"`) whose text begins _"You've reached your
Fable limit. Switch to another model, or manage usage credits at …"_ (earlier _"Fable 5
limit"_). Since 2026-09-17 the meter reports it as kind `model` with the model named
(`model:Fable` in the text output) rather than as a session or weekly wall; every block
count in this document was taken before that, when the pattern did not match it, so
none of them include it.

**The dedupe rule is `requestId`, not `uuid`.** One API response is written to the
transcript as several `assistant` records, one per content block (thinking, text,
each `tool_use`), and each carries a `message.usage` snapshot whose `output_tokens`
is partial. At corpus scale the corpus holds 263,325 assistant records carrying a
`usage` object against 76,202 distinct `requestId`s — **3.46 records per API
response** (one-off probe). The meter keeps, per `requestId`, the record with the
largest `output_tokens`, and falls back to `uuid` only when `requestId` is absent.
Resumed and compacted sessions replay history into new files carrying the same
`requestId`s, so the same key absorbs replay. Section "Calibration" below shows what
the two wrong rules would have cost.

**Lanes.** A record with `isSidechain: true` is the subagent lane, everything else
is main. `tokens-by-lane.json`: 36,639 main requests against 39,616 subagent —
subagents are the majority of API calls on this machine.

**Repo attribution** comes from `cwd`, matched against `/Documents/GitHub/<repo>`,
which folds a worktree back into its repo. The project directory name, with
`--claude-worktrees-…` / `--worktrees-…` stripped, is the fallback.

**What is skipped:** records whose `message.model` is `<synthetic>` (no API call was
made), records with no `usage` object, records whose four counters are all zero, and
any directory named `memory`.

**Retention boundary on the day of the run.** The oldest retained transcript file has
mtime **2026-08-16** (`ls -t ~/.claude/projects/*/*.jsonl | tail -1`), and the oldest
usage event inside the retained files is **2026-08-14** (`tokens-by-day.json`, first
row). The newest is 2026-09-14. That is 32 local days of coverage. Retention moves
daily; anything older than the boundary is gone, not zero.

**The four counters — `in`, `out`, `cacheCreate`, `cacheRead` — are reported raw and
separately. Nothing is cost-weighted**, because the plan's weighting is not public. A
single weighted "token" number would be a guess with a decimal point on it.

**The corpus is live while the meter reads it.** This session writes to
`~/.claude/projects` as the runs proceed, so successive runs see slightly different
totals: across the eleven series runs the request count rose from 76,238
(`tokens-by-day.json`) to 76,263 (`tokens-by-skill.json`). Each table below carries
its own file's total; the totals are not identical across files and must not be
summed across them.

## Calibration against stats-cache.json

Six runs, two timezones × three lanes, each comparing per-`(day, model)` transcript
sums against `~/.claude/stats-cache.json`'s `dailyModelTokens`, under five candidate
units. Only days strictly inside the transcripts' coverage are compared, so a
partially retained first day and a still-running last day cannot fake a mismatch.

Source: `_data/tokens-calibration-<tz>-<lane>.json`, field `calibration`.

| tz                  | lane     | rows | best unit | median rel. error | p90 rel. error | verdict        |
| ------------------- | -------- | ---- | --------- | ----------------- | -------------- | -------------- |
| UTC                 | main     | 63   | `in+out`  | **0.396**         | 0.941          | NOT RECONCILED |
| America/Los_Angeles | main     | 63   | `in+out`  | 0.507             | 0.932          | NOT RECONCILED |
| UTC                 | all      | 63   | `out`     | 0.615             | 1.430          | NOT RECONCILED |
| America/Los_Angeles | all      | 63   | `out`     | 0.636             | 1.616          | NOT RECONCILED |
| UTC                 | subagent | 58   | `in+out`  | 0.646             | 1.000          | NOT RECONCILED |
| America/Los_Angeles | subagent | 58   | `in+out`  | 0.750             | 1.000          | NOT RECONCILED |

**The verdict, in the words of the rule decided in advance.** No triple says
`RECONCILED`. The best median relative error is **0.396** (UTC, main lane, unit
`in+out`) — worse than the 20% threshold the plan set for "roughly comparable". By
the third interpretation rule in Task 7, **`stats-cache.json` is dropped as a
source.** Every figure in this document comes from the transcripts alone. The cache
is not used as a cross-check, a sanity bound, or a tiebreak anywhere below.

**Why it fails.** It is not a unit mismatch that a coefficient would repair. From
`tokens-calibration-America-Los_Angeles-all.json`, over the 63 compared
`(day, model)` rows:

- In aggregate the cache reports 105,759,015 against the transcripts' `out` of
  53,032,946 — a ratio of 1.994. So the cache is close to twice the deduped output.
- But the ratio is not constant across models: `claude-haiku-4-5-20251001` 0.466,
  `claude-sonnet-5` 1.083, `claude-opus-5` 1.754, `claude-fable-5` 2.206,
  `claude-fable-5-1` 3.018, `claude-opus-4-8` 3.383.
- Nor across rows: the per-row `stats / out` ratio runs p10 0.382, p50 1.026,
  p90 4.311 — centred near parity, scattered by an order of magnitude around it.
- The cache-inclusive units are not near-misses, they are different quantities
  altogether: median `stats / (out+cacheCreate)` is 0.085, and median
  `stats / (in+out+cacheCreate+cacheRead)` is 0.006.

Three explanations were tested and refuted before the cache was dropped
**(one-off probe, 2026-09-14)**:

| hypothesis                                  | median rel. error (`out`) |
| ------------------------------------------- | ------------------------- |
| the cache sums every record, no dedupe      | 0.876                     |
| the cache dedupes by `uuid`                 | 0.728                     |
| **the meter's rule: dedupe by `requestId`** | **0.636**                 |
| the cache is a day behind (offset −1)       | 0.988                     |
| the cache is a day ahead (offset +1)        | 0.999                     |

Both wrong dedupe rules are worse than the meter's, which is the strongest evidence
available that `requestId` is the right key — and the day-offset test rules out a
timezone or write-lag boundary as the cause, since offset 0 is the best of the three
alignments by a factor of 1.55.

**Days with transcript activity absent from the cache**: **2026-08-22, 2026-08-27,
2026-09-11** — reported identically by five of the six runs. The sixth
(`America/Los_Angeles`, `subagent`) lists only 2026-08-22 and 2026-09-11, because in
local time no subagent activity falls on 2026-08-27 at all: every subagent event the
UTC run assigns to that date happened between 00:00 and 07:00 UTC, which is the
evening of 2026-08-26 in Los Angeles.

## The weekly ceiling

The corpus contains **exactly one** weekly limit block (`tokens-blocks.json`, of 243
blocks total, 242 of them session limits):

> `2026-08-27T21:00:17.075Z` — repo `songbook`, main lane —
> _"You've hit your weekly limit · resets Aug 30 at 2am (America/Los_Angeles)"_

A correction to the package while passing: `09-operator-answers.md` records this as
"weekly limit hit at 21:00". 21:00 is the **UTC** timestamp. Locally the block landed
at **14:00 PDT** on Thursday 2026-08-27.

The block's own text names the next reset — Sunday 2026-08-30 at 02:00
America/Los_Angeles — so the window it exhausted began at the previous Sunday reset,
2026-08-23 02:00 PDT = `2026-08-23T09:00:00Z`. The ceiling is therefore what was spent
in **108.00 hours** of a 168-hour week.

`_data/tokens-ceiling-window.json`, window `2026-08-23T09:00:00Z →
2026-08-27T21:00:17.075Z`:

| model                     | requests   | in          | out            | cacheCreate    | cacheRead         |
| ------------------------- | ---------- | ----------- | -------------- | -------------- | ----------------- |
| claude-opus-5             | 13,316     | 26,677      | 12,320,889     | 44,303,690     | 3,428,858,372     |
| claude-fable-5            | 2,983      | 5,966       | 3,660,229      | 15,093,360     | 564,032,848       |
| claude-sonnet-5           | 2,484      | 4,968       | 2,686,062      | 9,496,652      | 347,542,962       |
| claude-haiku-4-5-20251001 | 214        | 2,525       | 45,601         | 843,175        | 4,536,215         |
| claude-opus-4-5-20251101  | 75         | 133,408     | 6,448          | 116,735        | 317,920           |
| **WINDOW TOTAL**          | **19,072** | **173,544** | **18,719,229** | **69,853,612** | **4,345,288,317** |

**The week's soft cap (spec §4) is 60% of that line:**

| counter     | ceiling       | soft cap (60%) |
| ----------- | ------------- | -------------- |
| requests    | 19,072        | 11,443         |
| in          | 173,544       | 104,126        |
| out         | 18,719,229    | 11,231,537     |
| cacheCreate | 69,853,612    | 41,912,167     |
| cacheRead   | 4,345,288,317 | 2,607,172,990  |

Two things to hold onto when this number is used. It is a **floor on the real
ceiling**, not the ceiling itself: it is what the account had already spent when it
was cut off, and the transcripts cannot show what a request that was refused would
have cost. And it is a **ceiling observed once**, on one week, at one plan tier; the
spec's 60% margin is doing the work of everything the single observation cannot say.

## The session ceiling

**The five-hour window is not an assumption here — the block messages prove it.** On
2026-09-05 at 23:27:26Z the block said _"resets 7:50pm (America/Los_Angeles)"_. The
next block, 2026-09-06 at 04:10:12Z — 21:10 PDT, i.e. after that reset, so in the
following window — said _"resets 12:50am"_. 19:50 to 00:50 is exactly five hours.
Two consecutive windows, measured end to end, five hours each.

**A finding the block counts hide: the three "high block" days are not 64, 72 and 51
separate stops. They are one stop each, fanned out across parallel subagents.**
From `tokens-blocks.json`:

| UTC day    | blocks | distinct minutes | span   | repos | subagent / main | distinct message texts |
| ---------- | ------ | ---------------- | ------ | ----- | --------------- | ---------------------- |
| 2026-09-02 | 64     | 4                | 5m 12s | 4     | 58 / 6          | 1 — _"resets 2pm"_     |
| 2026-09-05 | 72     | 2                | 1m 27s | 2     | 70 / 2          | 1 — _"resets 7:50pm"_  |
| 2026-09-06 | 51     | 2                | 8m 37s | 2     | 49 / 2          | 1 — _"resets 12:50am"_ |

On 2026-09-02 the 64 blocks are `Broken` 47, `vida-legacy-foundation` 13,
`beachfront-dentistry` 2, `reddoor-website` 2 — four repositories hitting the same
wall inside five minutes. On 2026-09-05, `reddoor-website` 70 and
`welcome-to-the-flower-court` 2. So the package's headline that on 2026-09-06 "the
operator was blocked more often than he gave instructions" (53 blocks against 49
prompts) is measuring **subagent breadth at the moment of the block**, not how often
the operator was stopped. He was stopped once that day.

**Spend before the block.** Two figures are given because they differ. `spend5h` in
`tokens-blocks.json` is a fixed five-hour lookback ending at the block. The exact
window — reset time minus five hours, to the block — is in
`_data/tokens-session-window-<day>.json`.

| UTC day    | window (exact)                          | requests | in      | out       | cacheCreate | cacheRead   |
| ---------- | --------------------------------------- | -------- | ------- | --------- | ----------- | ----------- |
| 2026-09-02 | `16:00:00Z → 18:27:42.673Z` (2h 28m in) | 1,426    | 171,000 | 1,227,495 | 6,948,962   | 192,831,839 |
| 2026-09-05 | `21:50:00Z → 23:27:26.946Z` (1h 37m in) | 921      | 17,414  | 575,070   | 6,050,913   | 97,930,232  |
| 2026-09-06 | `02:50:00Z → 04:10:12.599Z` (1h 20m in) | 677      | 38,805  | 512,180   | 5,808,794   | 48,806,472  |

The five-hour lookback for the **first** block of each day, and the distribution of
`spend5h.out` across every block that day (`tokens-blocks.json`):

| UTC day    | first block     | spend5h out | spend5h cacheCreate | spend5h cacheRead | spend5h.out min / median / max    |
| ---------- | --------------- | ----------- | ------------------- | ----------------- | --------------------------------- |
| 2026-09-02 | `18:27:42.673Z` | 1,227,495   | 6,948,962           | 192,831,839       | 1,227,495 / 1,228,948 / 1,255,034 |
| 2026-09-05 | `23:27:26.946Z` | 1,962,493   | 15,375,020          | 488,667,100       | 1,962,493 / 1,966,697 / 1,974,097 |
| 2026-09-06 | `04:10:12.599Z` | 795,591     | 9,002,482           | 80,258,217        | 740,665 / 791,122 / 795,591       |

The distributions are flat within each day for the same reason the counts are
inflated: all the blocks are within minutes of each other, so the lookback barely
moves. (The 2026-09-06 minimum is below the first block's figure because the last
block is 8 minutes later, and 8 minutes of early activity has slid out of the
lookback.)

**The lookback overstates the in-window spend where a window starts mid-session**: by
3.41× on 2026-09-05 (1,962,493 vs 575,070 `out`) and 1.55× on 2026-09-06 (795,591 vs
512,180). On 2026-09-02 the two agree exactly, because that window opened at 09:00
PDT with no activity in the preceding hours. **Use the exact-window row for the
ceiling.** The lowest of the three, 512,180 output tokens in 80 minutes, is the most
conservative session ceiling this corpus supports.

**Block counts, both prefixes, against the package.** Block timestamps are UTC; the
package's table in `09-operator-answers.md` is in local days. Converting the meter's
243 blocks both ways:

| day        | meter, UTC prefix | meter, America/Los_Angeles | package (`09-operator-answers.md`) |
| ---------- | ----------------- | -------------------------- | ---------------------------------- |
| 2026-08-10 | 0                 | 0                          | 2                                  |
| 2026-08-24 | 9                 | 18                         | 12                                 |
| 2026-08-25 | 9                 | 0                          | 11                                 |
| 2026-08-27 | 1                 | 1                          | 1                                  |
| 2026-08-28 | 0                 | 0                          | 5                                  |
| 2026-08-31 | 0                 | 29                         | 2                                  |
| 2026-09-01 | 29                | 0                          | 35                                 |
| 2026-09-02 | 64                | 72                         | **67**                             |
| 2026-09-03 | 8                 | 0                          | 8                                  |
| 2026-09-05 | 72                | 123                        | **73**                             |
| 2026-09-06 | 51                | 0                          | **53**                             |
| **total**  | **243**           | **243**                    | **269**                            |

**I used the UTC prefix**, and got **64 / 72 / 51** where the package reports
**67 / 73 / 53**. Both are reported; neither is adjusted. The UTC prefix is the right
comparison because the package's own dates are UTC — its "weekly limit hit at 21:00"
on 2026-08-27 is that block's UTC timestamp, and local time was 14:00. The local-day
column is included because it is the operator's day, and it tells a different story:
in Los Angeles time the operator was blocked on five days, not eleven, and never on
2026-09-06 at all — the 51 blocks the package dates to 09-06 are the tail of his
2026-09-05 evening.

Two sources for the residual gap, neither large enough to matter to the ceiling:
**replay** (the corpus holds 284 raw block records today against 243 distinct `uuid`s
— one-off probe; the meter counts distinct) and **retention** (2026-08-10 is now
outside the window; 2026-08-28 and 2026-08-31 carry transcript activity today —
8 and 3,904 requests in `tokens-by-day.json` — but no block records at all).

## Where the tokens go

Every table: key, requests, `in`, `out`, `cacheCreate`, `cacheRead`. Sorted by `out`.
Each table's TOTAL is its own run's total (see the live-corpus note above).

**By ISO week** — `_data/tokens-by-week.json`, tz America/Los_Angeles. Note that the
weekly _limit_ window resets Sunday 02:00 local and therefore straddles two ISO weeks;
these are calendar weeks, not billing weeks.

| week (Mon–Sun)              | requests   | in            | out            | cacheCreate     | cacheRead          |
| --------------------------- | ---------- | ------------- | -------------- | --------------- | ------------------ |
| 2026-W33 (Aug 10–16)        | 3,003      | 93,162        | 3,779,151      | 13,641,611      | 552,801,565        |
| 2026-W34 (Aug 17–23)        | 15,102     | 282,331       | 17,823,109     | 55,165,748      | 2,528,827,858      |
| 2026-W35 (Aug 24–30)        | 17,681     | 166,788       | 17,038,623     | 63,053,541      | 4,118,454,323      |
| 2026-W36 (Aug 31–Sep 6)     | 26,646     | 864,002       | 17,371,180     | 125,044,750     | 4,162,179,517      |
| 2026-W37 (Sep 7–13)         | 13,484     | 183,708       | 10,427,261     | 57,166,047      | 2,514,581,202      |
| 2026-W38 (Sep 14–, partial) | 328        | 6,558         | 425,814        | 1,406,845       | 39,405,645         |
| **TOTAL**                   | **76,244** | **1,596,549** | **66,865,138** | **315,478,542** | **13,916,250,110** |

W33 and W38 are clipped by retention and by the run happening mid-day; only W34–W37
are whole. Output tokens are flat across W34–W36 (17,823,109 / 17,038,623 /
17,371,180) and then fall 40% in W37 (10,427,261) — while `cacheCreate` nearly doubles
into W36 (63,053,541 → 125,044,750), the week of the fan-out days. More cache written
for the same output is the signature of that week.

**By repo (top 12 of 20)** — `_data/tokens-by-repo.json`.

| repo                        | requests   | in            | out            | cacheCreate     | cacheRead          |
| --------------------------- | ---------- | ------------- | -------------- | --------------- | ------------------ |
| Broken                      | 17,343     | 349,185       | 18,019,849     | 66,578,237      | 3,313,866,029      |
| reddoor-website             | 13,867     | 358,222       | 12,711,323     | 63,780,435      | 2,937,297,774      |
| reddoor-maintenance         | 9,617      | 122,615       | 8,734,928      | 39,839,055      | 2,077,963,292      |
| songbook                    | 5,976      | 27,722        | 6,346,376      | 21,805,653      | 928,562,404        |
| vida-legacy-foundation      | 10,929     | 105,126       | 5,046,807      | 44,111,320      | 1,558,171,223      |
| 29-navy                     | 5,608      | 19,133        | 3,337,397      | 17,556,513      | 999,627,866        |
| dont-lose-your-head         | 2,206      | 146,550       | 3,335,412      | 10,384,950      | 389,483,968        |
| octagonal-led-turn-counter  | 1,386      | 19,019        | 1,798,255      | 8,746,382       | 181,138,431        |
| reddoor-starter             | 2,750      | 34,066        | 1,561,402      | 16,083,400      | 481,435,477        |
| beachfront-dentistry        | 1,254      | 49,563        | 1,215,761      | 4,193,608       | 271,824,426        |
| welcome-to-the-flower-court | 976        | 47,244        | 1,211,573      | 7,448,034       | 159,317,797        |
| scriptorium-setup           | 983        | 56,323        | 1,053,706      | 3,873,116       | 111,804,485        |
| _(8 more)_                  | 3,354      | 261,821       | 2,496,062      | 11,090,226      | 506,739,848        |
| **TOTAL**                   | **76,249** | **1,596,589** | **66,868,851** | **315,490,929** | **13,917,233,020** |

The maintained fleet is not where the tokens are. `Broken` and `reddoor-website` —
two repositories — take 46% of output tokens between them.

**By lane** — `_data/tokens-by-lane.json`.

| lane      | requests   | in            | out            | cacheCreate     | cacheRead          |
| --------- | ---------- | ------------- | -------------- | --------------- | ------------------ |
| main      | 36,639     | 298,183       | 39,034,909     | 135,343,042     | 10,340,093,052     |
| subagent  | 39,616     | 1,298,418     | 27,835,504     | 180,164,661     | 3,577,971,270      |
| **TOTAL** | **76,255** | **1,596,601** | **66,870,413** | **315,507,703** | **13,918,064,322** |

Subagents make **more requests** than the main lane (52%) and write **less output**
(42%), but create **57% of the cache**. Fan-out is cheap in output and expensive in
cache-write.

**By repo × lane (top 12 by total out)** — `_data/tokens-by-repo-lane.json`, 38 groups.

| repo                        | main `out` | subagent `out` | subagent share |
| --------------------------- | ---------- | -------------- | -------------- |
| Broken                      | 9,810,687  | 8,209,162      | 45.6%          |
| reddoor-website             | 8,603,336  | 4,107,987      | 32.3%          |
| reddoor-maintenance         | 4,489,713  | 4,258,401      | 48.7%          |
| songbook                    | 1,940,373  | 4,406,003      | 69.4%          |
| vida-legacy-foundation      | 3,535,578  | 1,511,229      | 29.9%          |
| 29-navy                     | 1,867,083  | 1,470,314      | 44.1%          |
| dont-lose-your-head         | 1,928,119  | 1,407,293      | 42.2%          |
| octagonal-led-turn-counter  | 755,448    | 1,042,807      | 58.0%          |
| reddoor-starter             | 1,081,366  | 480,036        | 30.7%          |
| beachfront-dentistry        | 1,194,155  | 21,606         | 1.8%           |
| welcome-to-the-flower-court | 1,065,780  | 145,793        | 12.0%          |
| scriptorium-setup           | 550,089    | 503,617        | 47.8%          |

The subagent share is not a property of the work, it is a property of the session:
`songbook` runs at 69% subagent and `beachfront-dentistry` at 1.8%.

**By model** — `_data/tokens-by-model.json`.

| model                     | requests   | in            | out            | cacheCreate     | cacheRead          |
| ------------------------- | ---------- | ------------- | -------------- | --------------- | ------------------ |
| claude-opus-5             | 57,050     | 145,913       | 44,470,673     | 198,760,281     | 11,141,694,451     |
| claude-fable-5            | 8,485      | 387,529       | 10,800,055     | 50,354,159      | 1,338,013,035      |
| claude-fable-5-1          | 4,507      | 345,682       | 6,228,919      | 42,442,409      | 703,123,619        |
| claude-sonnet-5           | 4,821      | 9,642         | 4,623,363      | 17,758,772      | 639,832,929        |
| claude-opus-4-8           | 336        | 6,009         | 569,106        | 1,333,577       | 83,078,001         |
| claude-haiku-4-5-20251001 | 670        | 4,678         | 149,503        | 4,023,638       | 11,159,222         |
| claude-opus-4-5-20251101  | 388        | 697,152       | 31,018         | 836,477         | 1,475,199          |
| **TOTAL**                 | **76,257** | **1,596,605** | **66,872,637** | **315,509,313** | **13,918,376,456** |

`claude-opus-5` is 75% of requests and 66% of output. `claude-opus-4-5-20251101` is
the odd row: 388 requests carrying 697,152 input tokens — 44% of the corpus's entire
`in` count — against almost no cache read. It is the one slice where prompt caching
is not in play.

**By effort** — `_data/tokens-by-effort.json`.

| effort    | requests   | in            | out            | cacheCreate     | cacheRead          |
| --------- | ---------- | ------------- | -------------- | --------------- | ------------------ |
| `xhigh`   | 73,945     | 854,057       | 65,708,319     | 304,375,878     | 13,670,223,041     |
| `high`    | 1,256      | 40,722        | 985,289        | 6,280,090       | 235,791,223        |
| _(unset)_ | 1,058      | 701,830       | 180,521        | 4,860,115       | 12,634,421         |
| **TOTAL** | **76,259** | **1,596,609** | **66,874,129** | **315,516,083** | **13,918,648,685** |

There is effectively one setting in use: **97% of requests ran at `xhigh`**. Effort is
not a dial this machine turns; it is a constant. Any lever built on lowering effort
selectively is untested here.

**By agent type** — `_data/tokens-by-agent.json`.

| agent                                  | requests   | in            | out            | cacheCreate     | cacheRead          |
| -------------------------------------- | ---------- | ------------- | -------------- | --------------- | ------------------ |
| `main`                                 | 36,639     | 298,183       | 39,034,909     | 135,343,042     | 10,340,093,052     |
| `workflow-subagent`                    | 27,741     | 498,843       | 18,968,002     | 132,318,634     | 2,266,298,075      |
| `general-purpose`                      | 9,435      | 95,561        | 7,447,885      | 36,512,896      | 1,141,651,338      |
| `superpowers:code-reviewer`            | 1,243      | 2,486         | 1,151,835      | 6,957,443       | 127,993,827        |
| `subagent:unknown`                     | 704        | 699,424       | 116,577        | 1,989,546       | 7,663,207          |
| `Explore`                              | 350        | 700           | 97,035         | 1,787,670       | 30,200,389         |
| `episodic-memory:search-conversations` | 133        | 1,282         | 32,954         | 410,847         | 4,176,547          |
| `claude-code-guide`                    | 16         | 134           | 25,406         | 199,578         | 851,249            |
| **TOTAL**                              | **76,261** | **1,596,613** | **66,874,603** | **315,519,656** | **13,918,927,684** |

`workflow-subagent` was not in the plan's list of observed `attributionAgent` values
and is the single largest consumer after the main lane: **36% of all requests and 28%
of all output tokens**. It is also 68% of the entire subagent lane's output (18,968,002 of the 27,839,694 that
lane accounts for in the same file). If a
wasted-work census wants one place to look, this is it.

**By skill** — `_data/tokens-by-skill.json`, 25 groups.

| skill                                     | requests   | in            | out            | cacheCreate     | cacheRead          |
| ----------------------------------------- | ---------- | ------------- | -------------- | --------------- | ------------------ |
| _(no skill attributed)_                   | 69,416     | 1,417,363     | 60,440,829     | 287,682,287     | 12,924,096,221     |
| `superpowers:subagent-driven-development` | 2,124      | 7,175         | 1,400,762      | 6,909,874       | 233,508,285        |
| `superpowers:brainstorming`               | 924        | 14,715        | 946,091        | 5,105,441       | 93,580,941         |
| `superpowers:writing-plans`               | 264        | 10,107        | 845,676        | 1,138,166       | 76,599,729         |
| `evening-review`                          | 1,056      | 105,678       | 812,526        | 6,322,736       | 164,920,117        |
| `superpowers:test-driven-development`     | 1,078      | 18,645        | 762,706        | 3,878,657       | 164,264,827        |
| `superpowers:systematic-debugging`        | 615        | 14,695        | 726,861        | 1,595,628       | 91,389,301         |
| `artifact-design`                         | 78         | 876           | 228,442        | 340,235         | 25,443,997         |
| `figma:figma-design-to-code`              | 133        | 3,097         | 179,297        | 343,144         | 36,369,382         |
| `superpowers:executing-plans`             | 84         | 1,788         | 138,546        | 201,675         | 26,227,396         |
| _(15 more)_                               | 491        | 2,478         | 394,774        | 2,014,330       | 82,810,060         |
| **TOTAL**                                 | **76,263** | **1,596,617** | **66,876,510** | **315,532,173** | **13,919,210,256** |

Skill attribution covers **9.6% of output tokens**. The rest carries no
`attributionSkill`, so skill is the weakest dimension here and the table should be
read as "what the attributed slice looks like", not as a ranking of where the work
went. Within that slice, `superpowers:writing-plans` is the densest: 845,676 output
tokens from 264 requests — 3,203 output tokens per request, against 660 for
`subagent-driven-development`.

**By day** — the full 32-day series is in `_data/tokens-by-day.json` and is not
reprinted. Its shape: the biggest single day is 2026-08-24 (7,885 requests,
8,448,201 `out`), and the collapse `03-calendar.md` and `05-metrics-appendix.md` treat
as behavioural is unmistakable in the counters — 2026-08-26 has 3,384 requests, then
2026-08-27 has 42, 2026-08-28 has 8, 2026-08-29 has 3, 2026-08-30 has 23, and
2026-08-31 returns to 3,904. That is the weekly block and its reset, drawn in tokens.

## Compactions

`_data/tokens-compactions.json`:

    COMPACTIONS  107  byTrigger={"manual":107}  preTokens p50=491,829 p90=643,158 max=847,227

**All 107 compactions carry `trigger: "manual"`. Not one is `auto`.** The operator's
answer in `09-operator-answers.md` — _"compact is mostly me clicking it"_ — is not
"mostly" correct, it is exactly correct, and this closes Q1 of that document with
data rather than recollection. All 107 are in the main lane; none in a subagent. Top
repos: `Broken` 32, `reddoor-website` 26, `reddoor-maintenance` 11,
`vida-legacy-foundation` 10, `songbook` 6, `29-navy` 5. First 2026-08-16T18:41:01Z,
last 2026-09-11T16:26:48Z.

**A count correction.** `09-operator-answers.md` says "288 compaction events" and the
plan's Facts section says 254 markers exist. Both count raw records. Today the corpus
holds **254 raw `compact_boundary` records resolving to 107 distinct `uuid`s** (one-off
probe) — replayed history repeats each marker an average of **2.37 times**. The
conclusion in `09-operator-answers.md` is unaffected (every raw record is also
`manual`), but the magnitude is: this is 107 deliberate operator actions over 27 days,
about four a day, not 288.

**The preTokens distribution says the click is not free choice.** p50 491,829, p90
643,158, max 847,227 — but the **minimum is 462,618** and p10 is 466,665. Across 107
compactions there is not one below ~460k. The operator does not compact when he feels
like it; he compacts when the context is already about half a million tokens deep, which
is what a warning-driven click looks like. Stated as an observation: the trigger field
says manual and nothing here contradicts it, but "chosen" and "unprompted" are not the
same claim, and this data only supports the first.

## One line a day

    node scripts/meta-week/token-meter.mjs --by day --from $(date +%F)

Output on 2026-09-14, mid-day:

    key         requests  in     out      cacheCreate  cacheRead
    2026-09-14  361       6,654  446,577  1,493,571    44,488,188
    TOTAL       361       6,654  446,577  1,493,571    44,488,188

Read against the soft cap above, the day cost 4.0% of the week's `out` allowance and
1.7% of its `cacheRead` allowance. (`tokens-by-day.json`, written twenty minutes
earlier in the same session, has 322 requests for the same day — the corpus is live
and the one-liner is a point reading, not a ledger entry.)

## Caveats, stated next to the numbers they affect

- **Retention, ~30 days.** Coverage is 2026-08-14 to 2026-09-14; the oldest retained
  file's mtime is 2026-08-16. Every "TOTAL" in this document is a total over that
  window and nothing else. Anything earlier is **gone, not zero** — the package's two
  2026-08-10 limit blocks are the visible proof, and any trend line drawn back past
  2026-08-14 from these files is drawing on absence.
- **`attributionAgent` is missing on some subagent records** and those fold to
  `subagent:unknown`: 704 requests, 0.9% of the corpus. They matter disproportionately
  to one counter — they carry 699,424 of the corpus's 1,596,613 `in` tokens (43.8%) —
  so any statement about **uncached input** is really a statement about this
  unattributed slice, and it should not be attributed to a named agent type.
- **Repo attribution and worktrees.** All four worktree project directories
  (`reddoor-maintenance--claude-worktrees-{announcement-copy-fixes,p3-writers,prismic-types-headless-delivery}`
  and `reddoor-website--worktrees-medtech-process`) fold into their repo through `cwd`:
  no worktree key appears among the 20 keys in `tokens-by-repo.json`. The plan
  anticipated a sibling checkout key (`reddoor-maintenance-e2ebudget`) — **no such key
  exists in this corpus**; the sibling-looking directories
  (`-GitHub-Broken-broken`, `-GitHub-octagonal-led-turn-counter-octagonal-led-turn-counter`)
  also fold correctly. The one key that is not a repository is **`-Users-tuckerlemos`
  (13 requests)** — sessions whose `cwd` was the home directory, where both the `cwd`
  match and the project-directory fallback fail. It is 0.02% of requests; it is named
  here so nobody later reads it as a project.
- **The five-hour session window is now measured, not assumed** (two consecutive
  resets, 19:50 → 00:50, exactly 5h). But `spend5h` in `tokens-blocks.json` is a fixed
  lookback, **not** the window, and it overstates in-window spend by up to 3.41× when a
  window opens mid-session. The session ceiling should be quoted from
  `tokens-session-window-*.json`, not from `spend5h`.
- **The weekly ceiling is one observation.** One weekly block exists in 32 days of
  corpus. The 60% soft cap is a margin against that fact, not a calculated safety
  factor.
- **Limit-block counts are fan-out counts.** A "block" is one assistant record; 64 of
  them can be one wall hit by 58 subagents in five minutes. Count distinct minutes or
  distinct message texts before treating blocks as events.
- **`stats-cache.json` is not a control.** It was tested six ways and failed all six;
  see the calibration table. Nothing in this document is cross-checked against it, and
  nothing downstream should be either without redoing that test.
- **The counters are raw.** `in`, `out`, `cacheCreate` and `cacheRead` are not
  commensurable and are never summed into a single number here. A "total tokens"
  figure would need the plan's weighting, which is not public.
- **The meter reads a corpus it is also writing to.** Totals drift by tens of requests
  between runs in the same session. Quote a table's own TOTAL; never sum across files.
