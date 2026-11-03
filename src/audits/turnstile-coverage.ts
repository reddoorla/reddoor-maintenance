/**
 * Turnstile coverage: on a site whose row has `require_turnstile`, every page that
 * carries a lead form must render the Turnstile widget with that form.
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
 * sees with no `.cf-turnstile` mount of its own cannot mint a token, so on a gated
 * site every submission from it is lost: that is a FAIL. A mount that IS present
 * is left to form-e2e's own widget verdict to judge (script loaded, no widget
 * error); this module never manufactures a pass. A page it could not judge (did
 * not load, never confirmed hydration before a trigger had to be clicked, or was
 * cut by the time budget) is named, never failed: a false fail here is an alarm
 * that pages every morning and cannot be muted.
 */

import { HYDRATION_TIMEOUT_MS, waitForHydration } from "./util/hydration-wait.js";

/** A lead form: a `<form>` that asks for an email. A search box does not count
 *  (the same rule as findFormPath). */
export const LEAD_FORM = 'form:has(input[type="email"], input[name="email"])';

/**
 * A form that asks for an email but does not post to central ingest (an email
 * preferences page, a third-party newsletter) can carry this attribute to be left
 * out. Ingest gates every form type on a `require_turnstile` site, so the opt-out
 * is for forms that never reach it, and it is explicit so it is never a guess.
 */
export const EXEMPT_ATTR = "data-turnstile-exempt";

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
  /** A lead form was in the page as loaded (hand-off and exempt forms excluded). */
  pageForm: boolean;
  /** Every such form had its own mount (inside it, or inside its dialog). */
  pageCovered: boolean;
  /** Clicking an inquiry trigger opened a NEW dialog with a lead form, on this page. */
  modalForm: boolean;
  /** ...and every lead form in it had its own mount. */
  modalCovered: boolean;
  /** Nothing was judged: the page did not load, or threw. */
  unreachable?: boolean;
  /** The modal half was not judged: a trigger existed but the page never said it
   *  had hydrated, so a click could not be told from a plain link; or the pass
   *  ran out of time before reaching the page. */
  unjudged?: "hydration" | "deadline";
};

export type TurnstileCoverage = { pages: PageCoverage[] };

/** The paths whose lead form renders with no Turnstile mount. PURE. */
export function uncoveredPaths(coverage: TurnstileCoverage): string[] {
  return coverage.pages
    .filter((p) => (p.pageForm && !p.pageCovered) || (p.modalForm && !p.modalCovered))
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
  const looked = coverage.pages.filter((p) => !p.unreachable && p.unjudged !== "deadline");
  const unreachable = coverage.pages.filter((p) => p.unreachable).map((p) => p.path);
  const unjudged = coverage.pages.filter((p) => p.unjudged === "hydration").map((p) => p.path);
  const unreached = coverage.pages.filter((p) => p.unjudged === "deadline").map((p) => p.path);
  const caveats =
    (unreachable.length ? `; did not load: ${unreachable.join(", ")}` : "") +
    (unjudged.length ? `; modal not judged: ${unjudged.join(", ")}` : "") +
    (unreached.length ? `; not reached (time budget): ${unreached.join(", ")}` : "");
  if (missing.length > 0) {
    return `Require Turnstile on, but no widget on ${missing.join(", ")}: every submission from there is stored as spam and emailed to nobody${caveats}`;
  }
  if (looked.length === 0) return `Turnstile coverage not checked: no page loaded${caveats}`;
  return `Turnstile on every form page (${withForm.length ? withForm.join(", ") : "none"} of ${looked.length} pages checked)${caveats}`;
}

const GOTO_TIMEOUT_MS = 15_000;
/** The most one page may take, load and click included. */
const PAGE_TIMEOUT_MS = 45_000;
/** How long a clicked trigger has to open its form. The modal opens on the click;
 *  this is headroom for a cold page, not an animation window. */
const OPEN_TIMEOUT_MS = 5_000;
/** The whole pass, so a slow gated site cannot eat the nightly's 30-minute step. */
export const COVERAGE_BUDGET_MS = 180_000;

/**
 * Whether every judged lead form inside `root` has its own mount: inside the form,
 * or inside the dialog that holds it. A hand-off form (its action ends `#inquire`,
 * or it holds a trigger) is judged by the modal it opens, and an exempt form is
 * not judged at all. Browser-side, so it is a string: this package does not
 * compile against the DOM lib.
 */
const JUDGE_FN = `(root) => {
  const forms = [...root.querySelectorAll(${JSON.stringify(LEAD_FORM)})].filter(
    (f) =>
      !f.hasAttribute(${JSON.stringify(EXEMPT_ATTR)}) &&
      !(f.getAttribute("action") || "").endsWith("#inquire") &&
      !f.querySelector("[data-inquire]"),
  );
  const own = (f) => {
    if (f.querySelector(${JSON.stringify(TURNSTILE_MOUNT)})) return true;
    const d = f.closest('[role="dialog"], dialog');
    return !!d && d.querySelector(${JSON.stringify(TURNSTILE_MOUNT)}) !== null;
  };
  return { form: forms.length > 0, covered: forms.every(own) };
}`;

const SEEN_ATTR = "data-turnstile-coverage-seen";
const DIALOGS = `[...document.querySelectorAll('[role="dialog"], dialog')]`;

/** The page as loaded; also marks every dialog already present, so a popup that
 *  was there before the click is never mistaken for the one the click opened. */
const PAGE_STATE_EXPR = `(() => {
  ${DIALOGS}.forEach((d) => d.setAttribute(${JSON.stringify(SEEN_ATTR)}, ""));
  const judged = (${JUDGE_FN})(document);
  return {
    pageForm: judged.form,
    pageCovered: judged.covered,
    hasTrigger: document.querySelector(${JSON.stringify(FORM_TRIGGER)}) !== null,
  };
})()`;

/** Click the first inquiry trigger with a real click event, visible or not (the
 *  modal listens on `document` in the capture phase). */
const CLICK_TRIGGER_EXPR = `(() => {
  const t = document.querySelector(${JSON.stringify(FORM_TRIGGER)});
  if (!t) return false;
  t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  return true;
})()`;

/** A dialog the click opened (unmarked) holding a lead form, judged; null while
 *  none has appeared. */
const DIALOG_STATE_EXPR = `(() => {
  const judge = ${JUDGE_FN};
  let found = false;
  let covered = true;
  // Every new dialog with a lead form, not the first: a marked dialog the
  // framework re-created after marking carries no mark, and must not stand in
  // for the modal (a covered copy would hide its gap).
  for (const d of ${DIALOGS}) {
    if (d.hasAttribute(${JSON.stringify(SEEN_ATTR)})) continue;
    const j = judge(d);
    if (j.form) {
      found = true;
      covered = covered && j.covered;
    }
  }
  return found ? { modalCovered: covered } : null;
})()`;

/** The slice of a Playwright Page this pass uses. */
type CoveragePage = {
  goto: (
    url: string,
    opts: { waitUntil: "domcontentloaded"; timeout: number },
  ) => Promise<{ ok: () => boolean } | null>;
  url: () => string;
  evaluate: <T>(expr: string) => Promise<T>;
  waitForLoadState: (state: "load", opts: { timeout: number }) => Promise<unknown>;
  waitForFunction: (expr: string, arg: unknown, opts: { timeout: number }) => Promise<unknown>;
};

export type CoverageOpts = {
  hydrationTimeoutMs?: number;
  openTimeoutMs?: number;
  /** Total budget for the pass (default COVERAGE_BUDGET_MS). */
  budgetMs?: number;
};

/** Load `url` and report what it carries. Never throws: a page that cannot be
 *  read is `unreachable`, which judges nothing. */
export async function inspectPage(
  page: CoveragePage,
  url: string,
  opts: CoverageOpts = {},
): Promise<PageCoverage> {
  const path = new URL(url).pathname;
  const none = { pageForm: false, pageCovered: true, modalForm: false, modalCovered: true };
  // Set once the page itself was judged, so a throw after the click (a late
  // navigation destroying the context) keeps that verdict instead of
  // reporting the page as never loaded.
  let judged: PageCoverage | undefined;
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: GOTO_TIMEOUT_MS });
    if (!resp || !resp.ok()) return { path, ...none, unreachable: true };
    // A trigger clicked before hydration is a plain link to /contact, which would
    // read as "no form here": wait for the site to say it hydrated (capped).
    const hydration = await waitForHydration(page, {
      timeoutMs: opts.hydrationTimeoutMs ?? HYDRATION_TIMEOUT_MS,
    });
    const own = await page.evaluate<{
      pageForm: boolean;
      pageCovered: boolean;
      hasTrigger: boolean;
    }>(PAGE_STATE_EXPR);
    const result: PageCoverage = {
      path,
      ...none,
      pageForm: own.pageForm,
      pageCovered: own.pageCovered,
    };
    judged = result;
    if (!own.hasTrigger) return result;

    const before = new URL(page.url()).pathname;
    await page.evaluate<boolean>(CLICK_TRIGGER_EXPR);
    const opened = await page
      .waitForFunction(`${DIALOG_STATE_EXPR} !== null`, undefined, {
        timeout: opts.openTimeoutMs ?? OPEN_TIMEOUT_MS,
      })
      .then(() => true)
      .catch(() => false);
    // A trigger that navigated (a nav CTA on a page with no modal) opened the
    // form of ANOTHER page; that page is judged on its own visit.
    const stayed = new URL(page.url()).pathname === before;
    if (!opened || !stayed) {
      // Unconfirmed hydration means the click may have been a plain link only
      // because the listener was not attached yet: say so rather than pass it.
      return hydration === "marker" ? result : { ...result, unjudged: "hydration" };
    }
    const dialog = await page.evaluate<{ modalCovered: boolean } | null>(DIALOG_STATE_EXPR);
    if (!dialog) return result;
    return { ...result, modalForm: true, modalCovered: dialog.modalCovered };
  } catch {
    return judged ? { ...judged, unjudged: "hydration" } : { path, ...none, unreachable: true };
  }
}

/** Visit each URL in a fresh page of one browser context and report its coverage,
 *  within one total budget; pages the budget does not reach are `unjudged`. */
export async function checkTurnstileCoverage(
  urls: readonly string[],
  opts: CoverageOpts = {},
): Promise<TurnstileCoverage> {
  const { chromium } = await import("@playwright/test");
  const deadline = Date.now() + (opts.budgetMs ?? COVERAGE_BUDGET_MS);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const pages: PageCoverage[] = [];
    for (const url of urls) {
      if (Date.now() >= deadline) {
        pages.push({
          path: new URL(url).pathname,
          pageForm: false,
          pageCovered: true,
          modalForm: false,
          modalCovered: true,
          unjudged: "deadline",
        });
        continue;
      }
      // One retry for a page that did not load: on 2026-11-03 a live run lost
      // /boise to a one-off load failure that two reruns did not repeat.
      let result: PageCoverage | undefined;
      for (let attempt = 0; attempt < 2 && (!result || result.unreachable); attempt++) {
        if (attempt > 0 && Date.now() >= deadline) break;
        const page = await ctx.newPage();
        try {
          // Bounded even if an evaluate hangs on a busy page, so the budget holds.
          result = await Promise.race([
            inspectPage(page as unknown as CoveragePage, url, opts),
            new Promise<PageCoverage>((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    path: new URL(url).pathname,
                    pageForm: false,
                    pageCovered: true,
                    modalForm: false,
                    modalCovered: true,
                    unreachable: true,
                  }),
                PAGE_TIMEOUT_MS,
              ).unref?.(),
            ),
          ]);
        } finally {
          await page.close().catch(() => {});
        }
      }
      if (result) pages.push(result);
    }
    return { pages };
  } finally {
    await browser.close();
  }
}
