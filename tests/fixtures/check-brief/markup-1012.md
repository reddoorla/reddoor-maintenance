<!-- Built from the journal, not a stored brief: the PM brief behind #1012 and #1020 is not in the repo.
     docs/workJournal.md:6450-6460 — "#1012 and #1020 both said Discord, Figma comments and the MarkUp
     boards could not be reached from a cloud session ... The environment carries `DISCORD_BOT_KEY`,
     `FIGMA_PAT` and `MARKUP_API_KEY`." -->

## Worker brief — #674: second pass over reviewer feedback

**Item.** #674 · 🟢 GREEN · effort M
Collect what the reviewers asked for. MarkUp is unreachable from a cloud session, so the boards wait for a
laptop session.

**Verify first.**

- MarkUp is unreachable from a cloud session: it holds no key — `env-set MARKUP_API_KEY` → exit 1, prints "unset"
- Control: a key the cloud is known to carry — `env-set DISCORD_BOT_KEY` → exit 0, prints "set"
