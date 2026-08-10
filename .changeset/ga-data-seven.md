---
"@reddoorla/maintenance": patch
---

Update @google-analytics/data to v7. Its google-gax@6 pins google-auth-library
to exactly 10.5.0 while our direct dep floats at ^10.6.2, which split the
install in two and made the JWT we hand to BetaAnalyticsDataClient nominally
incompatible with gax's AnyAuthClient (TS2322). A pnpm override now pairs every
copy to the direct dep's spec, so one install serves both and the types agree.
