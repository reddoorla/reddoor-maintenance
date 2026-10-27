## 2026-10-20 — `@prismicio/svelte` 3 in three sites: two landed on `staging`, williamson held behind kit 3 (vida-legacy-foundation#119, gallerysonder#132, williamson-construction-co#36)

Worker for decision `decisions/2026-10-20-1924-evening-queue-four.md` (b) in reddoor-workspace, brief `briefs/2026-10-20-prismicio-svelte-3.md`.

**One first real error, in all three.** Renovate's bumps (williamson-construction-co#33, vida-legacy-foundation#113, gallerysonder#130) failed `svelte-check` with the same message, `'$$_rotalumiSecilS0.$$slot_def' is of type 'unknown'`, at `<SliceSimulator let:slices>`. 3.0.0's `SliceSimulator` renders `{@render children?.({ slices })}` and has no `<slot>`, while 2.2.x has only the slot. No page form works on both versions, so a prep PR under Renovate's was impossible: each site got one PR carrying the bump, the snippet form and a test. erp-industrial#75 was green only because erp's simulator already used the snippet.

**Read the package, not the changelog.** Diffing the published `dist` of 2.2.1 and 3.0.0 (2.2.2's is byte-identical to 2.2.1's) gave three behaviour changes besides the simulator:

- `PrismicImage` now derives a missing `height`/`width` from the aspect ratio. No site passes either alone.
- The kit `PrismicPreview` moved from `invalidateAll` to `refreshAll`, and its end-of-preview `goto` passes `{ refreshAll: true, reset: false }`.
- `PrismicTable` reads `field.head`. Unused in these sites.

The rest is formatting.

**The defect class that hid it.** Every site's `/slice-simulator` spec checked framing headers or bundle wiring, never that a slice renders. A simulator that mounts and shows nothing, which is what v3 does with the slot form, passed all of them. The new test does the following:

- serves a host page at `https://simulator-smoke.prismic.io/` through `page.route`. Outside dev, `@prismicio/simulator`'s receiver accepts the handshake only from Prismic's https origins, `*.prismic.io` and `*.wroom.io` among them; `vite dev` skips that check.
- grants it Chrome's `local-network-access` permission;
- runs the library's `ready` / `connect` / `setSliceZone` handshake by hand, mirroring `ChannelEmitter`;
- asserts that a slice renders.

**Belief corrected on contact.** The test's first version failed on the known-good v2 page with `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. Current Chrome blocks a public origin from framing localhost until the permission is granted. The instrument was wrong, not the site, and it was fixed before any red was trusted.

**Measured, per repo.**

- The test passed on v2 and went red on v3 without the fix.
- It also went red with `SliceSimulator` imported from the wrong module, and with the snippet renamed. In the second case the handshake still returned 200, but no slice rendered.
- Driving each PR's Netlify deploy preview through the same handshake rendered the slice on a production build, where the origin check is live.
- After the merges, both `staging` branch deploys serve simulator nodes byte-identical to their previews, and render the sent slice. `vidalegacy.org` (still `main`, v2) serves a different node with no `children` snippet.
- vida's `pnpm test:mutate` scored 88.37%; Stryker's scope is untouched by this change.

**Review round 1** (correctness, test validity, claims and scope, on the session model):

- **vida and gallerysonder: minors only.** Folded into the test before landing:
  - a 25 s handshake poll;
  - the Type Builder's `activeSliceAPI`/`sliceZoneSizeAPI`;
  - fail on page errors;
  - a filled CTA in vida, so `PrismicLink` runs.
- **williamson-construction-co: one major.** That repo is still on kit 2.70.3, and 3.0.0 peers on kit `^3.0.0`. Kit 2's `_goto` ignores `refreshAll` and `reset`. When an editor exits a preview, the page's load reads only `params.uid` and the layout's reads only the cookie, so neither re-runs. The draft stays on screen and the toolbar stays mounted. Visitors are unaffected, and kit 3 removes the defect.
- The briefs had williamson's prismicio PR landing before kit 3. So #36 is held, and the ask is `decisions/2026-10-20-2033-wcc-prismicio-svelte-3-before-kit3.md` (pick: kit 3 first).

**Honest accounting.** My first williamson PR body called the kit 2 gap "editor-only, no forced refresh". The correctness lens showed it was worse: stale draft content and a stuck toolbar, not a missed refresh.

The `williamson-construction-co` hover spec `tests/interaction/hovers.spec.ts:175` fails in the cloud container on `main` too, while CI is green: container-only. The same slot form sits in the starter: reddoorla/reddoor-starter#195. Renovate's #113 and #130 were still open at landing and should close on Renovate's next run.
