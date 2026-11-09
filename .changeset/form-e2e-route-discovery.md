---
"@reddoorla/maintenance": minor
---

form-e2e finds a form off /contact: when neither /contact nor / carries one, the probe looks at up to 15 sitemap routes, sampled by path family, and drives the first form it finds there. A discovered page whose email form posts to an absolute URL is skipped, so a third-party newsletter form is never submitted. The pass line names the route ("form at /join-the-team, found by route discovery"), and an n/a line says how many discovered routes were also looked at, so n/a still means the site has no form.
