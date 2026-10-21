<!-- Built from the journal, not a stored brief: no copy of the 2026-10-04 Mantis brief survives.
     docs/workJournal.md:7448 — "The brief named the Prismic token `MANTIS_PRISMIC`. That name is
     absent. The token is `MANTIS_LANDSCAPING_PRISMIC`." -->

## Worker brief — Mantis Landscaping: seed the Prismic repository

**Item.** Mantis Landscaping · 🟢 GREEN · effort S
Seed the Prismic repository with the token `MANTIS_PRISMIC`.

**Verify first.**

- The Prismic write token is `MANTIS_PRISMIC` — `env-set MANTIS_PRISMIC` → exit 0, prints "set"
- Control: the name derived from the repository — `env-set MANTIS_LANDSCAPING_PRISMIC` → exit 0, prints "set"

**Start here.**

- `seed.mjs`
