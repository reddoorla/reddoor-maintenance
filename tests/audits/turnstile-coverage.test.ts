import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  checkTurnstileCoverage,
  coverageSummary,
  uncoveredPaths,
  type PageCoverage,
  type TurnstileCoverage,
} from "../../src/audits/turnstile-coverage.js";
import { applyCoverage, formE2eAudit, type FormRunner } from "../../src/audits/form-e2e.js";
import { selectFleetSites } from "../../src/inventory/select.js";

// The 2026-11-03 forms review: reddoorla.com's /contact carried the Turnstile
// widget, so form-e2e scored the site's widget "pass", while the inquiry modal on
// /medtech and /boise rendered none and every submission from it was stored as
// spam. These pages model each shape the coverage pass must tell apart.

const HYDRATED = `<script>document.documentElement.setAttribute("data-hydrated","")</script>`;
const NAV = `<nav><a href="/contact#inquire">Let's talk</a></nav>`;

/** The InquiryModal convention: a document-level capture listener turns any
 *  `#inquire` click into an open dialog holding an email form. */
const modal = (withMount: boolean, hydrated = true) => `
<script>
  document.addEventListener("click", (e) => {
    const t = e.target.closest('[data-inquire], a[href$="#inquire"]');
    if (!t) return;
    e.preventDefault();
    if (document.querySelector(".inquiry")) return;
    const d = document.createElement("div");
    d.className = "inquiry";
    d.setAttribute("role", "dialog");
    d.innerHTML = '<form><input type="email" name="email"><button>Inquire Now</button></form>'
      + ${withMount ? `'<div class="cf-turnstile"></div>'` : "''"};
    document.body.appendChild(d);
  }, true);
  ${hydrated ? `document.documentElement.setAttribute("data-hydrated", "");` : ""}
</script>`;

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;

const PAGES: Record<string, string> = {
  // Known-good: the form and its widget are in the page as served.
  "/contact": page(
    `${NAV}<form method="POST"><input type="email" name="email"><div class="cf-turnstile"></div><button>Send</button></form>`,
  ),
  // The defect: the modal opens a form with no widget.
  "/medtech": page(`${NAV}<h1>MedTech</h1>${modal(false)}`),
  // The fix: the same modal with a mount.
  "/fixed": page(`${NAV}<h1>Fixed</h1>${modal(true)}`),
  // No modal on this page: the nav CTA navigates to /contact. Not a form page.
  "/about": page(`${NAV}<h1>About</h1>${HYDRATED}`),
  // A CTA that navigates to ANOTHER page showing a dialog form with no widget:
  // that form is the other page's, judged on its own visit, never this one's.
  "/team": page(`<a href="/landing#inquire">Talk to us</a>${HYDRATED}`),
  "/landing": page(`<div role="dialog"><form><input type="email" name="email"></form></div>`),
  // An offer hero: a hand-off form (action ends #inquire, its button is a trigger)
  // that opens the modal. The hand-off form itself must not read as a bare form.
  "/offer": page(
    `${NAV}<form action="/contact#inquire" method="get"><input type="email" name="email"><button type="submit" data-inquire>Start</button></form>${modal(true)}`,
  ),
  // A search form asks for no email: not a lead form.
  "/search": page(`${NAV}<form><input type="search" name="q"></form>`),
  // A plain lead form with no widget on the page.
  "/newsletter": page(
    `<form method="POST"><input type="email" name="email"><button>Join</button></form>`,
  ),
  // Two lead forms, one widget: the second form has no widget of its own.
  "/two-forms": page(
    `<form method="POST"><input type="email" name="email"><div class="cf-turnstile"></div></form>` +
      `<footer><form method="POST"><input type="email" name="email"><button>Join</button></form></footer>`,
  ),
  // A form that posts somewhere other than ingest, marked so: not judged.
  "/preferences": page(
    `<form method="POST" action="/api/email-preferences" data-turnstile-exempt><input type="email" name="email"></form>`,
  ),
  // A dialog already open before the click, holding a covered form, ahead of an
  // inquiry modal with no widget: only the dialog the click opened is judged, so
  // the popup's widget cannot hide the modal's gap.
  "/popup": page(
    `<div role="dialog" class="popup"><form><input type="email" name="email"><div class="cf-turnstile"></div></form></div>${NAV}${modal(false)}`,
  ),
  // The same modal on a page that never says it hydrated: a click that opens
  // nothing cannot be told from a plain link, so the modal is not judged.
  "/no-marker": page(`<a href="/contact#inquire">Let's talk</a>`),
};

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const html = PAGES[path];
    if (!html) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const run = (paths: string[], budgetMs?: number) =>
  checkTurnstileCoverage(
    paths.map((p) => base + p),
    {
      hydrationTimeoutMs: 1000,
      openTimeoutMs: 1000,
      ...(budgetMs !== undefined ? { budgetMs } : {}),
    },
  );

describe("turnstile coverage, in a real browser", () => {
  it("passes the known-good page: a form with its widget", async () => {
    const c = await run(["/contact"]);
    expect(c.pages[0]).toMatchObject({ pageForm: true, pageCovered: true });
    expect(uncoveredPaths(c)).toEqual([]);
  });

  it("fails a page whose modal opens a form with no widget", async () => {
    const c = await run(["/contact", "/medtech"]);
    expect(c.pages[1]).toMatchObject({ pageForm: false, modalForm: true, modalCovered: false });
    expect(uncoveredPaths(c)).toEqual(["/medtech"]);
  });

  it("passes the same modal once it carries a mount", async () => {
    expect(uncoveredPaths(await run(["/fixed"]))).toEqual([]);
  });

  it("does not credit a page with another page's form when its CTA navigates", async () => {
    const c = await run(["/about", "/team"]);
    expect(c.pages[0]).toMatchObject({ pageForm: false, modalForm: false });
    expect(c.pages[1]).toMatchObject({ pageForm: false, modalForm: false });
    expect(c.pages.every((p) => p.unjudged === undefined)).toBe(true);
    expect(uncoveredPaths(c)).toEqual([]);
  });

  it("judges an offer hero by the modal it opens, not as a bare form", async () => {
    const c = await run(["/offer"]);
    expect(c.pages[0]).toMatchObject({ pageForm: false, modalForm: true, modalCovered: true });
    expect(uncoveredPaths(c)).toEqual([]);
  });

  it("ignores a form that asks for no email, and fails a plain one with no widget", async () => {
    const c = await run(["/search", "/newsletter"]);
    expect(c.pages[0]?.pageForm).toBe(false);
    expect(uncoveredPaths(c)).toEqual(["/newsletter"]);
  });

  it("fails a second form that has no widget of its own, though the page has one", async () => {
    expect(uncoveredPaths(await run(["/two-forms"]))).toEqual(["/two-forms"]);
  });

  it("leaves out a form marked as not posting to ingest", async () => {
    const c = await run(["/preferences"]);
    expect(c.pages[0]?.pageForm).toBe(false);
  });

  it("judges the dialog the click opened, not a popup that was already open", async () => {
    const c = await run(["/popup"]);
    expect(c.pages[0]).toMatchObject({ pageCovered: true, modalForm: true, modalCovered: false });
    expect(uncoveredPaths(c)).toEqual(["/popup"]);
  });

  it("names a page whose hydration it could not confirm instead of passing it", async () => {
    const c = await run(["/no-marker"]);
    expect(c.pages[0]?.unjudged).toBe("hydration");
    expect(coverageSummary(c)).toMatch(/modal not judged: \/no-marker/);
  });

  it("judges nothing on a page that does not load, and says so", async () => {
    const c = await run(["/missing"]);
    expect(c.pages[0]?.unreachable).toBe(true);
    expect(uncoveredPaths(c)).toEqual([]);
    expect(coverageSummary(c)).toMatch(/not checked: no page loaded; did not load: \/missing/);
  });

  it("stops at its time budget and names what it did not reach", async () => {
    const c = await run(["/medtech", "/contact"], 0);
    expect(c.pages.map((p) => p.unjudged)).toEqual(["deadline", "deadline"]);
    expect(uncoveredPaths(c)).toEqual([]);
  });
});

const p = (path: string, over: Partial<PageCoverage> = {}): PageCoverage => ({
  path,
  pageForm: false,
  pageCovered: true,
  modalForm: false,
  modalCovered: true,
  ...over,
});
const covered: TurnstileCoverage = { pages: [p("/contact", { pageForm: true })] };
const gap: TurnstileCoverage = {
  pages: [...covered.pages, p("/medtech", { modalForm: true, modalCovered: false })],
};

describe("folding coverage into the widget verdict", () => {
  it("a page with no widget fails the verdict whatever /contact earned", () => {
    expect(applyCoverage("pass", gap)).toBe("fail");
    expect(applyCoverage(null, gap)).toBe("fail");
  });

  it("full coverage changes nothing: a mount is not proof the widget works", () => {
    expect(applyCoverage("pass", covered)).toBe("pass");
    expect(applyCoverage(null, covered)).toBe(null);
    expect(applyCoverage(null, undefined)).toBe(null);
  });

  it("names the uncovered pages in the summary", () => {
    expect(coverageSummary(gap)).toMatch(/no widget on \/medtech/);
    expect(coverageSummary(covered)).toMatch(/Turnstile on every form page \(\/contact of 1/);
  });
});

describe("form-e2e runs the coverage pass only on a gated site", () => {
  const NOW = new Date("2026-11-03T00:00:00.000Z");
  const discoverDeps = { fetchText: async () => null };
  const gated = {
    path: "/tmp/r",
    name: "reddoor",
    deployedUrl: "https://r.example",
    requireTurnstile: true,
  };
  const passingSubmit = async () => ({
    formPresent: true as const,
    success: true,
    formsHealth: { testMode: true, turnstile: true },
    turnstile: {
      containerPresent: true,
      scriptLoaded: true,
      hostnameRejected: false,
      initFailed: false,
      widgetError: false,
    },
  });
  const runnerWith = (coverage: TurnstileCoverage, seen: string[][]): FormRunner => ({
    submit: passingSubmit,
    coverage: async (urls) => {
      seen.push([...urls]);
      return coverage;
    },
  });
  const verdict = (r: { details?: unknown }) =>
    (r.details as { turnstileWidget: unknown }).turnstileWidget;

  it("turns a passing widget verdict to fail when a form page has no widget", async () => {
    const seen: string[][] = [];
    const r = await formE2eAudit({
      site: gated,
      now: NOW,
      discoverDeps,
      formRunner: runnerWith(gap, seen),
    });
    expect(verdict(r)).toBe("fail");
    expect(r.status).toBe("warn");
    expect(r.summary).toMatch(/no widget on \/medtech/);
    expect(seen[0]).toContain("https://r.example/contact");
  });

  it("keeps the pass when every form page has the widget", async () => {
    const r = await formE2eAudit({
      site: gated,
      now: NOW,
      discoverDeps,
      formRunner: runnerWith(covered, []),
    });
    expect(verdict(r)).toBe("pass");
    expect(r.status).toBe("pass");
  });

  it("does not run it on a site that does not require Turnstile", async () => {
    const seen: string[][] = [];
    const r = await formE2eAudit({
      site: { path: "/tmp/a", name: "acme", deployedUrl: "https://a.example" },
      now: NOW,
      discoverDeps,
      formRunner: runnerWith(gap, seen),
    });
    expect(seen).toEqual([]);
    expect(verdict(r)).toBe("pass");
  });

  it("warns a gated site with no CONTACT form when a landing page lacks the widget", async () => {
    const r = await formE2eAudit({
      site: gated,
      now: NOW,
      discoverDeps,
      formRunner: {
        submit: async () => ({
          formPresent: false,
          formsHealth: { testMode: true, turnstile: true },
        }),
        coverage: async () => gap,
      },
    });
    expect(r.status).toBe("warn");
    expect(verdict(r)).toBe("fail");
  });

  it("never runs it when the site refused the probe (testMode undeclared)", async () => {
    const seen: string[][] = [];
    await formE2eAudit({
      site: gated,
      now: NOW,
      discoverDeps,
      formRunner: {
        submit: async () => ({ testModeUndeclared: true }),
        coverage: async (u) => (seen.push([...u]), gap),
      },
    });
    expect(seen).toEqual([]);
  });

  it("keeps the submit's result when the coverage pass itself throws", async () => {
    const r = await formE2eAudit({
      site: gated,
      now: NOW,
      discoverDeps,
      formRunner: {
        submit: passingSubmit,
        coverage: async () => {
          throw new Error("browserType.launch: boom");
        },
      },
    });
    expect(verdict(r)).toBe("pass");
    expect(r.summary).toMatch(
      /Turnstile coverage could not run: (Error: )?browserType\.launch: boom/,
    );
  });
});

describe("the fleet row carries Require Turnstile to the audit", () => {
  it("sets requireTurnstile on the Site only when the row has it", () => {
    const row = (name: string, requireTurnstile: boolean) =>
      ({
        name,
        url: `https://${name}.example`,
        status: "maintained",
        acceptedWatchConditions: [],
        requireTurnstile,
      }) as never;
    const sites = selectFleetSites([row("gated", true), row("open", false)], "/tmp/w");
    expect(sites.find((s) => s.name === "gated")?.requireTurnstile).toBe(true);
    expect(sites.find((s) => s.name === "open")?.requireTurnstile).toBeUndefined();
  });
});
