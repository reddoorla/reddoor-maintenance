import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "@playwright/test";
import {
  HYDRATED_SELECTOR,
  waitForHydration,
  type HydrationWaitPage,
} from "../../../src/audits/util/hydration-wait.js";

const pageWithMarkerAfter = (ms: number | null) =>
  `data:text/html,${encodeURIComponent(
    `<!doctype html><html><body><p>x</p><script>${
      ms === null
        ? ""
        : `setTimeout(() => { document.documentElement.dataset.hydrated = ""; }, ${ms});`
    }</script></body></html>`,
  )}`;

describe("waitForHydration — against a real page", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  it("returns as soon as the site writes html[data-hydrated], well before the settle", async () => {
    const page = await browser.newPage();
    await page.goto(pageWithMarkerAfter(300), { waitUntil: "domcontentloaded" });
    const t0 = Date.now();
    const how = await waitForHydration(page, { timeoutMs: 8000 });
    const took = Date.now() - t0;
    expect(how).toBe("marker");
    expect(took).toBeLessThan(4000);
    expect(await page.locator(HYDRATED_SELECTOR).count()).toBe(1);
    await page.close();
  }, 30_000);

  it("settles for the whole timeout on a site that never writes the marker", async () => {
    const page = await browser.newPage();
    await page.goto(pageWithMarkerAfter(null), { waitUntil: "domcontentloaded" });
    const t0 = Date.now();
    const how = await waitForHydration(page, { timeoutMs: 1500 });
    const took = Date.now() - t0;
    expect(how).toBe("settled");
    expect(took).toBeGreaterThanOrEqual(1400);
    await page.close();
  }, 30_000);

  it("reports the marker at once when the site already wrote it", async () => {
    const page = await browser.newPage();
    await page.goto(pageWithMarkerAfter(0), { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-hydrated"));
    const t0 = Date.now();
    expect(await waitForHydration(page, { timeoutMs: 8000 })).toBe("marker");
    expect(Date.now() - t0).toBeLessThan(1000);
    await page.close();
  }, 30_000);
});

describe("waitForHydration — never throws past the probe", () => {
  it("settles when the page cannot answer at all", async () => {
    const dead: HydrationWaitPage = {
      waitForLoadState: () => Promise.reject(new Error("closed")),
      waitForFunction: () => Promise.reject(new Error("closed")),
    };
    expect(await waitForHydration(dead, { timeoutMs: 10 })).toBe("settled");
  });

  it("counts the load wait against the same budget", async () => {
    const seen: number[] = [];
    const page: HydrationWaitPage = {
      waitForLoadState: async (_s, o) => {
        seen.push(o.timeout);
        await new Promise((r) => setTimeout(r, 300));
      },
      waitForFunction: (_e, _a, o) => {
        seen.push(o.timeout);
        return Promise.reject(new Error("timeout"));
      },
    };
    await waitForHydration(page, { timeoutMs: 5000 });
    expect(seen[0]).toBe(5000);
    expect(seen[1]).toBeGreaterThan(0);
    expect(seen[1]).toBeLessThanOrEqual(4750);
  });
});
