# inv-04 — Site fleet composition

Survey date: **2026-09-12**. Read-only. Everything below is either a command
output I ran, a file I read, or an Airtable record I listed; where I am
inferring rather than measuring I say so in the sentence.

Sources: `/Users/tuckerlemos/Documents/GitHub` (41 git checkouts + 1 non-repo
directory), the pre-built corpus at
`/private/tmp/claude-501/-Users-tuckerlemos-Documents-GitHub-reddoor-maintenance/28e83896-3f66-4bb2-86f0-612ee993fd98/scratchpad/corpus/`,
the Airtable base `Reddoor Websites` (`appHG8nLOzULzXOER`, table `Websites`
`tblerElkKDif2VqrO`), and `gh repo list` for archive state.

---

## 1. Headline

The "fleet" is three different populations wearing one name.

1. **13 sites carry a maintenance contract** (Airtable `Status = maintained`).
   Eleven of those thirteen have **zero unit tests in their own repo**. Their
   entire quality signal is produced centrally, from `reddoor-maintenance`,
   against the deployed URL.
2. **Nine more sites are live-or-nearly-live but outside every sweep** — 2
   `launching`, 7 `building`. Because every fleet job filters on
   `Status = maintained`, `hedloc` and `alamo-anatomy` were last security-audited
   **2026-07-08** while every maintained site was audited **2026-09-12
   09:51 UTC**. That is a 66-day gap, and nothing alarms on it.
3. **The remaining ~19 checkouts are not client sites at all** — two templates,
   a prototype, five internal tools, eight personal projects, and one repo that
   belongs to someone else's GitHub account.

Attention is wildly concentrated. In the 6-week window (2026-07-30 → 2026-09-12)
**13 of the 20 client-site repos received no Claude session at all** and their
last non-docs commit is a fleet sweep, not per-site work:

```
$ python3 … sessions.jsonl | group by cwd → sessions in window
reddoor-website 701 · Broken 642 · vida-legacy-foundation 452 · songbook 342
reddoor-maintenance 334 · caldea 222 · beachfront-dentistry 95 · 29-navy 85
reddoor-starter 90 · gallerysonder 27 · revogen 14
… and 0 for erp-industrial, caltex-landing, espada, hedloc,
  medical-solutions-of-texas, data-dynamiq, 1836dig, la-homelessness-initiative,
  la-homelessness-youth, the-pointe-burbank, the-tower-burbank,
  vineyard-custom-homes, alamo-anatomy, canvas-starter
```

Four of the six busiest checkouts (`Broken`, `songbook`, `caldea`,
`dont-lose-your-head`) are **personal projects, not client work**.

---

## 2. The whole fleet, one table

`lastCode` = last commit in the window that is neither a bot nor a `docs:`/
`chore:` commit — i.e. the last time real product code moved. `maint` =
the `@reddoorla/maintenance` range in `package.json` (latest published is
**0.95.1**, confirmed `npm view @reddoorla/maintenance version`). `unit` = count
of `*.test.ts` tracked under `src/` + `tests/`.

### 2a. Client sites under contract — Airtable `Status = maintained` (13)

| checkout                   | remote                               | Airtable name / freq                   | kit     | prismic                                | netlify | maint   | lastCode   | unit    | e2e | sessions |
| -------------------------- | ------------------------------------ | -------------------------------------- | ------- | -------------------------------------- | ------- | ------- | ---------- | ------- | --- | -------- |
| beachfront-dentistry       | reddoorla/beachfront-dentistry       | Beachfront Dentistry · Q/Yearly        | ^2.61.1 | yes (`48bb12d1`)                       | yes     | ^0.90.0 | 2026-09-10 | **110** | 23  | 95       |
| reddoor-website            | reddoorla/reddoor-website            | Reddoor · Q/None                       | ^2.65.2 | yes (`reddoor-la`)                     | yes     | ^0.83.0 | 2026-09-11 | **42**  | 21  | 701      |
| gallerysonder              | reddoorla/gallerysonder              | Sonder · **Monthly**/Q                 | ^2.0.0  | yes (`gallerysonder`)                  | yes     | ^0.93.0 | 2026-09-10 | 0       | 12  | 27       |
| revogen                    | reddoorla/revogen                    | Revogen · Q/None                       | ^2.68.0 | yes (`revogen`)                        | yes     | ^0.90.1 | 2026-09-02 | 0       | 2   | 14       |
| medical-solutions-of-texas | reddoorla/medical-solutions-of-texas | MSOT · Q/None                          | ^2.68.0 | yes (`msot`)                           | yes     | ^0.83.0 | 2026-09-01 | 0       | 1   | 0        |
| erp-industrial             | reddoorla/erp-industrial             | ERP Industrials · Q/Yearly             | ^2.59.0 | yes (`erp-industrial`)                 | yes     | ^0.90.0 | 2026-09-01 | 0       | 1   | 0        |
| espada                     | reddoorla/espada                     | Espada · Q/None                        | ^2.5.27 | yes (`espada`)                         | yes     | ^0.83.0 | 2026-09-01 | 0       | 1   | 0        |
| vineyard-custom-homes      | reddoorla/vineyard-custom-homes      | Vineyard Custom Homes · Q/None         | ^2.5.27 | yes (`vineyard-custom-homes`)          | yes     | ^0.90.0 | 2026-09-01 | 0       | 1   | 0        |
| caltex-landing             | reddoorla/caltex-landing             | CalTex · Q/None                        | ^2.61.1 | yes (`caltex-landing`)                 | yes     | ^0.90.0 | 2026-09-01 | 0       | 1   | 0        |
| data-dynamiq               | reddoorla/data-dynamiq               | Data Dynamiq · Q/None                  | ^2.61.1 | **config only** (`reddoor-wireframer`) | yes     | ^0.81.0 | 2026-09-01 | 0       | 1   | 0        |
| 1836dig                    | reddoorla/1836dig                    | 1836dig · Q/None · launched 2026-07-31 | ^2.61.1 | **no**                                 | yes     | ^0.81.0 | 2026-09-01 | 0       | 1   | 0        |
| la-homelessness-initiative | reddoorla/la-homelessness-initiative | LA Homelessness Initiative · Q/None    | ^2.61.1 | **no**                                 | yes     | ^0.81.0 | 2026-09-01 | 0       | 1   | 0        |
| la-homelessness-youth      | reddoorla/la-homelessness-youth      | LA Homelessness Youth · **freq None**  | ^2.61.1 | **no**                                 | yes     | ^0.81.0 | 2026-09-01 | 0       | 1   | 0        |

`la-homelessness-youth` keeps `Status = maintained` with `maintenence freq =
None` deliberately — it is the portfolio copy of the Initiative site, and
`maintained` is what keeps it inside the sweeps while `freq None` stops the
client reports. That is the documented idiom, not a misconfiguration.

### 2b. Pre-contract — `launching` (2) and `building` (7)

| checkout                   | remote                           | Airtable  | prod URL in Airtable                    | lastCode   | unit | notes                                                                           |
| -------------------------- | -------------------------------- | --------- | --------------------------------------- | ---------- | ---- | ------------------------------------------------------------------------------- |
| hedloc                     | reddoorla/hedloc                 | launching | `hedloc.netlify.app`                    | 2026-09-01 | 0    | last security audit **2026-07-08**                                              |
| alamo-anatomy              | reddoorla/alamo-anatomy          | launching | `alamo-anatomy.netlify.app`             | 2026-09-01 | 1    | last security audit **2026-07-08**; oldest stack in the fleet                   |
| vida-legacy-foundation     | reddoorla/vida-legacy-foundation | building  | `vida-legacy-foundation-rd.netlify.app` | 2026-09-12 | 73   | bilingual (9 files with `hreflang`/`lang="es"`)                                 |
| 29-navy                    | reddoorla/29-navy                | building  | **`www.29navy.com`**                    | 2026-09-12 | 54   | Airtable row has **no `Git repo`, no `Netlify ID`** — row and repo are unlinked |
| the-pointe-burbank         | reddoorla/the-pointe-burbank     | building  | `the-pointe-burbank.netlify.app`        | 2026-09-01 | 97   |                                                                                 |
| the-tower-burbank          | reddoorla/the-tower-burbank      | building  | `the-tower-burbank-rd.netlify.app`      | 2026-09-01 | 91   |                                                                                 |
| Domaru                     | _(no checkout)_                  | building  | `domaruhealthsupply.com`                | —          | —    | no repo, no Git repo field                                                      |
| Williamson Homes           | _(no checkout)_                  | building  | `williamson-homes.com`                  | —          | —    | no repo                                                                         |
| Williamson Construction Co | _(no checkout)_                  | building  | `williamson-construction.com`           | —          | —    | no repo                                                                         |

The `building` rows carry **no** `Security Vulns *`, `Smoke OK`, `Last
lighthouse audit at` or `Deps Outdated` values at all — they have never been
audited. Verified by listing those exact fields for every non-archived row.

### 2c. Templates, prototypes, internal tooling (7)

| checkout             | remote                         | what it is                                                                                 | lastCode   | unit |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ | ---------- | ---- |
| reddoor-starter      | reddoorla/reddoor-starter      | **native template**, default for `/new-site`                                               | 2026-09-11 | 45   |
| reddoor-starter-blux | reddoorla/reddoor-starter-blux | **Blux track template** — 139 tracked paths matching `blux` vs **0** in the native starter | 2026-09-04 | 94   |
| canvas-starter       | reddoorla/canvas-starter       | 2D snap-canvas prototype, no Airtable row                                                  | 2026-09-01 | 63   |
| reddoor-maintenance  | reddoorla/reddoor-maintenance  | the orchestrator (v0.95.1)                                                                 | 2026-09-11 | —    |
| reddoorla-dot-github | **reddoorla/.github**          | reusable CI + Renovate preset                                                              | 2026-09-01 | —    |
| reddoor-md-pdf       | reddoorla/reddoor-md-pdf       | md→pdf tool                                                                                | 2026-08-20 | —    |
| reddoor-rfp-analyses | reddoorla/reddoor-rfp-analyses | private RFP outputs                                                                        | —          | —    |
| claude-skills        | reddoorla/claude-skills        | the seven fleet skills, symlinked into `~/.claude/skills`                                  | 2026-09-11 | —    |

### 2d. Cannot receive a push (3) — confirmed against GitHub, not guessed

```
$ gh repo list reddoorla  --json name,isArchived …   →  the-pointe      isArchived: true
                                                        the-tower       isArchived: true  (no local checkout)
                                                        reddoor-test    isArchived: true  (no local checkout)
$ gh repo list tucksravin --json name,isArchived …   →  reddoor-mailer  isArchived: true
$ git -C rfp-analyze remote get-url origin           →  error: No such remote 'origin'
```

| checkout       | remote                    | state         | live consequence                                                                                                              |
| -------------- | ------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| the-pointe     | reddoorla/the-pointe      | **ARCHIVED**  | `chore/work-journal` is **2 commits ahead of origin/main** and can never be pushed (`fd42cb6`, `20629b5` — both journal docs) |
| reddoor-mailer | tucksravin/reddoor-mailer | **ARCHIVED**  | 1341 "dirty" paths — the repo has `node_modules/` **committed** and then deleted on disk                                      |
| rfp-analyze    | _(none)_                  | **NO ORIGIN** | superseded: `docs: this repo is now a subtree of reddoorla/claude-skills` (2026-09-08)                                        |

`the-tower` (archived) is the superseded predecessor of the live
`the-tower-burbank`; `the-pointe` likewise for `the-pointe-burbank`. Both live
successors are healthy and pushable. The archived ancestors remain checked out
locally, which is how a sweep gets fooled.

### 2e. Personal / non-Reddoor (11)

| checkout                    | remote                                 | what                                                                   | sessions in window |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------- | ------------------ |
| Broken                      | **smahre/Broken**                      | Godot game, someone else's account; Tucker authored 356 of 359 commits | 642                |
| songbook + songbook-content | tucksravin/songbook, /songbook-content | SvelteKit app (adapter-**static**) + its content repo                  | 342                |
| caldea                      | tucksravin/caldea                      | worldbuilding, no `package.json`                                       | 222                |
| dont-lose-your-head         | tucksravin/dont-lose-your-head         | game, 3 human authors (Tucker 95, Sean 33, Ben 32)                     | 94                 |
| scriptorium-setup           | tucksravin/scriptorium-setup           | writing env                                                            | 75                 |
| welcome-to-the-flower-court | **tucksravin/invitations**             | ← **directory name ≠ remote name**                                     | 62                 |
| the-bench                   | tucksravin/the-bench                   | workshop monorepo                                                      | 49                 |
| a-budget, to-go, ulti-grid  | tucksravin/*                           | small tools                                                            | 7 / 0 / 0          |

Two non-repo artefacts sit loose in `~/Documents/GitHub`:
`29-navy-reference-snapshot-2026-09-08/` (12 MB frozen reference render) and
`footer.mjs` (a July 31 one-off Playwright diff script comparing
`gallerysonder.com` to a deploy preview).

**Repos on GitHub with no local checkout:** `reddoorla/composition-hospitality`
(Blux migration, Airtable status `external`), `reddoorla/reddoor-prospect-runner`
(private prospect-audit runner).

---

## 3. How heterogeneous is it, actually

Very. The sites _look_ uniform — all SvelteKit 2 / Svelte 5 / Vite 8 /
Tailwind 4 / pnpm / `@sveltejs/adapter-netlify` 6 — and then every dimension
underneath disagrees.

### 3a. Version spread across the 23 site-shaped repos

```
svelte             ^5.55.10 ×15   ^5.56.8 ×4   ^5.23.0 ×2   ^5.55.5 ×1   ^5.56.3 ×1
@sveltejs/kit      ^2.61.1  ×15   ^2.5.27 ×3   ^2.68.0 ×2   ^2.59.0 ×1   ^2.65.2 ×1   ^2.0.0 ×1
vite               ^8.0.14  ×15   ^8.2.0  ×4   ^8.0.2  ×2   ^8.0.10 ×1   ^8.0.16 ×1
tailwindcss        ^4.3.0   ×16   ^4.3.1  ×5   ^4.0.14 ×1   ^4.2.4  ×1
@prismicio/client  ^7.21.8  ×13   ^7.3.1  ×5   ^7.18.0 ×1   ^7.15.1 ×1   absent ×3
@prismicio/svelte  ^2.2.1   ×15   ^2.0.0  ×4   **^1.3.1 ×1 (erp-industrial)**   absent ×3
@reddoorla/maint   0.93.1 ×3 · 0.93.0 ×1 · 0.90.1 ×2 · 0.90.0 ×8 · 0.83.0 ×3 · 0.81.0 ×4 · 0.75.0 ×1
```

**Not one site is on the current `@reddoorla/maintenance` 0.95.1.** The best are
two minors behind; `the-pointe` is on `^0.75.0` and cannot be moved. `gallerysonder`
declares `@sveltejs/kit: ^2.0.0`, a range so wide it is effectively unpinned.
`erp-industrial` is the only repo still on `@prismicio/svelte@1.x` — a major
behind everyone else — and is also the only site carrying `sass`.

### 3b. npm scripts: 23 repos, **14 distinct script sets**

The largest agreeing group is four repos. `test:a11y` exists in exactly four
(`29-navy`, `reddoor-starter`, `the-pointe`, `vida-legacy-foundation`) — the
starter ships an a11y gate that **19 of 20 client sites never received**. Seven
repos have no `test` script at all (`1836dig`, `caltex-landing`, `erp-industrial`,
`gallerysonder`, `hedloc`, `medical-solutions-of-texas`, `revogen`,
`vineyard-custom-homes`).

### 3c. Two generations of site, cleanly separable by test count

```
repo                        routes  slices  unitTests  e2eSpecs
beachfront-dentistry            14      31        110        23   ┐
reddoor-starter-blux            10      29         94         4   │ generation 2
the-pointe-burbank              10      27         97         5   │ (starter-descended)
the-tower-burbank               10      27         91         4   │
vida-legacy-foundation           6      18         73         4   │
canvas-starter                   8      16         63         2   │
29-navy                          7      15         54         3   │
the-pointe                       7      13         51         0   │
reddoor-starter                  6      10         45         2   │
reddoor-website                 24      16         42        21   ┘
gallerysonder                   10       7          0        12   ┐
espada                           9       2          0         1   │ generation 1
medical-solutions-of-texas       9       2          0         1   │ (pre-starter)
caltex-landing                   8       5          0         1   │
vineyard-custom-homes            8       3          0         1   │
erp-industrial                   6       4          0         1   │
hedloc                           6       5          0         1   │
revogen                          5       8          0         2   │
data-dynamiq                    20       2          0         1   │
alamo-anatomy                    9       0          1         1   │
1836dig                          2       0          0         1   │
la-homelessness-initiative       2       0          0         1   │
la-homelessness-youth            2       0          0         1   ┘
```

The split is not about site size — `data-dynamiq` has 20 routes and zero unit
tests; `vida-legacy-foundation` has 6 routes and 73. It is about **when the repo
was created relative to the starter**. Everything descended from
`reddoor-starter` inherited `test:unit && test:smoke`; everything older got a
single smoke spec bolted on by a sweep and nothing since.

This is not the same as "untested". The central `fleet-smoke`, `fleet-lighthouse`,
`fleet-form-e2e`, `fleet-prismic-drift` and `fleet-security` workflows in
`reddoor-maintenance/.github/workflows/` run against the **deployed** URL of
every `maintained` site, and Airtable shows `Smoke OK = pass` for all 13. The
coverage is real; it is just _centralised and post-deploy_, so a regression in a
generation-1 site is caught after it ships, not in its PR.

### 3d. Prismic: three different relationships to the same CMS

- **17 repos** ship `slicemachine.config.json` with a real Prismic repository
  name (`espada`, `revogen`, `hedloc`, `msot`, `reddoor-la`, …). All use
  `@slicemachine/adapter-sveltekit` and `./src/lib/slices` — that part is
  genuinely uniform.
- **`data-dynamiq`** points its config at `reddoor-wireframer` — not its own
  Prismic repo. `slicemachine.config.json` is nonetheless load-bearing: removing
  it breaks the build. Airtable shows no `Prismic Models` verdict for it.
- **`beachfront-dentistry`** uses an opaque Prismic repo id (`48bb12d1`) rather
  than a slug — the only one.
- **3 sites have no Prismic at all**: `1836dig` (Webflow conversion),
  `la-homelessness-initiative`, `la-homelessness-youth`.
- **`canvas-starter`, `reddoor-starter`, `reddoor-starter-blux`** all still say
  `"repositoryName": "your-prismic-repo-name"` — correct for templates.

### 3e. Netlify: uniform adapter, drifted config

Every site uses `@sveltejs/adapter-netlify@^6.0.4` and publishes `build/`. But:

- `command = "pnpm build"` in 8 repos vs `command = "pnpm run build"` in 11.
- `functions = "functions/"` declared in exactly 8 (`caltex-landing`,
  `data-dynamiq`, `erp-industrial`, `espada`, `gallerysonder`, `hedloc`,
  `medical-solutions-of-texas`, `vineyard-custom-homes`) and absent from the
  other 12 — including every generation-2 site.
- `Netlify ID` is populated in Airtable for 12 of 13 maintained sites.
  **`Beachfront Dentistry` has no `Netlify ID` and no `Deploy status`.** Every
  other maintained row has both. Deploy health for the fleet's most actively
  developed client site is therefore not being measured. _(Measured: I listed
  those exact fields; I did not verify what the deploy check does when the ID is
  blank.)_

---

## 4. Shared-CI drift: the fix-once layer is 22/23 aligned, and the exception matters

Every site's `.github/workflows/ci.yml` calls the org reusable workflow pinned
by sha:

```
$ grep -oE 'reddoorla/\.github/\.github/workflows/[a-z-]+\.yml@[0-9a-f]+' */.github/workflows/ci.yml
22 repos → …ci.yml@8f9852c4f69f629d1d785036366d74d9358645f9   = v1.4.1 (2026-09-01)
reddoor-website → …ci.yml@c714d9e472885bbf66f386e9f056a16aab7986d2   = v1.4.2 (2026-09-09)
the-pointe (ARCHIVED) → …ci.yml@4a32c3d0caf2050d6f72274d3325f2306772860d = v1.3.0 (2026-07-14)
```

Tag→sha resolution via `gh api repos/reddoorla/.github/tags`. v1.4.2's commit
message is:

> `fix(ci): stop apt from reading Google's Chrome repo during browser install`

So the Playwright-browser-install fix landed in the shared workflow on
2026-09-09 and **only `reddoor-website` has taken it**. 22 site repos are still
on v1.4.1. Whether that matters depends on whether their CI hits the apt path —
I did not run a site CI job to find out, so treat the consequence as unproven
and the version gap as measured.

Note also that the **local `reddoorla-dot-github` checkout is stale**: its
`origin/main` is at `25bab2c` (2026-09-05) and `c714d9e4` is not an object in
it. `git log c714d9e4` returns `fatal: bad object`; the sha resolves fine
through `gh api`. Anyone diagnosing the reddoor-website pin from the local clone
alone would conclude the sha is bogus. It is not.

`prismic-models.yml` (reusable, pinned at v1.4.0 `55839543`) exists in **9**
repos: `29-navy`, `beachfront-dentistry`, `caltex-landing`, `erp-industrial`,
`espada`, `gallerysonder`, `medical-solutions-of-texas`, `revogen`,
`vineyard-custom-homes`. Eleven other repos ship `slicemachine.config.json`
without it — including `reddoor-website`, whose Airtable `Prismic Models` still
reads `pass` because the **central** `fleet-prismic-drift.yml` covers it.

---

## 5. The security-pin layer is the most drifted surface in the fleet

`pnpm-workspace.yaml` `overrides:` is hand-managed. The same advisory is pinned
**five different ways** across the fleet.

### GHSA-pxg6-pf52-xh8x (`cookie` < 0.7.0)

| right-hand side                                                             | repos                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `">=0.7.0 <1"`                                                              | 29-navy, beachfront-dentistry, canvas-starter, espada, reddoor-starter, reddoor-starter-blux, the-pointe-burbank, the-tower-burbank, vida-legacy-foundation, reddoor-website, reddoor-maintenance |
| `"^0.7.2"`                                                                  | alamo-anatomy, data-dynamiq, erp-industrial, gallerysonder, la-homelessness-initiative, medical-solutions-of-texas, revogen, vineyard-custom-homes                                                |
| `">=0.7.0 <2"` — **permits cookie 1.x**                                     | **1836dig, hedloc**                                                                                                                                                                               |
| `"^0.7.0"`                                                                  | reddoor-md-pdf                                                                                                                                                                                    |
| `"@sveltejs/kit>cookie": "^0.7.0"` — parent>child selector, not a scope cap | caltex-landing                                                                                                                                                                                    |
| _(no `overrides:` block at all)_                                            | **la-homelessness-youth**, the-pointe, welcome-to-the-flower-court                                                                                                                                |

Resolved versions, read straight out of the lockfiles:

```
$ grep -oE "^  cookie@[0-9.]+" */pnpm-lock.yaml | sort -u
1836dig                cookie@1.1.1                      ← already on 1.x
hedloc                 cookie@0.7.2  cookie@1.1.1
29-navy/beachfront/caltex/alamo/reddoor-starter/reddoor-website
                       cookie@0.7.2  cookie@1.1.1
la-homelessness-youth  cookie@0.6.0                      ← the VULNERABLE version
```

And the graph that puts it there:

```
$ grep -n -B2 "cookie: 0.6.0" la-homelessness-youth/pnpm-lock.yaml
1801-      '@types/cookie': 0.6.0
1803:      cookie: 0.6.0        ← @sveltejs/kit's own dependency
```

`la-homelessness-youth` is the **only maintained site with no overrides block**,
and it is the only one resolving `cookie@0.6.0`. Its sibling
`la-homelessness-initiative` — same stack, same sweep history — pins
`"cookie@<0.7.0": "^0.7.2"` and resolves `cookie@0.7.2`. Meanwhile Airtable
reports `Security Vulns High/Moderate/Low = 0` and `Security advisories = []`
for it, audited 2026-09-12 09:51 UTC.

**I could not close this loop.** The fleet security audit derives from GitHub's
Dependabot alerts (every advisory URL in the Airtable JSON is
`…/security/dependabot/N`), and the alerts endpoint is unreachable from this
session:

```
$ gh api "repos/reddoorla/gallerysonder/dependabot/alerts?state=open" -i
Get "https://api.github.com/…/dependabot/alerts?…":
  tls: failed to verify certificate: x509: OSStatus -26276     (3/3 attempts)
$ gh api repos/reddoorla/la-homelessness-youth --jq .name      # control
la-homelessness-youth                                          # works
```

One earlier attempt returned **empty output with exit 0** — which, given three
consecutive hard TLS failures on the same path, was almost certainly the same
error swallowed by `--jq`, not a genuine empty list. Per this repo's own first
rule, an instrument that has never passed on a known-good input proves nothing:
I am **not** claiming la-homelessness-youth has zero alerts, and I am **not**
claiming the audit is blind. The measured facts are (a) the override is absent,
(b) the lockfile resolves the vulnerable version, (c) the audit reports zero.
Reconciling those three needs the alerts API from an unsandboxed shell.

### GHSA-f88m-g3jw-g9cj / the new libheif advisory (`sharp`)

`sharp` is a **direct** dependency at `^0.35.0` in 17 site repos (vineyard:
`^0.35.3`; reddoor-website overrides it to an exact `"0.35.4"`). Override idioms
again disagree: `sharp@<0.35.0: ^0.35.3` (9 repos), `"imagetools-core>sharp":
"^0.35.0"` (caltex-landing only), `sharp@<0.35.0: ">=0.35.0 <0.36"` (espada),
`"sharp@<0.35.0": ^0.35.0` (msot), and **absent** in canvas-starter,
the-pointe-burbank, data-dynamiq, erp-industrial, hedloc, 1836dig,
la-homelessness-*.

Two repos with no sharp override resolve the vulnerable transitive copy:

```
$ grep -oE "^  sharp@[0-9.]+" canvas-starter/pnpm-lock.yaml the-pointe-burbank/pnpm-lock.yaml
canvas-starter       sharp@0.33.5   sharp@0.35.3
the-pointe-burbank   sharp@0.33.5   sharp@0.35.3
$ grep -B2 "sharp: 0.33.5" canvas-starter/pnpm-lock.yaml
  imagetools-core@6.0.4:
    dependencies:
      sharp: 0.33.5
```

That is exactly the `imagetools-core@6 → sharp ^0.33.1` path the override was
written for. Neither repo is `maintained` (canvas-starter has no Airtable row;
the-pointe-burbank is `building`), so neither is audited.

---

## 6. 27 of the 32 open PRs in the fleet are one Renovate wave

```
$ python3 … prs.jsonl | state == OPEN            →  32 total
   27 are "chore(deps): update dependency sharp …[security]", all created 2026-09-09
    5 are human: dont-lose-your-head#62, gallerysonder#99, reddoor-maintenance#769,
                 reddoor-maintenance#771 (version-packages), vida-legacy-foundation#74
```

The wave splits into two shapes per repo:

| head branch                                        | diff              | what it changes                               |
| -------------------------------------------------- | ----------------- | --------------------------------------------- |
| `renovate/npm-sharp-vulnerability`                 | +120/−120, 1 file | the **direct** `sharp` dep + lockfile         |
| `renovate/npm-sharp-0.35.0-vulnerability`          | +307/−4, 2 files  | the **pnpm override KEY** `sharp@<0.35.0`     |
| `renovate/npm-imagetools-core-sharp-vulnerability` | +307/−4, 2 files  | caltex's `imagetools-core>sharp` override key |

The shared preset at
`reddoorla-dot-github/renovate-config.json` contains a rule written specifically
to stop the second kind, with a description citing the 2026-08-03
brace-expansion wave and the 2026-08-10 cookie wave:

```json
{
  "description": "pnpm overrides are hand-managed security pins, never Renovate's to bump…",
  "matchDepTypes": ["overrides", "pnpm.overrides", "pnpm-workspace.overrides"],
  "enabled": false
}
```

Thirteen override-key PRs exist anyway. The preset also sets
`vulnerabilityAlerts: { enabled: true }` and `osvVulnerabilityAlerts: true`.
**My reading is that security updates are configured separately from
`packageRules` and so escape the `enabled: false`, but I did not verify that
against Renovate's resolution order or a run log — treat the mechanism as
inferred and the 13 PRs as measured.** Either way, the guard that was supposed
to prevent exactly this class of PR did not prevent it, and the fix is one
config question, not 13 merge decisions.

Before calling them "stuck": they are **not**. `group:allNonMajor` plus the
never-automerge rule on `sharp` / `@reddoorla/maintenance` / `imagetools-core`
means these require a human and a green Netlify preview by design. Green +
unmerged here is the rule working. What is notable is the **volume and the
shape**, not the fact that they are open.

The underlying advisory is real and current — Airtable's 2026-09-12 audit
reports `sharp: Vulnerabilities in libheif (GHSA-g89c-p67h-r497,
GHSA-2jg2-4ch7-h545)`, severity **high**, `relationship: direct`, on six
maintained sites: MSOT, Espada, Vineyard, Revogen, Sonder, CalTex
(`scope: runtime` on all but Espada). `reddoor-website` already pins
`sharp: "0.35.4"` and has no open sharp PR — the one repo ahead of the wave.

One inconsistency I cannot explain from here: `beachfront-dentistry` resolves
`sharp@0.35.3` (same as gallerysonder) and has both sharp PRs open, yet its
Airtable audit reads `Security Vulns High: 0, advisories: []`. Same audit run,
same resolved version, different verdict. That needs the Dependabot alerts API.

---

## 7. Working-tree state (nine checkouts are not on `main`)

| checkout                                | branch                                           | ahead of origin                   | dirty        |
| --------------------------------------- | ------------------------------------------------ | --------------------------------- | ------------ |
| reddoor-website                         | `chore/renovate-base-branch-and-slideshow-flake` | 0                                 | 0            |
| beachfront-dentistry                    | `fix/p751-unanchored-score`                      | 2 commits not on origin/main      | 0            |
| vida-legacy-foundation                  | `fix/person-card-clipping`                       | 0                                 | 0            |
| gallerysonder                           | `docs/journal-2026-09-11`                        | 0                                 | 0            |
| welcome-to-the-flower-court             | `feat/sigil-badges`                              | 6 commits not on origin/main      | 0            |
| **the-pointe**                          | `chore/work-journal`                             | **2 — unpushable, repo archived** | 0            |
| a-budget / rfp-analyze / reddoor-mailer | `chore/work-journal`                             | —                                 | 3 / 0 / 1341 |

Worktree sprawl is concentrated in the two heavy repos:

```
reddoor-website      8 worktrees (7 parked feature branches under .worktrees/)
reddoor-maintenance  5 (incl. two sibling checkouts: -e2ebudget, -turso-spec)
reddoor-starter      3 ·  reddoor-starter-blux 2 · gallerysonder 2
```

Three worktrees are `prunable` — they point into deleted session scratchpads
(`the-pointe` ×2, `1836dig` ×1). Per the "stale worktree poisons archaeology"
lesson, these are exactly the kind of thing that makes a merged PR look
unpushed.

Disk: `reddoor-website` 4.5 GB, `beachfront-dentistry` 3.4 GB,
`reddoor-maintenance-e2ebudget` 2.0 GB, `reddoor-starter` 1.5 GB — ~18 GB in
the top twelve, almost entirely `node_modules` across worktrees.

---

## 8. What the composition implies for a meta week

- **The sweep boundary is `Status = maintained`, and it is doing more work than
  it looks like.** Nine live-or-near-live sites (2 launching, 7 building) get no
  security audit, no lighthouse, no smoke, no deploy check. Two of them
  (`hedloc`, `alamo-anatomy`) have real prod-shaped URLs and a 66-day-old audit.
- **The starter's quality layer has never been backported.** `test:a11y` reaches
  4 of 23 repos; unit tests reach 10 of 23; 11 of the 13 contract sites have
  none. The generation-1 sites are the ones with revenue attached.
- **Fix-once works where it is wired and nowhere else.** 22/23 repos share a CI
  sha — genuinely good. But `prismic-models.yml` reached 9 of 20 eligible repos,
  the `functions = "functions/"` netlify key reached 8 of 20, and the security
  overrides were hand-written five different ways.
- **The most valuable single artefact would be a per-site drift report that
  diffs each site against `reddoor-starter` rather than against itself.** Every
  gap in this document was found by comparing repo to repo by hand; nothing in
  the fleet currently reports "this site is missing the a11y gate / the override
  block / the functions key".
- **Four of the six busiest checkouts are personal.** If the meta week is about
  where time goes, that is the number to sit with.
