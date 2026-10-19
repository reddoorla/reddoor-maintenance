---
"@reddoorla/maintenance": patch
---

`launch-check` counts an unquoted privacy link and resolves relative links against the page the home page landed on and its `<base href>`; before launch it refuses a schedule whose first report has already fallen due and accepts only `YYYY-MM-DD` dates, while live rows keep the old anchor rule.
