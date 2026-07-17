---
"@reddoorla/maintenance": minor
---

blux convert: emit products.json — the product catalog a Blux "products" feed
drives. Blux renders a detail page per record (/products/<slug>) from a
Handlebars template the static export drops, so the catalog is rebuilt
deterministically: canonical categories (the raw feed is dirty — whitespace,
case, and typo variants like "Upholstrered" → "Upholstered"), the faithful
slug (each record's stored `url` wins, e.g. "Howdy Set" → howdyset, else derive
from the title), and reconstructed main + gallery image urls. Slug-collision
safe (an enabled record wins over a disabled duplicate). Proven on composition:
552 records → 549 products (3 collisions deduped), categories Upholstered 408 /
Case 126 / Exterior 15, all reconstructed image urls resolve.
