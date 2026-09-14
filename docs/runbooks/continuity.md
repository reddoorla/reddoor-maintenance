# Runbook — keeping the fleet alive for a week without the operator

For a Reddoor colleague with access to this repo and the operator's machine, and no other
context. Tucker is unreachable for a week. This page says **what to watch, what to leave
alone, and what to do when something breaks** — in that order.

The short version: almost everything here is designed to fail loudly and safely. Nothing
client-facing can go out without a human approving it. The one failure that costs something
irreversible is a lead that cannot be placed — section 3.

---

## Before you start

**Three checkouts cannot take a push.** `reddoor-mailer` and `the-pointe` are archived on
GitHub; `rfp-analyze` has no `origin`. An archived repo is invisible from inside its clone —
`git remote -v`, `git ls-remote` and `git fetch` all behave normally and only the push fails,
after every commit already exists. Ask the script, don't discover it at push time:

```sh
scripts/fleet-repos.sh --skipped    # what to leave alone, and why
scripts/fleet-repos.sh --pushable   # names to iterate
```

The script enumerates the **disk** and maps by **remote**, not by directory name: the checkout
`welcome-to-the-flower-court` is `tucksravin/invitations`, and a fourth archived repo
(`reddoorla/the-tower`) has no local clone, so `--skipped` will never list it. Do not unarchive
anything to finish a sweep — that is the operator's decision. (`CLAUDE.md` §"Before a fleet
sweep", `scripts/fleet-repos.sh`.)

**Two rules that matter even for one visit** (`CLAUDE.md` §"Concurrent sessions"):

- **Never commit from the main checkout.** Move to your own worktree first
  (`git worktree add …`). A concurrent session has clobbered the main checkout's HEAD before.
- **Claim a signal before triaging it.** Red nightlies and cockpit alarms are visible to every
  session. Find the auto-filed tracking issue (section 1 names them) and comment your claim
  before starting. A run that never started files no issue — absence of a tracking issue is not
  absence of a failure.

**Stopping an agent.** In the VS Code extension — the operator's surface — click the agent
count under the prompt box and stop agents from the agent map. The documented terminal chord
`Ctrl+X Ctrl+K` does **nothing** in the extension, in either Ctrl or Cmd form (verified
2026-09-14). In the terminal CLI, `/tasks` enumerates running background agents and `x` stops
one (not resumable); from inside a session the `TaskStop` tool stops one by id and leaves it
resumable. (`docs/meta-week/13-research.md` §"Stop a whole fan-out" for the documented paths.)

**`.claude/` version control is already settled** — decision A9, yes, shipped in
[#788](https://github.com/reddoorla/reddoor-maintenance/pull/788) (`.gitignore:14–23` now
re-includes the directory and tracks `settings.json`, `workflows/`, `rules/`, `hooks/`).
Nothing to re-argue.

---

## 1. What runs unattended, and what its failure looks like

Ten scheduled workflows, all in `.github/workflows/`, all in this repo — it is the central
scheduler for the whole fleet. Times are UTC. Every one of them also has a
`workflow_dispatch`, so you can re-run any of them by hand from the Actions tab.

| cron           | workflow              | what it does                                                                                                         | tracking issue it files on failure                                                                |
| -------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `30 4 * * *`   | `fleet-db-backup`     | Dumps Turso, rehearses the restore, decrypts and re-verifies the `.gpg` it uploads, then checks plan-quota headroom  | "Nightly Turso backup failing"; the quota job files "Turso plan quota needs attention" separately |
| `0 5 * * *`    | `fleet-prismic-drift` | Read-only: does each repo's content model still match the models registered in its Prismic repository                | "Nightly Prismic model drift sweep failing"                                                       |
| `0 6 * * *`    | `fleet-security`      | Vuln counts + dependency drift per site → store; dispatches Renovate; org-wide protection-coverage audit             | "Nightly fleet security audit failing"; the coverage audit files "Fleet protection coverage gap"  |
| `0 8 * * *`    | `fleet-lighthouse`    | Lighthouse + domain + browser + Netlify-deploy + function-health against each site's **deployed** URL (no checkout)  | "Nightly fleet audit failing"                                                                     |
| `23 9 * * *`   | `daily-reports`       | Drafts due reports, sends already-**approved** ones, emails the operator digest                                      | "Daily reports run failing"                                                                       |
| `0 10 * * *`   | `fleet-smoke`         | Clones each active site and runs that site's own `pnpm test:smoke`                                                   | "Nightly fleet smoke failing"                                                                     |
| `15 10 * * *`  | `fleet-form-e2e`      | Playwright drives each deployed `/contact` form with the `testMode` marker (reaches no real inbox, DB or webhook)    | "Nightly fleet form-e2e failing"                                                                  |
| `30 14 * * *`  | `release-health`      | npm `latest` vs `main`'s version, **and** the release workflow's own redness                                         | "npm registry is behind main" / "Release workflow is failing on main"                             |
| `0 11 * * 1`   | `time-travel`         | Runs the whole test suite on a clock shifted forward, to catch tests that secretly depend on "today"                 | "Time-travel suite failing"                                                                       |
| `0 */12 * * *` | `renovate`            | Dependency PR creation **and merge** — platform auto-merge is off fleet-wide, so Renovate merges from inside the run | none                                                                                              |

Event-driven, not scheduled: `ci` (push + every PR), `release` (push to `main`), and
`report-rerender` (dispatch only).

**Where a failure shows up.** Three places, in rough order of reliability:

1. **A GitHub issue in this repo.** Every red nightly above files or reopens one deduped issue,
   identified by its exact title, and auto-closes it on the next green run. This is the durable
   signal — the `if: failure()` step is `continue-on-error`, so the alert machinery can never
   turn a green run red. Start here: `gh issue list --repo reddoorla/reddoor-maintenance`.
2. **A best-effort GitHub email to the last pusher.** That is you only if you pushed last. Do
   not rely on it (`.github/workflows/fleet-lighthouse.yml:158`).
3. **The daily digest email** from the `daily-reports` run at 09:23 UTC. It goes to
   `OPERATOR_EMAIL` (a GitHub Actions repo variable), falling back to `tucker@reddoorla.com` —
   deliberately the operator's monitored personal inbox, **never** `info@reddoorla.com`, which
   is the client-facing shared inbox (`src/util/operator.ts:1–27`). If the operator's inbox is
   unread for a week, this channel is dark; the issues in (1) are not.

**The cockpit.** The dashboard served by this repo's Netlify deploy: cockpit at `/`, per-site
at `/s/:slug`, behind Basic auth (`DASHBOARD_PASSWORD`). It sorts every visible site into four
tiers — `attention`, `watch`, `healthy`, `pre-launch` (`src/dashboard/fleet-cockpit.ts:33`) —
worst-band-wins, with the watch band being the soft zone beneath the alert floor (a Lighthouse
score in [75, 85), a check stale past 30 days). A watch reason the operator has explicitly
accepted is routed to `acceptedReasons` and leaves the band rather than raising it
(`fleet-cockpit.ts:180`, `:287`).

**The "Needs you" feed** is real and is the thing to read first
(`src/dashboard/fleet-cockpit.ts:390–412`, rendered at `src/dashboard/fleet-render.ts:228`).
One row per site, every reason combined, ordered `broken` → `watch` → `approval`, critical-first
within `broken`. A vuln the fleet is still auto-patching is amber `watch`; a vuln whose
auto-fix is **exhausted** is a hard `broken`, as is any non-vuln attention item. If the feed is
empty, nothing needs you.

---

## 2. What is safe to ignore for a week

**Almost everything — and the reason is a feature, not an accident: no client-facing report can
go out without a human approval.** Two independent gates:

- `netlify/functions/approve-report.mts:81` — `requireOperator(req, { wants: "json" })`. Every
  approval runs through one Basic-auth credential, checked before any Airtable read, behind a
  CSRF check. No credential, no approval.
- `src/reports/send/orchestrate.ts:158–171` — `sendOne` **throws** rather than send when the health
  gate is not clear, _even if "Approved to send" was set directly in Airtable_. The row is
  skipped, `Sent at` stays null, and the at-least-once retry is preserved.

So the worst case for the report pipeline over a week is that drafts pile up unsent. Nothing
wrong reaches a client because nobody was watching. **Do not go looking for a way to send
them.** There is a logged send-anyway override (`?override=1` plus a written reason); it is for
the operator, not for a week of cover.

Everything below degrades harmlessly. Leave it:

| Signal                                         | What actually happens over a week                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renovate PRs sitting open, green and unmerged  | Renovate runs every 12 hours and merges from inside its own run. Green + unmerged is far more often a rule working than a rule broken — under a grouped preset a single held package makes the whole branch non-automergeable. Naming the rule that would have to permit the merge is a prerequisite to calling anything stuck. |
| A Prismic drift ack expiring                   | Acks carry an explicit `prismicAckUntil`; once it passes, the alarm simply comes back (`src/alerts/digest-collectors.ts:592–596`, `:660`). An ack only ever mutes a `fail`, never `unknown` and never staleness. A re-appearing drift alarm is the mute ending, not a new break.                                                |
| A red nightly that goes green on the next run  | Every tracking issue in section 1 auto-closes on recovery. One red night in a week is noise; the same issue still open on day three is not.                                                                                                                                                                                     |
| Drafts accumulating in the approve queue       | See the two gates above. This is the system working.                                                                                                                                                                                                                                                                            |
| Lighthouse scores drifting into the watch band | Watch is the soft band beneath the alert floor, by design (`src/dashboard/fleet-cockpit.ts:36–38`).                                                                                                                                                                                                                             |

---

## 3. What is not safe to ignore

### 3.1 A form submission that cannot be placed — the lead path

This is the only failure in the fleet that used to lose something irreplaceable and silently.
It no longer does, but it now needs someone to finish the recovery.

**How it works today** (shipped in
[#785](https://github.com/reddoorla/reddoor-maintenance/pull/785), merged 2026-09-14). A public
form POST reaches `src/forms/ingest.ts`. If the site lookup **throws** (the store is down) or
**resolves to null** (a real fleet site with no row — a half-finished `ensure-site`, a deleted
row), the one writer `captureDeadLetter` (`src/forms/ingest.ts:185–196`) writes the whole raw
payload, the Turnstile verification and the error into the `submission_deadletter` table and
logs `[ingest] lead for '<slug>' dead-lettered as <id>`. The throw path returns an honest
`accepted`; the unknown-slug path keeps its `unknown-site` status so the submitting site still
learns its slug does not resolve, but **the lead now exists somewhere**
(`src/forms/ingest.ts:202–231`). Probes (`testMode`) are never dead-lettered.

**What a week-long break looks like now.** The queue grows and the alarm gets louder, not
quieter. `collectDeadLetterAlerts` (`src/alerts/digest-collectors.ts:435–460`) raises one
`deadletter` attention item per slug, counting unreplayed rows, and it reaches both the cockpit
and the digest. Two shapes:

- The slug **resolves** to a fleet site. The item reads _N leads dead-lettered and not yet
  replayed — run `db replay-deadletters`_, and links to that site's page.
- The slug resolves to **no** fleet site. The item reads _N leads dead-lettered for '&lt;slug&gt;',
  which resolves to NO fleet site — leads are being dropped; run `ensure-site <slug>` then
  `db replay-deadletters`_, and is rendered card-less with **no** link (a `/s/<slug>` link would
  404). This is the serious one: it means submissions are arriving for a site the system no
  longer believes in.

**How to replay.** From this repo, after `pnpm build`:

```sh
node dist/cli/bin.js db replay-deadletters
```

It re-runs each queued payload through the same ingest function, resolving sites through the
same lookup the live path uses (Turso first; Airtable is opened but not called under the
freeze, so a missing Airtable PAT no longer refuses the whole replay). It prints one line per
row and then a summary:

```
DEADLETTER_REPLAY replayed=<n> still_failing=<n>
```

Exit code is 1 while anything is still failing. If Resend is unconfigured the replay still
runs and the recovered leads land un-emailed (`notify=failed`) rather than blocking — you can
re-notify later, but the lead is saved either way (`src/cli/commands/db.ts:85–172`). If the
alarm named an unresolvable slug, run `ensure-site <slug>` **first**, then replay.

### 3.2 Turnstile stops minting tokens on a site

A Turnstile sitekey is bound to a list of hostnames. A sitekey served from a hostname that is
**not** on its widget's list does not degrade — it throws `Error: 110200`, renders no iframe and
mints **no token at all**. On a site with `Require Turnstile` checked, that buckets 100% of real
leads as spam. Nothing in this repo touches the Cloudflare allowlist and no automated check can
see it from outside: `/health` only knows whether the env var is a non-empty string.
(`docs/runbooks/turnstile-widgets.md`, `docs/runbooks/require-turnstile-rollout.md`.)

The trap that produces this: a widget holds 10 hostnames on the free tier, `TURNSTILE_SITE_KEY_1`
("Forms 1") has been full for a while, and copying that sitekey onto a new site produces the
silent-110200 state — as it did on 2026-09-04
([#689](https://github.com/reddoorla/reddoor-maintenance/issues/689)). **Moving a site from
`*.netlify.app` to its real domain breaks Turnstile until the new hostnames are allowlisted.**
If a site launched or changed domain this week, check this first. The runbook has the read-only
widget-capacity listing and the add-a-site steps.

A **secret** problem is less dangerous than a hostname problem, because verification fails
open: a secret/config error, a Cloudflare `internal-error`, a network timeout or an unknown
code all return `unverifiable`, not `fail`. Only `invalid-input-response` (a forged token) is a
definite negative (`src/forms/turnstile.ts:92–109`). So a wrong secret costs you the spam gate,
not the leads — unless the site has `Require Turnstile` on.

### 3.3 Turso quota

The org's plan carries `overages: false`, which means **crossing a quota BLOCKS reads and
writes rather than billing for them** — and since the Airtable freeze, Turso is the only store
there is. So a quota crossing is a total outage of the lead path, the dashboard and the report
pipeline at once (`src/db/usage.ts:3`, `src/cli/commands/db.ts:422`,
`.github/workflows/fleet-db-backup.yml:160`).

The `quota` job inside `fleet-db-backup` checks headroom nightly and files **"Turso plan quota
needs attention"** if it does not return `verdict=ok`. Treat that issue as urgent — it is the
one alarm in the fleet that fires _before_ a wall rather than after one. Note that the check
reads the Platform API with the **account-level** `TURSO_FLEET_USAGE` token; the database-level
`TURSO_AUTH_TOKEN` cannot read quota. The probe has timed out once (2026-08-29, the job's
5-minute limit); a probe failure reds the job rather than reading as headroom, which is the
right direction but means a red quota job is sometimes the probe, not the plan.

### 3.4 A bounced or complained-on report

`collectDeliveryFailures` (`src/alerts/digest-collectors.ts:208–228`) raises an attention item
for any report row whose `deliveryStatus` is `bounced` (warning) or `complained` (**critical**).
A spam complaint from a client is worth a same-day human reply; do not let it sit a week.

---

## 4. Where the credentials are, and who can reach them

Names and locations only. Nothing below is a value, and you should not need to print one.

| Where                                     | What lives there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.config/reddoor-maint/credentials.env` | **Everything except Discord.** Loaded into `process.env` by `loadCredentialsIntoEnv`, which never overwrites a variable already set (`src/util/credentials.ts:51–67`). Path respects `$XDG_CONFIG_HOME`. Names in use across the codebase include `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TURSO_FLEET_USAGE`, `TURSO_ORG`, `TURNSTILE_SECRET_KEY{,_2,_3}`, `FORMS_INGEST_TOKEN`, `PROSPECT_EDIT_TOKEN`, `DASHBOARD_PASSWORD`, `DASHBOARD_BASE_URL`, `GH_TOKEN`, `GITHUB_TOKEN`, `RENOVATE_TOKEN`, `NETLIFY_PAT`, `PRISMIC_ACCESS_TOKEN`, `PRISMIC_WRITE_TOKEN`, `GA_SA_KEY_PATH`, `GA_SUBJECT`, `OPERATOR_EMAIL`. |
| The repo `.env`                           | **Discord only.** `DISCORD_BOT_KEY` **is** the bot token — use it directly as `Authorization: Bot $DISCORD_BOT_KEY`. There is no `DISCORD_BOT_TOKEN` anywhere; do not hunt for one (`CLAUDE.md` §"Discord is the tone reference").                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| GitHub Actions secrets + variables        | The nightlies read the same names as repo **secrets**, plus `BACKUP_PASSPHRASE`, which exists only here and on the operator's machine. `OPERATOR_EMAIL` is an Actions **variable** — set in CI and nowhere else, which is exactly how a fleet digest once landed in the client inbox from a local run (`src/util/operator.ts`).                                                                                                                                                                                                                                                                                                                                                                     |
| Netlify site env                          | The central deploy's own copy: the full list with purposes is the table in `README.md` §"Site deployment (Netlify + Resend)". These are set in the Netlify UI, not from this repo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1Password (Personal vault)                | Six **client** credential items, imported during the Airtable retirement and verified byte-for-byte; the four credential fields were then cleared from all nine Airtable site rows (`docs/meta-week/04-journal-beat-by-beat.md:3230–3235`).                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| GitHub org                                | `reddoorla`. Repo admin, Actions secrets, branch protection and the secret-scanning alerts all live at the org or per-repo level here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**`TURSO_FLEET_USAGE` is not `TURSO_AUTH_TOKEN`.** The first is an account-level Platform API
token that can read plan quota; the second is a database-level token that cannot. A third,
`TURSO_RESTORE_AUTH_TOKEN`, is read only by `db restore` (section 6).

**Who can reach any of this today: the operator, and only the operator.** The credentials file
is one file on one laptop; `BACKUP_PASSPHRASE` is on that same laptop and in a **Personal**
1Password vault; the Discord token is in an untracked repo `.env`. A second person covering a
week would need, per system:

- GitHub — membership in the `reddoorla` org with admin on this repo (to read Actions logs,
  re-run workflows, and see the tracking issues).
- Netlify — access to the team that owns the central site, to read function logs and env.
- Turso — access to the org that owns the database, plus the two token kinds above.
- Resend — access to the sending domain and the webhook endpoint config.
- Cloudflare — access to the account holding the Turnstile widgets.
- Airtable — access to the (now frozen) base, if a historical lookup is needed.
- 1Password — the client-credential items, which are currently in a Personal vault.
- Discord — membership in the **reddoor creative** guild.
- The operator's machine — `~/.config/reddoor-maint/credentials.env` and the repo `.env`.

How any of that gets granted is the operator's call, not this page's.

---

## 5. How to reach clients, per channel

Three channels, and they are not interchangeable.

**Discord — where the conversations actually are.** Guild **reddoor creative**,
`1199077765144662046`, with 109 text channels, roughly one per project (`#sonder`,
`#hedloc-web`, `#beachfront-dentistry-website`, …). Plain REST at
`https://discord.com/api/v10` — e.g. `GET /channels/{id}/messages?limit=N` with
`Authorization: Bot $DISCORD_BOT_KEY`. There is no MCP server and no script; curl it.

Two constraints (`CLAUDE.md` §"Discord is the tone reference"):

- **The bot is a reader.** It authenticates as "Message Reader". Use it to catch up on a
  channel, not to post as Reddoor.
- **Know who is internal before you write anything.** Project channels contain Reddoor staff
  **and** clients. In `#sonder`, `timholmes_62898` and `nicole_35266` are internal and **Josh**
  is the client — so a note "for Tim" is a colleague note, not a client email. Read enough of a
  channel to place people first.

Do **not** read Discord through the browser: `discord.com` in the local Chrome profile is
logged out, and logging in as the operator is not yours to do. `discord.com` is also off the
sandbox network allowlist, so curl it unsandboxed.

Some channels (`#new-business`, `#schedule`, `#msot`, `#rd-marketing`) have no operator
participation at all — if something needs a Reddoor voice this week, a colleague already in
that channel is the right sender, not you via a bot.

**Email — via Resend, and only through the approval queue.** Two producers, both of which draft
and never send:

- Monthly/maintenance reports — `daily-reports` drafts what is due, and sends only what a human
  has already approved (section 2).
- The announcement email — `announce [site]` drafts the monthly-report announcement for every
  `maintenance` site into the same approve queue and **never sends**; the operator approves and
  the next send run delivers (`src/cli/commands/announce.ts:20–25`). It flags
  `⚠ recipient missing` per site rather than guessing.

Delivery outcomes come back through the Resend webhook
(`netlify/functions/resend-webhook.mts`, gated on `RESEND_WEBHOOK_SECRET`) and surface as the
bounce/complaint attention items in §3.4.

**The per-site recipient field.** Who a report actually reaches is configured per site, not per
message: `Report recipients (To)` and `Report recipients (CC)` on the Websites row, mirrored to
`sites.report_recipients_to` / `report_recipients_cc` in Turso
(`src/reports/airtable/websites.ts:483–484`, `src/db/fleet-state.ts:108–109`). Form
notifications have their own per-site routing, including field-value → recipient routes with a
fallback (`src/reports/airtable/websites.ts:23–34`).

> **Known trap — MSOT and Revogen resolve to the same recipient.** The Lane 2 preflight found
> both sites pointing at `accounting@revogenbiologics.com`, which means an MSOT report would
> reach Revogen's accountant. It is recorded as an open operator item, unfixed
> (`docs/meta-week/14-lane2-decisions-log.md`, S4 defect (4) and operator item 6). **Check the
> recipient cell before approving anything for either site.**

---

## 6. Restoring the database (Turso)

Promoted here from `docs/superpowers/plans/2026-08-17-airtable-to-turso-migration.md`, Phase 5
("Rollback is rehearsed") and Phase 1.5. **Since the Airtable freeze, Turso is the only store
there is** — this is the procedure that gets the fleet back.

**The backup.** `fleet-db-backup` runs nightly at 04:30 UTC
(`.github/workflows/fleet-db-backup.yml`). It dumps Turso over plain SQL through the same
database-level url + token the other nightlies hold, asserts the dump actually contains site
rows, loads it into a scratch engine and compares restored row counts against the **origin
manifest** the dump carries, encrypts it with `gpg --symmetric --cipher-algo AES256` under
`BACKUP_PASSPHRASE`, then **decrypts the `.gpg` it is about to upload and re-runs the same
verification on the round-tripped copy** before publishing it as an Actions artifact
(`turso-backup-<run_id>`, 30-day retention). A run that cannot verify refuses to upload.

**The restore, as rehearsed** — every command below was checked against the tree on 2026-09-14,
and a fresh session with only this section was asked to dry-run it; what it could not find is now
written in.

1. **Download the newest artifact** from a green `fleet-db-backup` run (artifact
   `turso-backup-<run_id>`, one file, `dump.sql.gpg`, kept 30 days):

   ```sh
   cd ~/Documents/GitHub/reddoor-maintenance
   run=$(gh run list --repo reddoorla/reddoor-maintenance --workflow fleet-db-backup.yml \
     --status success --limit 1 --json databaseId --jq '.[0].databaseId')
   gh run download "$run" --repo reddoorla/reddoor-maintenance -n "turso-backup-$run" -D restore
   cd restore
   ```

2. **Decrypt it** with `BACKUP_PASSPHRASE`. The value lives in
   `~/.config/reddoor-maint/credentials.env` on the operator's machine
   (`docs/meta-week/_research/challenge-evidence-audit.md:301`) and, for CI only, as a repo
   Actions secret you cannot read back. Load the file without printing it, then decrypt:

   ```sh
   set -a; . ~/.config/reddoor-maint/credentials.env; set +a
   gpg --batch --quiet --decrypt \
     --passphrase "$BACKUP_PASSPHRASE" \
     --output dump.sql dump.sql.gpg
   ```

3. **Create a NEW, EMPTY Turso database** and mint a database-level token for it, with the
   `turso` CLI (installed at `~/.turso/turso`; `turso auth login` is a browser OAuth login
   on the Turso org that owns the fleet — section 4 lists that access). Do **not** run
   `db migrate` against it first: step 4 refuses a non-empty target.

   ```sh
   turso auth login
   turso db create fleet-restore-YYYYMMDD
   turso db show fleet-restore-YYYYMMDD --url      # the libsql:// url for --url below
   turso db tokens create fleet-restore-YYYYMMDD   # the token; it becomes TURSO_AUTH_TOKEN in step 5
   ```

4. **Restore into it.** Install and build first (`pnpm install --frozen-lockfile && pnpm build` —
   `dist/` on the operator's machine may be stale), then:

   ```sh
   TURSO_RESTORE_AUTH_TOKEN=<token from step 3> \
     node dist/cli/bin.js db restore \
       --file dump.sql \
       --url <libsql url from step 3>
   ```

   `--url` never defaults — production is deliberately out of reach
   (`src/cli/commands/db.ts:366`). Expect a line of this shape, and exit 0:

   ```
   RESTORE loaded=true tables=11 rows=803 blob_bytes=7777769 mismatches=0
   ```

   The row and byte figures are whatever the dump carried (those are the 2026-08-31 values);
   what you are checking is `mismatches=0`. Row and byte counts are compared against the
   dump's origin manifest, so a restore that "succeeded" with fewer rows than the origin held
   exits non-zero with a `✗` line per mismatch (`src/cli/commands/db.ts:405–418`). Three
   refusals you may see instead, each naming itself: `RESTORE refused=auth-token-absent` (a
   remote url with no token), `RESTORE refused=manifest-absent` (not a dump this tool
   produced), and `RESTORE refused=target-not-empty`.

5. **Repoint `TURSO_DATABASE_URL` at the new database.** This is the step the rehearsals never
   needed and the one most likely to be missed. `db restore` refuses a non-empty target
   (`RESTORE refused=target-not-empty`, `src/cli/commands/db.ts:390–392`) — a restore is for an
   EMPTY target, so a real recovery **always lands on a new database**, and nothing points at it
   until you say so. Set two names, `TURSO_DATABASE_URL` (the url from step 3) and
   `TURSO_AUTH_TOKEN` (the token from step 3 — the same value you passed as
   `TURSO_RESTORE_AUTH_TOKEN`), in both places:
   - this repo's **GitHub Actions secrets** (every nightly reads them):
     `gh secret set TURSO_DATABASE_URL --repo reddoorla/reddoor-maintenance` and the same for
     `TURSO_AUTH_TOKEN`; each prompts for the value.
   - the central **Netlify project `reddoor-maintenance`**
     (app.netlify.com → Projects → reddoor-maintenance → Site configuration → Environment
     variables; the dashboard and the forms functions 500 without `TURSO_DATABASE_URL`), then
     Deploys → Trigger deploy.

   The operator's own `credentials.env` still names the old database; leave a note for them.

6. **Verify.** Curl the central site's health endpoint and check it reports
   `TURSO_DATABASE_URL` as present (presence only, never values; `README.md` §"Site
   deployment", step 3). The host is `https://reddoor-maintenance.netlify.app` — the code
   default in `src/dashboard/handler-helpers.ts:7`, overridable by `DASHBOARD_BASE_URL`:

   ```sh
   curl https://reddoor-maintenance.netlify.app/.netlify/functions/resend-webhook
   ```

   Then load the cockpit at that host's `/`, and re-run the backup by hand —
   `gh workflow run fleet-db-backup.yml --repo reddoorla/reddoor-maintenance` — and confirm it
   goes green. Note what that proves: the nightly reads the Actions secrets, so a green run
   confirms step 5 landed, not step 4.

### Two traps

- **Never pipe a dump through `pnpm exec`.** It writes warnings to **stdout**, which lands
  inside the SQL and corrupts the dump. Invoke the binary directly — `./node_modules/.bin/tsx`
  locally, or `node dist/cli/bin.js` as every workflow step does.
- **`gpg` may not be installed.** It was not on the operator's Mac when the backup path was
  first reviewed, on the only machine holding the passphrase
  (`docs/meta-week/04-journal-beat-by-beat.md:2766–2768`). Check `gpg --version` before you
  need it, not during an incident.

### Why you can trust this

The rollback has been rehearsed **three times**, not once
(`docs/superpowers/plans/2026-08-17-airtable-to-turso-migration.md`, Phase 5): once into a
local `turso dev` target; once into a real hosted database — which is what exposed that
`db restore` sent no auth token, a defect neither `:memory:` nor `turso dev` could show; and
once on 2026-08-31 against the **actual nightly artifact**, decrypted locally with
`BACKUP_PASSPHRASE` and restored into a fresh hosted database, giving
`RESTORE loaded=true tables=11 rows=803 blob_bytes=7777769 mismatches=0` and independently
confirmed with a `turso db shell` count check. A full fleet restore takes seconds.

The untested half is step 5. Everything up to it has been done for real; the repoint has not.
