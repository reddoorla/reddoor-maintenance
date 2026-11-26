---
"@reddoorla/maintenance": patch
---

LEADS counts only real leads. A submission now counts only when it came from the site's own apex or `www` page, so staging, deploy previews, other `netlify.app` hosts and `localhost` no longer count. It must also not come from Reddoor's own domain or from an address no mail reaches (`example.com`/`.org`/`.net`, `.test`, `.invalid`, `.localhost`, `.example`, a one-letter TLD), ignoring trailing punctuation, symbols, spaces and invisible characters after the address. An address literal such as `bob@[1.2.3.4]` is read as a real sender. The report's LEADS block, the site page's lead panel and the digest's 24h leads share this rule (reddoorla/reddoor-maintenance#2296). A site that moves domain stops counting leads from its old one, and the digest's fleet total no longer counts leads for a site missing from the roster.
