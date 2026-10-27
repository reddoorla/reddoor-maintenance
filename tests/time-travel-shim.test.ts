import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chromium } from "@playwright/test";
import { installTimeTravel } from "../vitest.time-travel.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("time-travel shim — moves today and nothing else (#1171)", () => {
  let real: {
    setImmediate: typeof setImmediate;
    setTimeout: typeof setTimeout;
    setInterval: typeof setInterval;
    queueMicrotask: typeof queueMicrotask;
    performanceNow: typeof performance.now;
  };

  beforeEach(() => {
    vi.useRealTimers();
    real = {
      setImmediate: globalThis.setImmediate,
      setTimeout: globalThis.setTimeout,
      setInterval: globalThis.setInterval,
      queueMicrotask: globalThis.queueMicrotask,
      performanceNow: performance.now,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shifts Date.now() by the requested days", () => {
    installTimeTravel(90);
    const shiftDays = (Date.now() - vi.getRealSystemTime()) / MS_PER_DAY;
    expect(shiftDays).toBeGreaterThan(89.99);
    expect(shiftDays).toBeLessThan(90.01);
    expect(new Date().getTime()).toBe(Date.now());
  });

  it("keeps the shifted clock moving with real time", async () => {
    installTimeTravel(90);
    const before = Date.now();
    await new Promise((r) => real.setTimeout(r, 120));
    expect(Date.now() - before).toBeGreaterThanOrEqual(60);
  });

  it("leaves every scheduler real", () => {
    installTimeTravel(90);
    expect(globalThis.setImmediate).toBe(real.setImmediate);
    expect(globalThis.setTimeout).toBe(real.setTimeout);
    expect(globalThis.setInterval).toBe(real.setInterval);
    expect(globalThis.queueMicrotask).toBe(real.queueMicrotask);
    expect(performance.now).toBe(real.performanceNow);
  });

  it("lets a browser launched under it answer page.evaluate", async () => {
    installTimeTravel(90);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent("<p>x</p>");
      const outcome = await Promise.race([
        page.evaluate(() => 1 + 1).then((v) => `answered ${v}`),
        new Promise<string>((r) => real.setTimeout(() => r("no answer in 15s"), 15_000)),
      ]);
      expect(outcome).toBe("answered 2");
    } finally {
      await browser.close();
    }
  }, 60_000);
});
