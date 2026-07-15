---
"@reddoorla/maintenance": patch
---

fix(forms): catch cold-outreach/gibberish/bare-domain spam + lower threshold to 60

Live data showed the classifier was auto-bucketing nothing (`spam_auto` = 0 across
127 recent submissions) while ~1-in-4 delivered messages were spam. This tunes it:

- **Threshold 100 → 60.** The dominant bypass — Latin-script cold outreach (SEO /
  virtual-assistant pitches) — only sums 25–55 from content signals, so nothing crossed 100. Every individual signal stays low enough that none buckets alone (each needs
  corroboration), and `spam_auto` is recoverable, so a false positive is a nuisance the
  operator can undo, not a lost lead.
- **Cold-outreach / SEO keyword phrases** added to `SPAM_KEYWORDS` (multi-word, so they
  stay high-precision): "guest post", "link building", "first page of google", "position
  your brand", "within 24 hours", "virtual assistant", "seo problem", etc.
- **Gibberish-token signal** for random keyboard-mash form-filler bots — detected by a run
  of ≥5 consecutive consonants in a long token (real English words never exceed 4), Latin
  a-z only so native-script names are untouched. Body +35 (strong tell); name +35 only
  under a stricter single-token rule, so a consonant-heavy real surname can't bucket alone.
- **Bare-domain signal** (+20) for a pasted `brand.com` with no scheme/www — the exact
  dodge past the URL regex — excluding email domains, only when no real URL is present.
- **URL contribution capped** at two links (max +50) so a genuine lead pasting their site
  plus portfolio stays under the threshold on links alone.

Measured on the live sample at threshold 60: 8/20 hand-marked spam now auto-bucket (was
0/20) plus additional unmarked inbox spam, with **zero false positives on genuine leads**.
The residual miss — grammatically clean single-signal outreach — needs a velocity /
duplicate-submission signal, which is the tracked next lever (it requires an ingest-time DB
lookup).
