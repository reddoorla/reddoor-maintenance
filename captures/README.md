# Webflow reference captures

Byte-for-byte copies of the three sites still served by Webflow, taken on
2026-09-30 before the Webflow workspace cancels on 2026-10-19 (OD7-P0, #1029,
`docs/webflow-conversions-2026-10.md`). A Webflow reference that has stopped
serving cannot be captured again (spec D11, Beachfront), so these copies are the
reference for the rebuilds from now on.

| capture                    | site                                      | Webflow site id            | pages | files | size   | where the bytes are                        |
| -------------------------- | ----------------------------------------- | -------------------------- | ----- | ----- | ------ | ------------------------------------------ |
| `williamson-homes/`        | `https://www.williamson-homes.com`        | `645ec08251dadc9000a072e5` | 10    | 429   | 167 MB | branch `capture/od7-williamson-2026-09-30` |
| `williamson-construction/` | `https://www.williamson-construction.com` | `646d47bfeb53b0308e8d4379` | 14    | 333   | 143 MB | branch `capture/od7-williamson-2026-09-30` |
| `domaru/`                  | `https://www.domaruhealthsupply.com`      | `61817e584460db988c9333a4` | 7     | 121   | 18 MB  | here, on `main`                            |

`mantis-landscaping/` is a **Blux** site (`https://mantislandscaping.com`,
captured 2026-10-01, 6 pages, 105 files, 244 MB). The Webflow tool cannot
capture it, and its `CAPTURE.md` says why and how it was captured instead. Only
the manifest is here. The bytes go to the site repo in P0 of
`docs/mantis-landscaping-plan-2026-10.md`.

The two Williamson captures are for their own site repos, which do not exist
yet. Their bytes are not on `main`: 310 MB of photography and video would stay in
this repo's history for good. `main` holds each one's `CAPTURE.md` and
`manifest.json` (every URL, file path and sha256), and the bytes sit on the
branch above, which nothing here merges. Keeping them off `main` does not keep
them out of clones while the branch exists. A default fetch takes every branch,
so a plain `git clone`, the cloud-session setup hook's unshallow fetch and every
`fetch-depth: 0` CI checkout download about 290 MiB more (measured in a cloud
session on 2026-09-30: 288.7 MiB of objects reachable only from the branch,
against 17.7 MiB for all of `main`). That cost ends when the branch is deleted,
after Phase 1 copies each capture into its site repo (BACKLOG Operator
decisions 33, answered 2026-09-30).

## Layout

Each capture directory holds:

- `pages/<path>/index.html` — every page reachable by same-origin links from `/`.
- `files/<host>/<path>` — every file those pages load, and every file those
  files load in turn: stylesheets and their `url()`s, scripts (including the
  githack counter script and its jsDelivr sibling), every `srcset` variant, both
  transcodes of each background video, posters, PDFs, Lottie JSON, favicons and
  Google Fonts. A query string is folded into the filename as `.q<sha8>`.
- `manifest.json` — each page and file with its URL, path, bytes and sha256, and
  the references deliberately not vendored (reCAPTCHA, Turnstile, the Vimeo and
  YouTube embeds, and the Adobe Fonts faces, which are licensed), each with its
  reason.
- `CAPTURE.md` — the human summary.

Nothing is rewritten. Every URL in the HTML still points at Webflow's CDN. The
capture records what the reference loads; it is not a site that can be served
as it stands.

## Prove a capture is whole

```sh
node scripts/webflow-capture/check.mjs captures/domaru --expect-pages 7
```

The check re-reads every reference from the captured bytes and requires each one
to be on disk with the sha256 the manifest recorded, or to be a named exclusion.
It also requires every page link to point at a captured page, and every page to
carry its Webflow site id. It exits 0 when the capture is whole and 1 with each
failure named. For the Williamson captures, check out the branch first:

```sh
git fetch origin capture/od7-williamson-2026-09-30
git worktree add ../wt-capture origin/capture/od7-williamson-2026-09-30
node scripts/webflow-capture/check.mjs ../wt-capture/captures/williamson-homes --expect-pages 10
node scripts/webflow-capture/check.mjs ../wt-capture/captures/williamson-construction --expect-pages 14
```

## Moving a capture into its site repo

Once `reddoorla/williamson-homes` exists and has the match harness
(`reddoor-maint match-harness <site> --ref https://www.williamson-homes.com`):

1. Copy `captures/williamson-homes/` from the branch to the site's
   `matching/spec/`, and copy `scripts/webflow-capture/{lib,check}.mjs` beside it
   so the check travels with the bytes.
2. The harness's `.gitignore` block ignores `matching/*`. Add
   `!matching/spec/` after that block (not inside it: the block is
   recipe-owned), and put `matching/spec/` in `.prettierignore` and the ESLint
   ignores.
3. Set `refMark` in `matching/harness.json` to
   `data-wf-site="645ec08251dadc9000a072e5"` (Construction:
   `data-wf-site="646d47bfeb53b0308e8d4379"`) and `selfHosts` to the Netlify
   name. The recipe seeds `refMark: ""`, and the preflight refuses it until it is
   set. On 2026-09-30 `node matching/harness.mjs --check-ref` passed against
   both live sites with these values.

## Recapture

```sh
node scripts/webflow-capture/capture.mjs --ref https://www.domaruhealthsupply.com --out captures/domaru --expect-pages 7
```

This makes plain GETs, one at a time and paced, and runs the check when it
finishes. It works only while the site is still served from Webflow.
