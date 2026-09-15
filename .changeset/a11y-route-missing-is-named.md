---
"@reddoorla/maintenance": patch
---

a11y: a fixture route that 404s is reported as a missing route, and the fail summary names the rule and the route (#680)

The generated spec navigated each route and ran axe over whatever came back.
`/dev/animate-in` is not fleet-universal; on reddoor-website the audit was
scanning the 404 page for months and reading green because the bare fallback had
nothing to flag. When that site gave its 404 page a designed watermark (contrast
1.39 on a 3:1 rule) the step went to `a11y: 1 violations` with no route and no
rule in the log, and a config problem was bisected as a markup one.

Two changes in `src/audits/a11y.ts`:

- The spec captures the `goto` response. A missing or non-200 response becomes a
  `route-missing` violation (impact `serious`, help `<path> returned <status>`)
  and the loop `continue`s — axe never runs over the error page.
- The fail summary appends `<rule> on <route>` for every violation (identical
  pairs folded to `×N`, capped at six with `+N more`), and a `route-missing`
  entry carries its status. The artifact JSON always knew this; the summary is
  the line that reaches CI and the cockpit, so it now says it too.

The hydration smoke loop over `/` is deliberately untouched: it exists to catch
client crashes on a page that may legitimately render data-less in CI, and
gating it on a 200 is a separate decision.
