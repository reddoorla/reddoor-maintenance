---
"@reddoorla/maintenance": patch
---

feat(forms): aggressive SEO/solicitation filtering tuned from the live miss corpus

Operator policy (2026-07-15): the fleet's sites are niche and specific — they rank top
for their own names — and clients who want SEO/marketing help ask the agency directly,
so SEO-topic content arriving through a public contact form is near-always solicitation.
Overblock is accepted; `spam_auto` stays recoverable.

Tuned from a replay of every live submission the previous classifier missed:

- **Seller-keyword weight 25 → 30 (cap 3 hits / 90)** — two solicitor phrases now bucket
  outright. Genuine leads write zero of them; a lead who grazes ONE ("we want to rank
  higher") is still delivered at 30.
- **SEO-topic phrases move (back) to seller tier at full weight** ("google ranking",
  "rank higher", "drive traffic", "seo problem", "backlinks", "virtual assistant") and
  the list is expanded with the observed dodges: "page one" / "1st page" (was "first
  page of google" — real pitches write "You're not on page one" and "1st page of
  Google"), "top of search results", "seo process", "people already searching",
  "leads and sales", "businesses like yours", "tried emailing you" (the classic opener),
  "article for your website", "wikipedia page" / "wiki links", "get yours today" /
  "free shipping" (product blasts), and the MAVIS virtual-assistant flood's template
  invariants ("virtual intelligent system", "mavis", "overtake and handle",
  "custom built ai") — that flood rotates names/domains and rewords every copy, so the
  exact-duplicate velocity signal can't see it.
- **Hyphens fold to spaces before matching** — "link-building" and "custom-built AI"
  were live keyword dodges.
- **Lorem-ipsum detector** (+60, the one signal allowed to bucket alone): form-tester
  bots submit truncated Latin filler ("Velit ullam reprehen") that is too short for the
  velocity signal and invisible to the gibberish detector; two distinct stems are
  required so a lone romance-language cognate ("voluptuous") can never fire.
- Buyer tier shrinks to the genuinely ambiguous pair ("within 24 hours",
  "free consultation") — weak +10 capped +20 alone, promoted to full weight beside any
  seller phrase.

Measured on the live corpus (old vs new): marked-spam recall **8/20 → 19/20** (the one
remaining miss is a keyword-less "share a document" phish), and 16 additional unmarked
spam rows in the delivered pile now bucket — every one hand-verified as solicitation
(MAVIS flood ×10, search-ranking pitches, guest-article fishing, product blasts).
**Zero genuine leads flip**: the charity invite, artist introduction, job seeker, poet,
price-list ask, and portal complaint all still deliver.
