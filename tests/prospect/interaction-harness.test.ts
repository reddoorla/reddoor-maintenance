import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "@playwright/test";
import { probeForms, pageInteractionDeps, INVALID_EMAIL } from "../../src/prospect/interaction.js";

/**
 * THE ABORT HARNESS, PROVED AGAINST A REAL BROWSER AND A REAL SERVER.
 *
 * Every other test of this module supplies a fake `intercept`, so none of them
 * can see whether anything is actually intercepted. That is not a hypothetical
 * gap: the fakes have no router, and their absence already hid a `page.evaluate`
 * bug that made every snippet return undefined and a route deadlock that took
 * whole crawls down. Both suites were green throughout.
 *
 * And the one live run we had was no better. reddoorla.com's contact form marks
 * its fields required, so the browser refused the submit before a request was
 * ever made — the probe returned `blocked: 0`, meaning the interception layer
 * had never once fired against a real page. The claim that we can press submit
 * on a stranger's form without delivering anything rested entirely on reading
 * the code.
 *
 * So the form below is built to be the case that actually tests it: no
 * `required`, no `type="email"`, nothing for the browser to object to. It will
 * genuinely try to POST. The server records every request it receives, and the
 * assertion that matters is that it receives NOTHING.
 */
const FORM_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Contact</title></head>
<body>
  <h1>Contact us</h1>
  <form action="/submit" method="post">
    <label>Your name <input type="text" name="name"></label>
    <label>Email <input type="text" name="email" placeholder="email address"></label>
    <label>Message <textarea name="message"></textarea></label>
    <button type="submit">Send</button>
  </form>
</body></html>`;

/** A newsletter form that submits into a popup, the way Mailchimp's embed does. */
const POPUP_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Newsletter</title></head>
<body>
  <h1>Sign up</h1>
  <form action="/subscribe" method="post" target="popupwindow">
    <label>Email <input type="text" name="email" placeholder="email address"></label>
    <button type="submit">Sign up</button>
  </form>
</body></html>`;

/** No `target` to strip: the handler opens the window itself. */
const JS_POPUP_PAGE =
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Newsletter</title></head>
<body>
  <h1>Sign up</h1>
  <form id="f">
    <label>Email <input type="text" name="email" placeholder="email address"></label>
    <button type="submit">Sign up</button>
  </form>
  <script>
    document.getElementById("f").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = encodeURIComponent(this.querySelector("input").value);
      window.open("/subscribe?email=" + v, "_blank");
    });
  </scr` +
  `ipt>
</body></html>`;

/** A form beside a challenge iframe, the shape of a contact page with Turnstile. */
const CAPTCHA_PAGE =
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Contact</title></head>
<body>
  <h1>Contact us</h1>
  <form>
    <label>Your name <input type="text" name="name"></label>
    <label>Email <input type="text" name="email" placeholder="email address"></label>
    <label>Message <textarea name="message"></textarea></label>
    <iframe src="/challenge" title="challenge" width="300" height="65"></iframe>
    <button type="submit">Send</button>
  </form>
  <script>
    // Submits nothing, so the page survives the probe and the iframe can be
    // inspected afterwards. An unhandled form would navigate to itself, the
    // interceptor would abort that, and there would be no page left to look at.
    document.querySelector("form").addEventListener("submit", (e) => e.preventDefault());
  </scr` +
  `ipt>
</body></html>`;

describe("the Tier 4 abort harness, against a real browser", () => {
  let server: Server;
  let browser: Browser;
  let base = "";
  const received: { method: string; url: string; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith("/subscribe")) {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          received.push({ method: req.method!, url: req.url!, body });
          res.writeHead(200, { "content-type": "text/html" });
          res.end("<!doctype html><p>subscribed</p>");
        });
        return;
      }
      if (req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          received.push({ method: req.method!, url: req.url!, body });
          res.writeHead(200, { "content-type": "text/html" });
          res.end("<!doctype html><p>thanks</p>");
        });
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        req.url === "/popup"
          ? POPUP_PAGE
          : req.url === "/js-popup"
            ? JS_POPUP_PAGE
            : req.url === "/captcha"
              ? CAPTCHA_PAGE
              : req.url === "/challenge"
                ? "<!doctype html><p>captcha</p>"
                : FORM_PAGE,
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((r) => server?.close(() => r()));
  });

  it("stops the submission, and the server never hears from it", async () => {
    received.length = 0;
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: "load" });

    const probe = await probeForms(pageInteractionDeps(page, base));

    // The receipt. `blocked: 0` is what a probe that never intercepted anything
    // looks like, and it is what our only previous live run returned.
    expect(probe).not.toBeNull();
    expect(probe!.blocked).toBeGreaterThan(0);

    // The claim the whole feature rests on.
    expect(received).toEqual([]);

    // And the verdicts follow from the interception rather than from the
    // browser's own validation, which this form deliberately gives it none of.
    expect(probe!.emptyRefused).toBe(false);
    expect(probe!.emptyHow).toContain("stopped the request");

    await page.close();
  }, 90_000);

  it("puts the page back: the marker is gone and navigation works again", async () => {
    // An interceptor left armed aborts every navigation for the rest of the
    // crawl — silently emptying the remaining pages, which is worse than the
    // deadlock it replaced. And the marker is our attribute, not the site's:
    // left behind, it appears in the next page's extract as markup they do not
    // have.
    received.length = 0;
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: "load" });
    await probeForms(pageInteractionDeps(page, base));

    const res = await page.goto(base, { waitUntil: "load" });
    expect(res?.status()).toBe(200);
    expect(await page.locator("[data-audit-form]").count()).toBe(0);
    expect(await page.locator("form").count()).toBe(1);
    await page.close();
  }, 90_000);

  it("survives a second probe on the same page object", async () => {
    // The deadlock reproduced two runs in four and only ever on the SECOND
    // probe, because `unroute` waits for in-flight handlers the reload leaves
    // behind. No fake has a router, so no unit test can reach this. A hang here
    // is the regression, and the test timeout is the assertion.
    received.length = 0;
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: "load" });
    const first = await probeForms(pageInteractionDeps(page, base));

    // The page has to be navigated back first. Aborting the second submission
    // leaves Chromium on its own error page, so the tab the probe hands back is
    // not the site — see the test below. In the crawl that is harmless and
    // deliberate: `crawl.ts` runs the probe LAST, after `page.content()`, axe
    // and vitals, and latches `formProbed` so it happens once per crawl.
    await page.goto(base, { waitUntil: "load" });
    const second = await probeForms(pageInteractionDeps(page, base));

    expect(first?.blocked).toBeGreaterThan(0);
    expect(second?.blocked).toBeGreaterThan(0);
    expect(received).toEqual([]);
    await page.close();
  }, 120_000);

  it("returns nothing rather than a verdict when the page it is handed has no form", async () => {
    // What the probe leaves behind: the aborted submission puts Chromium on its
    // own error page. Asked to probe THAT, it must decline — a verdict invented
    // from a page the site never served would be a finding about nobody.
    received.length = 0;
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: "load" });
    await probeForms(pageInteractionDeps(page, base));

    expect(page.url()).not.toBe(base);
    expect(await probeForms(pageInteractionDeps(page, base))).toBeNull();
    expect(received).toEqual([]);
    await page.close();
  }, 90_000);

  it("stops a form that submits into a popup window", async () => {
    // The shape that prompted this: clearleft.com's only form is a Mailchimp
    // newsletter posting to `target="popupwindow"`. `page.route` is registered
    // on the page, and a popup is a NEW page — so if the interception does not
    // reach it, the probe delivers a real signup to a real list.
    received.length = 0;
    const page = await browser.newPage();
    await page.goto(`${base}popup`, { waitUntil: "load" });
    await probeForms(pageInteractionDeps(page, `${base}popup`));
    // A popup navigates on its own schedule; give it longer than the probe took.
    await page.waitForTimeout(1500);
    expect(received).toEqual([]);
    await page.close();
  }, 90_000);

  it("stops a submit handler that opens the window itself", async () => {
    // The belt to the target-stripping braces. There is no `target` attribute
    // to remove here — the handler calls `window.open` — so this passes only
    // because the interceptor is registered on the CONTEXT and treats any
    // request from another page as the submission.
    received.length = 0;
    const page = await browser.newPage();
    await page.goto(`${base}js-popup`, { waitUntil: "load" });
    await probeForms(pageInteractionDeps(page, `${base}js-popup`));
    await page.waitForTimeout(1500);
    expect(received).toEqual([]);
    await page.close();
  }, 90_000);

  it("lets a captcha iframe load, and does not count it as a submission", async () => {
    // The regression the popup rule could have caused. A `<iframe src>` is also
    // a navigation request; the difference is that its frame RESOLVES, where a
    // popup's throws because the request is what creates it. Getting this wrong
    // both breaks Turnstile on the page we are trying to observe and adds to
    // `blocked` — which the verdict reads as "the form submitted", accusing a
    // good form of sending an empty enquiry on exactly the pages most likely to
    // have one.
    received.length = 0;
    const page = await browser.newPage();
    await page.goto(`${base}captcha`, { waitUntil: "load" });
    const probe = await probeForms(pageInteractionDeps(page, `${base}captcha`));

    // The challenge loaded, and is still there after the probe ran.
    expect(page.frames().length).toBeGreaterThan(1);
    expect(await page.frameLocator("iframe").locator("p").innerText()).toBe("captcha");
    // Nothing was stopped: the iframe navigation must not reach the counter,
    // because `blocked` IS the "did it submit?" measurement.
    expect(probe!.blocked).toBe(0);
    expect(probe!.emptyHow).toContain("did nothing at all");
    expect(received).toEqual([]);
    await page.close();
  }, 90_000);

  it("sends the junk address nowhere either", async () => {
    received.length = 0;
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: "load" });
    const probe = await probeForms(pageInteractionDeps(page, base));

    // A text input named "email" is an email field to CHOOSE_FORM and not to
    // the browser, so nothing client-side catches the junk value — the request
    // is made, and we are the only thing that stops it.
    expect(probe!.invalidEmailRefused).toBe(false);
    expect(received).toEqual([]);
    expect(INVALID_EMAIL).not.toContain("@");
    await page.close();
  }, 90_000);
});
