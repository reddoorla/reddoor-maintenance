import { chromium } from "@playwright/test";

// The Blux export's index.html renders its final layout only after its runtime
// JS applies height/position adjustments. Freezing the RAW html renders the
// wrong height (the-pointe: 16873px); freezing the JS-SETTLED DOM renders the
// live height (15333px). So the freeze hydrates the page once in headless
// chromium, scrolls top→bottom to trigger the layout pass, and snapshots the
// settled DOM. (Proven in the design POC scratchpad/freeze-final.mjs.)

export interface SettleOptions {
  /** Layout viewport — Blux desktop layout is authored at 1440. */
  width?: number;
  height?: number;
  /** Scroll step in px (smaller = more reliable lazy triggers, slower). */
  step?: number;
}

/**
 * Render a local `index.html` in headless chromium, let its JS settle the
 * layout, and return the serialized settled DOM (full document HTML).
 */
export async function settleExport(
  indexHtmlPath: string,
  opts: SettleOptions = {},
): Promise<string> {
  const width = opts.width ?? 1440;
  const height = opts.height ?? 1000;
  const step = opts.step ?? 500;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`file://${indexHtmlPath}`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    // Trigger the JS layout pass across the whole page.
    const total = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < total + 1000; y += step) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1200);
    return await page.content();
  } finally {
    await browser.close();
  }
}
