# 2026-10-21 — The dashboard stops bundling the send pipeline: 16 MB to 4.9 MB, and a cold start from 4.7 s to 0.7 s

**Where it landed:** reddoorla/reddoor-maintenance#1648 (branch `claude/dashboard-bundle-diet`). This is PR 3 of the workspace brief `briefs/2026-10-21-dashboard-one-function.md`, after #1645, which made the dashboard one function (`2026-10-21-1729-dashboard-one-function.md`).

**What the 16 MB was.** Netlify's deploy record lists each function's zipped size.

- **Before #1645:** each page function was about 16.1 MB (`sveltekit-index` 16,155,833 bytes) and so was `approve-report` (16,039,257). The other endpoint functions were about 4.7 MB, and `auth` and `refresh-fleet` were 0.34 MB.
- **After #1645:** the one `sveltekit-render` was 16,215,160 bytes.

esbuild metafiles traced the difference to two value imports:

- **The address helpers.** `src/reports/preflight.ts` and the site page's view (`cockpit/src/lib/site/view.ts`) took `parseAddresses`, `isProbablyEmail` and `withGlobalCc` from `src/reports/send/orchestrate.ts`. That module is the whole send pipeline:
  - `render-from-row.ts` → `header-image/capture.ts` → `@playwright/test` → `playwright-core`, 6.7 MB of input on its own;
  - `resend.ts` → `resend` → `@react-email/render` → `react-dom/server`.
- **`rendersCommentary`.** The view took it from `src/reports/render.ts`, which imports `mjml`. That brings cheerio, parse5, juice and its `node-fetch`/`whatwg-url`/`tr46` mapping table, `html-minifier` with `uglify-js`, `clean-css` and `js-beautify`.

`approve-report` was the one 16 MB endpoint because it imports `preflight`. The other endpoints' 4.7 MB is the database client, which they need. `auth` and `refresh-fleet` never touched it.

**The fix.**

- **`src/reports/send/addresses.ts`** is a leaf module holding the four addressing helpers. `orchestrate.ts` re-exports them, so its exports are unchanged.
- **`src/reports/template-for.ts`** says which template a report type renders. `renderReportHtml` dispatches on it and `rendersCommentary` reads it, so the two still cannot drift, which is why they had sat side by side. `render.ts` re-exports `rendersCommentary`.
- **`tests/dashboard/bundle-diet.test.ts`** walks the static value imports from `cockpit/src` and fails on any path to `orchestrate.ts`, `render.ts`, `mjml`, Playwright or `resend`. Its positive control is that the same walk does find Resend from `orchestrate.ts`.

**Measured.**

- **esbuild bundles (unminified, before → after):**
  - the site view: 3,339,193 → 40,393 bytes;
  - the approve handler: 4,369,483 → 1,070,840.
- **Netlify:** this PR's deploy `6ad8fe10` lists `sveltekit-render` at 4,927,828 bytes, against 16,215,160 on #1645's.
- **A cold signed-out `GET /`**, the redirect to sign-in, measured as curl's time to first byte from this container. Each deploy's first request after it had sat idle:
  - three idle #1645 deploys at 16 MB, measured at 11:00am PT: 4.79, 4.67 and 4.59 s;
  - this PR's fresh deploy, at 11:02am PT: 0.68 s.
  - Warm requests were the same on both: 0.31 to 0.50 s, with single spikes of 1.1 to 2.7 s on the 16 MB deploys.
  - That is one cold sample after against three before.
  - This is a client-side timing, not Netlify's request log: the observability connector needed signing in again and could not be read today. It includes this container's proxy and TLS time.
- **What I could not measure.** A cold signed-in `/` and a warm signed-in `/s/:slug` both need a session cookie, which means reading the site's signing secret, and this session did not.

**The region, for the operator** (his step, not taken). The functions run in `us-east-2` and Turso is `aws-us-west-2`. A counting Kysely plugin over the real loaders gives these sequential queries per load:

| Page           | Queries |
| -------------- | ------- |
| `/s/:slug`     | 8       |
| `/`            | 8       |
| `/submissions` | 4       |
| `/fleet`       | 1       |
| `/audits`      | 1       |

Each `/s/:slug` query waits on the one before: site, reports, submissions, spam totals, then the alarm context's bounce count, dead-letter count, oldest dead letter (only when one exists) and digest state. [I] At a cross-country round trip of roughly 60 to 70 ms, 8 serial queries cost about 0.5 s that co-location would cut to a few tens of ms. That is about a third of the 1.37 s warm `/s/caltex` measured this morning. Running those reads in parallel would buy part of the same saving without a data move. Neither is done here.

**Mutations, each run alone (6, all red):**

- the view imports `orchestrate` again (1 red);
- the view imports `render` again (1);
- `preflight` imports `orchestrate` again (2);
- `addresses.ts` imports `resend` (2);
- `rendersCommentary` drifts from the dispatch (2, in `renders-commentary.test.ts`);
- a cockpit file imports the package's own entry, `@reddoorla/maintenance` (1; added in review, since the walk checks bare package names without following them).

**Beliefs corrected.** The brief's suspects were `@google-analytics/data`, `googleapis` and the Playwright or Lighthouse code. Playwright was right. The GA and Google API clients were not in the dashboard's bundle at all. The other half was MJML and Resend's React renderer, reached through two helper functions of a few lines each.
