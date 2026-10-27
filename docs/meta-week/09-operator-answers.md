# The operator's answers to the three open questions

`08-second-pass.md` §6 listed three things the evidence could not settle. Tucker
answered them on 2026-09-12, before this package was handed over. His answers are
recorded here, with the follow-up evidence gathered to check the one that was
checkable.

**Read this before forming any view about pacing, workload, or the
personal-versus-commercial split.** Two of the three conclusions a reader would
otherwise reach from `03` and `05` are wrong.

---

## Q1. Was `/compact` chosen or automatic?

> **"compact is mostly me clicking it."**

**Chosen.** So the 288 compaction events are a deliberate operator action, not the
harness auto-triggering. That closes the ambiguity `05` had to leave open, and it
changes what the number means: it is **288 times the operator judged a session had
outgrown its context**, not 288 times a limit was reached passively.

Combined with Q2 below, this is the clearest signal in the corpus about _session
scoping_ rather than workload.

---

## Q2. What happened on 2026-08-27?

Tucker's reply was itself a question — _"is that just me hitting token limits?"_ —
so it was checked rather than assumed.

**Yes. It was a weekly usage limit, and the dates match exactly.**

Measured from the raw transcripts:

```
2026-08-27 21:00  [songbook]  "You've hit your weekly limit · resets Aug 30 at 2am (America/Los_Angeles)"
2026-08-28 17:18  [Broken]    same block; operator buys extras — "extras usage, just need a quick answer"
```

Against the daily record:

| day        | unique prompts | commits | what was happening                    |
| ---------- | -------------- | ------- | ------------------------------------- |
| 2026-08-26 | 112            | 109     | last full day                         |
| 2026-08-27 | 53             | 15      | **weekly limit hit at 21:00**         |
| 2026-08-28 | 3              | 1       | blocked; extras bought for one answer |
| 2026-08-29 | 1              | 3       | blocked                               |
| 2026-08-30 | 1              | 1       | limit resets 02:00                    |
| 2026-08-31 | 83             | 79      | **full resumption, 6 repos**          |

So the "95% collapse" that `03-calendar.md` and `05-metrics-appendix.md` both
treat as the most repeated pattern in the window **was not exhaustion, burnout,
travel, or a natural end of work. It was a hard account cap.** Any recommendation
built on the collapse as a _behavioural_ signal is built on nothing.

### The larger finding this uncovered

The weekly block was not isolated. A precise pass for genuine account-limit block
messages — excluding code that merely discusses rate limits — found **269 of them
in the window**:

| day        | sessions | unique prompts | limit blocks | blocks per instruction |
| ---------- | -------- | -------------- | ------------ | ---------------------- |
| 2026-08-10 | 26       | 46             | 2            | 0.04                   |
| 2026-08-24 | 213      | 178            | 12           | 0.07                   |
| 2026-08-25 | 331      | 140            | 11           | 0.08                   |
| 2026-08-27 | 8        | 53             | 1            | 0.02                   |
| 2026-08-28 | 5        | 3              | 5            | 1.67                   |
| 2026-08-31 | 143      | 83             | 2            | 0.02                   |
| 2026-09-01 | 186      | 190            | 35           | 0.18                   |
| 2026-09-02 | 210      | 145            | **67**       | 0.46                   |
| 2026-09-03 | 239      | 152            | 8            | 0.05                   |
| 2026-09-05 | 357      | 138            | **73**       | 0.53                   |
| 2026-09-06 | 196      | 49             | **53**       | **1.08**               |

Most are _session_ limits (the rolling window), not the weekly one — messages of
the form `"You've hit your session limit · resets 2pm"`.

**On 2026-09-06 the operator was blocked more often than he gave instructions**
(53 blocks against 49 prompts). 2026-09-05 carries the corpus's highest session
count (357) and its highest block count (73).

### The mechanism, measured

Limit blocks track **parallel fan-out**, not how much the operator asks for:

| correlation with limit blocks        | r        |
| ------------------------------------ | -------- |
| sessions that day (subagent fan-out) | **0.56** |
| unique operator prompts that day     | 0.32     |

The blocks also arrive in bursts across repositories simultaneously — on
2026-08-24 between 20:12 and 20:14, four different projects
(`reddoor-maintenance`, `beachfront-dentistry`, `Broken`, `reddoor-website`)
took the same session-limit block within two minutes. That is the same moment
the operator wrote:

> _"phew ok, what just happened? my system got overloaded and you didn't stop
> your agents when i asked you to"_

**So the ceiling is being hit by concurrent agent breadth, not by hours worked.**
That is a tractable engineering problem, and it is the one the operator himself
identified — see Q3.

---

## Q3. Is the 38% personal-project share deliberate?

> **"yes that's fine, I don't need every token to go to work, I just need to get
> all my asks done and work to improve our output, which we've easily been
> covering. Ideally if we're efficient with tokens we shouldn't be hitting
> limits."**

**Deliberate, and explicitly not a problem to solve.** The personal/commercial
split is settled: it is fine, the commercial asks are being met, and the operator
does not want tokens rationed toward work.

**Do not recommend reducing personal-project time.** It is not the constraint, and
the operator has ruled on it.

The constraint he _does_ name is token efficiency: _if we're efficient with
tokens we shouldn't be hitting limits._ Read against Q2, that is a precise and
well-founded instinct — the limits are being driven by fan-out breadth (r=0.56),
so efficiency work targets **how many agents run concurrently and how much
context each one carries**, not how the hours are allocated between projects.

---

## What this means for the reader

Three corrections to carry into any recommendation:

1. **The Aug 27–30 collapse is an account cap, not behaviour.** `03-calendar.md`
   §"The Aug 24–26 peak and the Aug 27–30 collapse" and `05-metrics-appendix.md`
   both describe the shape accurately and speculate about the cause; this
   document supersedes that speculation. The smaller repeat after 2026-09-10 was
   not separately verified and may or may not share the cause.
2. **288 compactions are a deliberate operator action**, so they measure session
   scoping, not passive context exhaustion.
3. **The personal/commercial split is settled and closed.** The live question is
   token efficiency under a hard ceiling.

The highest-value thing a reader can do with this document is connect it to the
existing measured facts about delegation in `05`: **`general-purpose` is 1,040 of
1,348 subagent spawns against 35 uses of the read-only `Explore` agent**, and
Bash is 72% of ~160,000 tool calls. If concurrent breadth is what hits the
ceiling, those two numbers are where the ceiling is being spent.
