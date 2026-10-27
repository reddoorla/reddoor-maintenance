## 2026-10-11 — Shankar Annamalai is staged in a hedloc Prismic release, not entered by hand (release `asvLKRIAALUvJrWz`)

This corrects in part the 17:22 entry, "Hedloc's Executive Team row is 4 wide at lg; Shankar's entry is the operator's". The operator activated the Prismic MCP for hedloc after that entry landed and asked for the entry to be staged. It is in release `asvLKRIAALUvJrWz`, "Executive Team: add Shankar Annamalai (P1-40)", for the operator to publish: https://hedloc.prismic.io/builder/upcoming/asvLKRIAALUvJrWz. Nothing was published.

**What is staged.** One item is appended to the `about` document's `team_member` group, after Ben Friedman:

- name "Shankar Annamalai", title "Advisor";
- the headshot, asset `tFb0uvkVPwH3KOz0`, 1125×1500, alt "Shankar Annamalai";
- the .docx's five paragraphs as plain paragraphs, left without headings like the other three bios.

It was checked three ways:

- The paragraphs were compared byte for byte with the text in the .docx's `word/document.xml`, and are identical.
- `update_document` ran once as a dry run before the real write.
- `diff_release` against the published version shows one document with exactly two deltas: the group's key list gains a fourth key, and the item is added. Jack, Dan and Ben are untouched.

**The asset upload has a trap, worth knowing for the next Dropbox headshot.** `upload_asset` fetches a public URL server-side.

- **Erik's shared link with `dl=1` came back as a "document" asset.** It has no dimensions and a `hedloc.cdn.prismic.io` URL instead of an `images.prismic.io` one, so it cannot fill an image field. Dropbox labels the file `application/json` (seen on HEAD), and Prismic sorts by that label.
- **The same link with `raw=1` works.** A GET there returns `image/jpeg`, and the upload became a proper imgix image asset.
- **The failed first upload is still in the library**, as asset `FyXEaSXx6pW_KKta`. The MCP has no asset delete, so the operator removes it by hand.
- **The temp host was not used.** The tool's own hint, a temp host like tmpfiles.org, would have put a client's unpublished photo on a third-party public host. The client's own Dropbox link was the better source.

**A number corrected.** The 17:22 entry and the backlog said Shankar's bio is 1,867 characters. That count came from the raw XML, where `&` is the five-character `&amp;`. The text itself is 1,855 characters (113/642/667/94/339). The fixture's paragraphs still use the XML lengths, 12 characters longer in all, which makes its overflow check slightly stricter, not looser.

**Still open, all the operator's:**

1. Publish the release.
2. Trigger a Netlify build. `/executive-team` is prerendered, and no Prismic → Netlify build hook could be confirmed.
3. Check https://hedloc.netlify.app/executive-team.
4. Post Erik's reply from hedloc#55's body.
