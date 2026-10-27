# AEO evidence base

What we have actually measured about how answer engines read a page, as opposed
to what we have inferred from somebody else's study. Every claim here names the
run that produced it, and the raw transcripts are committed beside it.

This file exists because `Standing.svelte` on the website already pointed at it
and it did not exist (reddoorla/reddoor-maintenance#675).

---

## 2026-09-15 — Does the assistant we test read JavaScript-rendered text?

**Short answer: no, it does not execute JavaScript — but "JS-dependent" as we
measure it is broader than "invisible", and the gap is worth knowing.**

### Why it was asked

`src/prospect/checks.ts` gives JS dependence 60 of readability's 100 points. The
measurement — the share of a page's content words present after render but
absent from the raw HTTP response — is real. The consequence it scores, that the
assistant cannot see those words, rested entirely on the Vercel/MERJ crawler
study of December 2024: a study of training and index crawlers on one host's
network, not of what an engine reads at answer time. For our own instrument we
had no evidence either way. On a client-rendered prospect that assumption zeroes
60% of their readability — our assumption reported as their defect.

### Design

Three pages, identical but for where one nonce fact lives. The fact is a made-up
reading ("the Kelverhoy index for Station Marrowick") so no engine can supply it
from memory or from elsewhere on the web.

| Arm                    | Where the value lives                                                                                              | Nonce |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ----- |
| `control.html`         | Server-rendered HTML                                                                                               | 7314  |
| `script-embedded.html` | In the bytes, but only inside `<script type="application/json">` — the shape Next.js `__NEXT_DATA__` and Nuxt ship | 5209  |
| `js-fetched.html`      | Nowhere in the bytes; fetched at runtime from `station-marrowick.json` by a script                                 | 8827  |

Each page also states its own arm name in server HTML, so a run that reached the
page but found no reading is distinguishable from a run that never arrived.

Served publicly, with correct `text/html`, from the committed fixtures at a
pinned commit:

```
https://raw.githack.com/reddoorla/reddoor-maintenance/c2d71a1243edf53a690a35d8f32ec934558a28a0/docs/experiments/js-dependence/<arm>.html
```

Byte-level check of the setup itself, before probing anything (`curl`):

```
control.html          http=200 type=text/html  749 bytes
script-embedded.html  http=200 type=text/html 1408 bytes
js-fetched.html       http=200 type=text/html 1282 bytes
station-marrowick.json http=200 type=application/json 72 bytes

token 7314: control.html:1  script-embedded.html:0  js-fetched.html:0  station-marrowick.json:0
token 5209: control.html:0  script-embedded.html:1  js-fetched.html:0  station-marrowick.json:0
token 8827: control.html:0  script-embedded.html:0  js-fetched.html:0  station-marrowick.json:1
```

So each nonce is in exactly one place, and `js-fetched.html` contains no nonce at
all. The arms differ only in mechanism.

### Proving the instrument first

A negative result from a probe that finds nothing is worth nothing. Two checks
ran before any verdict was read:

1. A smoke run against `https://example.com` returned its first sentence
   verbatim — the fetch path works at all.
2. The CONTROL arm returned `7314` on all three runs. The probe demonstrably
   finds server-rendered text on these very pages.

Only then does `NOT STATED` on another arm mean anything.

### Result — 9 runs, 3 per arm, 2026-09-15

Prompt, identical but for the URL: _"Fetch `<url>` and read it. Answer with
exactly two lines and nothing else: ARM / READING (…or NOT STATED if the page
does not state it)."_

| Arm             | Run 1      | Run 2      | Run 3      | URLs fetched                |
| --------------- | ---------- | ---------- | ---------- | --------------------------- |
| CONTROL         | 7314       | 7314       | 7314       | `control.html` only         |
| SCRIPT-EMBEDDED | 5209       | 5209       | 5209       | `script-embedded.html` only |
| JS-FETCHED      | NOT STATED | NOT STATED | NOT STATED | `js-fetched.html` only      |

Unanimous, 3/3 on every arm. Raw `stream-json` transcripts, including every tool
call: `docs/experiments/js-dependence/runs/*.jsonl`.

The "URLs fetched" column is load-bearing. On JS-FETCHED the model could have
read `fetch("station-marrowick.json")` in the script source and simply requested
that file itself; it never did, on any run. And on SCRIPT-EMBEDDED it made
exactly one request, so `5209` came out of the page's own bytes rather than a
second retrieval.

### Reading the result

**The premise holds for content that requires a JS engine.** Text written at
runtime was invisible on every attempt, while server-rendered text on the same
pages came back every time. The 60-point weight is not resting on an untested
assumption any more, and per the issue's own reading ("only the HTML fact: the
premise holds and the weight is justified") it stays.

**But our measurement is broader than the effect it scores.** Running the repo's
own extractor over the three fixtures:

```
control.html:          nonce 7314 in raw .text? true
script-embedded.html:  nonce 5209 in raw .text? false
js-fetched.html:       nonce 8827 in raw .text? false
```

`extractPage` does not walk script contents, so SCRIPT-EMBEDDED and JS-FETCHED
are indistinguishable to `jsDependence` — both count as words that "only appear
after JavaScript runs". The probe told those two apart decisively. So for a page
that ships its content inside a script tag — every stock Next.js and Nuxt page —
`jsDependence` counts as invisible text the assistant demonstrably reads, and
docks up to 60 points for it. That is a real over-penalty, on a very common
stack. It is not corrected here: doing it properly means teaching the extractor
to read JSON-LD-adjacent script payloads, which is a larger change than this
issue, and the honest first step is to stop the report asserting what it had not
measured.

> Corrected on 2026-09-16 in #828: `extractPage` now projects a `dataText` field
> from `application/json` / `…+json` script bodies and `jsDependence` reads it,
> so the SCRIPT-EMBEDDED arm above scores 0% missing while JS-FETCHED is
> unchanged at 5.4%. The three arms below are the fixtures that gate it.

### What was NOT established

- **The production instrument was not the one tested.** `CLAUDE_OAUTH` is empty
  in `~/.config/reddoor-maint/credentials.env` and no `ANTHROPIC_API_KEY` was
  available, so the metered API path could not be driven. These runs used
  `claude -p` with `WebFetch` at `PROBE_MODEL` (`claude-sonnet-5`) — and
  `src/prospect/claude-code.ts` itself documents that a Claude Code harness is
  measurably _not_ the same instrument as a bare API call. Treat this as strong
  evidence about the harness and suggestive about the API.
- **This measures a fetch, not the audit's probe path.** Worth stating plainly
  because the issue assumed otherwise: **our probes never fetch the prospect's
  page at all.** `WebFetch` is in `BASE_DISALLOWED` in `claude-code.ts`, and
  `claudeWebSearchEngine` only ever runs `web_search`. So the issue's step 1
  ("noindex is fine; the probe fetches by URL") cannot be executed as written —
  a fresh noindex page is in no search index and the probe engines have no way
  to reach it. What the visibility probes read is a _search index_, which is
  built by crawlers that are not the ones the readability premise is about.
- **One day, not three.** The issue asked for three runs on different days. These
  are nine runs on one afternoon. The answer path is not deterministic and the
  unanimity above may be flattering; re-running on another day is cheap.
- **One engine.** No Perplexity arm — `PERPLEXITY_API_KEY` was not set.

### Reproducing it

The fixtures are committed and the URLs are pinned to a commit, so the pages
cannot drift under a later run. Re-run the loop in the PR body of #675, or point
any assistant with a fetch tool at the three URLs above and ask for the reading.
