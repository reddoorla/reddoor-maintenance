## 2026-10-20 — OD 31: form-e2e covers five more client forms; ERP and Revogen pass in production, the other three on staging

Landed in the PR that carries this file. The code shipped in five client PRs, one per repo, per the decisions `2026-09-30-0029-od-31-779-the-client-half-of-form-e2e-coverage.md` and `2026-10-20-2139-od31-staging-recut-data-dynamiq-lahi.md` in reddoorla/reddoor-workspace:

- reddoorla/erp-industrial#78 (`ca4ec09`) and reddoorla/revogen#105 (`138bdb3`), into `main`;
- reddoorla/data-dynamiq#73 (`a574b6f`), reddoorla/la-homelessness-initiative#59 (`b24f6ef`) and reddoorla/la-homelessness-youth#37 (`8371057`), into `staging`. Their promotion PRs are reddoorla/data-dynamiq#74, reddoorla/la-homelessness-initiative#60 and reddoorla/la-homelessness-youth#39, opened for the operator.

Refs #779.

**The coverage, measured.** Dispatched run 39500630989 (21:28–21:36Z) printed `FLEET_FORM_E2E skipped=5 total=17` and `FLEET_FORM_E2E_UNCOVERED sites=29-navy,caltex,data-dynamiq,la-homelessness-initiative,la-homelessness-youth`. The run that morning, 39384376385, printed `skipped=7` with `erp-industrials` and `revogen` also listed. Both now `pass`: ERP with `interest` synthesised, Revogen with first-name, last-name, city, state and distributorship synthesised, after following its new `/contact` 301. Turso `site_health.form_e2e_ok` reads `pass` for both (21:31:50Z and 21:34:25Z). The three staging sites passed the same runner pointed at their `staging--` URLs (DD 3.9 s, LHI 1.9 s, LHY 1.9 s). They leave `UNCOVERED` at their promotion, after which the floor is the two formless sites, 29-navy and caltex.

**"Marked test" was checked from a second authority.** The probe cannot tell whether ingest dropped its submission, so I counted `submissions` rows before and after. ERP stayed at 62 and Revogen at 6, the three staging sites at 0, and no row in the fleet carries `monitor+e2e@`. The control that makes that zero mean something: the same query sees ERP's 62 real leads.

**Belief corrected on contact: the probe cannot catch a declared-but-dropped marker.** The brief's first mutation was "declare `testMode` in `/health` without forwarding it; the probe must catch that the submission was not marked test." It cannot. `defaultFormRunner` waits for `[role="status"]` and nothing else. Against a local fixture that declares `testMode` and drops it, the real runner reported `success:true`, and the fixture's ingest got an unmarked body: a real lead, reported green. So the proof for that mutation, and for reading the marker from bound state, has to sit in each site's own tests. Every site's smoke suite now starts a capture ingest in Playwright's `globalSetup` (`tests/smoke/ingest-capture.ts`). `playwright.config.ts` forces `FORMS_INGEST_URL` at it, forced rather than defaulted, and never reuses a dev server, so a smoke run cannot reach central ingest. A spec submits the real form and asserts on the body ingest would receive. Each repo's PR body carries the mutation table: all four brief mutations turn its spec red, mutations 1 and 2 always with `probe_success=true` beside them.

**The harness that made pre-merge proof safe.** Running the probe against a deploy preview before the forward was proven would have risked a real lead, since previews carry the real ingest token. Instead, a local harness ran `defaultFormRunner` against each branch's production build (`vite preview`) with ingest pointed at a capture server. It refuses any non-localhost URL. It was itself proven first: PASS on a forwarding fixture, FAIL on a dropping one.

**What the sites needed beyond the two-line recipe.**

- **Data Dynamiq and both LA sites** kept the form behind an `{#if}`, so it was absent at `domcontentloaded`. The modal now stays in the DOM, invisible and `inert`, with a CSS transition replacing `fly`. `/contact` 301s to `/#contact`, which opens it.
- **Data Dynamiq's `ContactButton`** rendered no `type` attribute, so `button[type="submit"]` never matched.
- **The LA sites** built their JSON from bound state, so the injected input went nowhere.
- **None of the five set `html[data-hydrated]`**, so the probe waited out its 5 s fallback. All five set it now.

**Defects review found, all fixed before merge.**

- On revogen#105, the axe test audits every route inside one 30 s test. It timed out in CI on all three attempts once the other worker was submitting real forms; its budget now scales with the route count.
- On Data Dynamiq, a Prismic page with the uid `contact` would fail every prerender against the new static route (reproduced). That is possible because `reddoor-wireframer` is shared. Revogen had the same `entries()`, and both now skip that uid.
- The always-rendered DD modal mounted Turnstile on every visit. It mounts on open again, at the cost of a null Turnstile verdict (reddoorla/data-dynamiq#72).
- The capture port was fixed, and a retry could never pass, because the capture outlived the attempt.

Review stopped at round 3 for ERP and Revogen and at round 2 for the other three, each final round minors-only. Filed rather than folded: reddoorla/data-dynamiq#72, reddoorla/la-homelessness-initiative#58 and reddoorla/la-homelessness-youth#38.

**Honest accounting.**

- **The `staging` recut.** For DD and LHI, the brief's own step was refused by this session's permission classifier. The work waited on the decision file above until the operator allowed it.
- **ERP's merge.** ERP took main's SvelteKit 3 migration (erp-industrial#79, from another session) mid-PR, in a merge commit. The spec, the harness and the forwarding mutation all held on kit 3.
- **LHY's Turnstile verdict.** Its `/health` reports `turnstile: false`, so after promotion the probe will write `turnstileWidget: "fail"` there. `require_turnstile` is 0, so no alarm follows.
