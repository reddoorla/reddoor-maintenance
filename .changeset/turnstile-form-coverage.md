---
"@reddoorla/maintenance": minor
---

`form-e2e` checks every form page of a site whose row requires Turnstile. It visits `/contact`, `/` and a sample of the sitemap in a browser, judges each lead form (a form asking for an email) as loaded and any form an inquiry trigger (`[data-inquire]`, or a link ending `#inquire`) opens in a dialog, and turns the Turnstile widget verdict to `fail` when one renders no `.cf-turnstile` mount, naming the pages. The fleet `Site` now carries `requireTurnstile`.
