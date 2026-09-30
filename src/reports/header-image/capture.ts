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

/** Budget for the best-effort consent click. Only a button already found inside
 *  a consent overlay is clicked, so a site with no banner never waits on it. */
const CONSENT_CLICK_TIMEOUT_MS = 1_500;

/** The late look polls this many times, this far apart: 1.5s in all. */
const LATE_LOOK_POLLS = 7;
const LATE_LOOK_INTERVAL_MS = 250;

/** Time a late-dismissed banner gets to leave before the shutter. Sonder's panel
 *  and its blur scrim are gone within a second of the click. */
const LATE_DISMISS_SETTLE_MS = 1_000;

/** Copy that marks a still-visible accept/reject button as consent UI rather
 *  than page content, for the pre-shutter backstop. */
const CONSENT_COPY = /\bcookies?\b|\bconsent\b/i;

/** Thrown when consent UI is still on screen at the shutter, so no header is
 *  generated from that shot. `refreshHeaderImage` then keeps whatever header is
 *  stored; the CLI reports the site as failed. */
export class ConsentStillVisibleError extends Error {
  constructor(url: string) {
    super(`consent banner still visible at the shutter on ${url}; no header generated`);
    this.name = "ConsentStillVisibleError";
  }
}

/** Thrown when one of the page's own stylesheets failed to load, so the shot
 *  would show the site unstyled. On 2026-09-30 one of four Sonder captures
 *  rendered as plain text and two giant logos; `assertNotBlank` and the consent
 *  backstop both passed it, and it was stored and emailed. Detected from the
 *  network, not the DOM: Chromium gives a `<link>` a non-null `sheet` even when
 *  its request 404s, returns HTML, or has its connection reset. */
export class UnstyledPageError extends Error {
  constructor(url: string, failed: readonly string[]) {
    super(
      `${failed.length} stylesheet(s) from the page's own host failed on ${url}; no header generated: ${failed.join(", ")}`,
    );
    this.name = "UnstyledPageError";
  }
}

/** Runs in the page: absolute URLs of the `<link rel=stylesheet>` elements that
 *  apply to the screen (not alternate, not disabled, media matching). A failed
 *  print stylesheet or a failed `preload as=style` leaves the screen styled, so
 *  neither may refuse the shot. */
const SCREEN_STYLESHEETS_PROBE = `[...document.querySelectorAll("link")]
  .filter((l) => l.relList.contains("stylesheet") && !l.relList.contains("alternate") && !l.disabled)
  .filter((l) => !l.media || matchMedia(l.media).matches)
  .map((l) => l.href)`;

/** The failed stylesheets, among those recorded, that came from a host the
 *  page itself was served from. A third-party stylesheet (a font kit, a widget)
 *  is left out: its loss changes fonts, not the layout, and a permanently dead
 *  one would otherwise freeze the site's header. Pure, for tests. */
export function ownHostStylesheetFailures(
  failures: readonly { url: string; reason: string }[],
  pageUrls: readonly string[],
): string[] {
  const hosts = new Set(
    pageUrls.flatMap((u) => {
      try {
        return [new URL(u).host];
      } catch {
        return [];
      }
    }),
  );
  const own = new Map<string, string>();
  for (const f of failures) {
    let host: string;
    try {
      host = new URL(f.url).host;
    } catch {
      continue;
    }
    if (hosts.has(host) && !own.has(f.url)) own.set(f.url, f.reason);
  }
  return [...own].map(([url, reason]) => `${url} (${reason})`);
}

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
  const shootOpts: ShootOptions = {
    url,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    settleMs: options.settleMs ?? DEFAULT_SETTLE_MS,
    ...(options.consentSelector !== undefined ? { consentSelector: options.consentSelector } : {}),
  };
  // One re-shoot for an unstyled page, and only for that: the Sonder shot that
  // motivated the check was one bad capture in four, so a transient stylesheet
  // failure recovers here, while a stylesheet that is gone for good still refuses.
  try {
    return await shooter.shoot(shootOpts);
  } catch (err) {
    if (!(err instanceof UnstyledPageError)) throw err;
    return shooter.shoot(shootOpts);
  }
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
        const stylesheetFailures: { url: string; reason: string }[] = [];
        page.on("requestfailed", (req) => {
          if (req.resourceType() === "stylesheet") {
            stylesheetFailures.push({
              url: req.url(),
              reason: req.failure()?.errorText ?? "failed",
            });
          }
        });
        page.on("response", (res) => {
          if (res.request().resourceType() === "stylesheet" && res.status() >= 400) {
            stylesheetFailures.push({ url: res.url(), reason: `HTTP ${res.status()}` });
          }
        });
        await page.goto(opts.url, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
        // Best-effort only — a site that never idles must still be captured.
        await page.waitForLoadState("networkidle", { timeout: IDLE_BUDGET_MS }).catch(() => {});
        await page.evaluate("document.fonts && document.fonts.ready");
        // Dismiss consent UI, strictly best-effort: a header capture must never
        // fail because a site has no banner. Only a button inside a consent
        // overlay is ever clicked (see consentOverlayButtons); #814 clicked the
        // first "OK"/"Agree" anywhere, which on a page with a newsletter form
        // scrolled the shot or could submit the form. The click goes before the
        // style tag, which would make the button unclickable, and before the
        // settle, which absorbs the dismissal animation.
        const [earlyBanner] = await consentOverlayButtons(page);
        await earlyBanner?.click({ timeout: CONSENT_CLICK_TIMEOUT_MS }).catch(() => {});
        await page.addStyleTag({ content: consentHideRule(opts.consentSelector) });
        await page.waitForTimeout(opts.settleMs);
        // A banner that mounts after hydration misses the first look and, with
        // utility-only classes, the style rule too. Sonder's appears 2.5–5s after
        // `load`, so it arrived during the settle and shipped in every header
        // after #814. Look again, for up to LATE_LOOK_POLLS × LATE_LOOK_INTERVAL_MS
        // (the 1.5s a banner-less site used to spend in #814's click timeout). If
        // the banner will not leave, refuse the shot.
        const lateBanner = await waitForConsentOverlay(page);
        if (lateBanner) {
          await lateBanner.click({ timeout: CONSENT_CLICK_TIMEOUT_MS }).catch(() => {});
          await page.waitForTimeout(LATE_DISMISS_SETTLE_MS);
          if ((await consentOverlayButtons(page)).length > 0) {
            throw new ConsentStillVisibleError(opts.url);
          }
        }
        const screenSheets = (await page
          .evaluate(SCREEN_STYLESHEETS_PROBE)
          .catch(() => [])) as string[];
        const unstyled = ownHostStylesheetFailures(
          stylesheetFailures.filter((f) => screenSheets.includes(f.url)),
          [opts.url, page.url()],
        );
        if (unstyled.length > 0) throw new UnstyledPageError(opts.url, unstyled);
        const buf = await page.screenshot({ type: "png" });
        return new Uint8Array(buf);
      } finally {
        await browser.close();
      }
    },
  };
}

/** Runs in the browser on the button: the text of its nearest fixed or sticky
 *  ancestor, or "" when it sits in normal page flow. An ancestor whose content is
 *  taller than the viewport is a scroll wrapper (GSAP ScrollSmoother and the
 *  like pin the whole page in one), not a banner, so it is skipped. Built with
 *  `Function` so the repo's non-DOM tsconfig never type-checks browser globals;
 *  Playwright serializes it and calls it with the element. A plain string would
 *  not work: `evaluate` runs a string as an expression and never passes the
 *  element. */
const overlayTextProbe = new Function(
  "el",
  `for (let n = el; n && n !== document.body; n = n.parentElement) {
    const position = getComputedStyle(n).position;
    if (position !== "fixed" && position !== "sticky") continue;
    if (n.scrollHeight > window.innerHeight * 1.5) continue;
    return n.innerText;
  }
  return "";`,
) as (el: unknown) => string;

type ConsentButton = {
  isVisible: () => Promise<boolean>;
  evaluate: (fn: (el: unknown) => string) => Promise<unknown>;
  click: (opts: { timeout: number }) => Promise<void>;
};

type ConsentProbePage = {
  getByRole: (role: "button", opts: { name: RegExp }) => { all: () => Promise<ConsentButton[]> };
  waitForTimeout: (ms: number) => Promise<void>;
};

/** The first consent-overlay button to appear within the late-look window, or
 *  undefined. A fixed number of polls rather than a clock, so it is bounded. */
async function waitForConsentOverlay(page: ConsentProbePage): Promise<ConsentButton | undefined> {
  for (let i = 0; i < LATE_LOOK_POLLS; i++) {
    if (i > 0) await page.waitForTimeout(LATE_LOOK_INTERVAL_MS);
    const [button] = await consentOverlayButtons(page);
    if (button) return button;
  }
  return undefined;
}

/** Every visible accept/reject button that sits inside a fixed or sticky overlay
 *  whose own text carries cookie or consent copy: the banner's buttons, and not
 *  a newsletter "OK" or a "Cookie Policy" footer link elsewhere on the page. All
 *  matches are checked, not the first, because a late banner is appended after
 *  the content. Enumerating is instant, so a site with no banner pays nothing.
 *  A probe that fails (the consent tool reloaded the page on accept) counts as
 *  no banner. */
async function consentOverlayButtons(page: ConsentProbePage): Promise<ConsentButton[]> {
  const buttons = await page
    .getByRole("button", { name: CONSENT_BUTTON_NAME })
    .all()
    .catch(() => []);
  const found: ConsentButton[] = [];
  for (const button of buttons) {
    if (!(await button.isVisible().catch(() => false))) continue;
    const overlayText = await button.evaluate(overlayTextProbe).catch(() => "");
    if (CONSENT_COPY.test(String(overlayText))) found.push(button);
  }
  return found;
}
