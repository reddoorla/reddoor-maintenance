# 2026-10-21 — The dashboard's per-IP rate limits are not enforced

**Where it landed:** this PR (reddoorla/reddoor-maintenance, branch `claude/rate-limit-one-ip-verdict`), this entry and the cockpit snapshot fix below. The probe itself is the workflow on branch `claude/rate-limit-one-ip-probe`, which runs only on a push to that branch and is not meant to merge. Runs [39606055121](https://github.com/reddoorla/reddoor-maintenance/actions/runs/39606055121) and [39606688815](https://github.com/reddoorla/reddoor-maintenance/actions/runs/39606688815).

**Why.** Every limited function and, since the cutover (#1574), the edge function `cockpit-rate-limit.ts` declare a per-IP `rateLimit` so "a credential-guessing or scraping loop can't hammer Turso". The cutover entry (`2026-10-20-2315-od18-cockpit-cutover.md`) found no 429 from a cloud container. It could not tell a missing limit from an egress proxy that spreads requests over several IPs. This entry repeats the burst from one fixed IP.

**Verdict: not enforced.** From one IP, 260 requests went to four limited paths, each burst over its declared limit inside one 60 s window, between 6:13am and 6:20am PT. None got a 429. The table quotes the runner log, in UTC. Production deploy `6ad82cbe` (commit `ac83236e`, #1582) was serving.

| Path                                            | Rule                                        | Requests, span                                  | Egress IP, before and after | Statuses |
| ----------------------------------------------- | ------------------------------------------- | ----------------------------------------------- | --------------------------- | -------- |
| `/fleet`                                        | edge function `cockpit-rate-limit`, 60/60 s | 80 in 54.6 s (13:13:15.175 to 13:14:09.792 UTC) | 172.214.109.233, both       | 80 × 302 |
| `/api/sites/probe/details` (GET health check)   | `site-details`, 30/60 s                     | 80 in 52.1 s (13:15:17.275 to 13:16:09.354)     | 172.214.109.233, both       | 80 × 200 |
| `/api/reports/probe/approve` (GET health check) | `approve-report`, 30/60 s                   | 50 in 38.5 s (13:17:32.443 to 13:18:10.941)     | 20.98.142.226, both         | 50 × 200 |
| `/auth/login`                                   | `auth`, 30/60 s                             | 50 in 35.5 s (13:19:17.343 to 13:19:52.830)     | 20.98.142.226, both         | 50 × 200 |

The requests were sequential, one every 0.6 to 0.8 s. Netlify's docs say a client over the threshold can get through for "up to 10 seconds" before blocking starts. The last request of each burst came 13.3 to 32.3 s after the request that crossed the declared limit (`/fleet` 13.3 s, `site-details` 32.3 s, `approve-report` 16.7 s, `auth` 13.8 s), so that grace period does not explain it. The response to one extra request after each burst carried no rate-limit header.

**A second source agrees.** Netlify's own observability for 13:13:00 to 13:16:20 UTC (run 1) lists one client address, 172.214.109.233, with 162 requests: 81 × 200 and 81 × 302 (the 80 burst requests plus the trailing one, per path). There were 81 edge-function invocations, so `/fleet` did pass through `cockpit-rate-limit`. Block reasons: `none` × 162. A query for 429s returned nothing. The window was clamped to about the last 66 minutes, which is all the history the query returned, so this proves nothing older.

**Why it isn't enforced: the leading explanation is the plan's rule cap, unconfirmed.** Netlify's rate-limiting page, read today: "Customers in all plans can programmatically apply limits to specific functions, edge functions, or redirects, by adding rules in code". The page caps code-based rules per project at 2 on Free and Personal, 5 on Pro and Enterprise, and 100 only on Enterprise with High-Performance Edge. The team is `Pro` (the Netlify API's `type_name`; project plan `nf_team_pro`). The site declares 18: 17 function rules and the edge function's. The page does not say what happens over the cap. It does say "a rule that does not pass validation does not fail the deploy", and that some errors produce "neither an error nor a success message". The deploy record fits a rule that silently does nothing:

- it carries every function's rule as a `rate_limit` traffic rule (`sliding_window`, the declared `window_limit` and `window_size`, aggregate key `ip`);
- its post-processing summary has no message about rate limiting at all.

If Netlify kept the first five rules in sort order, `approve-report` and `auth` would sit among them; run 2 went at exactly those two and they did not throttle either. So either over the cap none apply, or the cause is something else. The config shape is not the suspect: it matches the docs' example key for key, and the deploy parsed it.

**Beliefs corrected.**

- The brief offered "a site-level rule in `netlify.toml` or the UI" as the fix. Neither is open on Pro. The docs say "rate limits for functions cannot be defined in the `netlify.toml` configuration file". A `[redirects.rate_limit]` block covers only a redirect, and still counts toward the cap. UI rules need Enterprise with High-Performance Edge.
- The cutover entry left "the agent proxy spreads requests over several egress IPs" open as an explanation. That is ruled out: Netlify saw a single client address.

**The instrument.** The probe is a `curl -w '%{http_code}'` loop, and it reported real 200s and 302s that match Netlify's own counts. What it has not done is see a 429 on a known-good limited endpoint, because none exists on this team to aim at. So "not enforced" stands on two sources, the probe and Netlify's logs. The cause stays a hypothesis until the cap test below passes.

**What a fix looks like.** It is not built here: this session's task was the measurement.

1. **Test the cap first.** Open a draft PR that drops `rateLimit` from every function, which leaves the edge function's rule as the site's only one. Run this probe against its deploy preview: the docs say code-based rules can be tested "with a PR or branch preview". If `/fleet/__data.json` 429s past 60, the cap is the cause.
2. **If it is the cap, consolidate to five rules or fewer.** Make one edge function, or two, with `rateLimit` on `/*`, minus the hashed assets. That covers the pages, `/api/*`, `/auth/*` and `/r/*`, and every per-function `rateLimit` goes. One shared per-IP budget then covers `/api/*`, where the functions now have separate budgets of 20 to 120. Choose the budget so a signed-in operator's page load and polling stay under it. A second rule for `/auth/*` at 30 keeps the stricter password-guessing limit. Then re-run the probe on production; the limit is not proven until it shows 429s.
3. **If one rule alone still gives no 429**, the limit is truly absent on this plan. Then ask Netlify support, or limit inside the app with a per-IP counter in Netlify Blobs on the auth gate. That second option costs code on every gated request.

The branch `claude/rate-limit-one-ip-probe` stays up for re-runs: edit the paths and push. The cloud proxy refuses branch deletes in any case.

## The snapshot fix this PR carries

The first CI run on this PR went red on `cockpit/tests/site/site.ssr.test.ts`, "submissions over the cap": the snapshot said `3mo ago` and the page rendered `4mo ago`. Every branch cut from `main` that day failed the same way. The page view is given a pinned `now` (`2026-06-15T10:00:00Z` in the fixture, the request time in production), but three of its age strings ignored it and read the wall clock:

- the submission row's `when` (`buildSubmissionRowView`);
- `Last audited`;
- the details panel's last commit.

The fixture's submissions are dated 2026-06-01 to 06-28, so one of them crosses a `floor(days / 30)` boundary every few days. The `Last audited` lines were already wrong, reading `4mo ago` against a fixture that says two weeks. All three now take the view's `now`. The `/s/:slug` snapshots were regenerated: the only lines that changed are the age strings (`Last audited 2w ago`, and the submission ages). Submissions dated after the pinned `now` read `just now`. Production already passed the request's `now`, so a visitor sees no change. The operator folded this into the session (2026-10-21).

Two mutations, each run against the regenerated snapshots:

| Mutation                                                                      | Result                |
| ----------------------------------------------------------------------------- | --------------------- |
| The submission row's `relativeTimeFromNow(…, now)` reverted to the wall clock | 3 snapshot tests red  |
| `Last audited` reverted to the wall clock                                     | 30 snapshot tests red |

`/submissions` still builds its rows with the wall clock (the parameter defaults to `new Date()`). Its tests do not pin a date, so they do not rot.

## Why the cockpit is slow, measured the same morning

Netlify's request log for the page functions, 13:18 to 13:31 UTC, gave these durations:

- Signed in on production: `/` took 7.09 s, then 1.59 s and 2.19 s. `/s/sonder` took 6.00 s, `/s/29-navy` 2.64 s and `/s/caltex` 1.37 s. `/submissions` took 4.75 s and `/audits` 4.11 s.
- Signed out on fresh deploy previews, where `/` does nothing but redirect to sign-in, five requests took 3.76 to 4.29 s.
- A warm signed-out redirect on production (`/fleet` in the probe above) has a p50 of 162 ms.

So about 3.5 s of a first visit is a cold start, before any query runs. `svelte.config.js` sets `split: true`, so each page is its own function of about 16 MB (`sveltekit-index` is 16,155,788 bytes), and each one cold-starts separately. The rest is the store. The functions run in `us-east-2`, but `TURSO_DATABASE_URL` is `aws-us-west-2`, so every query crosses the country. A warm `/s/caltex` still took 1.37 s.
