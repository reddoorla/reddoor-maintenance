## 2026-10-11 — Shankar Annamalai is live on Hedloc's Executive Team page (release `asvLKRIAALUvJrWz`)

The operator published the release staged in the 17:50 entry, rebuilt the site, and said it "looks live". This entry is the check from the live page itself, at 21:22Z on https://hedloc.netlify.app/executive-team. It also closes P1-40's site side, so hedloc#54 is closed.

**What the live page shows:**

- The HTML now lists Jack Harper, Dan Hord, Ben Friedman and Shankar Annamalai ("Advisor"), with the uploaded headshot `tFb0uvkVPwH3KOz0`. No Prismic releases remain pending.
- **At 1440:** four members in one row at x 58/399/740/1081, each 301px wide. That is the slot the layout PR left empty, now filled. His card and five-paragraph bio open, and the last paragraph ends exactly at the section's content edge (0px to spare). The grid cell grew with the bio, as hedloc#55 intended for a bio of his length.
- **At 1024:** four in one row at x 41/286/532/778, each 206px wide. His name wraps to two lines, both at offset 0 from the column edge.
- **At 390:** the four stack.
- No console errors at any width.

**A false negative from the probe, recorded so it is not mistaken for a defect later.** The first run of the live check found that clicking Shankar at 1024 opened nothing. Three fresh runs of the identical sequence opened his bio every time, and a separate probe opened it 3 of 3. The miss was the first page load in a cold browser: the probe waited a fixed 2.5s after `load`, and clicked before the site's JavaScript had hydrated. Any server-rendered page here behaves the same in that window, the pre-#55 page included. The repo's own tests wait on a hydration marker for exactly this reason.

**Still the operator's:**

- Erik's reply, the line in hedloc#55's body, which the operator plans to post on 10-12.
- The stray "document" asset `FyXEaSXx6pW_KKta` from the first upload. It is still in the media library; delete it there by hand.
