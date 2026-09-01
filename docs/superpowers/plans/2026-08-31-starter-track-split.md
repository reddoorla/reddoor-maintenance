# Starter Track Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `reddoorla/reddoor-starter` into a native client-site template (this repo's `main`) and `reddoorla/reddoor-starter-blux` (a full-history snapshot of today's `main` that stays the Blux migration render target), so the first `/new-site` clone (Vida Legacy Foundation) starts from a template with no Blux layer.

**Architecture:** Three independent legs. (A) Snapshot: push the pre-split `main` to a new template repo — zero code change. (B) Native-ize: on a `feat/native-template` branch of `reddoor-starter`, move the chrome types out of `$lib/blux`, rewrite the two content routes + sitemap + client to plain Prismic `page` queries, strip the `band` branch from the seven band-coupled slices, delete the Blux layer, and de-Blux the config/CSS/docs; one PR, CI green. (C) Repoint: maintenance comments/docs + the `new-site` skill learn about the two tracks.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), Tailwind 4, Prismic `@prismicio/client` 7 + Slice Machine, pnpm 11.8, vitest 4 + @testing-library/svelte, Playwright, `gh` CLI. macOS: `sed -i ''` (BSD sed).

**Spec:** `docs/superpowers/specs/2026-08-31-starter-track-split-design.md` (this repo). Deviations from the spec, decided while planning and recorded here so the spec need not be re-approved:

- `docs/migration.md` and `scripts/import/` are **generic Prismic-migrate tooling** (`@prismicio/migrate`, `htmlAsRichText`), not Blux — they are KEPT.
- `src/blux-layout.css` styles only `blux_*` slices — deleted outright; nothing native uses `.blux-section*`. The `.mt-media` / `.hero-band` / `.richtext-block` rules in `app.css` ARE native (only their comment says "Blux") — kept, comment reworded.
- `pageMeta()` (7 lines in `blux-catalog/page-doc.ts`) is native — moved to `src/lib/page-meta.ts` rather than reimplemented.
- `mocks.json` for TextColumns / Accordion / LeadText are NOT hand-written (the Slice Machine mock format for Group + StructuredText fields is not worth reverse-engineering); they get generated on the first Slice Machine run in the VLF build.
- `handleMissingId`'s `/dev/` referrer tolerance stays (harmless; `/dev/a11y-fixtures` is still prerendered).

**Working directories:**

- Starter checkout: `/Users/tuckerlemos/Documents/GitHub/reddoor-starter` (`main`, remote `origin` = `https://github.com/reddoorla/reddoor-starter.git`).
- Native-ize worktree (created in Task 4): `/Users/tuckerlemos/Documents/GitHub/reddoor-starter/.claude/worktrees/native-template` — `.claude/` is gitignored, so the worktree never shows up in the template.
- Blux clone (created in Task 2): `/Users/tuckerlemos/Documents/GitHub/reddoor-starter-blux`.
- Maintenance worktree for leg C: `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/starter-split` (branch `docs/starter-track-split`, already holds the spec and this plan).

---

## Leg A — Blux snapshot

### Task 1: Create `reddoor-starter-blux` from the pre-split `main`

**Files:** none (git + GitHub only).

- [ ] **Step 1: Verify the starter is clean and at the recorded pre-split SHA**

Run:

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-starter
git fetch -q origin
git status --short | wc -l
git rev-parse --short main origin/main
```

Expected: `0`, then two identical lines `82d93b0`. If `origin/main` has moved past `82d93b0`, STOP and update the spec changelog with the new SHA before continuing (the snapshot must equal the tip you are about to native-ize from).

- [ ] **Step 2: Confirm the target repo does not already exist**

Run: `gh repo view reddoorla/reddoor-starter-blux 2>&1 | head -1`
Expected: `GraphQL: Could not resolve to a Repository with the name 'reddoorla/reddoor-starter-blux'. (repository)`. If it exists, skip to Step 5.

- [ ] **Step 3: Create the empty repository**

Run:

```bash
gh repo create reddoorla/reddoor-starter-blux --public \
  --description "Reddoor site template — Blux migration track (frozen + catalog render). Forward-merge reddoor-starter/main; never merge back."
```

Expected: `https://github.com/reddoorla/reddoor-starter-blux`

- [ ] **Step 4: Push `main` with full history**

Run:

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-starter
git push https://github.com/reddoorla/reddoor-starter-blux.git main:main
gh api repos/reddoorla/reddoor-starter-blux/commits/main --jq '.sha[0:7]'
```

Expected: push succeeds; the API prints `82d93b0`.

- [ ] **Step 5: Mark it a template and confirm**

Run:

```bash
gh repo edit reddoorla/reddoor-starter-blux --template
gh repo view reddoorla/reddoor-starter-blux --json isTemplate,defaultBranchRef --jq '"template=\(.isTemplate) default=\(.defaultBranchRef.name)"'
```

Expected: `template=true default=main`

- [ ] **Step 6: Record the snapshot in the spec changelog**

In `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/starter-split/docs/superpowers/specs/2026-08-31-starter-track-split-design.md`, replace the last changelog bullet's tail `the Blux snapshot SHA is recorded here when step 2 runs.` with `the Blux snapshot (\`reddoor-starter-blux\` main) is that same commit, \`82d93b0\`, pushed <today's date>.` Commit:

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/starter-split
git add docs/superpowers/specs/2026-08-31-starter-track-split-design.md
git commit -m "docs(starter-split): record the Blux snapshot SHA"
```

### Task 2: Bootstrap commit on the Blux repo

**Files:**

- Modify: `/Users/tuckerlemos/Documents/GitHub/reddoor-starter-blux/package.json:2`
- Modify: `/Users/tuckerlemos/Documents/GitHub/reddoor-starter-blux/.github/workflows/ci.yml:14`
- Modify: `/Users/tuckerlemos/Documents/GitHub/reddoor-starter-blux/README.md:1-5`

- [ ] **Step 1: Clone**

Run:

```bash
cd /Users/tuckerlemos/Documents/GitHub
gh repo clone reddoorla/reddoor-starter-blux
cd reddoor-starter-blux && git log --oneline -1
```

Expected: `82d93b0 Merge pull request #103 from reddoorla/feat/testimonial-cta-banner`

- [ ] **Step 2: Rename the package and the CI deploy-preview site**

Run:

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-starter-blux
sed -i '' 's/"name": "sveltekit-prismic-starter-t-lemos"/"name": "sveltekit-prismic-starter-blux"/' package.json
sed -i '' 's/netlify-site: "reddoor-wireframer"/netlify-site: "reddoor-starter-blux"/' .github/workflows/ci.yml
grep -n '"name"' package.json | head -1; grep -n 'netlify-site' .github/workflows/ci.yml
```

Expected: `2:  "name": "sveltekit-prismic-starter-blux",` and `14:      netlify-site: "reddoor-starter-blux"`.

Note: `netlify-site` only feeds the deploy-preview comment URL in the reusable CI (`reddoorla/.github` ci.yml v1.3.0, input default = repo name); no Netlify site is required for CI to pass.

- [ ] **Step 3: Replace the README's title + purpose with the Blux-track banner**

Replace lines 1–5 of `README.md` (currently `# Reddoor Starter and Site Scaffold` … `A forkable starting point for all SvelteKit, Tailwind + Prismic sites developed at Reddoor.`) with:

```markdown
# Reddoor Starter — Blux migration track

> This is the **Blux track** of [reddoor-starter](https://github.com/reddoorla/reddoor-starter):
> a full-history snapshot of the native template taken 2026-08-31 (`82d93b0`)
> that keeps the Blux render layer (`src/lib/blux*`, the `Blux*` slices, the
> frozen-page route, the-pointe fidelity gates). It is the render target of
> `reddoor-maintenance/src/blux` and the template for Blux-migrated sites
> (`/new-site <slug> --track blux`).
>
> **Merge direction is one way:** pull shared improvements with
> `git merge starter/main` (remote `starter` = the native repo). Never merge
> this repo back into `reddoor-starter`; re-apply a generic fix there as its
> own PR.

## Purpose

The forkable starting point for SvelteKit, Tailwind + Prismic sites that are
migrated from the Blux platform.
```

Run: `sed -n '1,5p' README.md`
Expected: the first five lines above.

- [ ] **Step 4: Commit and push straight to `main` (no protection yet — see Task 3)**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-starter-blux
git add package.json .github/workflows/ci.yml README.md
git commit -m "chore: bootstrap the Blux-track template (name, CI preview site, README banner)"
git push origin main
```

- [ ] **Step 5: Verify CI on the new repo**

Run (poll until a conclusion appears; the run takes ~5 min):

```bash
gh run list -R reddoorla/reddoor-starter-blux --branch main --limit 1 --json conclusion,status,headSha --jq '.[0]'
```

Expected: `{"conclusion":"success","status":"completed","headSha":"<bootstrap sha>"}`. A failure here is a real regression in the snapshot (it was green at `82d93b0`) — investigate before continuing.

### Task 3: Protect the Blux repo and wire the forward-merge remote

**Files:** none.

- [ ] **Step 1: Apply protection via the recipe (never hand-rolled)**

Run:

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance
node dist/cli/bin.js self-updating /Users/tuckerlemos/Documents/GitHub/reddoor-starter-blux
```

Expected: the recipe reports classic protection + the canonical ruleset applied and auto-merge off. The `ci / ci` required check self-adds on a later pass once observed — do not force it.

- [ ] **Step 2: Add the native repo as the `starter` remote**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-starter-blux
git remote add starter https://github.com/reddoorla/reddoor-starter.git
git fetch -q starter
git remote -v | grep starter | head -1
```

Expected: `starter	https://github.com/reddoorla/reddoor-starter.git (fetch)`

---

## Leg B — Native-ize `reddoor-starter`

### Task 4: Worktree, install, and move the chrome types out of `$lib/blux`

**Files:**

- Move: `src/lib/blux/site-config.ts` → `src/lib/site-config.ts`
- Move: `src/lib/blux/site-config.json` → `src/lib/site-config.json`
- Move: `src/lib/blux/site-config.test.ts` → `src/lib/site-config.test.ts` (content unchanged; its relative import keeps resolving)
- Modify: `src/lib/components/Nav.svelte:5`
- Modify: `src/lib/components/Footer.svelte:3-8`
- Modify: `src/routes/+layout.svelte:13,21-24,42-47`

- [ ] **Step 1: Create the branch worktree and install**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-starter
git fetch -q origin
git worktree add .claude/worktrees/native-template -b feat/native-template origin/main
cd .claude/worktrees/native-template
pnpm install --frozen-lockfile
pnpm check 2>&1 | tail -2
```

Expected: install completes; `svelte-check found 0 errors and 0 warnings` (baseline is green).

All following Leg B steps run from `/Users/tuckerlemos/Documents/GitHub/reddoor-starter/.claude/worktrees/native-template`.

- [ ] **Step 2: Move the two files**

```bash
git mv src/lib/blux/site-config.ts src/lib/site-config.ts
git mv src/lib/blux/site-config.json src/lib/site-config.json
git mv src/lib/blux/site-config.test.ts src/lib/site-config.test.ts
```

Note: from this commit until Task 7 deletes them, `src/routes/dev/blux-frozen` and `tests/gate/frozen-fidelity.spec.ts` are knowingly broken (the layout no longer honours `page.data.frozen`). The branch merges as a whole; never cherry-pick this commit alone.

- [ ] **Step 3: Rewrite `src/lib/site-config.ts`'s header + import**

Replace lines 1–6 (the comment block and `import config from "./site-config.json";`) with:

```ts
// Site chrome (navigation + footer) from a checked-in JSON stub. The starter
// ships it empty, so a fresh site renders the logo-only Nav + placeholder
// Footer; a site fills it in (or replaces it with a Prismic `settings`
// document — the VLF build does that first, and upstreams it).
import config from "./site-config.json";
```

Then replace the `loadSiteConfig` doc comment `/** The checked-in site config (empty until \`blux convert\`). _/`with`/_* The checked-in site config (empty on a fresh site). _/`, and in the `SiteConfig.footer.columns`comment replace the three lines starting`// Leasing-contact columns from the catalog chrome emit.`with`// Optional link columns. Absent on the stub.`. Also replace the `footerColumns`doc comment (the 6-line`/_* Resolve the footer columns … drop their real footer. */`) with:

```ts
/** Resolve the footer columns for a route: per-route page data wins, else the
 *  site-config chrome. Undefined when neither supplies columns — <Footer>
 *  renders its placeholder. */
```

Run: `grep -n -i 'blux\|catalog\|leasing' src/lib/site-config.ts`
Expected: no output.

- [ ] **Step 4: Repoint the three importers**

```bash
sed -i '' 's#from "\$lib/blux/site-config"#from "$lib/site-config"#' src/lib/components/Nav.svelte src/lib/components/Footer.svelte src/routes/+layout.svelte
grep -rn 'lib/blux/site-config' src; echo "exit=$?"
```

Expected: `exit=1` (no matches).

- [ ] **Step 5: Drop the frozen bare-render branch from the layout**

In `src/routes/+layout.svelte`:

1. Replace the comment at lines 21–23 (`// Site chrome from the Blux convert (empty stub on an unconverted starter →` … `// precedence over this in each chrome component.`) with:

```ts
// Site chrome from src/lib/site-config.json (empty stub → logo-only Nav +
// placeholder Footer). A route's own page data takes precedence in each
// chrome component.
```

2. Delete the block from `{#if page.data.frozen}` through `{:else}` (5 lines: the `{#if}`, the 3-line comment, the `{@render children?.()}`, and the `{:else}` line), and delete the matching `{/if}` that sits immediately before `{#if data.isPreviewSession}`.
3. Replace the chrome comment (`<!-- Chrome renders from page data when a route supplies it (a migrated Blux` … `existing routes are unaffected. -->`) with:

```svelte
  <!-- Chrome renders from page data when a route supplies navLinks/footerColumns,
       else from the site-config stub. Each component applies its own
       page-data-over-config precedence. -->
```

Run: `grep -n -i 'blux\|frozen' src/routes/+layout.svelte; pnpm check 2>&1 | tail -1`
Expected: no grep output; `svelte-check found 0 errors and 0 warnings`.

- [ ] **Step 6: Commit**

```bash
git add -A src/lib/site-config.ts src/lib/site-config.json src/lib/blux src/lib/components/Nav.svelte src/lib/components/Footer.svelte src/routes/+layout.svelte
git commit -m "refactor(chrome): move site-config out of \$lib/blux; layout drops the frozen branch"
```

### Task 5: Plain Prismic loaders — routes, sitemap, client, page-meta

**Files:**

- Create: `src/lib/page-meta.ts`
- Rewrite: `src/routes/[[preview=preview]]/+page.server.ts`
- Rewrite: `src/routes/[[preview=preview]]/+page.svelte`
- Rewrite: `src/routes/[[preview=preview]]/[uid]/+page.server.ts`
- Rewrite: `src/routes/[[preview=preview]]/[uid]/+page.svelte`
- Rewrite: `src/routes/sitemap.xml/+server.ts`
- Modify: `src/lib/prismicio.ts`

- [ ] **Step 1: Confirm the generated types export the union the client will use**

Run: `grep -n 'export type AllDocumentTypes' src/prismicio-types.d.ts`
Expected: one line. (If absent, use `prismic.createClient(repositoryName, config)` without the generic in Step 3 and cast `as PageDocument` at each `getByUID` — but it is present in every Slice Machine-generated file.)

- [ ] **Step 2: Create `src/lib/page-meta.ts`**

```ts
import { asText } from "@prismicio/client";

import type { PageDocument } from "../prismicio-types";

/** The layout's SEO/head payload for a page document (see <Seo> in
 *  +layout.svelte). Shared by both `[[preview]]` loaders so the two stay
 *  identical. */
export function pageMeta(page: PageDocument) {
  return {
    title: asText(page.data.title),
    meta_description: page.data.meta_description,
    meta_title: page.data.meta_title,
    meta_image: page.data.meta_image?.url,
    meta_image_alt: page.data.meta_image?.alt ?? undefined,
  };
}
```

- [ ] **Step 3: Rewrite `src/lib/prismicio.ts`**

```ts
import * as prismic from "@prismicio/client";
import { enableAutoPreviews, type CreateClientConfig } from "@prismicio/svelte/kit";
import config from "../../slicemachine.config.json";
import type { AllDocumentTypes } from "../prismicio-types";

export const repositoryName = import.meta.env.VITE_PRISMIC_ENVIRONMENT || config.repositoryName;

/**
 * True when the starter has not yet been wired to a real Prismic repository.
 * Prerender entry points (sitemap, dynamic [uid]) short-circuit to empty
 * results in that case so `pnpm build` succeeds on an unconfigured clone.
 */
export const isPlaceholderRepo = repositoryName === "your-prismic-repo-name";

/**
 * Every client is routes-free — deliberately. Prismic's routes resolver
 * validates each `routes` entry against the repo's DOC-BEARING types and
 * rejects EVERY query with a 400 when any entry misses, so a routes config
 * breaks a repo that has not yet published one of the named types (observed
 * live 2026-07-28). Without routes, `getAllByType` on an absent type resolves
 * to an empty list instead of erroring. The cost is that the API no longer
 * fills `doc.url`/`link.url` for content-relationship fields; nothing in the
 * starter reads those today (web-type links carry their own URL), and
 * `linkResolver` below is the local replacement to pass to `asLink` when a
 * consumer does need one.
 */
export const linkResolver: prismic.LinkResolverFunction = (doc) => {
  if (doc.type === "page" && doc.uid) {
    return doc.uid === "home" ? "/" : `/${doc.uid}`;
  }
  return null;
};

export const createClient = ({ cookies, ...config }: CreateClientConfig = {}) => {
  const client = prismic.createClient<AllDocumentTypes>(repositoryName, config);

  enableAutoPreviews({ client, cookies });

  return client;
};
```

- [ ] **Step 4: Rewrite the root route loader `src/routes/[[preview=preview]]/+page.server.ts`**

```ts
import { error } from "@sveltejs/kit";

import { pageMeta } from "$lib/page-meta";
import { createClient, isPlaceholderRepo } from "$lib/prismicio";

export async function load({ fetch, cookies }) {
  const client = createClient({ fetch, cookies });

  try {
    // The homepage is the `page` document with uid "home".
    const page = await client.getByUID("page", "home");
    return { page, ...pageMeta(page) };
  } catch {
    error(404, { message: "Page not found" });
  }
}

// On an unconfigured starter, skip prerendering "/" — the load above would
// 404 on the placeholder repo and fail the build. Real sites still prerender
// the home route normally.
export function entries() {
  return isPlaceholderRepo ? [] : [{}];
}
```

- [ ] **Step 5: Rewrite `src/routes/[[preview=preview]]/+page.svelte`**

```svelte
<script lang="ts">
  import { SliceZone } from "@prismicio/svelte";
  import { components } from "$lib/slices";

  let { data } = $props();
</script>

<SliceZone slices={data.page.data.slices} {components} />
```

- [ ] **Step 6: Rewrite `src/routes/[[preview=preview]]/[uid]/+page.server.ts`**

```ts
import { error, redirect } from "@sveltejs/kit";

import { pageMeta } from "$lib/page-meta";
import { createClient, isPlaceholderRepo } from "$lib/prismicio";

export async function load({ params, fetch, cookies }) {
  if (params.uid === "home") redirect(308, "/");

  const client = createClient({ fetch, cookies });

  try {
    const page = await client.getByUID("page", params.uid);
    return { page, ...pageMeta(page) };
  } catch {
    error(404, { message: "Page not found" });
  }
}

// Prerender every page document at its real route. "home" renders at "/" via
// the root route, so it is excluded here. Empty on an unconfigured starter so
// `pnpm build` succeeds before the Prismic repo is wired.
export async function entries() {
  if (isPlaceholderRepo) return [];

  const pages = await createClient().getAllByType("page");
  return pages.filter((page) => page.uid !== "home").map((page) => ({ uid: page.uid }));
}
```

- [ ] **Step 7: Rewrite `src/routes/[[preview=preview]]/[uid]/+page.svelte`**

```svelte
<script lang="ts">
  import { SliceZone } from "@prismicio/svelte";
  import { components } from "$lib/slices";

  let { data } = $props();
</script>

<SliceZone slices={data.page.data.slices} {components} />
```

- [ ] **Step 8: Rewrite `src/routes/sitemap.xml/+server.ts`**

```ts
import { createClient, isPlaceholderRepo } from "$lib/prismicio";
import type { RequestHandler } from "./$types";

export const prerender = true;

export const GET: RequestHandler = async ({ fetch, url }) => {
  const origin = url.origin;

  // One entry per page document ("home" renders at "/"). Empty on an
  // unconfigured starter so the prerender succeeds before Prismic is wired.
  const entries: { path: string; lastmod: string }[] = isPlaceholderRepo
    ? []
    : (await createClient({ fetch }).getAllByType("page")).map((page) => ({
        path: page.uid === "home" ? "/" : `/${page.uid}`,
        lastmod: new Date(page.last_publication_date ?? Date.now()).toISOString(),
      }));

  const urls = entries.map(
    ({ path, lastmod }) => `  <url>
    <loc>${origin}${path}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>`,
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml" },
  });
};
```

- [ ] **Step 9: Type-check and run the route-adjacent unit tests**

Run: `pnpm check 2>&1 | tail -1 && pnpm vitest run src/lib/seo src/lib/components/Seo 2>&1 | tail -3`
Expected: `svelte-check found 0 errors and 0 warnings`; tests pass. (The Blux suites still exist and still pass — nothing they import has moved except `site-config`, which Task 4 handled; if `src/lib/blux-frozen/artifacts.test.ts` or a route test now fails on the missing `isFrozenSite`, that is expected — they are deleted in Task 7.)

- [ ] **Step 10: Commit**

```bash
git add src/lib/page-meta.ts src/lib/prismicio.ts src/routes/sitemap.xml/+server.ts "src/routes/[[preview=preview]]"
git commit -m "refactor(routes): plain Prismic page loaders — no catalog/frozen probing"
```

### Task 6: Strip the `band` branch from the seven band-coupled slices

**Files:**

- Rewrite: `src/lib/slices/{Hero,RichText,TextColumns,Accordion,LeadText,Testimonial,CtaBanner}/index.svelte`
- Modify: the same seven `model.json` files (programmatic)
- Delete: `src/lib/slices/Hero/HeroBand.test.ts`, `src/lib/slices/RichText/RichTextBand.test.ts`
- Create: `src/lib/slices/RichText/RichText.test.ts`
- Modify: `band: null` fixture lines in `src/lib/slices/{TextColumns,Accordion,LeadText,Testimonial,CtaBanner}/*.test.ts` and `src/routes/dev/a11y-fixtures/+page.svelte`

`MediaText` and `SectionGrid` import nothing from `$lib/blux` — untouched.

- [ ] **Step 1: `src/lib/slices/Hero/index.svelte`** (the `default` variation only)

```svelte
<script lang="ts">
  import HeroBackgroundImage from "$lib/components/HeroBackgroundImage.svelte";
  import RichTextBody from "$lib/components/RichTextBody.svelte";
  import ContentBand from "$lib/components/ContentBand.svelte";
  import { PrismicLink, PrismicRichText } from "@prismicio/svelte";
  import type { Content } from "@prismicio/client";

  let { slice }: { slice: Content.HeroSlice } = $props();

  let hasImage = $derived(!!slice.primary.background_image?.url);
</script>

<!-- Full-bleed image band. When the slice carries a background image we
     stand the band 45vh tall so the photo shows; white overlay copy comes
     from the section class. -->
<ContentBand
  sliceType={slice.slice_type}
  variation={slice.variation}
  fallbackHeight={hasImage ? "45vh" : undefined}
  sectionClass="hero-band relative isolate overflow-hidden bg-neutral-900 text-white"
  contentClass="relative z-10 max-w-4xl px-6 py-24 text-center"
>
  {#snippet background()}
    {#if hasImage}
      <HeroBackgroundImage
        image={slice.primary.background_image}
        preload={false}
      />
    {/if}
  {/snippet}
  <PrismicRichText field={slice.primary.heading} />
  <RichTextBody field={slice.primary.body} />
  {#if slice.primary.cta_label && slice.primary.cta_link}
    <PrismicLink
      field={slice.primary.cta_link}
      class="mt-6 inline-block bg-white px-6 py-3 font-medium text-black"
    >
      {slice.primary.cta_label}
    </PrismicLink>
  {/if}
</ContentBand>
```

- [ ] **Step 2: `src/lib/slices/RichText/index.svelte`**

```svelte
<script lang="ts">
  import RichTextBody from "$lib/components/RichTextBody.svelte";
  import ContentBand from "$lib/components/ContentBand.svelte";
  import type { Content } from "@prismicio/client";

  let { slice }: { slice: Content.RichTextSlice } = $props();
</script>

<!-- Standalone copy blocks are centered section openers and interstitial
     blurbs — centered, on a comfortable measure. -->
<ContentBand
  sliceType={slice.slice_type}
  variation={slice.variation}
  contentClass="richtext-block max-w-3xl px-6 py-10 text-center"
>
  <RichTextBody field={slice.primary.content} />
</ContentBand>
```

- [ ] **Step 3: `src/lib/slices/TextColumns/index.svelte`**

```svelte
<script lang="ts">
  import RichTextBody from "$lib/components/RichTextBody.svelte";
  import ContentBand from "$lib/components/ContentBand.svelte";
  import type { RichTextField } from "@prismicio/client";

  type Column = { title?: string | null; body: RichTextField };
  type Props = {
    slice: {
      slice_type: string;
      variation?: string;
      primary: {
        eyebrow?: string | null;
        hasTopRule?: boolean | null;
        desktopColumns?: "2" | "3" | "4" | null;
        columns: Column[];
      };
    };
  };
  let { slice }: Props = $props();

  // Full class strings (not interpolated) so the Tailwind scanner keeps them.
  const columnsClass = $derived(
    (
      {
        "2": "md:grid-cols-2",
        "3": "md:grid-cols-3",
        "4": "md:grid-cols-4",
      } as Record<string, string>
    )[slice.primary.desktopColumns ?? "3"] ?? "md:grid-cols-3",
  );

  // With an eyebrow, that h2 is the section heading and column titles are its h3
  // children; without one the titles are the headings → promote to h2 so an
  // eyebrow-less instance never skips a level.
  const titleTag = $derived(slice.primary.eyebrow ? "h3" : "h2");
</script>

<ContentBand
  sliceType={slice.slice_type}
  variation={slice.variation}
  contentClass="richtext-block max-w-5xl px-6 py-10"
>
  {#if slice.primary.eyebrow || slice.primary.hasTopRule}
    <div
      class="mb-6 {slice.primary.hasTopRule
        ? 'border-b border-light pb-2.5'
        : ''}"
    >
      {#if slice.primary.eyebrow}
        <h2
          class="text-sm font-semibold tracking-wide text-secondary uppercase"
        >
          {slice.primary.eyebrow}
        </h2>
      {/if}
    </div>
  {/if}

  <div class="grid grid-cols-1 gap-10 {columnsClass}">
    <!-- Key by index: title is optional + non-unique, so keying on it would
         throw each_key_duplicate on a blank/repeated title. -->
    {#each slice.primary.columns as column, i (i)}
      <div>
        {#if column.title}
          <svelte:element
            this={titleTag}
            class="mb-2 text-lg font-semibold text-primary"
          >
            {column.title}
          </svelte:element>
        {/if}
        <RichTextBody field={column.body} />
      </div>
    {/each}
  </div>
</ContentBand>
```

- [ ] **Step 4: `src/lib/slices/Accordion/index.svelte`**

```svelte
<script lang="ts">
  import Accordion from "$lib/components/Accordion.svelte";
  import ContentBand from "$lib/components/ContentBand.svelte";

  // Thin slice over the shared, already-accessible Accordion primitive
  // ($lib/components/Accordion.svelte — button[aria-expanded]+aria-controls,
  // role=region, index-keyed). Body is plain text to match the primitive.
  type Item = { title?: string | null; body?: string | null };
  type Props = {
    slice: {
      slice_type: string;
      variation?: string;
      primary: {
        allowMultiple?: boolean | null;
        items: Item[];
      };
    };
  };
  let { slice }: Props = $props();

  const items = $derived(
    (slice.primary.items ?? []).map((i) => ({
      label: i.title ?? "",
      content: i.body ?? "",
    })),
  );
</script>

<ContentBand
  sliceType={slice.slice_type}
  variation={slice.variation}
  contentClass="max-w-3xl px-6 py-10"
>
  <Accordion {items} allowMultiple={slice.primary.allowMultiple ?? true} />
</ContentBand>
```

- [ ] **Step 5: `src/lib/slices/LeadText/index.svelte`**

```svelte
<script lang="ts">
  import RichTextBody from "$lib/components/RichTextBody.svelte";
  import ContentBand from "$lib/components/ContentBand.svelte";
  import type { RichTextField } from "@prismicio/client";

  // Inline prop types (the generated Content.* types don't include this slice
  // until it's pushed to a wired Prismic repo), mirroring the sibling slices.
  type Props = {
    slice: {
      slice_type: string;
      variation?: string;
      primary: {
        eyebrow?: string | null;
        body: RichTextField;
      };
    };
  };
  let { slice }: Props = $props();
</script>

<!-- A labelled lead paragraph: a small eyebrow above the opening copy. Plain,
     token-driven styling so a site can restyle it freely. -->
<ContentBand
  sliceType={slice.slice_type}
  variation={slice.variation}
  contentClass="richtext-block max-w-2xl px-6 py-10"
>
  {#if slice.primary.eyebrow}
    <!-- The eyebrow names the section → it's the section heading (h2). -->
    <h2
      class="mb-3 text-sm font-semibold tracking-wide text-secondary uppercase"
    >
      {slice.primary.eyebrow}
    </h2>
  {/if}
  <div class="text-lg">
    <RichTextBody field={slice.primary.body} />
  </div>
</ContentBand>
```

- [ ] **Step 6: `src/lib/slices/Testimonial/index.svelte`** — keep lines 19–33 (the avatar derivations), 36–40 (the semantic comment), 42–96 (the `<ContentBand>` … `</ContentBand>` body) and 111–125 (`<style>`) exactly as they are; only the script header and the wrapper change:

```svelte
<script lang="ts">
  import ContentBand from "$lib/components/ContentBand.svelte";
  import { PrismicImage } from "@prismicio/svelte";
  import { isFilled, type Content, type ImageField } from "@prismicio/client";
  import { resolveAvatarAlt } from "./avatarAlt";

  type Props = { slice: Content.TestimonialSlice };
  let { slice }: Props = $props();

  const avatar = $derived(slice.primary.avatar);
  const hasAvatar = $derived(isFilled.image(avatar));
  // PrismicImage takes its alt off the field, so the name fallback is written
  // back onto the field rather than passed as a prop (see ./avatarAlt.ts).
  const avatarAlt = $derived(resolveAvatarAlt(avatar?.alt, slice.primary.name));
  const avatarField = $derived({ ...avatar, alt: avatarAlt } as ImageField);
  const hasCredit = $derived(
    Boolean(slice.primary.name || slice.primary.role || hasAvatar),
  );
  // A filled avatar with nothing beside it naming the person is the one case
  // where the credit carries no text at all — give assistive tech the resolved
  // alt as visually-hidden text so the figure is never a bare, silent image.
  const needsSrName = $derived(
    hasAvatar && !slice.primary.name && !slice.primary.role && !!avatarAlt,
  );
</script>

<!-- An attributed pull quote. figure/blockquote/figcaption is the semantic
     pattern; the credited name is deliberately NOT a heading (it does not title
     a section, and marking it as one would both break the page outline and pick
     up whatever type scale the project defines for headings). The optional
     label DOES name the section, so it is the h2 — same call as LeadText. -->
<ContentBand
  sliceType={slice.slice_type}
  variation={slice.variation}
  contentClass="max-w-3xl px-6 py-10"
>
  … (lines 47–95 of the current file, unchanged: the label h2, the figure) …
</ContentBand>

<style>
  … (lines 112–124 of the current file, unchanged) …
</style>
```

Concretely: delete lines 3–4 (the two `$lib/blux` imports), replace lines 9–17 (`type Props` … the `band` derived) with the two-line `type Props`/`let { slice }` above, delete the `{#snippet content()}` line (41) and its closing `{/snippet}` (97), de-indent nothing (Prettier will reflow), and delete lines 99–109 (`{#if band}` … `{/if}`).

- [ ] **Step 7: `src/lib/slices/CtaBanner/index.svelte`**

```svelte
<script lang="ts">
  import RichTextBody from "$lib/components/RichTextBody.svelte";
  import ContentBand from "$lib/components/ContentBand.svelte";
  import {
    buttonBaseClasses,
    buttonSkinClasses,
    buttonSkinInverseClasses,
  } from "$lib/components/DefaultButton.svelte";
  import { PrismicLink } from "@prismicio/svelte";
  import { isFilled, type Content } from "@prismicio/client";

  type Props = { slice: Content.CtaBannerSlice };
  let { slice }: Props = $props();

  const background = $derived(slice.primary.background ?? "light");
  const onDark = $derived(background === "dark");

  // Full literal class strings so the Tailwind scanner keeps them. The palette
  // is the starter's placeholder theme (app.css `@theme`) — swap the tokens
  // per project, not the markup.
  const groundClass = $derived(
    (
      {
        light: "bg-light text-primary",
        dark: "bg-dark text-white",
        white: "bg-white text-primary",
      } as Record<string, string>
    )[background] ?? "bg-light text-primary",
  );

  const hasButton = $derived(
    isFilled.link(slice.primary.buttonLink) && !!slice.primary.buttonLabel,
  );
  // PrismicLink emits a plain <a> (with target/rel when the field asks for
  // them) wearing the shared button skin. Never a <button> inside a link —
  // that is axe's `nested-interactive` violation.
  const buttonClass = $derived(
    `${buttonBaseClasses} ${onDark ? buttonSkinInverseClasses : buttonSkinClasses} shrink-0`,
  );
</script>

<!-- A closing call-to-action band: one headline, one link. Deliberately
     unstyled beyond the theme tokens — the heading's size comes from the
     project's own h2 rule (app.css leaves the type scale blank), and
     RichTextBody keeps the announced level gap-free without touching the tag,
     so the visual never drifts from the outline. -->
<ContentBand
  sliceType={slice.slice_type}
  variation={slice.variation}
  sectionClass={groundClass}
  contentClass="flex max-w-5xl flex-col items-start gap-8 px-6 py-16 md:flex-row md:items-center md:justify-between"
>
  {#if isFilled.richText(slice.primary.heading)}
    <div class="max-w-2xl">
      <RichTextBody field={slice.primary.heading} />
    </div>
  {/if}

  {#if hasButton}
    <PrismicLink field={slice.primary.buttonLink} class={buttonClass}>
      {slice.primary.buttonLabel}
    </PrismicLink>
  {/if}
</ContentBand>
```

- [ ] **Step 8: Remove `band` from the seven models programmatically**

```bash
python3 - <<'EOF'
import json
slices = ["Hero","RichText","TextColumns","Accordion","LeadText","Testimonial","CtaBanner"]
for s in slices:
    p = f"src/lib/slices/{s}/model.json"
    d = json.load(open(p))
    d["variations"] = [v for v in d["variations"] if v["id"] != "band"]
    for v in d["variations"]:
        v.get("primary", {}).pop("band", None)
    json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
    open(p, "a").write("\n")
    print(s, [v["id"] for v in d["variations"]], "band" in json.dumps(d))
EOF
```

Expected output, one line per slice, each ending in `False`; `Hero ['default'] False`.

- [ ] **Step 9: Delete the band-only tests and add a native RichText test**

```bash
git rm -q src/lib/slices/Hero/HeroBand.test.ts src/lib/slices/RichText/RichTextBand.test.ts
```

Create `src/lib/slices/RichText/RichText.test.ts`:

```ts
import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import RichText from "./index.svelte";

afterEach(() => cleanup());

const slice = {
  slice_type: "rich_text",
  variation: "default",
  primary: {
    content: [{ type: "paragraph", text: "Body copy from Prismic", spans: [] }],
  },
  items: [],
} as never;

describe("RichText slice", () => {
  it("renders the copy inside a single tagged section", () => {
    const { container } = render(RichText, { props: { slice } });
    const sections = container.querySelectorAll("section");
    expect(sections).toHaveLength(1);
    expect(sections[0].getAttribute("data-slice-type")).toBe("rich_text");
    expect(sections[0].textContent).toContain("Body copy from Prismic");
  });
});
```

- [ ] **Step 10: Drop `band: null` from the remaining fixtures and any `context` props**

```bash
sed -i '' '/^[[:space:]]*band: null,[[:space:]]*$/d' \
  src/lib/slices/TextColumns/TextColumns.test.ts \
  src/lib/slices/Accordion/Accordion.test.ts \
  src/lib/slices/LeadText/LeadText.test.ts \
  src/lib/slices/Testimonial/Testimonial.test.ts \
  src/lib/slices/CtaBanner/CtaBanner.test.ts \
  src/routes/dev/a11y-fixtures/+page.svelte
grep -rn 'band\b\|presentation' src/lib/slices/{Hero,RichText,TextColumns,Accordion,LeadText,Testimonial,CtaBanner} src/routes/dev/a11y-fixtures/+page.svelte | grep -v 'hero-band\|ContentBand\|nothing but the band'
```

Expected: no output. If a test still passes `context: { presentation: … }` or `context: {}` to `render(...)`, delete that `context` property from the props object (the slices no longer accept it). The Testimonial test named "renders nothing but the band when the slice is empty" keeps its name — it asserts the empty `<section>`, which is still the behaviour.

- [ ] **Step 11: Type-check, run the slice tests, commit**

Run: `pnpm check 2>&1 | tail -1 && pnpm vitest run src/lib/slices/{Hero,RichText,TextColumns,Accordion,LeadText,Testimonial,CtaBanner} 2>&1 | tail -4`
Expected: `0 errors`; all slice test files pass.

```bash
git add -A src/lib/slices src/routes/dev/a11y-fixtures/+page.svelte
git commit -m "refactor(slices): drop the Blux band branch from the nine native slices"
```

### Task 7: Delete the Blux layer, the-pointe fixtures, gates, catalog types, and tracked process docs

**Files:**

- Delete: `src/lib/blux/`, `src/lib/blux-catalog/`, `src/lib/blux-frozen/`, `src/blux-theme.css`, `src/blux-layout.css`
- Delete: `src/lib/slices/{BluxBlock,BluxCarousel,BluxCollection,BluxEmbed,BluxGallery,BluxGrid,BluxMedia,BluxMediaText,BluxSection,BluxTable,BluxText,Carousel,Gallery,GridBand,LocationMap,MediaFull,SplitFeature,TitleBand,CollectionList}/`
- Delete: `src/routes/dev/{blux-frozen,blux-pointe,blux-page}/`, `src/routes/products/`, `src/routes/blux-*.test.ts`
- Delete: `src/lib/components/{ProductDetail,ProductListing}.svelte` + `.test.ts`
- Delete: `tests/gate/`
- Delete: `customtypes/{product,collection_item,project,event,news_article,person}/`
- Untrack: `docs/superpowers/`, `scratchpad/regen-types.mjs`
- Modify: `tests/a11y/fixtures.spec.ts:7`, `src/routes/dev/a11y-fixtures/+page.svelte` (CollectionList), `.gitignore`, `.prettierignore`, `src/app.css:4-9`

- [ ] **Step 1: Delete the code**

```bash
git rm -r -q src/lib/blux src/lib/blux-catalog src/lib/blux-frozen src/blux-theme.css src/blux-layout.css
git rm -r -q src/lib/slices/Blux{Block,Carousel,Collection,Embed,Gallery,Grid,Media,MediaText,Section,Table,Text}
git rm -r -q src/lib/slices/{Carousel,Gallery,GridBand,LocationMap,MediaFull,SplitFeature,TitleBand,CollectionList}
git rm -r -q src/routes/dev/blux-frozen src/routes/dev/blux-pointe src/routes/dev/blux-page src/routes/products
git rm -q src/routes/blux-skeleton.test.ts src/routes/blux-emit-breadth.test.ts src/routes/blux-collection-emit.test.ts
git rm -q src/lib/components/ProductDetail.svelte src/lib/components/ProductDetail.test.ts src/lib/components/ProductListing.svelte src/lib/components/ProductListing.test.ts
git rm -r -q tests/gate
git rm -r -q customtypes/product customtypes/collection_item customtypes/project customtypes/event customtypes/news_article customtypes/person
ls src/lib/slices; ls customtypes; ls src/routes/dev
```

Expected: slices = `Accordion CtaBanner Hero LeadText MediaText RichText SectionGrid Testimonial TextColumns index.js`; customtypes = `page`; dev = `a11y-fixtures animate-in`.

- [ ] **Step 2: Untrack the process docs and the scratchpad helper; make the exclusion versioned**

```bash
git rm -r -q --cached docs/superpowers scratchpad/regen-types.mjs
cat >> .gitignore <<'EOF'

# Agency process artifacts (specs/plans) and local helpers never ship in the
# template — the canonical copies live in reddoor-maintenance.
/docs/superpowers/
/scratchpad/
EOF
git ls-files docs/superpowers scratchpad | wc -l
```

Expected: `0`.

- [ ] **Step 3: Rewrite `.prettierignore`**

```
pnpm-lock.yaml
.svelte-kit/
build/
.netlify/
dist/

# Generated by Slice Machine; not hand-formatted. A prettier version bump
# reformats it and reds `prettier --check` on otherwise-fine dep-update PRs.
src/prismicio-types.d.ts

# Untracked agency process artifacts (see .gitignore).
docs/superpowers/
```

- [ ] **Step 4: Drop the Blux imports from `src/app.css`**

Replace lines 1–9 (through `@import "./blux-layout.css";`) with:

```css
/* Tailwind CSS v4 configuration */
@import "tailwindcss";
```

- [ ] **Step 5: Remove the CollectionList fixture from the a11y page and the blux route from the axe spec**

In `src/routes/dev/a11y-fixtures/+page.svelte`:

1. Delete the line `  import CollectionList from "$lib/slices/CollectionList/index.svelte";`.
2. Delete from the line `  const collectionListFixture = {` through the `  };` that closes `const collectionCtx = {` (currently lines 121–147 — verify with `sed -n '121p;147p'` before deleting: they must read `  const collectionListFixture = {` and `  };`).
3. Delete the line `  <CollectionList slice={collectionListFixture} context={collectionCtx} />`.
4. Replace the comment `  <!-- Blux-conversion slices — each renders its own <section> + heading;` with `  <!-- Prismic slices — each renders its own <section> + heading;`.

In `tests/a11y/fixtures.spec.ts`, delete line 7: `  { path: "/dev/blux-page", name: "blux band fixture" },`.

Run: `grep -n -i 'collection\|blux' src/routes/dev/a11y-fixtures/+page.svelte tests/a11y/fixtures.spec.ts`
Expected: no output.

- [ ] **Step 6: Type-check, run the whole unit suite, commit**

Run: `pnpm check 2>&1 | tail -1 && pnpm test:unit 2>&1 | tail -5`
Expected: `0 errors`; vitest reports all files passing (roughly 53 files / ~355 tests — the Blux 41 files are gone).

```bash
git add -A
git commit -m "chore(template): remove the Blux layer, the-pointe fixtures/gates, catalog types, and tracked process docs"
```

### Task 8: De-Blux the config — `svelte.config.js`, `app.css` tokens, `seo.ts`

**Files:**

- Rewrite: `svelte.config.js`
- Modify: `src/app.css` (`@theme`, comments, body/heading font, delete the Blux tail)
- Modify: `src/lib/seo.ts:1-2`

- [ ] **Step 1: Rewrite `svelte.config.js`**

```js
import { readFileSync } from "node:fs";
import adapter from "@sveltejs/adapter-netlify";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const slicemachine = JSON.parse(
  readFileSync(new URL("./slicemachine.config.json", import.meta.url), "utf-8"),
);
const isPlaceholderRepo =
  (process.env.VITE_PRISMIC_ENVIRONMENT || slicemachine.repositoryName) ===
  "your-prismic-repo-name";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    warningFilter: (warning) => warning.code !== "element_invalid_self_closing_tag",
  },
  kit: {
    adapter: adapter(),
    // Until a clone is wired to a real Prismic repo, every Prismic-backed
    // route returns 404 during prerender. Tolerate that on the placeholder
    // so `pnpm build` (and Netlify CI) succeed; real sites still fail loudly
    // because `repositoryName` no longer matches the sentinel.
    prerender: {
      // Prerendered endpoints (robots.txt, sitemap.xml) bake `url.origin` into
      // their output at build time; without this it would be SvelteKit's
      // "http://sveltekit-prerender" placeholder. Netlify sets URL to the
      // site's production origin during builds. Local builds keep the
      // placeholder, which only shows up in build/ output, never in dev.
      ...(process.env.URL ? { origin: process.env.URL } : {}),
      handleHttpError: ({ path, status, message, referrer }) => {
        if (isPlaceholderRepo && status === 404) {
          return;
        }
        throw new Error(
          `${status} ${path}${referrer ? ` (linked from ${referrer})` : ""}: ${message}`,
        );
      },
      // `/dev/*` tooling routes may carry in-page anchors that target ids on
      // fixture content, not on this site's pages. Those routes are
      // robots-excluded, so a missing id is tolerated only when every referrer
      // is a dev route — content routes keep failing loudly on a genuine
      // broken anchor.
      handleMissingId: ({ referrers, message }) => {
        if (referrers.every((r) => r.startsWith("/dev/"))) return;
        throw new Error(message);
      },
      // A malformed URL in CMS-pasted rich text (e.g. a school name typed into a
      // hyperlink) is unparseable — it can never be a real route to crawl, and
      // one editor's typo must not fail the whole build. Warn (so it surfaces
      // for cleanup) and keep prerendering. Unlike handleHttpError's fail-loud
      // 404 policy, an invalid URL has no valid interpretation to preserve.
      handleInvalidUrl: ({ href, referrer, message }) => {
        console.warn(
          `[prerender] skipped invalid URL ${JSON.stringify(href)}` +
            `${referrer ? ` (linked from ${referrer})` : ""} — fix the CMS link` +
            `${message ? ` [${message}]` : ""}`,
        );
      },
    },
    alias: {
      $components: "src/lib/components",
      "$components/*": "src/lib/components/*",
      $utils: "src/lib/utils",
      "$utils/*": "src/lib/utils/*",
      $stores: "src/lib/stores",
      "$stores/*": "src/lib/stores/*",
      $assets: "src/lib/assets",
      "$assets/*": "src/lib/assets/*",
    },
    // Baseline CSP for Prismic + Vimeo + Turnstile. EXTEND PER PROJECT — every
    // new host (web fonts, YouTube, a donation platform, analytics, Maps) must
    // be added to the relevant directive or the browser blocks it silently.
    // SvelteKit adds nonces/hashes for the inline scripts and styles it emits.
    csp: {
      mode: "auto",
      // Violations POST to /api/csp-report. To stage a stricter policy without
      // blocking, copy `directives` below into a sibling `reportOnly: { ... }`
      // block — SvelteKit will then emit a Content-Security-Policy-Report-Only
      // header alongside the enforced one.
      directives: {
        "default-src": ["self"],
        "script-src": [
          "self",
          "https://static.cdn.prismic.io",
          "https://player.vimeo.com",
          // Cloudflare Turnstile contact-form widget (enable via PUBLIC_TURNSTILE_SITE_KEY).
          "https://challenges.cloudflare.com",
        ],
        // Google Fonts stylesheet host (paired with fonts.gstatic.com under
        // font-src). Self-hosted fonts need nothing extra.
        "style-src": ["self", "unsafe-inline", "https://fonts.googleapis.com"],
        "img-src": ["self", "data:", "https://images.prismic.io", "https://*.prismic.io"],
        // Prismic hosts non-image media (e.g. .mp4 assets) on
        // <repo>.cdn.prismic.io — first-party content, same origin family as
        // images.prismic.io already allowed under img-src.
        "media-src": ["self", "https://*.vimeocdn.com", "https://*.prismic.io"],
        "frame-src": [
          "self",
          "https://player.vimeo.com",
          // Cloudflare Turnstile renders its challenge in an iframe from this host.
          "https://challenges.cloudflare.com",
        ],
        "connect-src": ["self", "https://*.prismic.io", "https://static.cdn.prismic.io"],
        "font-src": ["self", "data:", "https://fonts.gstatic.com"],
        "base-uri": ["self"],
        "form-action": ["self"],
        "frame-ancestors": ["self"],
        "report-uri": ["/api/csp-report"],
      },
    },
  },
  preprocess: vitePreprocess(),
};

export default config;
```

- [ ] **Step 2: `src/app.css` — tokens**

Replace the `@theme` block's palette comment + five colour lines (currently `  /* Neutral placeholder palette — replace per project */` through `  --color-accent: #111827;`) with:

```css
/* Neutral placeholder palette — replace per project (docs/STARTER.md). Every
     value is distinct on purpose so a forgotten token is visible, not silent. */
--color-light: #e5e7eb;
--color-primary: #111827;
--color-dark: #1f2937;
--color-secondary: #6b7280;
--color-accent: #2563eb;

/* Type — set per project. Self-host the brand's licensed woff2 files under
     static/fonts (preload the body face in app.html) or load a kit, then
     point these at the loaded family names. Until then the system stack
     applies. `font-heading` / `font-body` utilities come from these tokens. */
--font-heading: ui-sans-serif, system-ui, sans-serif;
--font-body: ui-sans-serif, system-ui, sans-serif;
```

- [ ] **Step 3: `src/app.css` — wire the tokens into base type**

In `@layer base`, replace `    font-family: "helvetica", sans-serif;` (inside `body {`) with `    font-family: var(--font-body);`, and replace the comment line `  /* Type scale — define per project (h1–h6, p, responsive variants). */` with:

```css
/* Type scale — define per project (sizes, leading, responsive variants). */
h1,
h2,
h3,
h4,
h5,
h6 {
  font-family: var(--font-heading);
}
```

- [ ] **Step 4: `src/app.css` — reword the slice-layout comment and delete the Blux tail**

Replace the four-line comment starting `/* Generic Blux slice layout — support rules the manifest-driven slice` (ending `per-slice type + band styling comes from the styles manifest, not here. */`) with:

```css
/* Layout hooks shared by the hand-authored slices (`.mt-media`, `.hero-band`,
   `.richtext-block`). Site-neutral; per-project type and colour come from the
   @theme tokens above. */
```

Then delete everything from the line `/* ── Blux text-role scale (convention) ──` to the end of the file (the text-role commentary, `.ib`, `.links`, the `.txt-role-*` placeholders, and `.band-pad` + its media query). The file must end with the closing `}` of `@layer base`.

Run: `grep -n -i 'blux\|txt-role\|band-pad\|\.ib\b' src/app.css; tail -3 src/app.css`
Expected: no grep output; the tail shows the `.add-noise::after` block closing followed by `}`.

- [ ] **Step 5: `src/lib/seo.ts` header**

Replace lines 1–2 with:

```ts
// Site-wide SEO configuration + helpers.
// PER-SITE: `/new-site` sets SITE_NAME, SITE_LOCALE and DEFAULT_OG_IMAGE (and
// sites with a social presence fill in organizationJsonLd in the layout).
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm check 2>&1 | tail -1 && pnpm build 2>&1 | tail -3 && ls build/dev`
Expected: `0 errors`; build succeeds; `build/dev` lists `a11y-fixtures.html animate-in.html` only.

```bash
git add svelte.config.js src/app.css src/lib/seo.ts
git commit -m "chore(config): drop the frozen/Maps CSP branches; add font tokens; mark seo.ts per-site"
```

### Task 9: Slice registry, page type, Lighthouse, README split

**Files:**

- Rewrite: `src/lib/slices/index.js`
- Modify: `customtypes/page/index.json` (choices), `customtypes/page/mocks.json` (check)
- Modify: `lighthouserc.json:4`
- Move: `README.md` → `docs/STARTER.md` (dedupe), Create: `README.md`

- [ ] **Step 1: `src/lib/slices/index.js`** (the file is the plain import + `export const components` form — verified 2026-08-31; keep that shape)

```js
import Accordion from "./Accordion/index.svelte";
import CtaBanner from "./CtaBanner/index.svelte";
import Hero from "./Hero/index.svelte";
import LeadText from "./LeadText/index.svelte";
import MediaText from "./MediaText/index.svelte";
import RichText from "./RichText/index.svelte";
import SectionGrid from "./SectionGrid/index.svelte";
import Testimonial from "./Testimonial/index.svelte";
import TextColumns from "./TextColumns/index.svelte";

export const components = {
  accordion: Accordion,
  cta_banner: CtaBanner,
  hero: Hero,
  lead_text: LeadText,
  media_text: MediaText,
  rich_text: RichText,
  section_grid: SectionGrid,
  testimonial: Testimonial,
  text_columns: TextColumns,
};
```

- [ ] **Step 2: Trim the page type's slice choices and check its mocks**

```bash
python3 - <<'EOF'
import json
KEEP = {"accordion","cta_banner","hero","lead_text","media_text","rich_text","section_grid","testimonial","text_columns"}
p = "customtypes/page/index.json"
d = json.load(open(p))
choices = d["json"]["Main"]["slices"]["config"]["choices"]
d["json"]["Main"]["slices"]["config"]["choices"] = {k: v for k, v in choices.items() if k in KEEP}
json.dump(d, open(p, "w"), indent=2, ensure_ascii=False); open(p, "a").write("\n")
print(sorted(d["json"]["Main"]["slices"]["config"]["choices"]))

REMOVED = {"blux_block","blux_carousel","blux_collection","blux_embed","blux_gallery","blux_grid","blux_media","blux_media_text","blux_section","blux_table","blux_text","carousel","collection_list","gallery","grid_band","location_map","media_full","split_feature","title_band"}
m = "customtypes/page/mocks.json"
raw = open(m).read()
hits = [r for r in REMOVED if f'"{r}"' in raw]
print("page mocks reference removed slices:", hits)
EOF
```

Expected: the nine kept ids sorted; `page mocks reference removed slices: []`. If the list is non-empty, remove those slice mocks from `customtypes/page/mocks.json` by hand (each is one object inside the `data.slices` array of a mock document, identified by its `slice_type`/`sliceType` key) and re-run the check.

- [ ] **Step 3: Lighthouse collects a real route too**

In `lighthouserc.json` replace `      "url": ["http://localhost:5173/dev/a11y-fixtures"],` with:

```json
      "url": [
        "http://localhost:5173/dev/a11y-fixtures",
        "http://localhost:5173/"
      ],
```

Note: on the placeholder repo `/` 404s in dev too, and Lighthouse still scores a 404 page (SEO fails on it) — that is why Lighthouse is not a required CI check. It becomes a real signal once the site has content. If this reds a required CI job, revert this step and note it in the PR.

- [ ] **Step 4: Move the agency README to `docs/STARTER.md` and dedupe its Components list**

```bash
git mv README.md docs/STARTER.md
```

In `docs/STARTER.md`, replace the whole `## Components` bullet list (from `- **Animation** — …` through `- **Content** — \`RichTextBody\` …`) with this single de-duplicated list:

```markdown
- **Animation** — `AnimateInTriggered`, `AnimateOutTriggered`, `Slider`, `TriggerTransitionOnMount`
- **Layout** — `ContentWidth`, `ContentBand` (the `<section>` + centered box shell every hand-authored slice renders through), `PreNavTransition` (opt-in fade-to-black _before_ navigation; alternative to `TransitionOverlay`), `ScreenWidthMedia` (poster-first background video: idle-deferred iframe, quality-ramp reveal, reduced-motion poster only), `TransitionOverlay`
- **Media** — `HeroBackgroundImage` (LCP-preloaded, imgix-srcset hero image), `Img` (progressive blur-up wrapper for `?as=run` imports), `VimeoBanner` (interaction-gated background video with playback heartbeat)
- **UI** — `Accordion`, `BrandIcon`, `DefaultButton`, `DelayedLink`, `LandscapeModal`, `Nav`, `Footer`, `ScaleTextToContainer`
- **Forms** — `TurnstileWidget` (optional Cloudflare Turnstile challenge; dark until `PUBLIC_TURNSTILE_SITE_KEY` is set), plus `Field`/`Form` primitives used by the contact form
- **Utils** — `$lib/utils/image` (`imgix()` / `srcset()` responsive Prismic image helpers), `$lib/utils/vimeo` (`checkVimeoVideo()` server-side oEmbed existence check)
- **Utils (from `@reddoorla/maintenance/client`)** — `whenPageReady()` (readiness floor/ceiling around eager-image settlement) and `prefersReducedMotion()` for load-aware splash/intro gating; the starter ships no splash, but the MSOT, espada, and reddoor-website layouts show the pattern
- **Content** — `RichTextBody` (drop-in `PrismicRichText` replacement that rank-compresses editor-authored heading levels into a gap-free `aria-level` outline without changing visuals)

`BrandIcon` renders CC0 [simple-icons](https://simpleicons.org/) social glyphs (`facebook`, `x`/`twitter`, `reddit`, `instagram`, `linkedin`) in `currentColor`; it is decorative, so put the accessible name on the wrapping link.
```

Also in `docs/STARTER.md`: change the title line to `# Reddoor Starter — stack notes`, and add after the Purpose paragraph: `The Blux migration track lives in [reddoor-starter-blux](https://github.com/reddoorla/reddoor-starter-blux) (a snapshot of this repo taken 2026-08-31 that keeps the Blux render layer; forward-merge only).` Add a `## Slices` section before `## Components` listing the nine slices: `Hero, MediaText, SectionGrid, RichText, TextColumns, Accordion, LeadText, Testimonial, CtaBanner — each a Slice Machine shared slice under src/lib/slices with model.json + tests; add screenshots/ per slice so the Prismic picker shows previews.`

- [ ] **Step 5: Create the thin client-facing `README.md`**

```markdown
# <Site name>

The website for **<Client>**, built and maintained by [Reddoor Creative](https://reddoorla.com).

- **Stack:** SvelteKit + Svelte 5, Tailwind CSS 4, Prismic (Slice Machine), Netlify.
- **Content:** edited in Prismic; every publish redeploys the site.
- **Local dev:** `pnpm install` then `pnpm dev` (site on http://localhost:5173, Slice Machine on http://localhost:9999).
- **Checks:** `pnpm check` · `pnpm lint` · `pnpm test:unit` · `pnpm test:smoke`.

Stack notes, component library, recipes and conventions: [docs/STARTER.md](docs/STARTER.md).
Accessibility and security notes: [docs/accessibility.md](docs/accessibility.md), [docs/security.md](docs/security.md).
```

`/new-site` fills in `<Site name>` / `<Client>` (added to the skill in Task 13).

- [ ] **Step 5b: Manual read of the chrome components and the PageData contract**

Open `src/lib/components/Nav.svelte`, `src/lib/components/Footer.svelte` and `src/app.d.ts` and reword every comment that describes the `navLinks` / `footerColumns` / `logo` props in Blux terms ("a migrated Blux site supplies these", "the Blux catalog pipeline emits", "the unconverted-starter default", "a converted site's resolved logo url") into native terms: `navLinks`/`footerColumns` are an optional per-route override of the `src/lib/site-config.json` defaults that no route in the bare template supplies; `logo`/`items` come from site-config. Keep the props and both render paths (the Blux repo forward-merges these files; deleting the override path would manufacture a conflict on every merge). A grep for the literal word `blux` does not catch "unconverted"/"converted" — read the files.

Run: `grep -n -i 'blux\|migrated\|converted\|catalog' src/lib/components/Nav.svelte src/lib/components/Footer.svelte src/app.d.ts`
Expected: no output.

- [ ] **Step 6: Whole-repo Prettier, lint, commit**

Run: `pnpm format >/dev/null && pnpm lint 2>&1 | tail -2`
Expected: prettier `--check` passes, eslint reports no errors.

```bash
git add -A
git commit -m "chore(template): nine-slice registry, page-type choices, Lighthouse real route, README split"
```

### Task 10: Full verification and the PR

**Files:** none new.

- [ ] **Step 1: Definition-of-done greps**

```bash
grep -ri 'blux\|catalog chrome\|leasing\|fidelity gate\|migrated site\|converted site\|unconverted' src customtypes tests docs README.md svelte.config.js package.json .prettierignore lighthouserc.json --exclude=prismicio-types.d.ts; echo "grep exit=$?"
git ls-files docs/superpowers scratchpad | wc -l
```

Expected: `grep exit=1` (no matches) and `0`. Fix any hit before continuing — `src/prismicio-types.d.ts` is excluded on purpose (Slice Machine regenerates it on its next run; stale slice types are inert).

- [ ] **Step 2: The full local gate**

```bash
pnpm check 2>&1 | tail -1
pnpm lint 2>&1 | tail -1
pnpm test:unit 2>&1 | tail -3
pnpm build 2>&1 | tail -2 && ls build/dev && du -sh build
```

Expected: `0 errors`; lint clean; all unit files pass; build succeeds; `build/dev` = `a11y-fixtures.html animate-in.html`; `build` well under 840 KB (the-pointe fixtures were ~230 KB of it).

- [ ] **Step 3: Smoke + axe locally (Playwright)**

Run: `pnpm test:smoke 2>&1 | tail -4`
Expected: the a11y fixtures (2 pages) and the smoke manifest (`/` expecting 404 on the placeholder repo) pass.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/native-template
gh pr create -R reddoorla/reddoor-starter --base main --head feat/native-template \
  --title "refactor(template): native-only starter — Blux track moved to reddoor-starter-blux" \
  --body "$(cat <<'EOF'
## Summary
- The Blux migration layer now lives in `reddoorla/reddoor-starter-blux` (full-history snapshot of `82d93b0`). This PR makes `reddoor-starter` the native client-site template.
- Content routes + sitemap query Prismic `page` documents directly; chrome types move to `src/lib/site-config.ts`.
- Nine editor-usable slices remain (Hero, MediaText, SectionGrid, RichText, TextColumns, Accordion, LeadText, Testimonial, CtaBanner), without the `band` branch; 12 `Blux*` + 7 band-only slices, the-pointe fixtures/gates, `/products`, 6 catalog custom types, and the tracked `docs/superpowers/` planning docs are gone.
- `svelte.config.js` loses the frozen/Maps CSP branches; `app.css` gains `--font-heading`/`--font-body` tokens; README split into a thin client README + `docs/STARTER.md`.

Spec + plan: reddoor-maintenance `docs/superpowers/{specs,plans}/2026-08-31-starter-track-split*`.

## Test plan
- [x] `pnpm check` / `pnpm lint` / `pnpm test:unit` / `pnpm build` / `pnpm test:smoke` green locally
- [x] `grep -ri blux src customtypes tests` empty; `build/dev` contains only the two dev tooling pages
- [ ] CI green
- [ ] After merge: throwaway `gh repo create --template` clone builds (Task 11)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Wait for CI and report the conclusion**

```bash
gh pr checks -R reddoorla/reddoor-starter feat/native-template --watch 2>&1 | tail -5
```

Expected: `ci / ci` = pass. Report the PR URL and the check conclusion to the operator. **Do not merge without the operator's go** (template refactor; verify the PR's changed-file list first per the fleet rule).

### Task 11: Post-merge verification (template clone + forward-merge dry run)

Run only after the operator merges the PR.

- [ ] **Step 1: Throwaway clone from the template**

```bash
cd "$TMPDIR"
gh repo create reddoorla/zz-template-smoke --private --template reddoorla/reddoor-starter --clone
cd zz-template-smoke && pnpm install --frozen-lockfile && pnpm build 2>&1 | tail -2 && ls build/dev && git ls-files | grep -c -i blux
```

Expected: build succeeds; `build/dev` = the two tooling pages; the final count is `0`.

```bash
gh repo delete reddoorla/zz-template-smoke --yes
cd "$TMPDIR" && rm -rf zz-template-smoke
```

- [ ] **Step 2: Forward-merge dry run into the Blux repo**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-starter-blux
git fetch -q starter
git merge --no-commit --no-ff starter/main 2>&1 | tail -20
git diff --name-only --diff-filter=U
git merge --abort
```

Expected: the conflicting-file list is confined to the files this plan rewrote (routes, `site-config`, the seven slices, `svelte.config.js`, `app.css`, `.prettierignore`, `.gitignore`, `README.md`, `lighthouserc.json`, `customtypes/page/index.json`, `src/lib/slices/index.js`). Record the list in the spec changelog. The Blux repo is NOT merged now — this only proves the conflict surface; the first real forward-merge happens when a shared fix lands.

---

## Leg C — Repointing and the `new-site` skill

### Task 12: Maintenance repointing (same branch as the spec/plan)

**Files** (all under `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/starter-split`):

- Modify: `src/blux/emit/slices.ts:6`, `src/blux/emit/presentation.ts:143`, `src/blux/emit/site-config.ts:52`
- Modify: `src/prismic/models/config.ts:31`
- Modify: `CLAUDE.md` (new section), `docs/superpowers/specs/2026-07-05-blux-conversion-pipeline-design.md` (dated note at top)

- [ ] **Step 1: The three render-mirror comments**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/starter-split
sed -i '' 's#in reddoor-starter/src/lib/slices/<Slice>/model.json#in reddoor-starter-blux/src/lib/slices/<Slice>/model.json#' src/blux/emit/slices.ts
sed -i '' "s#render mirror is reddoor-starter's#render mirror is reddoor-starter-blux's#" src/blux/emit/presentation.ts
sed -i '' 's#NETWORK` map (reddoor-starter$#NETWORK` map (reddoor-starter-blux#' src/blux/emit/site-config.ts
grep -n 'reddoor-starter' src/blux/emit/slices.ts src/blux/emit/presentation.ts src/blux/emit/site-config.ts
```

Expected: three lines, each containing `reddoor-starter-blux`. If the `site-config.ts` sed did not match (the line may not end at `reddoor-starter`), open the file at line 52 and change `reddoor-starter` to `reddoor-starter-blux` by hand.

- [ ] **Step 2: Placeholder-repo comment in `src/prismic/models/config.ts`**

Replace ` * three fleet repos: reddoor-starter, canvas-starter, and` with ` * four fleet repos: reddoor-starter, reddoor-starter-blux, canvas-starter, and`, and on the following lines change `Only the first two are visible from a local sweep` to `Only the first three are visible from a local sweep` and `finds two and is not evidence` to `finds three and is not evidence`.

- [ ] **Step 3: `CLAUDE.md` section** — insert immediately before `## In flight: the Airtable → Turso migration`:

```markdown
## Two starter templates (since 2026-08-31)

- `reddoorla/reddoor-starter` — the **native** template; default for
  `/new-site`. No Blux code.
- `reddoorla/reddoor-starter-blux` — the **Blux track**: a full-history
  snapshot of the native repo at `82d93b0` that keeps the Blux render layer.
  It is the render mirror `src/blux` targets and the template for
  `/new-site <slug> --track blux`. Forward-merge only (`git merge starter/main`
  in that repo); never merge it back.

Design: `docs/superpowers/specs/2026-08-31-starter-track-split-design.md`.
```

- [ ] **Step 4: Dated note at the top of the Blux pipeline spec**

Insert after the title line of `docs/superpowers/specs/2026-07-05-blux-conversion-pipeline-design.md`:

```markdown
> **2026-08-31:** the render target is now `reddoorla/reddoor-starter-blux`
> (see `2026-08-31-starter-track-split-design.md`); every `reddoor-starter`
> path below refers to that repo.
```

- [ ] **Step 5: Build, test the touched modules, commit, push, PR**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/starter-split
pnpm install --frozen-lockfile >/dev/null && pnpm build 2>&1 | tail -1 && pnpm vitest run tests/blux tests/prismic 2>&1 | tail -3
npx prettier --check src/blux/emit src/prismic/models CLAUDE.md docs/superpowers 2>&1 | tail -1
git add -A src/blux/emit src/prismic/models/config.ts CLAUDE.md docs/superpowers
git commit -m "docs(blux): point the render mirror at reddoor-starter-blux; two-template note in CLAUDE.md"
git push -u origin docs/starter-track-split
gh pr create -R reddoorla/reddoor-maintenance --base main --head docs/starter-track-split \
  --title "docs: starter track split — spec, plan, and Blux render-mirror repointing" \
  --body "Spec + implementation plan for splitting reddoor-starter into native + Blux-track templates, plus the three src/blux/emit comment repoints and a CLAUDE.md section. No behaviour change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: build + tests green, prettier clean, PR URL printed. (Test paths: if `tests/blux`/`tests/prismic` do not exist, run `pnpm test` instead.)

### Task 13: `new-site` skill — `--track` and the de-brand step

**Files:**

- Modify: `/Users/tuckerlemos/.claude/skills/new-site/SKILL.md` (lines 3, 13–16, and a new step after step 3)

`~/.claude/skills` is write-denied in the Bash sandbox; use the Edit tool, or `dangerouslyDisableSandbox` for the sed calls, with the operator's standing go-ahead.

- [ ] **Step 1: Description + input**

In the frontmatter `description:` (line 3), change `Bootstrap a new Reddoor client site from the reddoor-starter template` to `Bootstrap a new Reddoor client site from the reddoor-starter template (or reddoor-starter-blux with --track blux)`.

Replace the `Input:` paragraph (`Input: a slug (kebab-case client identifier, e.g. \`roalson\`). Confirm it with the operator before creating anything.`) with:

```markdown
Input: a slug (kebab-case client identifier, e.g. `roalson`) and an optional
track: `native` (default — `reddoorla/reddoor-starter`) or `blux`
(`reddoorla/reddoor-starter-blux`, for sites migrated off the Blux platform).
Confirm both with the operator before creating anything.
```

- [ ] **Step 2: Step 1 uses the track**

Replace the repo step's create command line

```
   `gh repo create reddoorla/<slug> --private=false --template reddoorla/reddoor-starter`
```

with

```
   `gh repo create reddoorla/<slug> --private=false --template reddoorla/reddoor-starter`
   (native) or `--template reddoorla/reddoor-starter-blux` (`--track blux`).
```

- [ ] **Step 3: New de-brand step after step 3 (renumber nothing — insert as 3b)**

Insert after the CI-input step:

```markdown
3b. **De-brand** (native track): in `src/lib/seo.ts` set `SITE_NAME` to the
client's display name and `SITE_LOCALE` (`en_US`, or the site's primary
locale); set `DEFAULT_OG_IMAGE = "/og-default.png"` once a 1200×630 card
exists in `static/`. Replace `static/favicon.png` with the client's icon.
Fill `<Site name>` / `<Client>` in `README.md`. Set `<html lang>` in
`src/app.html` if the primary language is not English. Extend the CSP in
`svelte.config.js` for every third-party host the design needs (web fonts,
YouTube, donation platform, analytics) — the baseline allows Prismic,
Vimeo, Turnstile and Google Fonts only.
```

- [ ] **Step 4: Verify**

Run: `grep -n 'track\|3b\.' /Users/tuckerlemos/.claude/skills/new-site/SKILL.md | head`
Expected: the description, Input paragraph, step 1 and step 3b lines.

---

## Self-review (done while writing)

- **Spec coverage:** snapshot (T1–T3) · native-ize delete/rewrite/keep tables (T4–T9) · definition of done incl. throwaway clone (T10–T11) · maintenance repointing incl. `models/config.ts` (T12) · `new-site --track` + de-brand (T13) · Node engine alignment, i18n, settings type, slice screenshots remain out of scope as the spec says. Deviations are listed in the header.
- **Placeholders:** none — every rewrite step carries the full file or the exact old→new text; the two "open the file and change by hand" fallbacks name the exact line and string.
- **Type consistency:** `pageMeta` (page-meta.ts) is imported by both loaders; `isPlaceholderRepo` / `createClient` keep their names from prismicio.ts; `AllDocumentTypes` is the generated union; slice `Props` shapes match what each test file's fixture casts to.
