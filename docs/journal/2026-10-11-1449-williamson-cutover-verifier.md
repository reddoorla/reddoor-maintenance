## 2026-10-11 — The Williamson cutover has a checklist, and a verifier that is red on Webflow and green on the previews (#1280)

P1-42 (OD7-P4, issue #1279) was the last piece before Wed 10-14, when
www.williamson-homes.com and www.williamson-construction.com move from Webflow
to Netlify. Its deliverables:

- `docs/runbooks/williamson-cutover-2026-10-14.md`, the operator's checklist;
- `scripts/williamson-cutover-verify.mjs`, a read-only verifier.

The worker changed no DNS and no Netlify setting. Every one of those steps is
the operator's.

**The verify-first held.** At 14:12Z the `data-wf-site` counts were 1, 1, 0, 0.
The live apex `A`, `www` CNAME, NS and MX all matched the plan's 09-29
measurement. The plan had only ever written "MX …mail.protection.outlook.com",
so §2 now carries the exact values.

The values a DO NOT TOUCH table needs differ between the two domains:

- Construction's SPF ends `~all` where Homes' ends `-all`.
- Construction has no google-site-verification TXT.
- Construction's zone was edited on 10-05 (SOA serial `2026100500`). No record
  the cutover depends on changed.
- Homes carries two `_dmarc` records, so under RFC 7489 §6.6.3 no DMARC policy
  applies to it at all. That is the client's to fix, and it is written into the
  checklist for Tim.

**Two measurements in this container decided how the verifier works.**

- **DNS goes over DoH.** Node's `dns.resolveMx` answered `ENODATA` for a domain
  that has an MX, so the container's resolver cannot see MX at all. The script
  reads every record through `dns.google` and `cloudflare-dns.com`. A check
  passes only when both agree, because the second authority is the control.
- **The certificate check needs the CONNECT tunnel.** A direct TLS connection
  from here sees "Anthropic Egress Gateway SDS Issuing CA", not the site's
  certificate. By that path an expired upstream certificate comes back as a
  bare HTTP 503. That is still red, but for the wrong reason.

  With `NODE_USE_ENV_PROXY=1`, the CONNECT tunnel carries the real certificate.
  expired.badssl.com, wrong.host.badssl.com and self-signed.badssl.com then
  fail with `CERT_HAS_EXPIRED`, `ERR_TLS_CERT_ALTNAME_INVALID` and
  `DEPTH_ZERO_SELF_SIGNED_CERT`, and badssl.com's valid certificate passes.
  `openssl s_client -proxy` showed the same real issuers: Google Trust
  Services for Webflow, DigiCert for `*.netlify.app`.

  So the script re-runs itself with that variable whenever `HTTPS_PROXY` is
  set, and its first line says which path it used. "Valid certificate" was the
  brief's word. In this container it would have been an untested assertion
  without that control.

**The instrument was proven on both sides**, the CLAUDE.md rule.

- **Webflow hosts:** RED, 56 of 64 checks failed (14:42Z). That was every page
  and the apex `A` and `www` CNAME on both resolvers. MX and TXT passed, as
  they should.
- **Previews:** GREEN, 32 of 32.
- **A known-good positive control.** Neither preview exercises the
  production-only checks, so they were run against 29 Navy, a Netlify site
  already cut over with the same record shape. They passed there, and its
  unknown path failed with a 404.

32 mutations each turned a test red: the brief's four, plus 28 found by
review. The table is in the PR.

**What review caught.** Round one ran three lenses (false greens, checklist
safety, test validity), and every lens was dirty. The findings worth
remembering:

- **The canonical needs a redeploy.** Both site repos bake Netlify's build-time
  `URL` into every prerendered page's canonical and `og:url` (line 64 of
  `svelte.config.js`). `URL` is the primary domain, which today is the
  `*.netlify.app` host, and that host answers
  `x-robots-tag: noindex, nofollow`. A cutover without a redeploy after
  Tuesday's domain step would serve `www` with every canonical pointing at a
  noindexed host. The first verifier would have called that GREEN. The
  checklist now has the redeploy as Tue step 4, and the verifier fails any
  production canonical that is not on `www`. Two reviewers found this
  independently; 29 Navy's canonical, `https://29navy.com/`, shows what
  correct looks like.
- **A new apex `A` row added beside the old one would have passed.** undici
  keeps one connection per origin, so all ten paths may hit whichever IP came
  first. The verifier now requires the apex `A` to be exactly `75.2.60.5` and
  the `www` CNAME to be exactly the site's `netlify.app` name.
- **The test fake ignored `init`.** So deleting `redirect: "manual"` left
  every test green, although real Node would then follow redirects itself and
  hide every apex hop. The fake now refuses such a call; that mutation turns
  30 tests red.
- **The form gate came after the step it guards.** The D6 gate for
  Construction's `/join-the-team` sat in a section below the step that moves
  Construction's DNS. It now opens that step.

**Round two** found no blocker or major issue, and two minors. Real Netlify
apex → `www` → trailing-slash chains pass.

1. The canonical check compared only the host, so an `http://www…` canonical
   passed. It now requires the `https://www…` origin.
2. The checklist claimed a low TTL from dns.google proves the new TTL is live.
   The old answer counts down through the same range. The checklist now points
   at GoDaddy's own server, through `dig @ns31.domaincontrol.com`.

Both are fixed, each with a red test or the doc line. Under the
two-dirty-rounds rule the PR went to the operator as Operator decisions 101
instead of into a third round.

Not taken:

- a per-host 404 negative control (SvelteKit serves real 404s, and the live
  runs show them);
- DKIM and `_dmarc` checks. The checklist says plainly that only editing
  nothing but the two rows guards those.

**Corrected on contact.** The plan says to lower the `www` TTL "from 3600 to
300". GoDaddy's custom-TTL floor is reported at 600 seconds (third-party
reports, not GoDaddy's docs), and the apex `A` already sits at 600. The
checklist says to use the lowest value GoDaddy accepts. It also explains that
dns.google reports its cache's remaining time, not the TTL that was set, so a
read-back above 600 within the hour is the old answer running out.

**Left for the operator, all 🔴:**

- the Tue 10-13 Netlify custom domains, redeploy and TTL;
- the Wed 10-14 GoDaddy edits;
- D0 (what Webflow stops on 10-19);
- D6 (who receives `/join-the-team`);
- `reddoor-maint launch` once the verifier is GREEN.

Both roster rows already carry `git_repo` and the matching `netlify_id`.
