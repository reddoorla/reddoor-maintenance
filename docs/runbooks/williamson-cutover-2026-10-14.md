# Williamson cutover, Wed 2026-10-14

The operator's checklist for moving `www.williamson-homes.com` and
`www.williamson-construction.com` from Webflow to Netlify (OD7-P4, BACKLOG
P1-42, issue #1279). The plan is `docs/webflow-conversions-2026-10.md`: §2 holds
the measured records and page lists, §4 the schedule, §7 the brief.

**Every DNS and Netlify-domain step below is 🔴 and the operator's.** No agent
logs in to GoDaddy, Webflow or Netlify's domain settings, or edits a record.
What an agent may run is the verifier, which only reads:

```sh
node scripts/williamson-cutover-verify.mjs              # apex + www, both sites
node scripts/williamson-cutover-verify.mjs --site homes # one site
node scripts/williamson-cutover-verify.mjs --preview    # the *.netlify.app hosts
```

The verifier fetches every §2 path on the apex and `www`, or on the preview
host with `--preview`. It follows redirects one hop at a time, up to 5 hops, and
fails on a loop.

Every page must pass all of these:

- each hop answers `server: Netlify`, with a certificate Node accepts;
- every redirect stays on the domain's own hosts;
- the last hop is a 200 for the same path;
- the page does not carry `data-wf-site`;
- the page loads nothing from `website-files.com`.

On the production hosts it also checks what Google will see:

- the page ends on `www` (plan D4);
- the page has no `noindex` header or meta tag;
- `<link rel="canonical">` points at `www`.

It reads DNS from two resolvers, `dns.google` and `cloudflare-dns.com`:

- **MX:** identical to the DO NOT TOUCH table.
- **TXT:** every value in that table is still there, with exactly one SPF
  record.
- **Production only:** the apex `A` must be exactly `75.2.60.5`, and the `www`
  CNAME exactly the site's `*.netlify.app` name. A new row added beside the old
  one fails.

It exits 0 on GREEN and 1 on RED.

When `HTTPS_PROXY` is set, as in a cloud session, the verifier re-runs itself
with `NODE_USE_ENV_PROXY=1`. Its requests then go through the proxy's CONNECT
tunnel, and the certificate it checks is the site's own. Measured 2026-10-11:
a direct connection from a cloud container sees the egress gateway's
certificate, "Anthropic Egress Gateway SDS Issuing CA". An expired upstream
certificate then comes back as a bare 503, where the tunnel gives
`CERT_HAS_EXPIRED`. The first line of the output names the path it used.

On 2026-10-11 at 14:42Z it was RED on the live Webflow hosts and GREEN on both
previews:

- **Webflow hosts:** 56 of 64 checks failed. That was every page and every
  A and CNAME check; every MX and TXT check passed.
- **Previews:** 32 of 32 passed.

Its production-only checks were also run against 29 Navy, a Netlify site
already cut over with the same record shape (`A 75.2.60.5`, `www` CNAME to its
`*.netlify.app` name). They passed there, and 29 Navy's unknown paths failed
with a 404. All of these runs are pasted in the PR that added the verifier.

## What changes: two records per domain, nothing else

| Domain                        | Record               | Today (Webflow)   | Cutover value (Netlify)                  |
| ----------------------------- | -------------------- | ----------------- | ---------------------------------------- |
| `williamson-homes.com`        | `@` `A` (TTL 600)    | `198.202.211.1`   | `75.2.60.5`                              |
| `williamson-homes.com`        | `www` `CNAME` (3600) | `cdn.webflow.com` | `williamson-homes.netlify.app`           |
| `williamson-construction.com` | `@` `A` (TTL 600)    | `198.202.211.1`   | `75.2.60.5`                              |
| `williamson-construction.com` | `www` `CNAME` (3600) | `cdn.webflow.com` | `williamson-construction-co.netlify.app` |

`75.2.60.5` is the load-balancer IP in Netlify's external-DNS docs (read
2026-10-11). The www target is each site's own Netlify name:

- `williamson-homes`, site id `9072ea82-4428-4ff2-b941-63084eaecb1b`
- `williamson-construction-co`, site id `7e2831e2-1a1b-4184-8399-981d0f6361c1`

If Netlify's domain panel shows different values once the domains are added,
the panel wins. Stop and note the difference here before anyone types a
record.

## DO NOT TOUCH

Everything below stays exactly as it is. Both domains run Microsoft 365 mail,
and `_dmarc` is `p=reject` on both, so losing SPF or DKIM bounces the
company's mail. **Never** do any of these:

- import a zone file
- use "reset to defaults"
- move the nameservers, including to Netlify DNS, which the Netlify panel
  offers
- turn on GoDaddy domain forwarding

Edit the two rows above in place, and nothing else.

Measured 2026-10-11 14:12Z through `dns.google`, and the MX and TXT also
through `cloudflare-dns.com`, which agreed:

| Record                         | `williamson-homes.com`                                                               | `williamson-construction.com`                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| NS                             | `ns31.domaincontrol.com`, `ns32.domaincontrol.com`                                   | `ns27.domaincontrol.com`, `ns28.domaincontrol.com`                                          |
| MX                             | `0 williamsonhomes-com02e.mail.protection.outlook.com`                               | `0 williamsonconstruction-com02e.mail.protection.outlook.com`                               |
| TXT (SPF)                      | `v=spf1 include:spf.protection.outlook.com -all`                                     | `v=spf1 include:spf.protection.outlook.com ~all`                                            |
| TXT (`MS=`)                    | `v=verifydomain MS=7526292`                                                          | `v=verifydomain MS=1109765`                                                                 |
| TXT (google-site-verification) | `google-site-verification=5M-cvpiEh6WVPkbik9fboRy3MRD42q6dix6GBxTPdNc`               | none exists                                                                                 |
| `_dmarc` TXT                   | two records, both `p=reject` (see below)                                             | `v=DMARC1; p=reject; rua=mailto:dmarc@williamson-construction.com; adkim=s; aspf=s;`        |
| `selector1._domainkey` CNAME   | `selector1-williamsonhomes-com02e._domainkey.williamsonconstruction.onmicrosoft.com` | `selector1-williamsonconstruction-com02e._domainkey.williamsonconstruction.onmicrosoft.com` |
| `selector2._domainkey` CNAME   | `selector2-williamsonhomes-com02e._domainkey.williamsonconstruction.onmicrosoft.com` | `selector2-williamsonconstruction-com02e._domainkey.williamsonconstruction.onmicrosoft.com` |
| `autodiscover` CNAME           | `autodiscover.outlook.com`                                                           | `autodiscover.outlook.com`                                                                  |
| `enterpriseregistration` CNAME | `enterpriseregistration.windows.net`                                                 | `enterpriseregistration.windows.net`                                                        |
| `enterpriseenrollment` CNAME   | `enterpriseenrollment.manage.microsoft.com`                                          | `enterpriseenrollment.manage.microsoft.com`                                                 |
| `lyncdiscover` / `sip` CNAME   | `webdir.online.lync.com` / `sipdir.online.lync.com`                                  | `webdir.online.lync.com` / `sipdir.online.lync.com`                                         |
| `_sip._tls` SRV                | `100 1 443 sipdir.online.lync.com`                                                   | `100 1 443 sipdir.online.lync.com`                                                          |
| `_sipfederationtls._tcp` SRV   | `100 1 5061 sipfed.online.lync.com`                                                  | `100 1 5061 sipfed.online.lync.com`                                                         |
| `email` CNAME                  | none exists                                                                          | `email.secureserver.net`                                                                    |

Two more records exist and stay as they are:

- `_domainconnect` CNAME `_domainconnect.gd.domaincontrol.com` (both domains)
- `ftp.williamson-construction.com` CNAME `williamson-construction.com`

The `ftp` record follows the apex to Netlify after the cutover, which is
harmless. Also leave the domains attached in Webflow until 10-19, because
they are the rollback.

These are the records the lookups found. No apex `AAAA` and no `CAA` exists on
either domain. A zone transfer is not possible from outside, so the zone may
hold records no lookup asked about. The rule covers them too: only the two
rows in the first table change.

The verifier re-checks the MX and the TXT values on every run. A zone replace
that loses either one shows up as RED even when every page is green. It does
not read DKIM, `_dmarc` or the Microsoft 365 CNAMEs and SRVs. For those, the
only guard is editing nothing but the two rows.

## Tue 10-13: prepare (operator)

1. **Netlify, Homes.** Open site `williamson-homes` and go to Domain
   management. Add `www.williamson-homes.com` as the custom domain and set it
   as the **primary domain**, so the apex 301s to `www` as Webflow does today
   (plan D4). Netlify adds `williamson-homes.com` itself and lists it as
   redirecting to the primary domain; if it does not, stop. Do not add the
   apex by hand as an alias. When Netlify offers Netlify DNS, choose
   **external DNS**.
   The panel then says "Awaiting External DNS", which is expected until
   Wednesday.
2. **Netlify, Construction.** Do the same on `williamson-construction-co`, with
   `www.williamson-construction.com` as primary; `williamson-construction.com`
   should appear as redirecting to it.
3. **Check the values.** Compare the records the Netlify panel asks for with
   the first table, and stop on any difference.
4. **Netlify, both sites: trigger a production deploy** (Deploys → Trigger
   deploy → Deploy site). Every prerendered page bakes Netlify's build-time
   `URL` into its canonical and `og:url` (line 64 of `svelte.config.js` in both
   site repos), and `URL` is the primary domain. Today it is the `*.netlify.app`
   host, which answers `x-robots-tag: noindex, nofollow`. Without a fresh
   build after the primary domain changes, `www` would ship a canonical
   pointing at a noindexed host. When the deploy finishes, check that
   `curl -s https://williamson-homes.netlify.app/ | grep -o 'rel="canonical"[^>]*'`
   shows `https://www.williamson-homes.com/`, and the same on Construction. The
   verifier fails a canonical that points anywhere but `www`.
5. **GoDaddy, both domains.** Lower the TTL on the `www` CNAME from 1 hour to
   the lowest GoDaddy accepts. The plan says 300, but GoDaddy's custom-TTL
   floor is reported at 600 seconds (third-party reports, not GoDaddy's own
   docs). The apex `A` is already at 600, which fits that floor. Change only
   the TTL field. Do it at least an hour before the cutover, so the old
   3600-second answers have expired by then.
6. **Read it back:**

   ```sh
   curl -s "https://dns.google/resolve?name=www.williamson-homes.com&type=CNAME"
   ```

   The answer should still point at `cdn.webflow.com`. dns.google reports how
   long its cached copy has left, not the TTL that was set, and each read can
   come from a different cache. A number above 600 means an old answer is
   still cached somewhere. A low number proves nothing, because the old
   answer also counts down through its last ten minutes. Only the full
   hour's wait guarantees the new TTL everywhere. On the laptop,
   `dig +noall +answer @ns31.domaincontrol.com www.williamson-homes.com CNAME`
   asks GoDaddy's own server and shows the TTL as set. Use `@ns27` for
   Construction. Then run the verifier. Pages, A and CNAME are still RED, because
   Webflow is still serving. Every MX and TXT line must still be PASS.

## Wed 10-14: cut over (operator, one domain at a time)

Do Homes first. It has no form, so a problem there costs nothing but time.
Webflow already sends `strict-transport-security: max-age=31536000` on the apex
and `www`. So a returning visitor cannot click past a certificate error, and
the minutes between the DNS edit and Let's Encrypt issuing are real downtime
for them. Cut over at a quiet hour.

1. **GoDaddy.** Edit the `@` `A` row from `198.202.211.1` to `75.2.60.5`. Edit
   the existing row; do not delete it and add a new one. Make sure exactly one
   `A` row remains on `@`.
2. **GoDaddy.** Edit the `www` CNAME row from `cdn.webflow.com` to
   `williamson-homes.netlify.app`.
3. **Netlify, Domain management.** Click "Verify DNS configuration" for both
   names. Under HTTPS, provision the certificate if it does not start on its
   own. Let's Encrypt can only issue once the new records resolve, so allow
   several minutes, up to the TTL.
4. **Verify:**

   ```sh
   node scripts/williamson-cutover-verify.mjs --site homes
   ```

   Re-run it until it prints `GREEN`. While caches still hold the old answers,
   some lines stay RED with `server: cloudflare`. A `certificate invalid` line
   means Netlify has not issued yet. A `canonical points at` line that stays
   RED after the certificate is issued means the build baked the wrong
   origin. Trigger another deploy (Tue step 4), then re-run.

5. **Construction: first check the form gate below.** Stop unless the
   `/join-the-team` gate holds. Then repeat steps 1 to 4 for
   `williamson-construction.com` with `williamson-construction-co.netlify.app`,
   and run `node scripts/williamson-cutover-verify.mjs --site construction`.
   Once it prints `GREEN`, send one test submission from
   `https://www.williamson-construction.com/join-the-team` and confirm it
   arrives.
6. **Check by eye.** Open both sites in an ordinary browser, on a phone and a
   desktop. The verifier proves where the pages come from. It does not prove
   they look right.

### Gates the verifier cannot check

- **Construction's `/join-the-team` form (D6, open).** Webflow's form backend
  stops receiving at the cutover. Before Construction's DNS moves, the
  recipient must be settled and a test submission on the preview must have
  arrived. Otherwise leads are lost with no error anywhere (plan §5 risk 6).
- **Turnstile.** On 2026-10-11, Construction's preview `/health` reported
  `"turnstile": false`, meaning no sitekey is set. The widget "Site Forms 2"
  already lists `williamson-construction.com` and `williamson-homes.com`, so the
  domain move cannot break Turnstile. If a sitekey is added before 10-14, use
  that widget, or add the domains to whichever widget the key belongs to
  (`docs/runbooks/turnstile-widgets.md`, "At launch").

## Rollback, until Mon 10-19

Rolling back reverses the two edits. Set `@` `A` back to `198.202.211.1` and
`www` CNAME back to `cdn.webflow.com`. Wait at least 600 seconds (the TTL)
before removing the custom domains from the Netlify sites. Otherwise anyone
whose cache still points at Netlify gets "Site not found". Webflow is expected to keep serving until the workspace cancels
on 10-19. What stops then is still D0, so 10-19 is the plan's worst case. The
rollback has not been tested: nobody has checked that Webflow re-serves a
domain after its DNS has left and come back.

## After the cutover

- **Fri 10-16 and Mon 10-19.** Run `node scripts/williamson-cutover-verify.mjs`
  again; both runs should be GREEN. On 10-19, Webflow's CDN may stop serving.
  A RED line naming `website-files.com` would mean a page still depends on it.
- **`reddoor-maint launch <site>`** is the operator's go, and only after the
  verifier is GREEN. It does five things:
  - checks the matching disposition
  - bootstraps the repo (Renovate and branch protection)
  - audits the roster URL
  - probes `/dev/match/<uid>` and `/health` there for the dev guard
  - drafts the launch email into the approve queue

  It never sends. Before the cutover, the roster URL (`www`) is still Webflow,
  so the audit and probes would measure the wrong site.

- **Roster.** As of 2026-10-11 both rows are `building`. They already carry
  `git_repo` (`reddoorla/williamson-homes`, `reddoorla/williamson-construction-co`)
  and the matching `netlify_id` (SELECT, 14:30Z). The status flip is the
  operator's: approving and sending the launch email flips it.

## Noticed, not changed

- **Homes has two `_dmarc` records**, both `v=DMARC1; p=reject`. One sends
  reports to `dmarc@williamson-homes.com`; the other sends them to
  `jim@williamson-construction.com`, with `pct=70`. A receiver that finds more
  than one DMARC record ignores both (RFC 7489 §6.6.3), so Homes has no DMARC
  policy in effect today. This predates the cutover and is the client's mail
  setup. Leave it alone on 10-14 and mention it to Tim.
- **Construction's zone was edited on 2026-10-05.** Its SOA serial is
  `2026100500`; Homes' is `2026042101`. The A, CNAME, NS and MX records all
  match the plan's 09-29 measurement, so whatever changed is not a record the
  cutover depends on.
- **HSTS `includeSubDomains`.** Both site repos send
  `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
  29 Navy's Netlify site does the same today. Browsers that see it on the apex
  will insist on HTTPS for every subdomain. The one that matters would be
  `email.williamson-construction.com` (CNAME `email.secureserver.net`). On
  2026-10-11 it already failed over HTTPS, with a certificate that does not
  name it, so nothing that works today is lost.
