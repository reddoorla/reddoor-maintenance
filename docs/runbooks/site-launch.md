# Site launch — one ordered list, from DNS cut-over to the first report with analytics

Every new site goes through this list. It exists because Williamson
Construction and Williamson Homes went live on 2026-10-13 with no Analytics, no
Search Console, no contact and no schedule, and nothing said so: `launch`
checked none of them, and each one fails late and quietly.

**The tooling enforces it.** `reddoor-maint launch-check <site>` prints one line
per step below, `ok`, `missing` or `unverified`, and exits non-zero unless every
line is `ok`. `reddoor-maint launch <site>` runs the same check first, before
any GitHub write, and stops unless every step is `ok` or named in
`--allow-missing <step>` (repeatable or comma-separated). `unverified` means
this run could not tell (no credentials, no browser, the API did not answer),
and it stops a launch exactly as `missing` does.

```sh
reddoor-maint launch-check williamson-homes          # read-only, any time
reddoor-maint launch williamson-homes                # refuses until ready
reddoor-maint launch williamson-homes --allow-missing search-console
```

Who does each step: **operator** (a Google console, a merge, an approval),
**worker** (an agent session: code PRs, row writes through the existing
mirrors), or **tooling** (a command checks it).

## Order, and why

Two orderings carry weight. Everything else can run in parallel.

- **The GA tag goes in as early as possible, before DNS if it can.** GA does
  not backfill: every day the live site runs untagged is a day the first report
  can never show. The tag is gated on the production host (`initAnalytics`), so
  installing it on a preview build collects nothing until DNS points at it.
- **The contact, the schedule and the header image go on the row before
  `launch`.** `launch` drafts the go-live email into the approve queue, and the
  approve gate (`approveBlockers`, `src/reports/preflight.ts`) refuses a report
  with no recipient or no header image. A launch without them drafts an email
  that can never be approved. A blank `maintenance_day` makes the first
  Maintenance report fall due the day the site turns `maintained`.

## The list

| #   | Step                                                                                                                                                                                                                | Who                              | `launch-check` step | Verified by                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | DNS cut over; the site serves on its production host with a certificate.                                                                                                                                            | operator                         | `url`               | The row's `url` is `https://` and answers 2xx, after redirects, on its own apex or `www` host. For a Webflow cut-over, the site's own verifier (e.g. `scripts/williamson-cutover-verify.mjs`).                                                                                                                                                                                                       |
| 2   | Record the row's `url` as the `https://` address the site serves (apex or `www`, whichever it lands on).                                                                                                            | worker or operator               | `url`               | Every audit, the report and the GA hostname filter read it. `http://` is `missing`.                                                                                                                                                                                                                                                                                                                  |
| 3   | GA4: create the property and a web stream for the production host. Reuse a pre-existing property (a Webflow-era one) if there is one, so the history carries over.                                                  | operator                         | `ga-property`       | —                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4   | GA4: grant every `GA_SUBJECT` subject (today `reports@reddoorla.com`) Viewer on the property.                                                                                                                       | operator                         | `ga-property`       | The Data API answers for the property **as each subject in turn, no failover** (`docs/runbooks/ga-search-role-account-cutover.md`). A refusal is `missing` and names the subject.                                                                                                                                                                                                                    |
| 5   | Put the numeric property ID on the row (`ga4_property_id`).                                                                                                                                                         | worker                           | `ga-property`       | Numeric; a `G-` measurement ID there is `missing`.                                                                                                                                                                                                                                                                                                                                                   |
| 6   | Install the tag: `reddoor-maint analytics-tag <site> --measurement-id G-… --production-host <host>`, which writes `src/hooks.client.ts`. Add the GA hosts to `kit.csp` by hand where the recipe refuses to edit it. | worker; operator merges          | `ga-tag`            | The GA4 Admin API lists the property's web streams, and a browser load of the live `url` must receive the loader for one of **those** measurement IDs. Another property's tag, a CSP refusal or no loader is `missing`. No browser here is `unverified`.                                                                                                                                             |
| 7   | Add a `/privacy` page and a footer link to it (the GA disclosure).                                                                                                                                                  | worker; operator merges          | `privacy`           | `GET <origin>/privacy` answers 2xx without leaving the site's hosts or path, and the home page links to the site's own `/privacy` (a link to Google's does not count).                                                                                                                                                                                                                               |
| 8   | Search Console: create the property (domain or URL-prefix) and give the worker an HTML-tag verification token.                                                                                                      | operator                         | `search-console`    | —                                                                                                                                                                                                                                                                                                                                                                                                    |
| 9   | Add the `google-site-verification` meta tag to `src/app.html`.                                                                                                                                                      | worker; operator merges          | —                   | The tag is on the live page.                                                                                                                                                                                                                                                                                                                                                                         |
| 10  | Press Verify, then add every `GA_SUBJECT` subject (`reports@reddoorla.com`) as a user.                                                                                                                              | operator                         | `search-console`    | —                                                                                                                                                                                                                                                                                                                                                                                                    |
| 11  | Record `search_console_property` on the row.                                                                                                                                                                        | worker                           | `search-console`    | The property is for the row's host, and the Search Console lookup `fetchSearch` runs answers for it as each subject. A refusal is `missing`.                                                                                                                                                                                                                                                         |
| 12  | Contact: `point_of_contact`, and `report_recipients_to` / `_cc` if reports go elsewhere.                                                                                                                            | operator decides; worker records | `contact`           | The approve gate's own recipient check (`recipientFindings`): a To resolves, every address is well formed, and it is not only an operator address. Stricter than the gate on that last point, which the gate only warns on.                                                                                                                                                                          |
| 13  | Schedule: `maintenance_freq` and `maintenance_day`; `testing_freq` and `testing_day` if Testing reports go out.                                                                                                     | operator decides; worker records | `schedule`          | A known frequency; for anything but `None`, a date (not over 13 months old) the cycle counts from. A Testing frequency needs its `testing_day` too.                                                                                                                                                                                                                                                  |
| 14  | Header image for the reports: `reddoor-maint header-image <site> --write-back`.                                                                                                                                     | worker                           | `header-image`      | The approve gate's header-image check (`headerImageFindings`).                                                                                                                                                                                                                                                                                                                                       |
| 15  | `reddoor-maint launch-check <site>` reads `READY`.                                                                                                                                                                  | worker                           | all                 | `LAUNCH_CHECK_SUMMARY … ready=true`.                                                                                                                                                                                                                                                                                                                                                                 |
| 16  | `reddoor-maint launch <site>` from the site's checkout: readiness, Renovate and protection, the dev guard, the first audit, and the go-live draft.                                                                  | operator                         | all                 | The command prints `drafted (awaiting approval)`.                                                                                                                                                                                                                                                                                                                                                    |
| 17  | Approve the go-live email. Sending it flips `status` to `maintained` and stamps "Launched at".                                                                                                                      | operator                         | —                   | The Reports row is sent; the site row reads `maintained`.                                                                                                                                                                                                                                                                                                                                            |
| 18  | The nightlies cover the site.                                                                                                                                                                                       | tooling                          | —                   | Only `maintained` sites are swept (`selectFleetSites`, `src/inventory/select.ts`), so lighthouse, smoke and form-e2e start the night after step 17. The Search Console re-check has its own filter (`maintained` and a stored `no-property`), so it too starts only after step 17. Read the site's `site_health` row the next morning. A site that sits `building` after DNS is live is unmonitored. |
| 19  | The first Maintenance report drafts with an analytics section.                                                                                                                                                      | tooling; operator approves       | —                   | The draft's Users and Google Indexed rows are filled, not blank; the run logs no `⚠ GA skipped` or `⚑ Search` line for the site.                                                                                                                                                                                                                                                                     |

Steps 3, 4, 8 and 10 are in Google's consoles and are the operator's. Steps
6, 7 and 9 are PRs in the site's repo; check its ruleset for whether `main`
takes a direct merge or goes through staging. Row writes go through the
existing commands and mirrors only (`ensure-site`, the dashboard's site page,
`header-image --write-back`), never a hand-written SQL statement.

## Opt-outs

A site whose row accepts `no analytics` passes `ga-property` and `ga-tag`, and
one that accepts `no search console` passes `search-console`
(`src/fleet/opt-outs.ts`). These are the operator's decisions, recorded on the
row's Accepted Watch Conditions. `--allow-missing` is the one-launch version (it lets a step through whether it reads `missing` or `unverified`)
of the same call, and leaves the step on the list for next time.

## Proven (2026-10-14)

- Data Dynamiq, fully launched: `READY`, 8 of 8 `ok`, `G-V11LZYNMY2` seen
  loading as property `556916505`'s stream.
- Williamson Construction and Williamson Homes, on the rows as they stood:
  `NOT READY`, 7 `missing` and `privacy` `unverified` (the url was `http://`, so
  it was not fetched). After the worker set the `https://` url and stored the
  header images the same day, both read `url ok` and `header-image ok`, with
  `privacy` now a measured `missing` (the live `/privacy` 404s).
- MSOT: `NOT READY` on `privacy` alone. Its `/privacy` and `/privacy-policy` both
  404 and its home page links to neither.
- Negative controls against the live APIs: property `999999999` reads
  `ga-property missing` (`PERMISSION_DENIED`); MSOT's property on Data Dynamiq's
  row reads `ga-tag missing` ("loads G-V11LZYNMY2, not … G-BZ0WQMEE8L"); a
  Search Console property the subject cannot read reads `search-console
missing`.
