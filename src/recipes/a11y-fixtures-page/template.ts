/** Relative path inside a site where the a11y fixtures route lives. The
 * hardcoded URL in `src/configs/lighthouse.ts` + `src/configs/playwright-a11y.ts`
 * is `/dev/a11y-fixtures`, so a SvelteKit `+page.svelte` here resolves. */
export const A11Y_FIXTURES_PAGE_RELATIVE = "src/routes/dev/a11y-fixtures/+page.svelte";

/** Stub `+page.svelte` for newly-onboarded sites. Generic on purpose —
 * landmarks, heading hierarchy, and a relative link cover the axe-core +
 * lhci defaults without committing the operator to any specific fixture
 * shape. Replace with site-specific patterns over time. */
export const A11Y_FIXTURES_PAGE_TEMPLATE = `<svelte:head>
  <title>a11y fixtures — Reddoor</title>
  <meta
    name="description"
    content="Reddoor accessibility fixtures — semantic landmarks, heading hierarchy, and a stable target for @lhci/cli and Playwright + axe-core coverage. Not linked from the public site."
  />
</svelte:head>

<main>
  <header>
    <h1>Accessibility fixtures</h1>
    <p>
      This page exists so <code>@lhci/cli</code> and Playwright + axe-core have a
      stable target with predictable a11y characteristics. It is not linked from
      the public site.
    </p>
  </header>

  <section aria-labelledby="landmarks-heading">
    <h2 id="landmarks-heading">Landmarks</h2>
    <p>
      A single <code>main</code> wraps the page; sections each declare
      <code>aria-labelledby</code> matched to their heading id so screen readers
      and axe both see a clean outline.
    </p>
  </section>

  <section aria-labelledby="links-heading">
    <h2 id="links-heading">Links</h2>
    <p>
      <a href="/">Back to home</a> — relative link with descriptive visible text,
      so no <code>aria-label</code> override is needed.
    </p>
  </section>
</main>
`;
