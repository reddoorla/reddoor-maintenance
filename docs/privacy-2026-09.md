# Fleet privacy page (#1055, option A) — 2026-09-30

The operator chose option A on 2026-09-30: one privacy template in
`reddoor-starter`, filled from per-site values. This file is the worker brief
(BACKLOG P1-26) and the reasoning behind it. It is not legal advice.

## Why

- **CalOPPA.** A commercial website that collects personal information from
  California residents must conspicuously post a privacy policy, and the policy
  must say how the site answers "Do Not Track". Every fleet site with a contact
  form collects a name, an email and a phone number. Most clients are in LA. So
  this applies whether or not a site runs analytics. It is enforced by the
  Attorney General after a 30-day notice to cure.
- **Google Analytics terms.** The terms require a posted policy that discloses
  GA's use. Under analytics design D4, Reddoor owns every property, so Reddoor
  is the party bound.
- **CIPA.** California's wiretap and trap-and-trace demand letters are about
  consent, not disclosure. A policy only weakens them. That exposure is BACKLOG
  item 46, not this brief.

## What a site actually shares (the template's switches)

| Service                             | Data                                | On which sites                 |
| ----------------------------------- | ----------------------------------- | ------------------------------ |
| Central forms (Turso, Resend email) | form fields, IP for rate limiting   | every site with a fleet form   |
| Cloudflare Turnstile                | browser signals for bot checks      | sites with a Turnstile sitekey |
| Mailchimp                           | newsletter email                    | Sonder                         |
| Google Analytics 4                  | usage, device, approximate location | sites with a measurement ID    |
| Google Fonts / Adobe Fonts          | IP to the font host                 | per site                       |
| Vimeo / YouTube embeds              | IP, player cookies                  | per site                       |
| Netlify                             | hosting logs                        | every site                     |

The worker derives each site's switches from its code and config (CSP hosts,
`forms`, the measurement ID), never from a hand-written list, so the page cannot
drift from what the site does.

```markdown
## Worker brief — P1-26: a fleet `/privacy` page from one template (#1055, option A)

**Item.** P1-26 · #1055 · 🟡 YELLOW · effort M
No fleet site has a privacy policy, though every form collects personal data
and GA4's terms require one [M, #1055]. roalson-interests adds GA4 at launch.

**Verify first.** `curl -s -o /dev/null -w '%{http_code}' https://roalsoninterests.com/privacy`
(and two maintained sites). Expect: 404.

**Start here.**

- `reddoorla/reddoor-starter` `src/lib/components/Footer.svelte`: the footer
  link goes here.
- `reddoor-starter` `src/routes/contact/+page.svelte`: the form that gets a
  one-line notice.
- central `src/recipes/analytics-tag/index.ts`: add a preflight that refuses
  when the site has no `/privacy` route, with a line naming the fix.
- `docs/privacy-2026-09.md` (this file): the switch table.

**Done when.**

- The starter renders `/privacy` from per-site values: client legal name,
  contact email, effective date, and the service switches.
- The footer links to it, each form carries a one-line notice linking to it,
  and it has a "Do Not Track" line.
- The analytics-tag recipe refuses a site with no `/privacy`.
- roalson-interests carries the page before its launch.
- The text is visibly marked DRAFT until BACKLOG 45 clears it.

**Mutations I will run** (each must turn a test red):

1. Drop the footer link.
2. Render GA4's paragraph on a site with no measurement ID.
3. Let the analytics-tag recipe proceed with no `/privacy` route.
4. Remove the Do Not Track line.

**Stop conditions** (beyond AUTONOMY.md's six):

- Final policy wording is BACKLOG 45's (a lawyer's), not yours. Write clear,
  plain draft text and mark it DRAFT; do not present it as reviewed.
- Rolling the page into the maintained sites is per-repo PRs, after item 45,
  not part of this item.
- Consent or banner behaviour is BACKLOG 46. Do not add one.
- Two dirty review rounds → "Operator decisions", not a third round.

**Landing.** As in `docs/worker-brief.md`: starter PR first, then central, then
roalson-interests. Claim on #1055. Journal entry.
```
