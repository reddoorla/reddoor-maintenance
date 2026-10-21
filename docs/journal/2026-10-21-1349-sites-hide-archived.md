# 2026-10-21 — Sites hides archived and external sites until asked

**Where it landed:** this PR (reddoorla/reddoor-maintenance, branch `claude/fleet-hide-archived`). The operator asked on 2026-10-21, after signing in to the new cockpit: "for fleet can we default to hiding archived and external sites, they should only come up if I'm actively looking for them."

**Why.** Sites (`/fleet`) is the one inventory since #1587, and it listed every row. Archived and external sites are ones nobody is working on, and they filled the table the operator scans.

**What a visitor sees.**

- **The default view hides them.** The default is no status chosen and no search. The status select's first option now reads "Current (archived & external hidden)". The meta line says how many are hidden, for example "3 of 4 sites · 1 archived or external hidden · Show all". The link keeps the sort.
- **Three ways bring them back:**
  - a new "All statuses" option (`?status=__all__`);
  - picking their status (`legacy`, `deprecated`, `archived`, `external`);
  - typing their name into the search.

**How it decides.**

- **The hiding reads the canonical status, not the raw cell.** A raw `legacy` or `deprecated` cell is canonical `archived`, so it hides with the rest. The table still shows and filters by the raw value, as before.
- **`__all__` follows `__none__`'s data-wins rule.** If a stored status were ever literally `__all__`, that value would filter to its rows, and the option would not be offered.

**Tests moved with the default.** Tests about inclusion and sort order, and the Sites tests whose fixtures carry an archived row, now ask for "All statuses" explicitly. The tests are:

- the "includes every site" case;
- the every-sort-key permutations;
- the null-last status sorts;
- the legacy document test;
- the `constructor` own-property test;
- the cardless-row chip test.

New tests pin four behaviours:

- the default hiding and its count;
- each of the three ways back;
- the data-wins collision;
- the meta line, its link and the selected option.

**Measured.** Mutations, each run and restored:

| Mutation                                | Result      |
| --------------------------------------- | ----------- |
| Nothing hidden by default               | 4 tests red |
| A search does not reveal hidden sites   | 2 red       |
| "All statuses" does not reveal them     | 19 red      |
| The hidden count stays 0                | 4 red       |
| The meta line drops the Show all link   | 3 red       |
| "All statuses" is never marked selected | 1 red       |

**Found on the way.** `main` went red today with no code change: a `/s/:slug` snapshot read the wall clock, and "3mo ago" became "4mo ago". That fix is its own PR, reddoorla/reddoor-maintenance#1602, and this one waits on it.
