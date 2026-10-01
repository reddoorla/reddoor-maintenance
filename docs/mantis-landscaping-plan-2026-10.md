# Mantis Landscaping: move from Blux to the Reddoor stack (plan, 2026-10)

Operator ask, 2026-10-01: "new project: mantislandscaping.com is nicole's
partners website and I want to move it onto the reddoor stack, feel free to
improve it as we move it over, it's currently on blux — spawn a session that
will start with making a plan". Tracking issue #1107. Nicole
(`nicole_35266`) is Reddoor staff; the site belongs to her partner's business
and is treated as a client site.

This document is the plan only. Nothing was created: no site repo, Prismic
repository, Netlify site, Turso row or DNS change. Every number is tagged
**[M]** (measured on 2026-10-01 between 17:28Z and 17:45Z, with the command or
file named) or **[I]** (inferred, with what would confirm it).

The decisions this plan needs are BACKLOG Operator decisions **59–62**. The
build is BACKLOG **P1-30**, blocked on them.

---

## 1. What is live today [M]

| fact          | value                                                                                                                                            | source                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| host          | Blux: `server: nginx`, `blux_*` analytics hooks, `/__analytics.js`, form posts to `/__post`, Blux site id `6e0b52ee-9bb9-4c5a-b1ee-653009e3b572` | `curl -D`, page HTML `data-base`, `<input name="blux-form">` |
| apex `A`      | `54.214.8.151`, `54.214.2.207` (AWS)                                                                                                             | `dns.google/resolve`                                         |
| `www`         | `CNAME h.blux.com.`                                                                                                                              | `dns.google/resolve`                                         |
| nameservers   | `ns-cloud-b{1..4}.googledomains.com`                                                                                                             | `dns.google/resolve`                                         |
| registrar     | **Squarespace Domains II LLC**; registered 2021-05-09, expires **2027-05-09**, last changed 2026-04-24                                           | `rdap.verisign.com`                                          |
| mail          | Google Workspace: `MX 1 aspmx.l.google.com` + four `alt*`; `TXT v=spf1 include:_spf.google.com ~all`                                             | `dns.google/resolve`                                         |
| host variants | `http://` and `https://`, apex and `www`: all four answer **200** with no redirect                                                               | `curl -w %{redirect_url}`                                    |
| canonical     | every page declares `http://www.mantislandscaping.com/…` (an `http` URL that never redirects)                                                    | page `<link rel=canonical>`                                  |
| `robots.txt`  | **404**                                                                                                                                          | `curl`                                                       |
| `sitemap.xml` | 200; 6 page URLs, 154 `image:loc` entries, 89 unique images                                                                                      | `curl` + `grep -c`                                           |
| analytics     | none besides Blux's own `__analytics.js`: no `gtag`, GTM, Meta pixel or Hotjar                                                                   | `grep` over the six captured pages                           |

## 2. Inventory [M]

### Pages (6 served, 2 dead links)

| path                           | title                                   | Blux bands | images | role                                                                                     |
| ------------------------------ | --------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------- |
| `/`                            | Mantis Landscaping - Mantis Landscaping | 9          | 16     | home: hero, three pillars, mission, services, process, projects teaser, takeaway, values |
| `/projects`                    | Project Index - Mantis Landscaping      | 2          | 3      | index rendered client-side from a Blux **feed** (2 published items)                      |
| `/projects/water-wise-gardens` | Water Wise Gardens - Mantis Landscaping | 5          | 40     | service page: intro, services, how it works, 5 case studies                              |
| `/projects/ediblegardens`      | Edible Gardens - Mantis Landscaping     | 5          | 43     | service page: 8 case studies (feed item 5)                                               |
| `/ediblegardens`               | Edible Gardens - Mantis Landscaping     | 5          | 51     | a **near-duplicate** of the page above: same 43 images plus 8 more                       |
| `/contact-us`                  | Contact Us - Mantis Landscaping         | 3          | 1      | Blux contact form, phone number, Mailchimp signup                                        |

- Band counts come from `reddoor-maint blux grid` run on each captured page
  (`Parsed 9/2/5/5/3 bands`), and equal the `id="page-block-N"` count from a
  plain `grep`. Two instruments agreeing is what makes the number usable.
  `blux grid` was not run on `/projects/ediblegardens`; it has the same
  layout as `/ediblegardens`.
- **Dead links on `/`:** the "Pest control / IPM" and "Consulting" service
  cards link to `/projects/landscaping` and `/projects/urban-farming`. Both
  answer **404** [M]. The feed's published items are indexes 1 and 5, so
  indexes 2–4 are probably unpublished drafts [I]. The Blux export (OD 60)
  would show them.
- Headings: every page has one `h1`. Heading order fails Lighthouse on all
  three pages audited (an `h3` or `h4` follows an `h1` directly).
- No page has a `meta name="description"`. Every `og:description` is empty.

### Media

| kind                        | count | bytes    | note                                                                                           |
| --------------------------- | ----- | -------- | ---------------------------------------------------------------------------------------------- |
| photos (`jpg`), originals   | 74    | 238.6 MB | phone photos; 38 are wider than 2560 px; largest 10.9 MB (`PXL_20210127_154946071.jpg`)        |
| graphics (`png`), originals | 13    | 0.26 MB  | logo, icons (several titled `noun-…`: Noun Project icons, licence to confirm, R5)              |
| `gif`, originals            | 2     | 3.4 MB   | single-frame (`identify %n` = 1); one is 2000×2398 at 3.4 MB and should be a JPEG/WebP         |
| video                       | 0     | n/a      | no `mp4` `data-ext` and no Vimeo/YouTube URL in any page; the player code is Blux runtime only |
| embeds (`iframe`)           | 0     | n/a      | only in Blux's lightbox runtime code                                                           |

**No photo has a text alternative.** Every image is a `div` with a CSS
background that Blux's runtime fills in from `data-base` + `w:<width>/` +
`data-media`. There is no `<img>` on five of the six pages, and the one on
`/contact-us` is Mailchimp's badge with no `alt` [M].

The sitemap names each original file (`Mantis-Web-1-2.jpg`,
`PXL_20230325_…MP.jpg`, …). Those names are the only description of the
images there is, so alt text has to be written (§4, OD 61).

### Fonts, scripts and third parties

- **Font:** Nunito 300 and 700 from Google Fonts (1 CSS, 5 `woff2`).
- **Colours (from the Blux CSS):** text `#2e1e15`, links and icons `#F58736`,
  band `#232d1b`, gold `#dfb726` / `#cda71f` / `#ae8e1a`.
- **Scripts:**
  - Blux runtime, inline in each page.
  - `/__analytics.js` (52 KB).
  - Mailchimp `mc-validate.js` (143 KB, served from S3 without compression)
    and `classic-10_7_dtp.css`, on `/contact-us` only.
  - The `eep.io` Mailchimp badge.
- **Links out:** Instagram `mantis_landscaping`, and a Mailchimp signup
  (`eepurl.com/h0T-cP`, list `mantislandscaping.us12.list-manage.com`).
- **Forms (2, both on `/contact-us`):**
  1. **Blux contact form**, posting to `/__post`. Its fields:
     - `Email`, which is `type="text"`, not `email`;
     - `Message`;
     - a honeypot `textarea name="feelings23"` with a visible label,
       "Feelings", that screen readers announce (Lighthouse `label` fails on
       it).

     After a submit it shows "Thank you for your submission. We'll contact you
     within 48 hours." **Where Blux delivers it is unknown** (R2).

  2. **Mailchimp newsletter signup** (`EMAIL`, `FNAME`, `LNAME`, Mailchimp's
     own honeypot).
- **Phone** 424-264-8944, in the contact copy.

## 3. Capture

**Done 2026-10-01T17:31:44Z [M]:** 6 pages and 105 files, 244.0 MB, 0 failed.

- The sha256 of every page and file is in
  [`captures/mantis-landscaping/manifest.json`](../captures/mantis-landscaping/manifest.json),
  and its summary is in
  [`CAPTURE.md`](../captures/mantis-landscaping/CAPTURE.md).
- **The OD7 capture tool does not work on Blux.** I ran
  `node scripts/webflow-capture/capture.mjs --ref https://mantislandscaping.com --expect-pages 6`
  and got 5 pages and 11 files, with the check failing on two counts:
  - `manifest.json has no siteId` (it keys on Webflow's `data-wf-site`);
  - `5 pages captured, expected 6`.

  It missed every one of the 89 images, because Blux builds their URLs at
  runtime and the tool only reads literal URLs. It also missed
  `/projects/ediblegardens`, which only the feed's JavaScript links to.

- **The capture that worked** reads `sitemap.xml` for the pages and the
  image list. It takes each page's `data-media` ids, fetches the **original**
  of each from `dv4tl7yyk1zlp.cloudfront.net/<site id>/<uuid>.<ext>` (the
  host the sitemap names), and adds every literal asset URL the pages carry.
  - The originals are 4.9× the size of the default rendition: the first hero
    image is 1,908,866 B against 391,500 B at `d3syaxnfm3oj0e…/w:1920/`.
  - Original-resolution sources are what a rebuild needs, since Prismic's
    imgix makes the renditions.
- **The repo already has a Blux tool**, `reddoor-maint blux …` (spec
  `docs/superpowers/specs/2026-07-05-blux-conversion-pipeline-design.md`):
  - `catalog`, `convert`, `emit` and `migrate` read a **Blux export
    directory** (`site.json` plus each page's rendered `index.html`). The
    live site does not serve `site.json` (404 at `/site.json`, `/__site.json`
    and `/data/site.json`).
  - `--probe` reconstructs the CDN URLs the HTML scrape misses, which is the
    same problem described above.
  - Mantis was not in the July corpus of 12 exports.
  - So the export has to come from the Blux dashboard. That is OD 60, and P0
    re-captures from it.
- **Where the bytes live:** not in this repo.
  - The capture has 89 originals at 242.3 MB. Committed on a branch here, as
    the Williamsons' were, they would add about 240 MB to every default
    clone, the cloud setup hook's unshallow fetch and every `fetch-depth: 0`
    checkout, until the branch is deleted (captures/README.md measured
    288.7 MiB for the Williamsons).
  - P0 instead puts the Blux export and the capture in the new site repo's
    `matching/spec/`, the place the Williamson captures were always headed.
    The originals go into Prismic's media library through the seed.
  - `main` here keeps only the manifest, so a later re-capture can prove it
    fetched the same bytes.
  - The risk in waiting is small and is ours to control: Blux serves for as
    long as the account is paid, and cancelling is the last step of this
    plan (OD 60). If the operator wants the bytes safe sooner, push them to
    `capture/mantis-2026-10-01`; the cost to clones is as above.

## 4. Improvements on the way over

Lighthouse 12.6.1, mobile, 1 run per page, on `/`, `/projects/water-wise-gardens`
and `/contact-us` [M]. I ran `@lhci/cli collect` directly with
`--no-sandbox`, because the fleet's `reddoor-maint audit --url … --only lighthouse`
cannot start Chrome as root in a cloud container (it wrote no `lhr-*.json`).
The accessibility category is Lighthouse's axe-core subset. A full axe run is
part of P5, not this plan.

| page                           | Perf | A11y | BP  | SEO | LCP   | TBT    | CLS | weight  |
| ------------------------------ | ---- | ---- | --- | --- | ----- | ------ | --- | ------- |
| `/`                            | 96   | 79   | 100 | 91  | 1.6 s | 170 ms | 0   | 373 KiB |
| `/projects/water-wise-gardens` | 98   | 79   | 100 | 91  | 1.9 s | 110 ms | 0   | 332 KiB |
| `/contact-us`                  | 99   | 76   | 100 | 83  | 1.5 s | 90 ms  | 0   | 397 KiB |

**Performance is not a reason to move.** Blux already serves sized CDN
renditions: Lighthouse puts the image-delivery savings at 6–28 KiB a page
[M]. The rebuild has to match these scores, not
beat them. The time to interactive (5.0–5.4 s) and the 71–161 KiB of unused
JS are Blux runtime, and they go away with it. Accessibility and SEO are
where the gain is.

### Safe defaults (no sign-off needed; they do not change how the site looks or reads)

| what                                                                                                                                             | why / evidence [M]                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| One host: `https://mantislandscaping.com` (or `www`, OD 61), with 301s from the other three variants, and a self-referencing `https` canonical   | all four variants answer 200 today, and every canonical points at the `http://www` one            |
| `robots.txt` plus a generated `sitemap.xml`                                                                                                      | `robots.txt` is 404                                                                               |
| Accessible name for the logo link and the footer "Projects" link; a 24 px target for the footer link                                             | `link-name` fails 2 nodes and `target-size` 1 on every audited page                               |
| Real `<button>` nav toggle instead of the unlabeled checkbox                                                                                     | `label` fails on `#navigation0-menuicon` on every page                                            |
| Heading levels in order (h1 → h2 → h3), same visual sizes                                                                                        | `heading-order` fails on all three pages                                                          |
| Photos as `<img>` with `alt`, `width`/`height`, `srcset` via Prismic imgix, lazy below the fold                                                  | no photo has alt text today; the originals run to 10.9 MB, and imgix serves the renditions        |
| Contact form on the fleet form route: `type="email"`, labelled fields, the fleet honeypot `bot-field` (hidden from AT), Turnstile, `MIN_FILL_MS` | the Blux form has a `type="text"` email and a honeypot that screen readers announce as "Feelings" |
| 301s: `/ediblegardens` → the one edible-gardens URL kept (OD 61), and the two dead service links pointed at a real page or removed               | two 404s linked from the home page                                                                |
| Security headers, Renovate and protection: the starter's `BASELINE_CSP`, `ci / ci`, smoke suite                                                  | fleet standard                                                                                    |

### Changes to how it looks or reads (operator sign-off: OD 62)

| what                                                                                                                             | evidence [M]                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Darken the gold** where white text sits on it or it sits on white/grey, to ≥ 4.5:1 (≥ 3:1 for large text)                      | white on `#dfb726` **1.91:1**; white on `#cda71f` 2.29:1; `#ae8e1a` on white 3.14:1; the contact form's **Submit** is `#dfb726` on `#f5f5f5` at **1.76:1**; the Mailchimp Subscribe button is white on `#aaa` at 2.32:1 |
| Fold `/ediblegardens` and `/projects/ediblegardens` into one page                                                                | 43 shared images; `/ediblegardens` has 8 more                                                                                                                                                                           |
| Meta descriptions and `og:description` for every page (we draft, the client approves)                                            | none exist                                                                                                                                                                                                              |
| Remove or fill the "Pest control / IPM" and "Consulting" cards                                                                   | both 404                                                                                                                                                                                                                |
| Native Mailchimp-backed signup styled like the site, in place of Mailchimp's embed (drops 143 KB of jQuery-era JS and the badge) | `mc-validate.js` 143 KB uncompressed; the badge has no alt                                                                                                                                                              |
| GA4 (fleet recipe `analytics-tag <site> --measurement-id G-… --production-host <host>`)                                          | no analytics today besides Blux's own; adding GA4 makes the parked `/privacy` page (P1-26, #1055) a launch dependency                                                                                                   |

## 5. Content model (native starter; Prismic)

**Custom types:**

- `page` (repeatable). Covers home (`uid` `home`, routed to `/`),
  `contact-us` and `projects`. It carries a slice zone plus SEO fields
  (`meta_title`, `meta_description`, `og_image`), the starter's own pattern.
- `project` (repeatable). Holds the service-led project pages:
  - `water-wise-gardens`, `edible-gardens`, and whatever the unpublished feed
    items turn out to be (OD 60/61);
  - fields: `title`, `kicker` ("design + installation + maintenance"),
    `intro`, `hero_image`, `services` (group of text), `card_image`, plus a
    slice zone and SEO.
- `case_study`. Either a group inside `project` or its own type: the 13 case
  studies (5 water-wise, 8 edible) are a title, a label ("Residential",
  "Edible Garden", …), a body and a photo set (3–8 photos each [I], counted
  in P2 from the export).
  - _Pick:_ a repeatable group on `project`. Nothing lists case studies
    across projects today, and a group keeps each page one document.
- `settings` (single): nav, footer, phone, Instagram, newsletter URL, and
  the default SEO image.

**Slices.** Native starter slices where they exist; otherwise new ones, about
seven:

| slice                                                     | used by                                              |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `hero` (background image, h1, CTA)                        | every page                                           |
| `feature_trio` (icon + two-line label ×3–4)               | home pillars and values; project "services provided" |
| `text_block` (heading, body, CTAs)                        | mission, takeaway, intros                            |
| `service_cards` (icon, title, link)                       | home "Select a service"                              |
| `steps` (numbered: visit, plan, install)                  | home and both project pages                          |
| `case_studies` (renders `project` groups: gallery + text) | project pages                                        |
| `project_list` (queries `project`)                        | `/projects` and the home teaser                      |
| `cta_band` ("It's time for your garden to flourish.")     | every page; could live in `settings` instead         |
| `contact_form` (fleet ingest) and `newsletter_signup`     | `/contact-us`                                        |

**Routes.**

| route             | resolves to     |
| ----------------- | --------------- |
| `/`               | `page:home`     |
| `/[uid]`          | `page`          |
| `/projects`       | `page:projects` |
| `/projects/[uid]` | `project`       |
| any unknown slug  | 404             |

Today's paths are kept: `/projects/water-wise-gardens`, `/contact-us`, and
whichever edible-gardens URL OD 61 keeps. The other one gets a 301.

**Model delivery.** It follows `docs/runbooks/prismic-model-delivery.md` as it
stands:

- `customtypes/` and slice `model.json` files in the repo;
- `prismic-ci <site>` (a positional run, because `--fleet turso` skips
  `building` rows);
- push on merge;
- no `prismic init` and no `prismic push`;
- the Type Builder stays off.

The fleet's move off Slice Machine is planned
(`docs/prismic-migration-plan-2026-10.md`, BACKLOG 57), but its D1–D3 are
unanswered and it has not reached the starter. If it lands before P2, Mantis
follows the starter it is cloned from, and is the cheapest site in the fleet
to move: it would have no content yet.

**Seed.** P2 pulls the content and assets from the Blux export:

- `reddoor-maint blux convert <export>` produces the IR: page text runs, the
  asset map, the theme tokens and diagnostics.
- The seed writes `page` and `project` documents through the Prismic
  Migration API (or the Prismic connector's `create_document` for a handful),
  uploading the 89 originals from the capture.
- The two GIFs are re-encoded as JPEG or WebP first.
- `blux migrate` writes Blux-track types (`blux_section`, `blux_media_text`,
  …), so it is **not** used as-is on the native model [M: `src/blux/emit`
  and `src/blux/catalog` emit `blux_*` slice ids].
- About 30 text blocks and 89 images, so a mapping script of about 150 lines
  or careful hand-seeding are both bounded [I]. Pick: the script, so the
  seed can be re-run if the export changes.

## 6. Phases

Briefs follow `docs/worker-brief.md`, one PR each, named mutations in each PR
body. The tiers are AUTONOMY.md's.

| phase                                              | owner                                                            | done when                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 — export, repo, capture** 🟢/🔴               | operator (export, `gh repo create` if the app is refused), agent | `reddoorla/mantis-landscaping` exists from **`reddoorla/reddoor-starter`** (OD 59) with `ci / ci` protection; the Blux export and this capture are in `matching/spec/`; a re-capture's sha256 matches `captures/mantis-landscaping/manifest.json` for all 105 files, or each difference is named; `match-harness --ref https://mantislandscaping.com` installed with `refMark` = `6e0b52ee-9bb9-4c5a-b1ee-653009e3b572` and `--check-ref` passing |
| **P1 — Prismic repository + write token** 🔴       | operator                                                         | the operator creates the Prismic repository `mantis-landscaping` and mints its Custom Types write token; `PRISMIC_WRITE_TOKEN` is set on the site repo and `PRISMIC_TOKEN_MANTIS_LANDSCAPING` on reddoor-maintenance with its `env:` line in `fleet-prismic-drift.yml`; `reddoor-maint prismic-models --fleet turso --tokens` prints `PRESENT` for the site (the agent prints this checklist and never mints)                                     |
| **P1b — Turso row** 🟡                             | agent                                                            | `reddoor-maint ensure-site mantis-landscaping --name "Mantis Landscaping" --url https://mantislandscaping.com --git-repo reddoorla/mantis-landscaping` wrote a row with `status = building`, and a `SELECT` shows it                                                                                                                                                                                                                              |
| **P2 — model, slices, routes, seed** 🟡            | agent                                                            | models merged and pushed by `prismic-models.yml`; the seed has created every page and project from the export; the Netlify preview answers 200 at every kept path, 301 at the folded ones, 404 at an unknown slug; a built-output grep finds no `cloudfront.net/6e0b52ee` or `blux`                                                                                                                                                               |
| **P3 — Netlify site** 🔴 (operator dashboard) / 🟡 | operator creates it, agent wires it                              | Netlify site `mantis-landscaping` builds `main`; the Prismic publish webhook rebuilds it; `FORMS_INGEST_URL`, `FORMS_INGEST_TOKEN` and `PUBLIC_TURNSTILE_SITE_KEY` are set (operator); the row's `netlify_id` is filled and `SELECT`-verified                                                                                                                                                                                                     |
| **P4 — form intake** 🟡                            | agent; recipient from client via Nicole                          | `/contact-us` posts through `@reddoorla/maintenance/forms` to `/api/forms/mantis-landscaping`; a test submission is stored in Turso and notifies the operator (pre-launch routing); the preview host is on the Turnstile widget (no error 110200); `form-e2e` covers it; the newsletter signup reaches the existing Mailchimp list (one test address, unsubscribed after)                                                                         |
| **P5 — fidelity and improvement pass** 🟡          | agent; OD 62 sign-off                                            | the safe defaults in §4 are in; OD 62's approved changes are in; the matching gate passes at 1440/834/390 for `/`, one project page and `/contact-us`, with a LEDGER line for every intended difference; Lighthouse on the preview is at or above today's table on every category; a full axe run has 0 serious/critical                                                                                                                          |
| **P6 — launch** 🔴 DNS / 🟡 recipe                 | DNS holder (OD 61) changes records; agent runs recipes           | only the apex `A` and the `www` `CNAME` change; MX, SPF and other TXT records are untouched; every kept path answers 200 with `server: Netlify` and none carries `blux`; the other three host variants 301; `forms-notify-target` is moved to the client recipient; `launch mantis-landscaping` drafts the Launch report (never sends); the row is `maintained` with `git_repo`/`netlify_id` already filled; report cadence set (OD 61)           |
| **P7 — Blux off** 🔴                               | operator                                                         | at least 14 days after cutover with no rollback, the Blux site is cancelled (OD 60)                                                                                                                                                                                                                                                                                                                                                               |

**P1-23 (#1056)** was in flight on 2026-10-01: a worker branch
(`claude/intelligent-euler-b08e4t`, 17:26Z) changes `launch` to score the live
URL. If it has not landed by P6, the Launch report scores the checkout, so
check before running `launch`.

**Privacy (P1-26, #1055, parked):** a launch dependency **only if** OD 62
adds GA4. Otherwise Mantis launches without it, as today.

## 7. Who owns what

| item                                                                                     | owner                                                                       |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Blux export download; Blux login                                                         | operator, or Nicole if the account is her partner's (OD 60)                 |
| Blux cancellation, and when                                                              | operator / account holder, after P7's 14 days                               |
| Domain and DNS: Squarespace Domains account (Google Domains nameservers)                 | **unknown** (R1, OD 61); whoever holds it makes the P6 change, or delegates |
| Google Workspace mail on the domain                                                      | client; untouched by this project                                           |
| Content and photo sign-off: alt text, meta descriptions, the folded page, the dead cards | client, via Nicole (OD 61/62)                                               |
| Contact form recipient                                                                   | client, via Nicole (OD 61); until launch, the fleet notifies the operator   |
| Mailchimp list                                                                           | client; we only post to it                                                  |
| GitHub repo, Prismic repository, Netlify site, write token, secrets                      | operator (🔴)                                                               |
| Code, model, seed, recipes, Turso row, reviews, PRs                                      | agent                                                                       |
| GA4 property (if OD 62 says yes)                                                         | operator creates it; agent wires it                                         |

No agent contacts the client or posts to Discord. Questions for the client
go to the operator through OD 61, as one message for Nicole.

## 8. Risks and unknowns

| #   | risk / unknown                                                                                                                                       | how we find out                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| R1  | Who holds the Squarespace Domains account. Google Domains nameservers still answer, so DNS is edited in Squarespace's panel                          | OD 61: Nicole asks her partner; confirm with a login, not a WHOIS (RDAP shows only the registrar)          |
| R2  | Where Blux sends contact submissions today. If it is an inbox nobody reads, leads are already being lost                                             | OD 61; the Blux dashboard's form settings, seen with the export                                            |
| R3  | Blux stops serving before P0 (account lapses)                                                                                                        | the manifest here proves any later capture; P0 starts with the export; OD 60 says not to cancel until P7   |
| R4  | Unpublished feed items (indexes 2–4) hold content the client expects to see                                                                          | the export's `site.json` `feeds`                                                                           |
| R5  | Icon licences: several PNGs are titled `noun-…-NNNNNNN` (Noun Project)                                                                               | ask in OD 61, or redraw as inline SVG in P5                                                                |
| R6  | The `blux` pipeline is dormant (no workflow runs it; its last consumer, the-pointe, is archived), so `convert` may not run cleanly on a fresh export | P2 runs `blux convert` first and records each diagnostic; `blux grid` already parsed this site's pages [M] |
| R7  | Email deliverability: a careless cutover drops the MX or SPF records                                                                                 | P6 compares `dig MX` and `TXT` before and after, and only the `A` and `www` records change                 |
| R8  | The images on Prismic: 238.6 MB of originals is heavy but under Prismic's per-file cap [I]; 10.9 MB is the largest                                   | the seed's upload step reports each file; downscale anything over the cap to 4000 px                       |
| R9  | Slice Machine's replacement lands mid-build                                                                                                          | BACKLOG 57; follow the starter at P0                                                                       |
