/**
 * Turnstile coverage: on a site whose row has `require_turnstile`, every page that
 * carries a lead form must render the Turnstile widget.
 *
 * Why it exists (workspace reports/2026-11-03-forms-spam-review): reddoorla.com's
 * `/contact` carried the widget, so form-e2e, which probes `/contact`, scored the
 * site's widget `pass`. Its `/medtech` and `/boise` landing pages open an inquiry
 * modal that rendered no widget. Central ingest stores a tokenless submission on a
 * gated site as `spam_auto` (`turnstile-required-absent`) and emails nobody, while
 * the visitor sees success: all 41 inquiries from those pages, 11 from production,
 * were lost that way, under a green verdict. One page with the widget said nothing
 * about the others.
 *
 * The check is conclusive in one direction only. A lead form that a real browser
 * sees with no `.cf-turnstile` mount beside it cannot mint a token, so on a gated
 * site every submission from it is lost: that is a FAIL. A mount that IS present
 * is left to form-e2e's own widget verdict to judge (script loaded, no widget
 * error); this module never manufactures a pass.
 */

import { HYDRATION_TIMEOUT_MS, waitForHydration } from "./util/hydration-wait.js";

/** A lead form: a `<form>` that asks for an email. A search box or a newsletter
 *  form without an email field does not count (the same rule as findFormPath). */
export const LEAD_FORM = 'form:has(input[type="email"], input[name="email"])';

/**
 * The inquiry-modal convention (reddoor-website `InquiryModal`): a CTA that opens
 * a form in a dialog instead of navigating. `data-inquire` on any element, or a
 * link whose href ends `#inquire`. Without JS such a link lands on `/contact`, so
 * the form it opens is not in the page's HTML at all, which is how a page-load
 * check missed it.
 */
export const FORM_TRIGGER = '[data-inquire], a[href$="#inquire"]';

/** The mount point a Turnstile widget renders into, on /contact and in the modal. */
export const TURNSTILE_MOUNT = ".cf-turnstile";

/** What the coverage pass saw on one page. */
export type PageCoverage = {
  path: string;
  /** A lead form was in the page as loaded (hand-off forms excluded, see below). */
  pageForm: boolean;
  /** A Turnstile mount was in the page as loaded. */
  pageMount: boolean;
  /** Clicking an inquiry trigger opened a lead form on this same page. */
  modalForm: boolean;
  /** ...and a Turnstile mount appeared with it. */
  modalMount: boolean;
  /** The page did not load (non-2xx or navigation error): nothing was judged. */
  unreachable?: boolean;
};

export type TurnstileCoverage = { pages: PageCoverage[] };

/** The paths whose lead form renders with no Turnstile mount. PURE. */
export function uncoveredPaths(coverage: TurnstileCoverage): string[] {
  return coverage.pages
    .filter((p) => (p.pageForm && !p.pageMount) || (p.modalForm && !p.modalMount))
    .map((p) => p.path);
}

/** The pages that carried a lead form at all, covered or not. PURE. */
export function formPaths(coverage: TurnstileCoverage): string[] {
  return coverage.pages.filter((p) => p.pageForm || p.modalForm).map((p) => p.path);
}

/** The one-line evidence for a run's summary. PURE. */
export function coverageSummary(coverage: TurnstileCoverage): string {
  const missing = uncoveredPaths(coverage);
  const withForm = formPaths(coverage);
  const looked = coverage.pages.filter((p) => !p.unreachable).length;
  if (missing.length > 0) {
    return `Require Turnstile on, but no widget on ${missing.join(", ")}: every submission from there is stored as spam and emailed to nobody`;
  }
  return `Turnstile on every form page (${withForm.length ? withForm.join(", ") : "none"} of ${looked} pages checked)`;
}

const PAGE_TIMEOUT_MS = 30_000;
/** How long a clicked trigger has to open its form. The modal opens on the click;
 *  this is headroom for a cold page, not an animation window. */
const OPEN_TIMEOUT_MS = 5_000;

/**
 * Judge one loaded page. Runs in the browser, so it is a string: this package does
 * not compile against the DOM lib. Returns the page's own lead form and mount;
 * a hand-off form (its action ends `#inquire`, or its submit is itself a
 * trigger) is not a lead form, since what it opens is judged as the modal.
 */
const PAGE_STATE_EXPR = `(() => {
  const leadForms = [...document.querySelectorAll(${JSON.stringify(LEAD_FORM)})].filter(
    (f) => !(f.getAttribute("action") || "").endsWith("#inquire") && !f.querySelector("[data-inquire]"),
  );
  return {
    pageForm: leadForms.length > 0,
    pageMount: document.querySelector(${JSON.stringify(TURNSTILE_MOUNT)}) !== null,
  };
})()`;

/** Click the first inquiry trigger with a real click event, visible or not (the
 *  modal listens on `document` in the capture phase). False when there is none. */
const CLICK_TRIGGER_EXPR = `(() => {
  const t = document.querySelector(${JSON.stringify(FORM_TRIGGER)});
  if (!t) return false;
  t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  return true;
})()`;

/** After a trigger click: a lead form inside an open dialog, and a mount in that
 *  dialog. Null while no dialog form has appeared yet. */
const DIALOG_STATE_EXPR = `(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"], dialog[open]')].find((d) =>
    d.querySelector(${JSON.stringify(LEAD_FORM)}),
  );
  if (!dialog) return null;
  return { modalMount: dialog.querySelector(${JSON.stringify(TURNSTILE_MOUNT)}) !== null };
})()`;

/** The slice of a Playwright Page this pass uses. */
type CoveragePage = {
  goto: (
    url: string,
    opts: { waitUntil: "domcontentloaded"; timeout: number },
  ) => Promise<{
    ok: () => boolean;
  } | null>;
  url: () => string;
  evaluate: <T>(expr: string) => Promise<T>;
  waitForLoadState: (state: "load", opts: { timeout: number }) => Promise<unknown>;
  waitForFunction: (expr: string, arg: unknown, opts: { timeout: number }) => Promise<unknown>;
};

/** Load `url` and report what it carries. Never throws: a page that cannot be
 *  read is `unreachable`, which judges nothing. */
export async function inspectPage(
  page: CoveragePage,
  url: string,
  opts: { hydrationTimeoutMs?: number; openTimeoutMs?: number } = {},
): Promise<PageCoverage> {
  const path = new URL(url).pathname;
  const none = { pageForm: false, pageMount: false, modalForm: false, modalMount: false };
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    if (!resp || !resp.ok()) return { path, ...none, unreachable: true };
    // A trigger clicked before hydration is a plain link to /contact, which would
    // read as "no form here": wait for the site to say it hydrated (capped).
    await waitForHydration(page, { timeoutMs: opts.hydrationTimeoutMs ?? HYDRATION_TIMEOUT_MS });
    const own = await page.evaluate<{ pageForm: boolean; pageMount: boolean }>(PAGE_STATE_EXPR);
    const result: PageCoverage = { path, ...none, ...own };

    const before = new URL(page.url()).pathname;
    const clicked = await page.evaluate<boolean>(CLICK_TRIGGER_EXPR);
    if (!clicked) return result;
    const opened = await page
      .waitForFunction(`${DIALOG_STATE_EXPR} !== null`, undefined, {
        timeout: opts.openTimeoutMs ?? OPEN_TIMEOUT_MS,
      })
      .then(() => true)
      .catch(() => false);
    // A trigger that navigated (a nav CTA on a page with no modal) opened the
    // form of ANOTHER page; that page is judged on its own visit.
    if (!opened || new URL(page.url()).pathname !== before) return result;
    const dialog = await page.evaluate<{ modalMount: boolean } | null>(DIALOG_STATE_EXPR);
    return { ...result, modalForm: dialog !== null, modalMount: dialog?.modalMount ?? false };
  } catch {
    return { path, ...none, unreachable: true };
  }
}

/** Visit each URL in a fresh page of one browser and report its coverage. */
export async function checkTurnstileCoverage(
  urls: readonly string[],
  opts: { hydrationTimeoutMs?: number; openTimeoutMs?: number } = {},
): Promise<TurnstileCoverage> {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const pages: PageCoverage[] = [];
    for (const url of urls) {
      const ctx = await browser.newContext();
      try {
        const page = await ctx.newPage();
        pages.push(await inspectPage(page as unknown as CoveragePage, url, opts));
      } finally {
        await ctx.close();
      }
    }
    return { pages };
  } finally {
    await browser.close();
  }
}
