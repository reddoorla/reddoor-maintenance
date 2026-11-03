## 2026-11-03 — form-e2e checks every form page of a site that requires Turnstile

This entry lands in the PR that carries this file, reddoorla/reddoor-maintenance#1898. The site fix it pairs with is reddoorla/reddoor-website#316. Source: reddoor-workspace `reports/2026-11-03-forms-spam-review/report.md`, recommendation 1.

**Why.** reddoorla.com's Turso row has `require_turnstile = 1`, and its `/contact` renders the widget. form-e2e probes `/contact`, so it scored the site's widget `pass`, and `site_health.turnstile_widget` read `pass` on the morning of 11-03. Meanwhile `/medtech` and `/boise` open an inquiry modal that rendered no widget, and the site forwarded no token. Central ingest stored every submission from that modal as `spam_auto` (`turnstile-required-absent`) and emailed no one. That was all 41 landing-page inquiries on record, 11 of them from production. A verdict earned on one page said nothing about the others.

**What it checks.** The check runs only for a site whose row requires Turnstile, which is `reddoor` alone among 47 rows. For that site, form-e2e also visits `/contact`, `/`, and a sample of 25 sitemap pages spread across path families, in one browser context with a 3-minute budget. On each page it judges two things:

- each lead form as the page loads. A lead form is a `<form>` that asks for an email.
- each form that opens in a new dialog when the first inquiry trigger is clicked (`[data-inquire]`, or a link ending `#inquire`).

A form needs its own `.cf-turnstile` mount, inside the form or inside its dialog. A gap sets the widget verdict to `fail`, which `collectTurnstileGuardrailAlerts` already raises as a CRITICAL alarm for a gated site. When every form has a mount, the verdict is unchanged: whether a present mount actually works is still the widget verdict's own question.

**Instrument first.** On 2026-11-03 at 10:25am PT, before the site fix shipped, the first version passed the known-good `/contact` (form and mount) and failed `/medtech` and `/boise` (modal form, no mount). It read the other 23 sampled pages as having no form. At 11:18am PT the reworked version also failed `/brand-friction-audit`. That page's offer hero opens the same modal, a third lost-lead page the report had not listed. The first version had missed it. This run lost `/boise` to a one-off load failure that two reruns did not repeat, so an unreachable page now gets one retry. At 11:31am PT, against #316's deploy preview, all four form pages (`/contact`, `/medtech`, `/boise`, `/brand-friction-audit`) read as covered.

**Defects the review found** (round 1, three lenses, Opus):

- The first mount check was page-wide. A second lead form with no widget would have passed beside one that had a widget. And any email form that never reaches ingest (an email-preferences page, a third-party newsletter) would have failed the whole page.
- After the click, the first open dialog holding an email form was judged, so a newsletter popup that was already open could stand in for the modal.
- A page that never confirmed hydration had its click turn into a plain link to `/contact`, which read as "no form here". That is the /medtech defect itself, passed silently.
- 27 pages at a 30s load each could overrun the nightly's 30-minute step.

The fixes, in order: each form needs its own mount, with `data-turnstile-exempt` as an explicit opt-out; dialogs present before the click are marked and skipped; such a page is named "modal not judged" instead of passed; and the whole pass has a budget. Round 2 found minors only. Four are folded in. The two that need new tests are reddoorla/reddoor-maintenance#1903 (a closed native `<dialog>`, and clicking only the first trigger). The website's three non-ingest email forms that should carry the opt-out are reddoorla/reddoor-website#317.

**Belief corrected on contact.** The brief asked for proof from "a test-mode submission whose stored turnstile outcome is pass". Neither half holds. A testMode payload short-circuits in `ingestSubmission` before the Turnstile check, and it persists nothing. `submissions` has no Turnstile column at all. The outcome survives only as `status` and `spam_reason`, and a pass and an `unverifiable` look the same there. The one stored trace that proves a pass is `turnstile-required-hostname`, which is written only when the outcome is `pass` and the hostname is foreign.

**Mutations.** Eleven mutations each turned at least one test red:

- `applyCoverage` never failing;
- a hand-off form counted as a lead form;
- no check that the click stayed on the page;
- modal forms ignored;
- coverage run on an ungated site;
- a page-wide mount check;
- the pre-existing-dialog mark removed;
- hydration ignored;
- the exempt attribute ignored;
- the row field not copied onto the Site;
- the coverage throw rethrown.

The first versions of two tests could not fail and were rebuilt. The navigate-away test now uses a fixture whose CTA leads to another page's dialog. The popup test now uses a covered popup ahead of an uncovered modal.

**Honest accounting.** `tests/model-bakeoff/t4-plan-task.test.ts` ("reads no hook or script-shell from the caller's pnpm config") fails in this cloud container on untouched `main` (`02281a44`) as well. The cause is the container's pnpm config, not this change. Every other test in the suite passed (12,487).
