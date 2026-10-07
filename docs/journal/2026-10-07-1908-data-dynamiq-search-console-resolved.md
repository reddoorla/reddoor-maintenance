## 2026-10-07 — Data Dynamiq's Search Console lookup resolves (Operator decisions 93 closed)

This follows the 18:0x entry on the Data Dynamiq Search Console tag. After
the operator pressed Verify, `sites.list` moved `tucker@reddoorla.com` from
`siteUnverifiedUser` to `siteOwner` (19:06Z). The lookup then resolved as
`tucker@` and still got the permission error as `reports@`. Once the
operator added both accounts, `reports@` read `siteFullUser` and resolved
too (19:08Z). The one remaining warning is "no Search Console data" for the
default brand query, which is expected on a property verified the same
day. The first nightly will record the stored outcome; nothing was written
to `site_health` from here.
