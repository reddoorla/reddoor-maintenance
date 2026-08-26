import type { Browser } from "@playwright/test";

/**
 * Render the website's print route to a PDF.
 *
 * The leave-behind is printed from `/audit/{token}/print`, a document designed
 * for paper, not from the interactive report. Printing the interactive page
 * would produce a PDF with its evidence still folded away behind disclosures —
 * worse on paper than the long version it replaced.
 *
 * The page is already live when this runs: the report route reads from the API
 * at request time rather than from a build artifact, so there is no deploy to
 * wait for after the audit persists.
 *
 * The runner already installs Playwright's chromium for the crawl, so this adds
 * no toolchain.
 */

export type LaunchBrowser = () => Promise<Browser>;

export type RenderPdfDeps = {
  launch?: LaunchBrowser;
};

/** Long enough for a cold marketing page plus webfonts, short enough that a
 *  wedged render cannot hold the runner open. The audit's own step timeout sits
 *  well above it. */
const NAVIGATION_TIMEOUT_MS = 60_000;

async function defaultLaunch(): Promise<Browser> {
  const { chromium } = await import("@playwright/test");
  // --no-sandbox: the runner is already an isolated container, and chromium's
  // own sandbox needs privileges it does not have there.
  return chromium.launch({ args: ["--no-sandbox"] });
}

export async function renderReportPdf(printUrl: string, deps: RenderPdfDeps = {}): Promise<Buffer> {
  const launch = deps.launch ?? defaultLaunch;
  const browser = await launch();
  try {
    const page = await browser.newPage();
    // `networkidle` rather than `load`: webfonts must settle before we print.
    // A fallback face baked into a client-facing PDF cannot be corrected after
    // the fact — the file is already in somebody's inbox.
    const res = await page.goto(printUrl, {
      waitUntil: "networkidle",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    // `page.goto` resolves for ANY status, and dropping its result meant a 404
    // rendered as a perfectly valid PDF of the marketing site's "Page not
    // found" — attached to the email and sent to the prospect. Nothing threw,
    // so no warning was recorded either: a hard failure became silently wrong
    // client-facing content. Throwing here lets the caller's existing catch turn
    // it into the warning it should always have been.
    if (!res || !res.ok()) {
      throw new Error(
        `renderReportPdf: ${printUrl} responded ${res ? res.status() : "no response"}`,
      );
    }
    return await page.pdf({
      // The print route declares `@page { size: A4 }`. Honour it rather than
      // restating the size here, so the document's own stylesheet stays the one
      // place page geometry is decided.
      preferCSSPageSize: true,
      // Without this the callout's fill drops out. It carries a border too, so
      // the emphasis survives either way — but there is no reason to print the
      // degraded version when we control the renderer.
      printBackground: true,
    });
  } finally {
    // In `finally`, not after the return: a navigation timeout or a render
    // failure must not leave a chromium process behind on the runner.
    await browser.close();
  }
}
