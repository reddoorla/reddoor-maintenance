# 2026-10-21 — Sites hides archived and external sites until asked

**Where it landed:** this PR (reddoorla/reddoor-maintenance, branch `claude/fleet-hide-archived`). The operator asked on 2026-10-21, after signing in to the new cockpit: "for fleet can we default to hiding archived and external sites, they should only come up if I'm actively looking for them."

**Why.** Sites (`/fleet`) is the one inventory since #1587, and it listed every row. Archived and external sites are ones nobody is working on, and they filled the table the operator scans.

**What a visitor sees.**

- **The default view hides them.** The default is no status chosen and no search. The status select's first option now reads "Current (archived & external hidden)". The meta line says how many are hidden, for example "3 of 4 sites · 1 archived or external hidden · Show all". The link keeps the sort.
- **Three ways bring them back:**
  - a new "All statuses" option (`?status=__all__`);
  - picking their status (`archived` or `external`);
  - typing their name into the search.

**How it decides.**

- **The hiding reads `status`, which now equals the raw cell.** The alias map that once made `legacy` and `deprecated` canonical `archived` is retired, so `canonicalizeStatus` is the identity. A stored `legacy` is therefore an unrecognized status, which the cockpit surfaces as an anomaly, and Sites leaves it visible. Hiding it would bury the one row that needs a look.
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
| "All statuses" does not reveal them     | 17 red      |
| The hidden count stays 0                | 4 red       |
| The meta line drops the Show all link   | 3 red       |
| "All statuses" is never marked selected | 1 red       |
| A stored `legacy` is hidden too         | 4 red       |

**Found on the way.** `main` went red today with no code change: a `/s/:slug` snapshot read the wall clock, and "3mo ago" became "4mo ago". That fix is its own PR, reddoorla/reddoor-maintenance#1602, and this one waits on it.

**Review round 1 found one major, now fixed.**

- **The major.** My first draft said the hiding read the canonical status, so a raw `legacy` cell hid as `archived`. That mapping has been gone since the alias map was retired: `canonicalizeStatus` returns its input. The new tests pinned the false claim with a fixture production cannot produce, `{status: "archived", statusRaw: "legacy"}`.
- **What changed:**
  - the comments and this entry now say what the code does;
  - the new tests build rows as production reads them;
  - a test pins that a stored `legacy` stays visible;
  - the module header's stale line about merging `legacy` into `archived` is corrected.
- **Not changed:** the Archived lane on Sites comes from the cockpit model, not the table. It still lists archived sites, collapsed, on the default view.
