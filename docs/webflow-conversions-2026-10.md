# Webflow conversions before 2026-10-19

Scoped 2026-09-29 by a worker session for BACKLOG Operator decisions 7. This is
research and planning only: nothing was built, no repo was created, and no DNS,
Netlify or Webflow setting was touched. Every measurement below comes from a
plain unauthenticated HTTP fetch, a public DNS lookup (`dns.google`), or a
SELECT on the live Turso roster, all made on 2026-09-29 between 23:50Z and
00:30Z. `[M]` means measured that way; `[I]` means inferred, with the reason
given.

## 1. Which sites

The BACKLOG line says "two sites still to convert … Domaru must stay up to
11-01". Its source, Discord #website-maintenance on 09-17, cannot be reached
from a cloud session. So the two sites cannot be named with certainty from the
repo alone. What the repo and the roster do show:

- **Exactly three live sites are still served by Webflow** [M]. The roster has
  four rows whose `legacy` column names `webflow.com/dashboard` as the site host.
  One of them, 29 Navy, now answers from Netlify (`server: Netlify`) with no
  `data-wf-site` attribute: it was converted in September. The other three
  answer with Webflow markup, and their DNS points at Webflow (`198.202.211.1`,
  `www` → `cdn.webflow.com`).

| roster slug                  | status     | live URL                                   | Webflow site id            | `legacy."account owner"` |
| ---------------------------- | ---------- | ------------------------------------------ | -------------------------- | ------------------------ |
| `domaru`                     | `building` | `https://www.domaruhealthsupply.com/`      | `61817e584460db988c9333a4` | `jan 11`                 |
| `williamson-homes`           | `building` | `https://www.williamson-homes.com/`        | `645ec08251dadc9000a072e5` | `dec 8`                  |
| `williamson-construction-co` | `building` | `https://www.williamson-construction.com/` | `646d47bfeb53b0308e8d4379` | `dec 8`                  |

- None of the three has a `git_repo`, a `netlify_id` or a maintenance frequency
  in the roster [M].
- **The reading this plan recommends** [I]: the "two sites to convert" are
  **Williamson Homes and Williamson Construction**, and Domaru is the separate
  case. The reasons: the two Williamson sites share an owner date, a phone
  number (310.570.7278), a class vocabulary (`.brian`, `.mark`, the counter
  circles) and a custom script, and nine Construction pages still carry the
  title suffix "| Williamson Homes", so Construction was cloned from Homes. That
  makes them one build and a variant. The Domaru line reads as "keep it up
  until 11-01", which suggests the site ends or changes hands then, not that it
  gets a new build.
- **Domaru still needs work under that reading.** If Reddoor's Webflow stops
  serving on 10-19 and Domaru must answer until 11-01, it needs somewhere to
  live for those 13 days. This plan scopes that as a static **bridge** (§3.3).
  If Domaru is instead one of the two conversions, §3.3's conversion row
  applies, and the schedule in §4 still fits, with the risk moved to
  Construction.

This is decision **D1** in §6. The plan scopes all three, so whatever the
answer, nothing needs to be re-measured.

One more thing the roster cannot settle: the `"account owner"` values (`dec 8`,
`jan 11`) look like renewal dates, and a Webflow site plan can be billed apart
from the workspace plan. If those are site-plan renewals, the sites might keep
serving after the workspace cancels on 10-19. That is **D0**: confirm on the
Webflow billing page what stops on 10-19. It needs a Webflow login, which this
session was barred from. The plan assumes the worst case: **all three stop
serving on 10-19**.

## 2. What each site is (measured)

The sitemap.xml gives nothing: Domaru's returns an HTML page, and both
Williamson sites return nothing parseable. Page counts therefore come from a
same-host link crawl starting at `/`, capped at 400 pages (no site came close).
Every crawled page answered 200. The crawl sees only linked pages, so an
unlinked page or a draft CMS item would not appear.

### 2.1 Williamson Homes — `www.williamson-homes.com`

- **Pages: 10, on 5 templates.** Home, `/projects`, `/about-us`, `/contact`,
  and one CMS template, `/projects/<slug>`, with 6 items: `palos-verdes-cove`,
  `pv-malaga-cove`, `manhattan-beach`, `hermosa-home-gym`,
  `palos-verdes-north` and `palos-verdes-west`.
- **CMS: 1 collection, Projects, with 6 visible items.** Collection lists
  (`w-dyn-list`) appear on the home page, on `/projects` and on every project
  page (the "other projects" list). No pagination links.
- **Forms: none.** Contact is by `mailto:` (`info@`, `brian@williamson-homes.com`)
  and `tel:`.
- **Integrations: none.** No GA, GTM, pixel or tag of any kind. Fonts are
  Montserrat and Lato from Google Fonts. There are Flaticon attribution links.
- **Custom code:** a scroll-direction "sidekick" nav script on every page; a
  counter animation loaded at runtime from
  `raw.githack.com/tucksravin/incidental-js/main/webflow/specific/williamson-homes/countersAnim.js`,
  which is the operator's own GitHub served through a third-party proxy; a
  Ken Burns background offset script; a jQuery odd/even offset on the project
  grid; and small inline style blocks. `data-w-id` (Webflow interactions) occurs 36
  times across the 10 pages.
- **Assets: 82 unique files** on `cdn.prod.website-files.com` after collapsing
  responsive variants, most of them JPEG photography.
- **Domain / DNS:** apex `A 198.202.211.1` (TTL 600) with a 301 to `www`; `www`
  `CNAME cdn.webflow.com` (TTL 3600). The nameservers are GoDaddy
  (`ns31/32.domaincontrol.com`). **Mail is Microsoft 365**
  (`MX …mail.protection.outlook.com`, an SPF include, an `MS=` verification
  TXT), plus a `google-site-verification` TXT. The account that holds the
  GoDaddy login is not visible from outside.
- **Staging host:** `williamson-homes.webflow.io` returns 404, so the staging
  name is something else or is disabled.

### 2.2 Williamson Construction — `www.williamson-construction.com`

- **Pages: 14, on 7 templates.** Home, `/about-us`, `/services`, `/projects`,
  `/contact`, `/join-the-team`, and one CMS template, `/projects/<slug>`, with
  8 items: two Cedars-Sinai, three Providence, `west-high-school`,
  `torrance-high-school` and `mbm-hospitality`.
- **CMS: 1 collection, Projects, with 8 visible items.** Lists on `/projects`
  and on every project page.
- **Forms: 1.** `/join-the-team` is a subcontractor intake: Name, Email, Phone,
  Trade, License Number, Insurance, Union, Prevailing Wage (radio buttons),
  plus one unlabeled field, `Name 6`. It is a Webflow-native form, so
  `webflow.js` posts it to Webflow's form backend, which ends when the site
  does. The address Webflow emails submissions to is not visible. `/contact`
  has no form, only `mailto:info@` and `tel:`.
- **Integrations:** an Adobe Fonts (Typekit) kit, `htt1asl`, serving
  `freight-sans-pro`, which is licensed to whoever owns the kit; Google Fonts
  (Lato, Montserrat); and one Vimeo video (`1138278406`) in an oEmbed. No
  analytics.
- **Custom code:** the same family as Homes (resize handlers for the project
  grid and caption offsets, and a plan-highlight script on `/services` that
  recolors SVG polygons on hover), plus 9 `w-embed` blocks.
- **Components:** across the 14 pages, the string `w-slider` occurs 22 times and
  `w-background-video` 12 times (class occurrences, not distinct components).
- **Assets: 101 unique files**, including **19 video/PDF files** (6 mp4, 6 webm
  and a PDF, with poster frames). This is the heaviest capture of the three.
- **Domain / DNS:** apex `A 198.202.211.1` (TTL 600) with a 301 to `www`; `www`
  `CNAME cdn.webflow.com` (TTL 3600). Nameservers GoDaddy (`ns27/28`); **mail is
  Microsoft 365**.
- **Staging host:** `williamson-construction.webflow.io` answers 200 with the
  same site id.
- **An existing defect:** 9 of the 14 page titles end in "| Williamson Homes".

### 2.3 Domaru — `www.domaruhealthsupply.com`

- **Pages: 7, one template each:** home, `/products`, `/services`, `/about`,
  `/faq`, `/contact` and `/privacy`.
- **CMS: none visible.** No `w-dyn-list` on any page.
- **Forms: 1.** `/contact` asks for Name, Company Name, Role, Email, Phone,
  Country and "Tell us about your project". It is a Webflow-native form
  protected by reCAPTCHA (Google's script loads on all 7 pages).
- **Integrations:** reCAPTCHA and Google Fonts (Jost). No analytics. Outbound
  links to `blackboxmerch.com` and `gojosteam.com`.
- **Custom code:** the Webflow loader only, plus one small FAQ dropdown style.
- **Components:** 12 distinct Lottie JSON files (22 Lottie elements across the
  7 pages); `w-slider` occurs 12 times and `data-w-id` 140 times. This is the
  most animated of the three.
- **Assets: 66 unique files.**
- **Domain / DNS:** apex `A 198.202.211.1` (TTL 149); `www`
  `CNAME cdn.webflow.com` (TTL 300). Both apex and `www` serve without a
  redirect. The nameservers are `ns1/ns2.dyna-ns.net`, which are Dynadot's
  [I, by name]. The SOA serial is `2026012001`, so the zone last changed in
  January 2026. **Mail goes through MailChannels** (`mx1/mx2.mailchannels.net`).
- **Staging host:** `domaru.webflow.io` answers 200 with the same site id.

### 2.4 Which track

**Native `reddoorla/reddoor-starter` for both Williamson sites.** The Blux track
exists to mirror a Blux render layer, and neither site has one. The
2026-09-08 Webflow rebuild pipeline spec (D1, D2) settled that Webflow rebuilds
go native, with site-specific mechanism living in the site repo. 29 Navy is the
precedent: a Webflow site rebuilt on native, started on 09-08 and serving from
Netlify by 09-28. Each Projects collection becomes a site-owned `project`
custom type, and each list becomes a content-relationship group (spec D3, D5).

**No track for a Domaru bridge.** A bridge is a static capture of the rendered
site, published on Netlify. If Domaru turns out to be a conversion, it goes
native too.

## 3. Conversion plans and effort

Effort is in worker sessions, where one session is a single long cloud or
laptop session of agent time. Operator minutes are listed separately. The
calibration is 29 Navy: about three weeks elapsed from bootstrap to Netlify,
with a matching campaign and without a deadline. These three sites are the same
size or smaller, but there is only one elapsed window of 20 days for all of
them. That is why the plan front-loads the capture and shares one design system
across both Williamson builds.

### 3.1 Williamson Homes (build first; Construction reuses it)

1. **Bootstrap:** `/new-site williamson-homes` (native), `match-harness --ref
https://www.williamson-homes.com`, and a capture of the full reference into
   `matching/spec/`: HTML, CSS, every asset including all responsive variants,
   fonts, and the githack counter script, vendored. (Phase 0, §5.)
2. **Content model:** a `page` with slices, and a `project` custom type (title,
   location, hero, gallery, body, and a relationship group for "other
   projects"), emitted into `customtypes/` and delivered by the prismic-models
   workflow. The 6 projects are seeded through `reddoor-maint webflow` capture,
   docs and migrate, or through a fixture and `prismic-seed`. No slice models
   (spec D5).
3. **Slices:** hero with Ken Burns, counters, project grid (odd/even offset done
   in CSS, not jQuery), timeline, team (`.brian` / `.mark`), and a contact
   block. The sidekick nav goes in the site header.
4. **Match:** home and one project page through the harness at 1440/834/390;
   the other pages checked by eye against the capture.
5. **URLs:** keep every path exactly as it is today (`/projects/<slug>`,
   `/about-us`, `/contact`), so no redirect table is needed. Canonical host
   stays `www`, with an apex → `www` 301 on Netlify.

| Williamson Homes      | low | expected | high |
| --------------------- | --- | -------- | ---- |
| Prismic, native       | 2   | 3        | 5    |
| Static, no CMS (D2=B) | 1.5 | 2        | 3    |

### 3.2 Williamson Construction (variant of Homes)

1. **Bootstrap** as above, then **cherry-pick** the shared slices and styles from
   `williamson-homes` (never merge one site repo into another).
2. **Content model:** the same `project` type (a second copy, owned by this repo)
   and 8 projects seeded.
3. **New work beyond Homes:** `/services` with the plan-highlight SVG
   interaction, `/join-the-team` on the fleet form pipeline, sliders,
   background video with 6 mp4/webm files self-hosted (Prismic media or
   Netlify, which decision D2 settles), the Vimeo embed, and the Adobe Fonts
   kit (D8).
4. **Form:** `/join-the-team` becomes a fleet form route (Turso submissions,
   Turnstile, `notify_routing`) with the same fields, `Name 6` renamed, and
   `forms-notify-target` held on the operator until launch. It goes live only
   with the recipients answered in D6.
5. **Fix in passing:** the 9 "| Williamson Homes" titles (D5 decides whether
   this counts as a content change).

| Williamson Construction | low | expected | high |
| ----------------------- | --- | -------- | ---- |
| Prismic, native         | 2   | 3.5      | 6    |
| Static, no CMS (D2=B)   | 1.5 | 2.5      | 4    |

### 3.3 Domaru

| Domaru                                           | low | expected | high |
| ------------------------------------------------ | --- | -------- | ---- |
| **Bridge** (static capture on Netlify, to 11-01) | 0.5 | 1        | 2    |
| Full native conversion (if D1 says so)           | 3   | 4        | 6    |

The **bridge** is the 7 rendered pages, their CSS and JS (including
`webflow.js`, which drives the sliders, interactions and Lottie), all 66 assets
and the 12 Lottie JSON files, captured and rewritten to relative URLs, and
published as a static site on a new Netlify site. Nothing may still load from
`cdn.prod.website-files.com` at the end, and a grep of the published HTML
proves it. The contact form changes: either Netlify Forms (one attribute plus a
hidden field, with reCAPTCHA removed) or a `mailto:` fallback. That choice is
D6. What happens on 11-01 (take it down, hand it over, redirect it) is part of
D1.

**The other Domaru option is to build nothing.** Webflow can transfer a site to
another workspace. If the client, or whoever takes Domaru on 11-01, has or opens
a Webflow workspace, a transfer before 10-19 keeps the site up with zero build.
That needs a Webflow login (an operator action), so it is listed under D1.

### 3.4 Totals

| Scope (recommended reading of D1)                           | low | expected | high |
| ----------------------------------------------------------- | --- | -------- | ---- |
| Homes + Construction on Prismic + Domaru bridge             | 4.5 | 7.5      | 13   |
| Homes + Construction static + Domaru bridge                 | 3.5 | 5.5      | 9    |
| Domaru + one Williamson converted, other Williamson bridged | 5   | 8        | 13   |

At one or two worker sessions a day, the expected Prismic total fits the window
in §4. The high case does not fit unless the static fallback is taken for
Construction. That is the lever to pull if 10-09 arrives with Construction
unfinished.

## 4. Schedule

Today is Tuesday 09-29. Webflow is assumed to stop serving on Monday 10-19. DNS
cuts over last and early enough that **Webflow is still serving for five days
after the cutover**, so a rollback is only a DNS change back.

| Date                  | What                                                                                                                                                                                         | Who                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Wed 09-30             | Morning pass: answer D0–D2 (the rest can follow by 10-05). **Phase 0 starts regardless:** it needs no decision and is what dies first.                                                       | operator; worker (P0)     |
| Wed 09-30             | **Phase 0**: bootstrap both Williamson repos, install the harness, capture all three references in full.                                                                                     | worker                    |
| Thu 10-01 – Mon 10-05 | **Phase 1**: Williamson Homes build, seed, match; preview on Netlify.                                                                                                                        | worker                    |
| Mon 10-05             | Deadline for D3–D8 (forms recipients, DNS holders, fonts kit).                                                                                                                               | operator                  |
| Tue 10-06 – Fri 10-09 | **Phase 2**: Williamson Construction, cherry-picked from Homes, plus form and video.                                                                                                         | worker                    |
| Wed 10-07 – Thu 10-08 | **Phase 3**: Domaru bridge (or transfer, per D1); preview on Netlify.                                                                                                                        | worker                    |
| Fri 10-09             | **Go / static-fallback call** for Construction if Phase 2 is not green.                                                                                                                      | operator                  |
| Mon 10-12             | Previews to Tim and the client: all three URLs, form test submissions end to end.                                                                                                            | operator / Tim            |
| Tue 10-13             | Fix round. **Phase 4 prep**: Netlify custom domains added (RED, operator); `www` CNAME TTLs lowered from 3600 to 300 at GoDaddy/Dynadot (RED, holder).                                       | worker; operator; holder  |
| **Wed 10-14**         | **Cutover: Williamson Homes and Construction.** GoDaddy: apex `A` → Netlify, `www` CNAME → `<site>.netlify.app`. **MX, SPF and verification TXT untouched.** SSL provisioned, then verified. | holder; operator verifies |
| **Thu 10-15**         | **Cutover: Domaru** (bridge or conversion) at Dynadot, same shape; MailChannels MX untouched.                                                                                                | holder; operator verifies |
| Fri 10-16             | Buffer. Post-cutover checks: every old path 200 on the new host, forms deliver, nothing loads from `website-files.com`.                                                                      | worker                    |
| Mon 10-19             | Webflow cancels. Re-check all three hosts answer from Netlify.                                                                                                                               | worker                    |
| Sun 11-01             | Domaru bridge ends per D1 (down, handed over, or redirected).                                                                                                                                | operator                  |

The three Williamson/Domaru roster rows move from `building` to whatever status
the operator picks, in the launch phase, not before. Moving a row to
`maintained` pulls it into every fleet sweep, so the row needs `git_repo` filled
first. The 29 Navy lesson is in the fleet-composition research.

## 5. Risks

1. **The reference dies on 10-19, and so may its assets.** Beachfront's
   reference died, and a paused campaign could not resume (spec D11). The
   `cdn.prod.website-files.com` files may stop resolving when the sites are
   unpublished or the plan lapses [I]. Phase 0 captures everything on day one,
   including every responsive variant, video and Lottie file.
2. **The Domaru constraint.** It must answer until 11-01, 13 days past the
   cancel. The bridge covers it, but the bridge keeps `webflow.js` and jQuery 3.5
   from the capture. That is acceptable for 13 days and not for longer. If
   "until 11-01" turns out to mean "from 11-01 onward, permanently", D1 changes
   and the bridge becomes a conversion.
3. **What stops on 10-19 is unverified** (D0). The plan assumes the worst. If the
   site plans run to `dec 8` and `jan 11`, the cutover can slip, but the plan
   does not count on it.
4. **Email breaks if the DNS change is done as a zone replace.** Both Williamson
   domains run Microsoft 365 mail and Domaru runs MailChannels. The cutover
   touches exactly two records per domain: apex `A` and `www` `CNAME`. The
   Phase 4 brief says so in its first line.
5. **DNS is in accounts nobody here has seen.** The GoDaddy and Dynadot logins
   are probably the clients' [I]. If the holder is not reachable on 10-14 or
   10-15, the cutover slips day for day into the buffer. D7 names the holder by
   10-05.
6. **Form submissions go dark silently.** Webflow's form backend ends with the
   site, and the address it notifies today is unknown. A cutover without the new
   route live and tested loses leads with nothing erroring. This happened once
   in the fleet already (29-navy#40, an unlinked `/contact` accepting real
   leads).
7. **Adobe Fonts kit `htt1asl`** is licensed to someone's Adobe account and
   restricted by domain. It will not render on `*.netlify.app` previews unless
   the kit owner adds that domain, and it breaks outright if the owner is gone.
   D8.
8. **Third-party runtime code.** The Williamson counter script loads from
   `raw.githack.com` at runtime. The rebuild vendors it, and the bridge must not
   depend on it.
9. **Deadline versus review.** "Two dirty review rounds, then stop" and "worker
   sessions never ask mid-flight" both apply. A decision that comes late slips
   the build day for day, which is why D3–D8 have a 10-05 deadline and Phase 0
   needs none.
10. **Concurrent sessions.** Each site repo gets one worker at a time. Phases 1
    and 2 are sequential by design, because Construction cherry-picks from
    Homes.

## 6. Operator decisions needed

> **Answered by the operator, 2026-09-30:**
>
> - **D1:** the two conversions are **Williamson Homes and Williamson
>   Construction**. **Domaru lapses on 10-19.** The client no longer wants it
>   up. There is no bridge, no transfer and no conversion, and Phase 3 is
>   cancelled. Phase 0's Domaru capture is kept only as an archive. The Domaru
>   cutover on 10-15 is dropped. On 10-19, Domaru is expected to stop answering.
>   The client should be told, and should repoint or drop the domain.
> - **D2:** Prismic, with a site-owned `project` custom type in each Williamson
>   repo. Static stays the fallback only at the 10-09 call.
> - **D5:** yes to both. Fix Construction's 9 "| Williamson Homes" titles.
>   Match home and one project page pixel-close; check the rest by eye.
> - **D3 and D4** follow the plan's picks: the native starter, unchanged paths,
>   and `www` canonical.
> - **D0, D6, D7 and D8** are facts the operator is getting from Tim by 10-05:
>   Webflow billing, form recipients, the GoDaddy holder and the Adobe Fonts kit
>   owner. D6 now covers only Construction's `/join-the-team`.
> - **Phase 0** started 2026-09-30 00:23Z in a worker session.

Each is the exact ask, with the pick this plan would make.

- **D0 — What stops on 10-19?** Check Webflow billing: does the workspace cancel
  take the three site plans with it, or do they run to `dec 8` / `jan 11`?
  _Pick:_ plan for the worst case either way. The answer only widens the
  buffer.
- **D1 — Which two, and what happens to Domaru?** Confirm the conversions are
  **Williamson Homes and Williamson Construction**. Then say what Domaru needs:
  (a) a static bridge on Netlify from 10-15 to 11-01, then down; (b) a transfer
  to the client's own Webflow workspace before 10-19 (your login); or (c) a full
  conversion. _Pick:_ Williamsons convert; Domaru (b) if the client has a
  workspace, otherwise (a).
- **D2 — Prismic or static content for the Williamsons?** _Pick:_ Prismic
  (native, `project` custom type), because Projects is the part a builder adds
  to, and it is the fleet standard with model delivery in CI. Static is the
  fallback only if 10-09 finds Construction short.
- **D3 — Track.** _Pick:_ native `reddoor-starter` for both (spec D1/D2; 29 Navy
  precedent). Blux does not apply.
- **D4 — Redirects and canonical host.** _Pick:_ keep every path unchanged, so
  there is no redirect table. Keep `www` canonical with apex → `www` 301, as
  Webflow does today (Domaru currently serves both without a redirect; pick
  `www` there too).
- **D5 — Fidelity and content fixes.** Match home and one project template
  pixel-close through the harness, and the rest by eye? Fix Construction's 9
  "| Williamson Homes" titles? _Pick:_ yes to both.
- **D6 — Form recipients.** Who receives Construction's `/join-the-team`
  submissions and Domaru's contact submissions? Does Williamson Homes want a
  contact form, or keep `mailto:`? _Pick:_ keep `mailto:` on Homes (no new
  scope), and ask Tim for the other two recipient addresses.
- **D7 — DNS holders.** Who holds GoDaddy for both Williamson domains and
  Dynadot for Domaru, and can they make the change on 10-14 and 10-15? The
  worker cannot find this out; Tim or Erik can.
- **D8 — Adobe Fonts. Answered 2026-09-30 ~20:05Z: not `htt1asl`; Reddoor's
  own kit `noj4tji` serves the rebuild.** `htt1asl` belongs to the Webflow
  build and is not carried over. On 09-30 `noj4tji.css` had no
  `freight-sans-pro` [M: 0 matches], so the operator added it. **Done
  2026-09-30 ~20:10Z [M, live `noj4tji.css`]:** `freight-sans-pro` at 400,
  500, 600, 700 and 900, and the separate family `freight-sans-pro-lights`
  at 100–300, each roman and italic. Adobe ships Light (300) only as
  `freight-sans-pro-lights`, so the build must give the reference's
  weight-300 rules (`.our-mission-text`, `.font-weight-thin`, `.form-label`,
  and the centred `text-size-4xl` intro) `font-family: "freight-sans-pro-lights"`
  at weight 300. Otherwise the browser synthesizes them from 400.
  The operator also added `williamson-construction-co.netlify.app` and the
  production apex and `www` to the kit's domains (not verifiable from a cloud session; the first proof is the preview in a browser). The build then swaps Lato
  for `freight-sans-pro` from `use.typekit.net/noj4tji.css`, with
  `use.typekit.net` in `style-src`/`font-src` and `p.typekit.net` in
  `style-src`, and resolves `TODO(D8)` in `src/app.css`. The question as it was asked: Who owns kit `htt1asl`? _Pick:_ keep it if the owner
  adds the Netlify preview domain; otherwise substitute the closest Google
  font and say so to the client.
- **Analytics (optional).** None of the three has any analytics today. _Pick:_
  do not add any unasked. It is a line in the launch email, not in the build.

## 7. Worker briefs, one per phase

Each brief below is ready to paste. The IDs are `OD7-P0` to `OD7-P4`, after
Operator decisions 7. No issue exists yet; each worker opens one in
reddoor-maintenance titled with its ID, unless an earlier phase already did.

### Phase 0

**Status, 2026-09-30 (#1029): half done.** All three references are captured
whole, with every page, every responsive variant, the 12 Construction videos
and its PDF, the 12 Domaru Lottie files, the Google Fonts faces and the githack
counter script. They were fetched by `scripts/webflow-capture/capture.mjs`, and
`check.mjs` reports 0 missing for each. Page counts match §2: 10, 14 and 7.
Domaru's capture (an archive now that it lapses) and the tools are in PR #1032,
which is held for the operator after two review rounds (BACKLOG decision 34).
The two Williamson captures (310 MB) are on branch
`capture/od7-williamson-2026-09-30` (see `captures/README.md` in #1032). The
harness preflight was proven on both live Williamson sites with
`refMark: data-wf-site="<site id>"`. **Not done:** neither Williamson repo
exists, because the org refused this session's create. That, the Construction
repo's name (the roster slug is `williamson-construction-co`) and the RED
new-site steps are BACKLOG Operator decisions 33. Two things §2 did not list:
Domaru `/about` has a YouTube embed, and Homes `/about-us` carries a
commented-out `<script>` for a jsDelivr copy of the counter script
(`cdn.jsdelivr.net/gh/tucksravin/incidental-js@latest`, "once ready to deploy").
The browser does not load it, but the file is in the capture anyway.

```markdown
## Worker brief — OD7-P0: bootstrap both Williamson repos and capture all three Webflow references

**Item.** OD7-P0 · no issue yet (open "OD7 Webflow conversions" and claim it) · 🟢 GREEN · effort S–M
Three sites still serve from Webflow, which cancels 10-19; the references and their
`cdn.prod.website-files.com` assets die with it, and Beachfront shows a dead reference
cannot be re-captured [M, docs/webflow-conversions-2026-10.md §2, §5.1].

**Verify first.** `for h in www.williamson-homes.com www.williamson-construction.com www.domaruhealthsupply.com; do curl -s https://$h/ | grep -o 'data-wf-site="[^"]*"'; done`
Expect: three `data-wf-site` ids (645ec082…72e5, 646d47bf…4379, 61817e58…33a4). If any is
missing, that site has already moved: stop and record it.

**Start here.**

- `docs/webflow-conversions-2026-10.md` §2 — page lists, asset counts (82 / 101 / 66), the
  19 video/PDF files, the 12 Lottie files
- `docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md` — D1–D11; "Started"
  means what it meant for 29 Navy
- `src/recipes/match-harness/`, `src/webflow/crawl.ts` — the harness and the capture crawler
- the `new-site` and `matching-a-page` account skills

**Done when.** `reddoorla/williamson-homes` and `reddoorla/williamson-construction` exist from
the native starter with the match harness installed; each `matching/spec/` holds every page's
HTML, CSS, JS, every asset URL the pages reference (all responsive variants, all mp4/webm/PDF,
all fonts), and `harness.json` with a non-empty `refMark` (the site id); a Domaru capture of
the 7 pages, 66 assets and 12 Lottie files is committed to a repo or directory named in
the PR; and a check script reports 0 references in each capture that failed to download.
Page counts match §2 (10 / 14 / 7) or the PR says why not.

**Mutations I will run** (each must turn a test red):

1. Delete one captured asset: the missing-asset check must fail and name it.
2. Point `--ref` at `beachfront-dentistry.webflow.io` (a dead host): the harness preflight must refuse.
3. Blank `refMark`: the harness must refuse.

**Stop conditions** (beyond AUTONOMY.md's six):

- No Netlify custom domain, no DNS change, no Webflow login, no Prismic token minting
  (RED; list what is needed under Operator decisions).
- If D1 has named different sites, capture those instead and say so in the PR.
- Two dirty review rounds → "Operator decisions", not a third round.

**Landing.** As in the template (`docs/worker-brief.md`); in the site repos, one PR each.
```

### Phase 1

```markdown
## Worker brief — OD7-P1: Williamson Homes on native Prismic, preview on Netlify by 10-05

**Item.** OD7-P1 · OD7 issue · 🟡 YELLOW (new site build; 3-lens review) · effort M (2–5 sessions, expected 3)
A 10-page Webflow site (5 templates, a 6-item Projects collection, no forms, no analytics)
must be serving from our stack before 10-19 [M, §2.1].

**Verify first.** `ls matching/spec/` in `reddoorla/williamson-homes` shows the Phase 0
capture, and D2/D3/D4/D5 are answered in docs/BACKLOG.md Operator decisions.
Expect: the capture is present. If D2 says static, build without the `project` type and
say so.

**Start here.**

- `matching/spec/` — the reference, including the vendored `countersAnim.js`
- §3.1 of docs/webflow-conversions-2026-10.md — model, slices, URLs
- 29-navy — the nearest precedent (a native Webflow rebuild)
- `reddoor-maint webflow capture|docs|migrate`, `prismic-seed` — seeding the 6 projects

**Done when.** The Netlify preview serves all 10 paths with a 200 at the same paths as
today; the 6 projects come from Prismic `project` documents, delivered by the
prismic-models workflow; home and one project page pass the harness gate at 1440/834/390;
a grep of the built output finds no `website-files.com` and no `githack`; and the unit
tests cover the project route (a missing slug is a 404, not a 500).

**Mutations I will run** (each must turn a test red):

1. A project route that returns 200 for an unknown slug.
2. The "other projects" list includes the current project.
3. One of the 6 seeded projects is dropped from the fixture.
4. An asset URL left pointing at `cdn.prod.website-files.com`.

**Stop conditions** (beyond AUTONOMY.md's six):

- The Prismic repo or write token does not exist: RED, operator; write it down and end.
- No custom domain and no DNS: Phase 4 only.
- Two dirty review rounds → "Operator decisions", not a third round.

**Landing.** As in the template; PRs land in `reddoorla/williamson-homes`, and the journal
entry lands in reddoor-maintenance.
```

### Phase 2

```markdown
## Worker brief — OD7-P2: Williamson Construction from Homes' slices, with the intake form

**Item.** OD7-P2 · OD7 issue · 🟡 YELLOW · effort M–L (2–6 sessions, expected 3.5)
14 pages on 7 templates, an 8-item Projects collection, a 9-field subcontractor intake
form on Webflow's backend, 19 video/PDF files, an Adobe Fonts kit and a Vimeo embed [M, §2.2].

**Verify first.** Phase 1 is merged (its slices exist to cherry-pick); D6 names the
`/join-the-team` recipient; D8 answers the fonts kit.
Expect: all three. If D6 is not answered, build the form with `forms-notify-target` held
on the operator and do not launch it; say so.

**Start here.**

- `reddoorla/williamson-homes` — slices and styles to `git cherry-pick`, never merge
- `matching/spec/` — the reference: the plan-highlight SVG on `/services`, the sliders and
  background videos
- the fleet form route and `reddoor-maint forms-notify-target` — intake submissions

**Done when.** The preview serves all 14 paths with a 200; the 8 projects come from Prismic;
`/join-the-team` stores a test submission in Turso and notifies the D6 recipient (or the
operator while held), with Turnstile on; video plays from self-hosted files; home and one
project page pass the harness gate; titles end in "| Williamson Construction" if D5 said fix.

**Mutations I will run** (each must turn a test red):

1. The intake handler drops the Prevailing Wage radio value.
2. The form accepts a submission without a Turnstile token.
3. The notify target ignores the held flag.
4. A project route that returns 200 for an unknown slug.

**Stop conditions** (beyond AUTONOMY.md's six):

- If 10-09 arrives with this not green: stop, record the state, and put the static-fallback
  question under Operator decisions.
- Two dirty review rounds → "Operator decisions", not a third round.

**Landing.** As in the template; PRs land in `reddoorla/williamson-construction`.
```

### Phase 3

```markdown
## Worker brief — OD7-P3: Domaru static bridge on Netlify (serving until 11-01)

**Item.** OD7-P3 · OD7 issue · 🟢 GREEN (a static copy, no new behavior) · effort S (0.5–2 sessions)
Domaru (7 pages, no CMS, a contact form with reCAPTCHA, 12 Lottie files) must answer until
11-01 while Webflow cancels 10-19 [M, §2.3]. Skip this brief if D1 chose a Webflow transfer
or a full conversion.

**Verify first.** D1 answer = bridge; D6 names the contact recipient or picks `mailto:`.
Expect: both. The Phase 0 capture exists.

**Start here.**

- the Phase 0 Domaru capture
- §3.3 of docs/webflow-conversions-2026-10.md

**Done when.** A new repo holds the static site; a Netlify preview serves `/`, `/products`,
`/services`, `/about`, `/faq`, `/contact` and `/privacy` with a 200; sliders, interactions
and Lottie animate; the published HTML contains no `website-files.com`; and the contact form
delivers a test submission (Netlify Forms) or is a `mailto:` per D6.

**Mutations I will run** (each must turn a test red):

1. Leave one Lottie JSON on the Webflow CDN: the no-external-asset check must fail.
2. Drop `/privacy` from the publish directory: the path check must fail.
3. Remove the Netlify Forms attribute: the form test must fail.

**Stop conditions** (beyond AUTONOMY.md's six):

- No custom domain, no DNS: Phase 4.
- Two dirty review rounds → "Operator decisions", not a third round.

**Landing.** As in the template.
```

### Phase 4

```markdown
## Worker brief — OD7-P4: cutover checklist and post-cutover verification (the worker changes no DNS)

**Item.** OD7-P4 · OD7 issue · 🟢 GREEN for the worker; every DNS and Netlify-domain step is 🔴 and belongs to the holder or the operator · effort S
Cutover is Wed 10-14 (Williamsons) and Thu 10-15 (Domaru), with Webflow still serving until
10-19 as the rollback [§4].

**Verify first.** P1–P3 previews are approved by Tim/the client (10-12); D7 names the DNS holders.
Expect: both. If not, the cutover date slips; write the new date under Operator decisions.

**Start here.**

- §2 of docs/webflow-conversions-2026-10.md — the exact current records and TTLs per domain
- `reddoor-maint launch <site>` — bootstrap, first audit, launch email draft

**Done when.** A per-domain checklist is in front of the holder that changes **only** the apex
`A` and the `www` `CNAME` (MX, SPF, `MS=` and google-site-verification TXT listed as DO NOT
TOUCH); after each cutover, a script shows every path from §2 answering 200 from Netlify
(`server: Netlify`) on apex and `www`, with a valid certificate, no `data-wf-site` in any page,
and MX records identical to the §2 values; forms deliver a live test; the roster rows get
`git_repo`/`netlify_id` (SELECT-verified) before any status change.

**Mutations I will run** (each must turn a test red):

1. Feed the verifier a page that still carries `data-wf-site`: it must fail.
2. Feed it changed MX answers: it must fail.
3. Feed it a 301 loop on the apex: it must fail.

**Stop conditions** (beyond AUTONOMY.md's six):

- Never log in to Webflow, a registrar or Netlify's domain settings; never edit DNS.
- A roster status flip to `maintained` is the operator's call, after `git_repo` is set.
- Two dirty review rounds → "Operator decisions", not a third round.

**Landing.** As in the template.
```
