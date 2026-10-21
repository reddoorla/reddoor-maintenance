import type { BrowserContext, BrowserContextOptions, Browser, Page } from "@playwright/test";

/**
 * Open a context with `options`, load `url`, and hand the page to `use`; the
 * context is closed after, whatever happens. A page that answers anything but
 * 2xx throws, so runDesignRules records it as unmeasured: a 404 page has no
 * design to judge, and judging it would pass or fail the wrong page.
 */
export async function withPage<T>(
  browser: Browser,
  options: BrowserContextOptions,
  url: string,
  use: (page: Page) => Promise<T>,
): Promise<T> {
  const context: BrowserContext = await browser.newContext(options);
  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    if (response && !response.ok()) throw new Error(`the page answered ${response.status()}`);
    return await use(page);
  } finally {
    await context.close().catch(() => {});
  }
}

/** Two animation frames and a task: a stop's IntersectionObserver callbacks
 *  and the style updates they start have run (revealBelowFold's wait). */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
      ),
  );
}
