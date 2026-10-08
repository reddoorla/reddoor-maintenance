## 2026-10-08 — Spam pass: vasdirect.com and three more blocked, the CC0 disposable list vendored, and it catches nothing yet (P1-37, #1257)

The operator asked from the cockpit: "add vasdirect.com to our spam block list,
are there any big lists of blockable domains we can add to spam? let's do
another spam pass". Every database read went through `openReadOnlyDb` and
`assertReadOnly` from `scripts/pm-cockpit.mts`. The UPDATE control was refused
before the first SELECT, and no row was marked or deleted.

**vasdirect.com cleared the block list's bar.** All six of its rows were read.
Every one was the virtual-assistant flood:

- six rows, 2026-08-19 → 2026-10-08;
- three sites: Espada 3, ERP Industrials 2, Reddoor 1;
- five rotating first-name addresses.

The 10-08 copy (veronica@, ERP Industrials) sat in the inbox as `new` at score 0.
Three more domains met the same bar while the sweep read them:

- `virtualeaseservice.com`: 7/7, four addresses;
- `parallelaid.com`: 3/3, three addresses, one still `new`;
- `erpfunds.com`: 3/3 product blasts, all same-site from `sales@`, so
  repeat-sender can never see them, and one reached the inbox at 55.

A review agent re-derived every count from the dump, and every count matched
but one. The keyword comment first said "nine sender domains"; the true figure
is seven, corrected before landing.

**The flood has a second template**, which the old keywords did not see: "a
trained VA who runs/operates our custom AI system". It appears in 12 live
copies across seven domains since 09-24. Two of them reached the inbox at score
0: vaelitecrew.com on 10-06, and the vasdirect copy above. It took two review
rounds and an operator call to catch it without catching leads.

- **First try:** two seller keywords, "trained va who" and "custom ai system".
  Round 1 found "Hi, we'd love a custom AI system for patient intake … Do you
  offer a free consultation?" scoring exactly 60. Any seller phrase promotes the
  buyer phrase "free consultation" to full weight.
- **Second try:** narrowing to "our custom ai system" fixed only that input.
  Round 2 found a client describing its own setup still scoring 60: "we have a
  trained VA who handles our scheduling … free consultation?" and "We'd like
  our custom AI system for quoting to feed leads … free consultation?". The
  belief that "no buyer says our" was wrong. Buyers say "our" about what they
  already run.
- **What landed** (Operator decisions 99, answered (a)): a separate
  `va-template` signal that scores +60 only when both phrases appear in one
  message. Neither phrase is a keyword, so neither can promote a buyer phrase.
  9 of the 12 live copies carry both, including both leaked ones; the other 3
  come from blocked domains. All the round-2 inputs are pinned under 60 by
  tests.

**The big list is real, and today it catches nothing.**
`disposable-email-domains/disposable-email-domains` is CC0 and holds 9,221
domains at `2a79805e` (2026-10-08), about twice the brief's 4–5k estimate. It is
vendored as a generated TS module that builds a `Set`, and it feeds only the
corroborated +45 tier. `scripts/refresh-disposable-domains.mts` regenerates it
from a pinned sha. It refuses a malformed line, and it refuses fewer than 5,000
domains, which is what a truncated fetch looks like. It drops any domain that is
already blocked. The rendered file is Prettier-clean as written, and a re-run at
the same sha is byte-identical.

**Before and after.** Across 491 live rows from 90 days, and 603 all time, not
one sender domain is on the list. So it changes no verdict, and a synthetic
control row (`bot@dropmail.me` plus one link, 25 → 70) proved the simulation
could see a hit. The whole change flips 7 verdicts, all spam, and every one was
read. No row still `new` changed score without flipping. The honest accounting:
the operator's question "are there big lists" has a yes, but the fleet's spam
does not come from throwaway mailboxes. It comes from cheap registered domains
that rotate identities, which is why the hand-read block list, not the big
list, carried this pass.

**The 30-day miss sweep** (77 rows not bucketed):

- Most are genuine: Sonder's RSVPs and newsletter signups, and Beachfront's
  patients.
- The VA template and erpfunds are fixed above.
- Five single-instance misses have no shared signal, so they get no addition:
  a Wikipedia-page pitch (proonlinepage.com, 30), a B2B PDF-orders pitch
  (amcef.com), an "AI code not working" pitch from hotmail, a fiction blob from
  mail.com, and a vague "commercial project" RFQ (celunegc.com).
- One proposal is not built: a Gmail dot-trick signal. All 20 rows with three
  or more dots in a Gmail local part are spam, 19 to MSOT in June–August and the
  Sonder RSVP for 51 guests on 10-07. It is a new signal with its own weight to
  choose, not a list entry.

**Instrument note.** The first mutation run was contaminated. Its restore step,
`git checkout -- <files>`, named the then-untracked snapshot, so git refused the
whole command. The mutations stacked and the table looked plausible. It was
re-run from a committed baseline with `git checkout HEAD --`, one mutation at a
time. Each of the brief's four mutations turned a test red, as did three against the
`va-template` signal: either phrase alone fires, one phrase dropped from the
pair, the signal removed.

`submissions rescore --apply` was not run. It would re-bucket the leaked `new`
rows, but this pass is read-only by brief.
