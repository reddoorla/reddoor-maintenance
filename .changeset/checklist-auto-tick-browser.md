---
"@reddoorla/maintenance": minor
---

Checklist auto-tick gains three Testing signals from one new audit: **Desktop Browsers**,
**Mobile Browsers**, and **Links & Navigation**. A new checkout-free `browser` audit drives
Playwright against the deployed URL — chromium/firefox/webkit for desktop, mobile-emulated
chromium/webkit, and an internal-link check — over a **representative route sample** discovered
from the sitemap and **bucketed by path family** so CMS-generated templates (Prismic
`[uid]`/`[slug]` pages) are always covered, not just static top-level pages. It joins the nightly
sweep (`--only lighthouse,domain,browser`, all checkout-free; the runner now `playwright
install`s firefox/webkit) and persists `Crossbrowser OK` / `Mobile OK` / `Links OK` / `Broken
links` / `Browser checked at` to the Websites row. The three boxes auto-tick at draft time when
fresh and green; stale → unknown, a failing verdict → fail (amber, with the broken-link count for
Links), never-run → manual. Fail-safe throughout: empty/flaky observations never count as a pass.
Honest scope: cross-engine render without JS errors + no mobile overflow + internal links resolve
— not pixel-perfect visual correctness or real-device touch.
