/** Viewport matching the plate's MacBook screen aspect (16:10), so the crop in
 *  compose.ts is a no-op for a well-behaved homepage. */
const VIEWPORT = { width: 1600, height: 1000 } as const;
/** 2x so the 1349px-wide screen rect is fed real pixels, not upscaled ones. */
const DEVICE_SCALE_FACTOR = 2;
/** Entrance animations and webfonts settle before the shutter. Measured against
 *  live fleet sites; overridable per site because consent gates and long
 *  animations vary. */
const DEFAULT_SETTLE_MS = 2500;
/** Budget for the `load` milestone — the navigation we actually gate on.
 *
 *  Do NOT put `waitUntil: "networkidle"` back on the `goto`. Measured across all
 *  14 live fleet sites (30s timeout): `load` succeeded on 14/14 in 346–1205ms,
 *  while `networkidle` NEVER fired on 4 of them (ERP Industrials, Vineyard,
 *  Revogen, 1836dig) — chat widgets, analytics polling and websockets hold the
 *  connection open forever, so `goto` threw and those sites could never get a
 *  header image at all. */
const NAV_TIMEOUT_MS = 60_000;
/** Best-effort extra wait for network idle, applied *after* `load` and with its
 *  rejection swallowed. The 10 sites that do settle still get the benefit; the 4
 *  that never will just proceed. 3s is sized from the measurement above: the
 *  slowest site that does reach idle took 4078ms from `goto` start, and by the
 *  time this runs the `load` milestone (~0.3–1.2s) has already passed, so 3s
 *  covers the real remaining settle time without stalling the never-idle sites. */
const IDLE_BUDGET_MS = 3_000;

/** Attribute heuristic for a cookie / consent banner: any element whose class or
 *  id mentions "cookie" or "consent", case-insensitively. Sonder's header shipped
 *  its consent panel and the panel's scrim over the hero (#654) — the banner
 *  never leaves on its own, so settle time was irrelevant and hiding it is the
 *  whole fix. Kept narrow on purpose: a broader net (e.g. "modal", "overlay")
 *  would start hiding hero art on sites that use those words for content. */
export const CONSENT_SELECTOR =
  '[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[id*="consent" i]';

/** Accessible names of the buttons a consent banner offers. Clicking one lets the
 *  site run its own dismissal, which is the only thing that reliably removes a
 *  scrim living OUTSIDE the banner element (a `body::before`, a sibling overlay). */
export const CONSENT_BUTTON_NAME =
  /^(accept( all)?( cookies)?|allow( all)?|reject( all)?|decline|got it|ok(ay)?|i (agree|understand)|agree)$/i;

/** Budget for the best-effort consent click. A site with no banner has no button,
 *  so the click times out on every capture there — it must be short, and it is
 *  swallowed. Sized so the 14 consent-free fleet sites pay ≤1.5s each. */
const CONSENT_CLICK_TIMEOUT_MS = 1_500;

/**
 * The CSS rule that hides consent UI before the shutter. `consentSelector` is a
 * per-site addition for banners the heuristic misses (a newsletter interstitial,
 * a GDPR shield with a bespoke class); it is joined onto the heuristic, never a
 * replacement for it. Pure, so it can be tested without a browser.
 */
export function consentHideRule(consentSelector?: string): string {
  const extra = consentSelector?.trim();
  const selector = extra ? `${CONSENT_SELECTOR},${extra}` : CONSENT_SELECTOR;
  return `${selector}{display:none!important;visibility:hidden!important;pointer-events:none!important}`;
}

export type ShootOptions = {
  url: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  settleMs: number;
  /** Extra CSS selector(s) hidden before the shutter, for a site whose consent
   *  or interstitial UI the class/id heuristic misses. */
  consentSelector?: string;
};

/** Injected browser IO. The real impl drives Playwright; tests pass a fake. */
export type Shooter = {
  shoot: (opts: ShootOptions) => Promise<Uint8Array>;
};

export type CaptureOptions = {
  shooter?: Shooter;
  settleMs?: number;
  consentSelector?: string;
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
    ...(options.consentSelector !== undefined ? { consentSelector: options.consentSelector } : {}),
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
        await page.goto(opts.url, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
        // Best-effort only — a site that never idles must still be captured.
        await page.waitForLoadState("networkidle", { timeout: IDLE_BUDGET_MS }).catch(() => {});
        await page.evaluate("document.fonts && document.fonts.ready");
        // Dismiss consent UI, strictly best-effort — a header capture must never
        // fail because a site has no banner. The click goes FIRST: once the rule
        // below hides the button it is no longer actionable, and the site's own
        // dismissal is what unwinds a scrim that lives outside the banner. Then
        // the style tag catches a banner with no matching button, or one that
        // fades out slower than the settle. Both run before the settle wait so
        // the settle absorbs whatever animation the dismissal starts.
        await page
          .getByRole("button", { name: CONSENT_BUTTON_NAME })
          .first()
          .click({ timeout: CONSENT_CLICK_TIMEOUT_MS })
          .catch(() => {});
        await page.addStyleTag({ content: consentHideRule(opts.consentSelector) });
        await page.waitForTimeout(opts.settleMs);
        const buf = await page.screenshot({ type: "png" });
        return new Uint8Array(buf);
      } finally {
        await browser.close();
      }
    },
  };
}
