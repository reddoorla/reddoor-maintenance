# Palette rollout for #916 / 0.102.0 — measured 2026-09-29

Every maintained site (Turso `sites.status = 'maintained'`, 15 rows, read
2026-09-29) plus `reddoor-starter-blux` was measured with its own CI gate,
`reddoor-maint audit --only a11y --fail-on-violations`, three ways:

- **control**: the site as it is, on its locked `@reddoorla/maintenance`;
- **#916**: the same tree with `origin/main` @ `c1410fa` packed and
  `pnpm add`ed, in a scratch copy that is never committed;
- **fix**: the #916 copy plus the 13-token `@theme` override, with values
  generated from that site's own `node_modules/tailwindcss/theme.css`.

"cc" is the number of nodes axe's `color-contrast` rule passed (the
artifact's `measured[].ruleNodes`). "none tokens emitted" is read from the
site's built CSS, not from a grep of the source.

## Result: 2 PRs to merge before 0.102.0, 1 site red for reasons outside the palette

| Repo                       | Tailwind             | none tokens emitted                                        | control       | #916                                                                                                                                 | #916 + fix                                                                                    | PR                                                                                   | Real violations now visible                                                                                 |
| -------------------------- | -------------------- | ---------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| reddoor-starter-blux       | 4.3.3                | neutral-900, neutral-100                                   | PASS (0.97.0) | **FAIL**: rule-errored on a11y fixtures (fixtures cc 0)                                                                              | PASS, cc 89 (fixtures 66)                                                                     | [reddoor-starter-blux#36](https://github.com/reddoorla/reddoor-starter-blux/pull/36) | none                                                                                                        |
| 29-navy                    | 4.3.3                | neutral-900                                                | PASS (0.97.0) | **FAIL**: rule-errored on a11y fixtures (fixtures cc 0)                                                                              | PASS, cc 113 (fixtures 68)                                                                    | [29-navy#58](https://github.com/reddoorla/29-navy/pull/58)                           | none                                                                                                        |
| vida-legacy-foundation     | 4.3.3                | neutral-900                                                | PASS (0.97.0) | **FAIL**, 3: rule-errored on a11y fixtures (none hue), rule-errored on `/` and `/es` (`blendFunctions[blendMode] is not a function`) | **FAIL**, 3: color-contrast on a11y fixtures (2 nodes), rule-errored on `/` and `/es` (blend) | none. Stop condition: it fails on #916 for a reason other than the palette           | `text-red-600` form-error text on the fixtures (`#s13-error`, `#s14-error`); `/` and `/es` still unmeasured |
| beachfront-dentistry       | 4.3.3                | neutral-100 (LocationMap placeholder, not on a gate route) | PASS (0.97.0) | PASS, cc 131                                                                                                                         | —                                                                                             | none needed                                                                          | none                                                                                                        |
| 1836dig                    | 4.3.3                | —                                                          | PASS (0.97.0) | PASS, cc 14                                                                                                                          | —                                                                                             | none needed                                                                          | none                                                                                                        |
| caltex-landing             | 4.3.3                | —                                                          | PASS (0.90.1) | PASS, cc 3 (animate-in fixture absent)                                                                                               | —                                                                                             | none needed                                                                          | none                                                                                                        |
| data-dynamiq               | 4.3.3                | —                                                          | PASS (0.97.0) | PASS, cc 14                                                                                                                          | —                                                                                             | none needed                                                                          | none                                                                                                        |
| erp-industrial             | 4.3.3 (JS `@config`) | —                                                          | PASS (0.95.1) | PASS, **cc 0**                                                                                                                       | —                                                                                             | none needed                                                                          | none, but see note                                                                                          |
| espada                     | 4.3.3                | —                                                          | PASS (0.95.1) | PASS, cc 16                                                                                                                          | —                                                                                             | none needed                                                                          | none                                                                                                        |
| gallerysonder              | 4.3.3                | —                                                          | PASS (0.97.0) | PASS, cc 67                                                                                                                          | —                                                                                             | none needed                                                                          | none                                                                                                        |
| la-homelessness-initiative | 4.3.3                | —                                                          | PASS (0.97.0) | PASS, cc 14                                                                                                                          | —                                                                                             | none needed                                                                          | none                                                                                                        |
| la-homelessness-youth      | 4.3.3                | —                                                          | PASS (0.97.0) | PASS, cc 14                                                                                                                          | —                                                                                             | none needed                                                                          | none                                                                                                        |
| medical-solutions-of-texas | 4.3.3                | —                                                          | PASS (0.95.1) | PASS, cc 16                                                                                                                          | —                                                                                             | none needed                                                                          | none                                                                                                        |
| reddoor-website            | 4.3.3 (JS `@config`) | —                                                          | PASS (0.95.1) | PASS, cc 65                                                                                                                          | —                                                                                             | none needed                                                                          | none                                                                                                        |
| revogen                    | 4.3.3                | —                                                          | PASS (0.95.1) | PASS, cc 10                                                                                                                          | —                                                                                             | none needed                                                                          | none                                                                                                        |
| vineyard-custom-homes      | 4.3.3                | —                                                          | PASS (0.95.1) | PASS, cc 12                                                                                                                          | —                                                                                             | none needed                                                                          | none                                                                                                        |

`reddoor-starter` is not in the table: the PM session carries its fix.
`roalson-interests` was out of scope.

## Vida, the one that needs a decision

Vida's 0.102.0 Renovate PR will be red even with the palette fixed, for two
reasons that the palette was hiding:

1. **`mix-blend-plus-lighter`** (HeartHero, PersonGrid, IconColumns) makes
   axe-core throw `blendFunctions[blendMode] is not a function` on `/` and
   `/es`. axe has no `plus-lighter` blend function, so `color-contrast` is
   skipped on those whole documents. Before #916 that was a silent pass. The
   choice is a gate-side exemption or axe patch in reddoor-maintenance, or a
   design change on the site. It is not a palette line.
2. **A real contrast failure** once the fixtures are measured: the form-error
   lines (`text-red-600`) on the a11y fixtures. That is a design colour, and
   the brief rules out changing a design colour.

No PR was opened. The palette part of the fix is the same 13 lines as the
other two, and is ready to apply once the rest is decided.

## Notes

- **erp-industrial measures 0 contrast nodes on its fixtures** and passes.
  #916 catches only colours axe cannot parse, not a page where the rule
  finds nothing to measure. It is not a palette issue, and it is recorded
  here so nobody reads that PASS as evidence of contrast.
- The fix PRs' render identity was checked with full-page Playwright
  screenshots of `/dev/a11y-fixtures`, `/dev/animate-in` and `/` at 390 and
  1280 px. All pairs were byte-identical. That instrument was proven first:
  an A/A run gives 0 bytes of difference, and `neutral-900` at chroma 0.08
  gives 359,643 / 837,179 differing bytes. Its first version shot the
  production preview, where every route was a 404, and passed vacuously.
- A mutation on 29-navy (fix minus the `neutral-900` line) went red with the
  same `rule-errored`, so that line is the load-bearing one.
