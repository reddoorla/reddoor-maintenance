/** Viewport matching the plate's MacBook screen aspect (16:10), so the crop in
 *  compose.ts is a no-op for a well-behaved homepage. */
const VIEWPORT = { width: 1600, height: 1000 } as const;
/** 2x so the 1349px-wide screen rect is fed real pixels, not upscaled ones. */
const DEVICE_SCALE_FACTOR = 2;
/** Entrance animations and webfonts settle before the shutter. Measured against
 *  live fleet sites; overridable per site because consent gates and long
 *  animations vary. */
const DEFAULT_SETTLE_MS = 2500;
const NAV_TIMEOUT_MS = 60_000;

export type ShootOptions = {
  url: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  settleMs: number;
};

/** Injected browser IO. The real impl drives Playwright; tests pass a fake. */
export type Shooter = {
  shoot: (opts: ShootOptions) => Promise<Uint8Array>;
};

export type CaptureOptions = {
  shooter?: Shooter;
  settleMs?: number;
};

/**
 * Screenshot a site's homepage for the header image.
 *
 * Viewport-only, never `fullPage`: the plate shows a laptop screen, not a
 * scroll. Failures propagate — a caller must be able to keep the site's existing
 * header rather than overwrite it with a broken shot.
 */
export async function captureHomepage(
  url: string,
  options: CaptureOptions = {},
): Promise<Uint8Array> {
  const shooter = options.shooter ?? (await defaultShooter());
  return shooter.shoot({
    url,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    settleMs: options.settleMs ?? DEFAULT_SETTLE_MS,
  });
}

/** Real Playwright shooter. Lazily imported so unit tests never load it and the
 *  static import graph stays central-dep-free for `test:dist`. */
export async function defaultShooter(): Promise<Shooter> {
  const { chromium } = await import("@playwright/test");
  return {
    async shoot(opts) {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({
          viewport: { width: opts.width, height: opts.height },
          deviceScaleFactor: opts.deviceScaleFactor,
        });
        await page.goto(opts.url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
        await page.evaluate("document.fonts && document.fonts.ready");
        await page.waitForTimeout(opts.settleMs);
        const buf = await page.screenshot({ type: "png" });
        return new Uint8Array(buf);
      } finally {
        await browser.close();
      }
    },
  };
}
