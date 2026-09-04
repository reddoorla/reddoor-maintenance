/**
 * The two questions you can only answer by pressing the button.
 *
 * Every other check in this battery observes. This one ACTS on a stranger's
 * website, and that changes what has to be true before a line of it runs.
 *
 * THE PROMISE THIS MODULE MAKES: nothing we do here reaches their server.
 * A contact form with no client-side validation, submitted empty, POSTs to
 * whoever reads that inbox — a junk enquiry from an audit they never asked for,
 * and one that would be indistinguishable from a real lead. So the route
 * interceptor is armed BEFORE the first click, it aborts every navigation and
 * every same-origin non-GET, and the count of what it stopped is carried back
 * in `blocked` so the claim "we submitted nothing" is checkable rather than
 * merely asserted.
 *
 * That interception is also the measurement. A form that refuses an empty
 * submit never asks the network for anything; a form that accepts one tries,
 * and we catch it trying. The thing that keeps us honest and the thing that
 * produces the finding are the same mechanism.
 *
 * WHY IT IS WORTH THE TROUBLE. "Your contact form silently does nothing when
 * somebody submits it empty" is the finding a business acts on within the hour,
 * and there is no way to see it from the markup: the form looks perfect.
 */

/** Text a validation message plausibly contains, in the languages we can claim
 *  to read. Deliberately narrow — a false positive here reports a site as fine
 *  when its form is broken, which is the direction that costs a real lead. */
const ERROR_WORDS =
  /\b(required|please\s|cannot be blank|can't be blank|must be|enter a|fill in|invalid|not valid|is not a valid)\b/i;

/** Values that look like a person filling the form in properly, so the only
 *  thing wrong on the second pass is the email address. */
const FILLER: Record<string, string> = {
  text: "Audit Test",
  search: "Audit Test",
  tel: "2085550142",
  url: "https://example.com",
  number: "1",
  date: "2030-01-01",
  textarea: "Checking that this form validates what it is given.",
};

export const INVALID_EMAIL = "not-an-email";

/** Takes our marker back off the page. */
const REMOVE_MARKER = `() => {
  document.querySelector("[data-audit-form]")?.removeAttribute("data-audit-form");
}`;

export type FormProbe = {
  /** The page we probed, so a finding has an address. */
  url: string;
  /**
   * Whether an empty submit was refused.
   *
   * `undefined` means we could not tell — the form sits in a cross-origin
   * iframe, or the click threw, or the browser pass never ran. It is never a
   * failure: a form we could not reach is our gap, not their defect.
   */
  emptyRefused: boolean | undefined;
  /** How it refused, in words a report can print. */
  emptyHow: string | null;
  /** Same, for an address that is not an address. Null when the form asks for
   *  no email at all, which is a form we have nothing to say about here. */
  invalidEmailRefused: boolean | null | undefined;
  invalidEmailHow: string | null;
  /** Requests the interceptor stopped. The receipt for "we sent nothing". */
  blocked: number;
};

/** What the page told us about the form it chose, before anything was clicked. */
type Chosen = {
  fields: number;
  hasEmail: boolean;
  action: string;
};

/**
 * Picks the form a visitor would use to make contact.
 *
 * Scored rather than matched, because `<form>` on a real site is as likely to
 * be a search box, a newsletter capture or a language switcher as an enquiry.
 * A search form scores itself out: submitting one is harmless but it answers a
 * question nobody asked.
 */
const CHOOSE_FORM = `() => {
  const forms = Array.from(document.querySelectorAll("form"));
  let best = null;
  let bestScore = 0;
  for (const form of forms) {
    const controls = Array.from(form.querySelectorAll("input, textarea, select"));
    const typed = (el) => (el.getAttribute("type") || el.tagName.toLowerCase()).toLowerCase();
    const visible = controls.filter((el) => {
      const t = typed(el);
      if (t === "hidden" || t === "submit" || t === "button" || t === "reset") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (visible.length === 0) continue;

    const attrs = (el) =>
      [el.getAttribute("name"), el.getAttribute("id"), el.getAttribute("autocomplete"),
       el.getAttribute("placeholder"), el.getAttribute("aria-label")]
        .filter(Boolean).join(" ").toLowerCase();
    const hasEmail = visible.some(
      (el) => typed(el) === "email" || /\\bemail\\b|e-mail/.test(attrs(el)),
    );
    const hasMessage = visible.some((el) => el.tagName === "TEXTAREA");
    const action = (form.getAttribute("action") || "").toLowerCase();
    const looksLikeSearch =
      visible.length === 1 &&
      (visible.some((el) => typed(el) === "search") || /search|\\/s\\b|\\?q=/.test(action) ||
       /search|query/.test(attrs(visible[0])));
    if (looksLikeSearch) continue;
    // A password field means this is a login, not an enquiry. Interacting with
    // one is both useless and rude.
    if (visible.some((el) => typed(el) === "password")) continue;

    const submit = form.querySelector(
      'button[type="submit"], input[type="submit"], button:not([type]), button[type="button"]',
    );
    if (!submit) continue;

    let score = visible.length;
    if (hasEmail) score += 4;
    if (hasMessage) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = { form, hasEmail, fields: visible.length, action };
    }
  }
  if (!best) return null;
  best.form.setAttribute("data-audit-form", "");
  return { fields: best.fields, hasEmail: best.hasEmail, action: best.action };
}`;

/** Fills every visible control except the email, which gets the junk value.
 *  Returns nothing: what matters is the form's own opinion afterwards. */
const FILL_FORM = `(args) => {
  const form = document.querySelector("[data-audit-form]");
  if (!form) return false;
  const controls = Array.from(form.querySelectorAll("input, textarea, select"));
  const fire = (el) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  for (const el of controls) {
    const type = (el.getAttribute("type") || el.tagName.toLowerCase()).toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button" || type === "reset") continue;
    const attrs = [el.getAttribute("name"), el.getAttribute("id"), el.getAttribute("autocomplete"),
                   el.getAttribute("placeholder")].filter(Boolean).join(" ").toLowerCase();
    const isEmail = type === "email" || /\\bemail\\b|e-mail/.test(attrs);
    if (el.tagName === "SELECT") {
      if (el.options.length > 1) { el.selectedIndex = 1; fire(el); }
      continue;
    }
    if (type === "checkbox" || type === "radio") {
      if (!el.checked) { el.checked = true; fire(el); }
      continue;
    }
    el.value = isEmail ? args.invalidEmail : (args.filler[type] || args.filler.text);
    fire(el);
  }
  return true;
}`;

/** The form's own verdict plus anything on the page that reads as an error.
 *  Both, because native constraint validation and a JS form library are two
 *  different mechanisms and a site may use either. */
const READ_STATE = `(args) => {
  const form = document.querySelector("[data-audit-form]");
  if (!form) return null;
  const nativeInvalid = typeof form.checkValidity === "function" ? !form.checkValidity() : false;
  const flagged = form.querySelectorAll('[aria-invalid="true"], .error, .is-invalid, .invalid').length;
  const alerts = Array.from(form.querySelectorAll('[role="alert"], [aria-live]'))
    .map((el) => (el.textContent || "").trim())
    .filter(Boolean)
    .join(" ");
  const text = (form.textContent || "").replace(/\\s+/g, " ").trim();
  return {
    nativeInvalid,
    flagged,
    hasErrorText: new RegExp(args.words, "i").test(alerts + " " + text),
  };
}`;

export type InteractionDeps = {
  /** Everything this needs from a Playwright page, named so a test can supply
   *  it without a browser. */
  evaluate: <T>(fn: string, arg?: unknown) => Promise<T>;
  /** Clicks the form's submit control. Resolves even when the click does
   *  nothing, which is one of the outcomes we are here to detect. */
  clickSubmit: () => Promise<void>;
  /** Arms the interceptor and returns a handle that reports what it stopped,
   *  can re-fetch the page past its own guard, and puts everything back. */
  intercept: () => Promise<{
    blocked: () => number;
    /** A clean copy of the page. False when the form did not come back. */
    reload: () => Promise<boolean>;
    release: () => Promise<void>;
  }>;
  /** Lets a client-side validator paint before we read the DOM. */
  settle: (ms: number) => Promise<void>;
  url: string;
};

/** How long a JS validator gets to render its message before we look. Long
 *  enough for a framework re-render, short enough that it is not a timeout. */
export const VALIDATION_SETTLE_MS = 600;

/** Nothing in this module may hang the crawl. A probe that stalls costs the
 *  whole audit — twenty pages already fetched, thrown away — where an
 *  abandoned one costs two checks that honestly read "not measured". */
export const PROBE_BUDGET_MS = 45_000;

/** Resolves to `null` rather than waiting forever. Used on every step that
 *  talks to a browser we do not control. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work.catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function probeForms(deps: InteractionDeps): Promise<FormProbe | null> {
  const chosen = await deps.evaluate<Chosen | null>(CHOOSE_FORM);
  if (!chosen) return null;

  const guard = await deps.intercept();
  const probe: FormProbe = {
    url: deps.url,
    emptyRefused: undefined,
    emptyHow: null,
    invalidEmailRefused: chosen.hasEmail ? undefined : null,
    invalidEmailHow: null,
    blocked: 0,
  };

  try {
    // ---- Empty ------------------------------------------------------------
    // The browser's own answer first: a form with a `required` field on it
    // reports itself invalid before anything is clicked, and that IS the
    // refusal — the click would only make the browser say so out loud.
    const before = await deps.evaluate<{
      nativeInvalid: boolean;
      flagged: number;
      hasErrorText: boolean;
    } | null>(READ_STATE, { words: ERROR_WORDS.source });

    if (before?.nativeInvalid) {
      probe.emptyRefused = true;
      probe.emptyHow = "the browser blocks it — the form marks its fields required";
    } else {
      const beforeBlocked = guard.blocked();
      await deps.clickSubmit();
      await deps.settle(VALIDATION_SETTLE_MS);
      const after = await deps.evaluate<{
        nativeInvalid: boolean;
        flagged: number;
        hasErrorText: boolean;
      } | null>(READ_STATE, { words: ERROR_WORDS.source });
      const attempted = guard.blocked() > beforeBlocked;
      const complained =
        after !== null &&
        (after.hasErrorText || after.flagged > (before?.flagged ?? 0) || after.nativeInvalid);

      if (complained) {
        // CHECKED BEFORE `attempted`, deliberately. A form that paints "please
        // fill this in" has not sent anything; if some same-origin beacon fired
        // on the same click, reading that as a submission would call a good
        // form broken. The false accusation is the expensive mistake here — a
        // missed detection is only a silent pass.
        probe.emptyRefused = true;
        probe.emptyHow = "the form showed an error rather than submitting";
      } else if (attempted) {
        // Nothing said, and something tried to leave: an empty enquiry was on
        // its way to somebody's inbox.
        probe.emptyRefused = false;
        // Says we stopped it, unprompted. A reader who sees "your form
        // submitted empty" should not have to wonder whether we put a blank
        // enquiry in their inbox to find that out.
        probe.emptyHow =
          "the form submitted with every field empty — we stopped the request before it left the browser";
      } else if (after === null) {
        // The form left the page without a request — we cannot say what
        // happened, so we do not.
        probe.emptyRefused = undefined;
      } else {
        // Nothing sent and nothing said. The button is inert, which is the
        // same experience as a form that swallows the message.
        probe.emptyRefused = false;
        probe.emptyHow = "the button did nothing at all — no error, and nothing sent";
      }
    }

    // ---- An address that is not an address ---------------------------------
    if (chosen.hasEmail) {
      // A CLEAN COPY OF THE PAGE FIRST, always. Two reasons, and each one on
      // its own is enough.
      //
      // A form that accepted the empty submit destroyed itself doing so: the
      // navigation we aborted leaves Chromium on its own error page, and there
      // is no form left to fill.
      //
      // And a form that painted "please enter a valid email" a moment ago still
      // has that text on screen. Reading it after the second click would credit
      // the form with catching something it never saw — a false pass on exactly
      // the sites most likely to be broken.
      const back = await guard.reload();
      const filled = back
        ? await deps.evaluate<boolean>(FILL_FORM, {
            invalidEmail: INVALID_EMAIL,
            filler: FILLER,
          })
        : false;
      if (!filled) {
        probe.invalidEmailRefused = undefined;
      } else {
        const state = await deps.evaluate<{
          nativeInvalid: boolean;
          flagged: number;
          hasErrorText: boolean;
        } | null>(READ_STATE, { words: ERROR_WORDS.source });
        if (state?.nativeInvalid) {
          probe.invalidEmailRefused = true;
          probe.invalidEmailHow = "the browser catches it — the field is typed as an email";
        } else {
          const beforeBlocked = guard.blocked();
          await deps.clickSubmit();
          await deps.settle(VALIDATION_SETTLE_MS);
          const after = await deps.evaluate<{
            nativeInvalid: boolean;
            flagged: number;
            hasErrorText: boolean;
          } | null>(READ_STATE, { words: ERROR_WORDS.source });
          const attempted = guard.blocked() > beforeBlocked;
          // Same ordering as above, and for the same reason.
          if (after && (after.hasErrorText || after.nativeInvalid || after.flagged > 0)) {
            probe.invalidEmailRefused = true;
            probe.invalidEmailHow = "the form showed an error rather than submitting";
          } else if (attempted) {
            probe.invalidEmailRefused = false;
            probe.invalidEmailHow = `the form accepted “${INVALID_EMAIL}” as an email address — we stopped the request before it left the browser`;
          } else {
            probe.invalidEmailRefused = undefined;
          }
        }
      }
    }
  } catch {
    // A click that throws tells us nothing about their form. Everything stays
    // at whatever it had reached, and undefined reads as "not measured".
  } finally {
    probe.blocked = guard.blocked();
    await guard.release();
  }

  return probe;
}

/**
 * The real page, wired to the deps above.
 *
 * `intercept` is the whole safety argument, so it is worth being precise about
 * what it stops. A form submission is either a navigation (a plain `<form>`) or
 * an XHR/fetch to the site's own origin (every JS form library). Both are
 * aborted. Third-party GETs — fonts, images, an analytics beacon — are let
 * through, because blocking them changes how the page behaves without making
 * anyone safer.
 *
 * What is counted as an attempt is narrower still: only navigations and
 * same-origin non-GETs. An analytics POST to a third party fires on all sorts
 * of clicks and is not this form trying to send a message, and counting one
 * would report a working form as broken.
 *
 * A dialog handler goes on for the duration too — a `confirm()` in a submit
 * handler blocks the page forever otherwise, and that would cost the whole
 * crawl, not just this check.
 */
export function pageInteractionDeps(
  page: import("@playwright/test").Page,
  url: string,
): InteractionDeps {
  return {
    url,
    settle: (ms) => page.waitForTimeout(ms),
    // Playwright evaluates a STRING as an expression and does not call it —
    // `page.evaluate("() => 1 + 1")` yields a function object, which serialises
    // to undefined, so every snippet here silently returned nothing. The call
    // has to be written out, with the argument inlined as JSON (every argument
    // in this file is our own constant, never anything off the page).
    evaluate: <T>(fn: string, arg?: unknown) =>
      page.evaluate(`(${fn})(${JSON.stringify(arg ?? null)})`) as Promise<T>,
    async clickSubmit() {
      const submit = page
        .locator(
          '[data-audit-form] button[type="submit"], [data-audit-form] input[type="submit"], [data-audit-form] button:not([type]), [data-audit-form] button[type="button"]',
        )
        .first();
      // `force`, because a submit button under a sticky footer or a cookie bar
      // is not a broken form and we are not here to test our own aim. `noWaitAfter`
      // because the navigation we might provoke is one we intend to abort.
      await submit.click({ timeout: 5_000, force: true, noWaitAfter: true });
    },
    async intercept() {
      let blocked = 0;
      // Open only while `reload` below is running, and nothing clicks during
      // that window — the sole navigation it lets through is our own GET back
      // to a page we already fetched.
      let allowNavigation = false;
      // Disarmed by `release`, BEFORE it tries to unroute. If the unroute does
      // not complete — and it sometimes does not — the handler stays registered
      // for the rest of the crawl, and an armed one aborts every navigation
      // that follows. That would have silently emptied the remaining pages of a
      // twenty-page crawl, which is far worse than the hang it replaced.
      let armed = true;
      let origin = "";
      try {
        origin = new URL(url).origin;
      } catch {
        origin = "";
      }
      const onDialog = (d: import("@playwright/test").Dialog) => void d.dismiss().catch(() => {});
      page.on("dialog", onDialog);
      // SYNCHRONOUS, and the route resolved fire-and-forget.
      //
      // This is the deadlock, and it took a live crawl to find. An `async`
      // handler returns a promise, and `unroute`/`unrouteAll` WAIT for every
      // such promise still in flight — so the second probe against a given page
      // hung in `release`, and the third hung in `route` itself, each taking a
      // twenty-page crawl down with it. No unit test could see it: the fakes
      // have no router.
      //
      // Returning nothing leaves Playwright nothing to await, and the abort or
      // continue still lands a tick later. The decision is made synchronously
      // so `blocked` is accurate the instant the request is seen.
      await page.route("**/*", (route) => {
        if (!armed) {
          void route.continue().catch(() => {});
          return;
        }
        let stop: boolean;
        try {
          const req = route.request();
          // MAIN FRAME ONLY. `isNavigationRequest` is also true for an iframe
          // loading its own document, and on a contact page that is usually a
          // captcha. Aborting Cloudflare Turnstile's challenge both breaks the
          // widget on the page we are trying to observe and counts as a stopped
          // request — which the verdict reads as "the form submitted". A
          // third-party iframe appearing in the second after a click would have
          // accused a perfectly good form of sending an empty enquiry, on
          // exactly the page most likely to have one.
          //
          // A form submitting INTO an iframe is still caught, by the
          // same-origin non-GET rule below.
          const isNavigation = req.isNavigationRequest() && req.frame() === page.mainFrame();
          const method = req.method().toUpperCase();
          const sameOrigin = (() => {
            try {
              return new URL(req.url()).origin === origin;
            } catch {
              return false;
            }
          })();
          // A form submission is either a navigation or a same-origin non-GET.
          // Third-party GETs — fonts, images, an analytics beacon — are let
          // through: blocking them changes how the page behaves without making
          // anyone safer. Our own reload is the one navigation allowed.
          stop = (isNavigation && !allowNavigation) || (method !== "GET" && sameOrigin);
        } catch {
          // A request we cannot even read is one we do not block, because the
          // only thing that could make it dangerous is being a submission, and
          // we would have been able to read that.
          stop = false;
        }
        if (stop) blocked++;
        void (stop ? route.abort() : route.continue()).catch(() => {});
      });

      return {
        blocked: () => blocked,
        reload: async () => {
          allowNavigation = true;
          try {
            await page.goto(url, { waitUntil: "load", timeout: 20_000 });
          } catch {
            return false;
          } finally {
            allowNavigation = false;
          }
          const again = await page.evaluate(`(${CHOOSE_FORM})(null)`).catch(() => null);
          return again !== null;
        },
        release: async () => {
          armed = false;
          page.off("dialog", onDialog);
          // THE MARKER FIRST, while the page is still definitely answering.
          // Then the routes.
          // The marker is ours; leaving it behind would show up in the next
          // page's extract as markup the site does not have. Passed as a
          // STRING like every other snippet here: `src/prospect/types.ts` is a
          // build entry, and an inline arrow touching `document` puts the DOM
          // lib on the declaration build, which does not have one.
          await withTimeout(page.evaluate(`(${REMOVE_MARKER})()`), 5_000);

          // `unrouteAll`, NOT `unroute`, and with `ignoreErrors`.
          //
          // This is the deadlock. `page.unroute` waits for route handlers that
          // are still in flight, and the reload above leaves several — so the
          // SECOND probe on a given page object hung here forever, taking a
          // twenty-page crawl down with it. It reproduced two runs in four and
          // never in a unit test, because the fakes have no router at all.
          // Short, because it is now only tidying: the handler above is
          // already inert, so a timeout here costs nothing but a registration
          // that passes everything through.
          await withTimeout(page.unrouteAll({ behavior: "ignoreErrors" }), 3_000);
        },
      };
    },
  };
}
