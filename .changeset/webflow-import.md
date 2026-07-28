---
"@reddoorla/maintenance": minor
---

webflow import module: capture, docs, migrate — scrape a live Webflow site into a
JSON IR and push it into Prismic via the shared migration runner (first consumer:
beachfrontdentistry.com). Pipeline: fixtures → html-to-richtext → detail/index
extractors (team, services, categories, questions, reviews) → crawler + asset
manifest → IR-to-entity-docs → beachfront page-doc assembly → CLI `webflow
capture`/`docs`/`migrate` → the proven blux `runMigration` runner (no blux
changes). Live rehearsal: 75 entity docs + 5 page docs, 70 assets, 0 missing,
zero extractor throws across all 75 real pages. 64 new tests. Two editorial
notes carried forward for a human pass: a `[DRAFT]` first-visit paragraph and an
empty tour-photo carousel awaiting Phase-4 fill.
