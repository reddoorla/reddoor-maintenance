import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { openDb } from "../../src/db/client.js";
import { NIGHTLIES } from "../../scripts/nightly-conductor.mjs";
import { expectedNight } from "../../cockpit/src/lib/overview/view.js";

/**
 * The cockpit navigates without a server round trip (home base
 * `briefs/2026-10-21-cockpit-one-snapshot.md`, PR 1), proven in a real browser
 * against the BUILT app: SvelteKit's own server (`cockpit/.svelte-kit/output`,
 * which `pnpm cockpit:build` writes and CI builds before the tests) behind a
 * plain node server, a seeded file database, and Chromium clicking through every
 * page. A page whose data came from its own server load would fetch
 * `__data.json` on the way in; every page here derives from the layout's
 * snapshot, so the scripted walk fetches none.
 *
 * The same walk checks what dropping `data-sveltekit-reload` could have broken:
 * each page's stylesheets leave with it (`lib/PageStyles.svelte`), so the pages'
 * shared class names never pick up the last page's rules.
 */

const ROOT = join(import.meta.dirname, "../..");
const OUT = join(ROOT, "cockpit/.svelte-kit/output");
const PASSWORD = "nav-test-password";

let dir: string;
let http: HttpServer;
let browser: Browser;
let origin: string;

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

/** The build is CI's (`pnpm cockpit:build` runs before the tests); elsewhere
 *  (`pnpm test` alone, the time-travel and release runs), build it when it is
 *  missing or older than the sources it is built from. */
function ensureBuilt(): void {
  const entry = join(OUT, "server/index.js");
  if (existsSync(entry) && statSync(entry).mtimeMs >= newestSource()) return;
  execFileSync("pnpm", ["cockpit:build"], { cwd: ROOT, stdio: "inherit" });
}

/** The newest file the cockpit build reads: its config, its own sources, the shared `src/` and the dependencies. */
function newestSource(): number {
  let newest = statSync(join(ROOT, "vite.cockpit.config.ts")).mtimeMs;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  walk(join(ROOT, "cockpit/src"));
  walk(join(ROOT, "src"));
  // A kit or adapter bump, or a tsconfig change, rebuilds too.
  for (const f of ["package.json", "pnpm-lock.yaml", "cockpit/tsconfig.json"])
    newest = Math.max(newest, statSync(join(ROOT, f)).mtimeMs);
  return newest;
}

/** One word of 52 letters: nothing to wrap at, wider than a 390px screen. */
const LONG_NAME = "Extraordinarilylongnamedbeachfrontvacationrentalsinc";

async function seed(url: string): Promise<void> {
  const db = await openDb({ url });
  for (const [id, name, slug] of [
    ["recA", "Acme", "acme"],
    ["recB", "Beta", "beta"],
  ] as const) {
    await db
      .insertInto("sites")
      .values({ id, slug, name, url: `https://${slug}.example.com`, status: "maintained" } as never)
      .execute();
  }
  // P1-78g review round 1 (T5): a Broken site with a long, unbreakable name, so the
  // overview's six-column tables would overflow a 390px screen if they did not stack.
  // Its page answers "fail", freshly, so it is Broken and named in section 1.
  const now = new Date().toISOString();
  await db
    .insertInto("sites")
    .values({
      id: "recL",
      slug: "longname",
      name: LONG_NAME,
      url: "https://longname.example.com",
      status: "maintained",
    } as never)
    .execute();
  await db
    .insertInto("site_health")
    .values({
      site_id: "recL",
      uptime_reachable: "fail",
      browser_checked_at: now,
      url_resolves: "pass",
      url_checked_at: now,
      cert_days_remaining: 12,
      domain_checked_at: now,
      deploy_status: "building",
      deploy_checked_at: now,
    } as never)
    .execute();
  // Leads on it, so the per-site leads table carries its name too: an hour old, so
  // Pat's lead below stays the newest on /submissions.
  const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  for (const [i, status] of ["new", "read", "spam_auto", "spam"].entries())
    await db
      .insertInto("submissions")
      .values({
        id: `subL${i}`,
        site_id: "recL",
        form_type: "contact",
        name: "Lee",
        email: `lee${i}@example.com`,
        status,
        notify_status: "sent",
        submitted_at: anHourAgo,
      } as never)
      .execute();
  await db
    .insertInto("submissions")
    .values({
      id: "sub1",
      site_id: "recA",
      form_type: "contact",
      name: "Pat",
      email: "pat@example.com",
      message: "Need a quote",
      status: "new",
      notify_status: "sent",
      submitted_at: new Date().toISOString(),
    } as never)
    .execute();
  // Review round 5 (R5-8): two fleet_daily nights, the newest the one expected by now,
  // so fleet_daily reaches `/` through the real loader and the overview's windowed
  // counts and reliability are figures, not "not yet collected". These are their
  // short forms; the longer ones (a stopped nightly, nights not recorded) are pinned
  // in the SSR tests, not laid out here. The newest night is taken at seed time, so a
  // run that crosses 6am Pacific between seeding and the check would read one night
  // behind.
  const newest = expectedNight(new Date());
  const before = new Date(Date.parse(`${newest}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (const [night, merged] of [
    [before, 600],
    [newest, 612],
  ] as const)
    await db
      .insertInto("fleet_daily")
      .values({
        night,
        counts: JSON.stringify({
          steps: Object.fromEntries(
            NIGHTLIES.map((n: { file: string }) => [
              n.file,
              { outcome: "completed", runId: 1, conclusion: "success" },
            ]),
          ),
          prsMerged: { value: merged },
          events: { value: { pr_automerged: merged / 6, vuln_cleared: 3 } },
        }),
        written_at: new Date().toISOString(),
      })
      .execute();
  // P1-78h: fourteen older nights, so section 8 draws its charts in the 390px check.
  // They carry only the blocks the trends read and no step results, so the nightly's
  // reliability above still counts its two recorded nights. Each is on the current
  // ladder but the oldest, so the level chart has a break; one night is missing.
  for (let i = 2; i <= 16; i++) {
    if (i === 9) continue;
    const night = new Date(Date.parse(`${newest}T00:00:00Z`) - i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await db
      .insertInto("fleet_daily")
      .values({
        night,
        counts: JSON.stringify({
          ladderVersion: i === 16 ? 1 : 2,
          sites: {
            value: { cards: 3, tiers: { broken: i % 3, attention: 1 }, preLaunch: 0, setup: 0 },
          },
          signals: { value: { vuln: i % 2 } },
          coverage: { value: { security_audit_at: { value: 17 }, lighthouse_at: { value: 17 } } },
          leads: {
            value: { new: 0, read: 0, archived: 0, spamAuto: 0, spam: 0, notified: 400 - 3 * i },
          },
          events: { value: { vuln_cleared: 3 - Math.floor(i / 6) } },
        }),
        written_at: new Date().toISOString(),
      })
      .execute();
  }
  await db.destroy();
}

beforeAll(async () => {
  ensureBuilt();
  dir = mkdtempSync(join(tmpdir(), "cockpit-nav-"));
  const url = `file:${join(dir, "fleet.db")}`;
  await seed(url);
  process.env.TURSO_DATABASE_URL = url;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.CONTEXT;
  process.env.DASHBOARD_PASSWORD = PASSWORD;

  const { Server } = (await import(join(OUT, "server/index.js"))) as {
    Server: new (m: unknown) => {
      init(o: { env: Record<string, string> }): Promise<void>;
      respond(r: Request, o: { getClientAddress(): string }): Promise<Response>;
    };
  };
  const { manifest } = (await import(join(OUT, "server/manifest.js"))) as { manifest: unknown };
  const app = new Server(manifest);
  await app.init({ env: process.env as Record<string, string> });

  http = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      const file = join(OUT, "client", path);
      if (path.startsWith("/_app/") && existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
        res.end(readFileSync(file));
        return;
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers))
        if (typeof v === "string") headers.set(k, v);
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const method = req.method ?? "GET";
      const body = method === "GET" || method === "HEAD" ? null : Buffer.concat(chunks);
      const request = new Request(`${origin}${req.url}`, { method, headers, body });
      const response = await app.respond(request, { getClientAddress: () => "127.0.0.1" });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    })().catch((err: unknown) => {
      // Fail the request loudly rather than leave it hanging to a timeout.
      res.writeHead(599, { "content-type": "text/plain" });
      res.end(`test bridge: ${String(err)}`);
    });
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  browser = await chromium.launch();
}, 300_000);

afterAll(async () => {
  for (const c of contexts) await c.close();
  await browser?.close();
  await new Promise((r) => http?.close(r));
  rmSync(dir, { recursive: true, force: true });
});

async function signedIn(user = "op"): Promise<Page> {
  // The gate redirects rather than challenging, so the header goes on every request.
  const context = await browser.newContext({
    extraHTTPHeaders: {
      authorization: `Basic ${Buffer.from(`${user}:${PASSWORD}`).toString("base64")}`,
    },
  });
  contexts.push(context);
  return context.newPage();
}

const contexts: BrowserContext[] = [];

/** Click a link to `href` and wait for the page it leads to. */
async function follow(page: Page, href: string, heading: string): Promise<void> {
  await page.locator(`a[href="${href}"]`).first().click();
  await page.waitForURL(`${origin}${href}`);
  await expect
    .poll(() => page.locator("h1").first().textContent(), { timeout: 10_000 })
    .toContain(heading);
}

/** The text of every page stylesheet in the head, in order. */
function pageSheets(page: Page): Promise<string[]> {
  return page.$$eval("style[data-page-style]", (els) => els.map((e) => e.textContent ?? ""));
}

describe("cockpit navigation, in a browser, against the built app", () => {
  it("loads the snapshot once and walks every page without a server request", async () => {
    const page = await signedIn();
    const data: string[] = [];
    const documents: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("__data.json")) data.push(r.url());
      if (r.resourceType() === "document") documents.push(r.url());
    });

    // P1-78f: the start page moved to /triage.
    const first = await page.goto(`${origin}/triage`);
    expect(first?.status()).toBe(200);
    expect(first?.headers()["cache-control"]).toBe("private, no-store");
    await expect.poll(() => page.locator("h1").first().textContent()).toContain("fleet cockpit");
    // Hydrated: the router handles the clicks below, not the browser.
    await page.waitForFunction(() => document.querySelector("a[href='/fleet']") !== null);
    await page.waitForLoadState("networkidle");

    await follow(page, "/fleet", "Sites");
    await follow(page, "/s/acme", "Acme");
    await follow(page, "/submissions", "Submissions");
    await follow(page, "/audits", "Prospect audits");
    await follow(page, "/triage", "fleet cockpit");
    await follow(page, "/", "Overview");

    expect(data).toEqual([]);
    expect(documents).toEqual([`${origin}/triage`]);
  });

  // P1-78g: / is the overview now, answered in place: no redirect.
  it("/ renders the overview with no redirect", async () => {
    const page = await signedIn();
    const hops: Array<[string, number]> = [];
    page.on("response", (r) => {
      if (r.request().resourceType() === "document")
        hops.push([new URL(r.url()).pathname, r.status()]);
    });
    await page.goto(`${origin}/`);
    await expect.poll(() => page.locator("h1").first().textContent()).toContain("Overview");
    expect(new URL(page.url()).pathname).toBe("/");
    expect(hops).toEqual([["/", 200]]);
    // fleet_daily reached the page through the real loader (review round 5, R5-8).
    await expect
      .poll(() => page.locator("body").textContent())
      .toContain(
        `${NIGHTLIES.length * 2} of ${NIGHTLIES.length * 2} nightly steps ran to the end over the last 2 nights`,
      );
  });

  // P1-78g's Done-when: the overview on a 390px-wide phone, in both themes, with
  // nothing scrolling sideways. Review round 1 (T5): the seed's long-named Broken
  // site makes the unstacked tables overflow, and every element is checked, not only
  // the page, so the phone layout's loss turns this red (mutation 10).
  it.each(["light", "dark"] as const)(
    "the overview fits a 390px-wide screen in the %s theme",
    async (scheme) => {
      const page = await signedIn();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${origin}/`);
      await expect.poll(() => page.locator("h1").first().textContent()).toContain("Overview");
      // The content the check needs is on the page: the long name, in section 1 and both tables.
      expect(await page.locator(".ov-list.broken li", { hasText: LONG_NAME }).count()).toBe(1);
      expect(await page.locator(".ov-live tbody th", { hasText: LONG_NAME }).count()).toBe(1);
      expect(await page.locator(".ov-leads-sites tbody th", { hasText: LONG_NAME }).count()).toBe(
        1,
      );
      // P1-78h: section 8 draws its four charts, so they are laid out here too.
      expect(await page.locator("figure.ov-trend svg.ov-chart").count()).toBe(4);
      await page.locator(".ov-trend-table summary").first().click();
      await page.locator(".ov-how summary").click();
      const fit = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: window.innerWidth,
        dark: getComputedStyle(document.body).backgroundColor,
        // Every element that lays out a box: one whose content is wider than itself
        // pushes something sideways. Only the two boxes hidden on purpose (the visually
        // hidden heading and the phone's table heads), and all inside them, are left
        // out, by name: skipping every box under an `overflow: hidden` ancestor let
        // clipped content count as fitting (review round 4, T1).
        wide: [...document.body.querySelectorAll("*")]
          .filter((e) => {
            if (e.closest(".visually-hidden, .ov-table thead") !== null) return false;
            const d = getComputedStyle(e).display;
            return d !== "inline" && d !== "contents" && e.clientWidth > 0;
          })
          .filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map(
            (e) => `${e.tagName.toLowerCase()}.${e.className}: ${e.scrollWidth} > ${e.clientWidth}`,
          ),
      }));
      expect(fit.wide).toEqual([]);
      expect(fit.scroll).toBeLessThanOrEqual(fit.width);
      // And what the tables show ends inside the screen: a cell cut off by a
      // clipping box still reads as overflowing here (review round 4, T1).
      const cells = await page.evaluate(() =>
        [...document.querySelectorAll(".ov-table th, .ov-table td")]
          .filter((e) => e.closest("thead") === null)
          .map((e) => ({ e, r: e.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0)
          .map(({ e, r }) => ({
            cell: (e.textContent ?? "").trim().slice(0, 30),
            right: r.right,
            width: window.innerWidth,
          })),
      );
      expect(cells.length).toBeGreaterThan(10);
      expect(cells.filter((c) => c.right > c.width + 0.5)).toEqual([]);
      // P1-78h: each chart is as wide as its figure, and its ticks are legible:
      // at least 10px tall on screen.
      const charts = await page.evaluate(() =>
        [...document.querySelectorAll("figure.ov-trend")].map((f) => ({
          chart: f.querySelector("svg.ov-chart")!.getBoundingClientRect().width,
          figure: f.getBoundingClientRect().width,
          tick: Math.min(
            ...[...f.querySelectorAll("text.ov-tick")].map((t) => t.getBoundingClientRect().height),
          ),
        })),
      );
      for (const c of charts) {
        expect(c.chart).toBeCloseTo(c.figure, 0);
        expect(c.tick).toBeGreaterThanOrEqual(10);
      }
      // Review round 1 (T3): every mark that carries a value or the break stands out
      // from the page's ground by at least 3:1, in this theme.
      const contrast = await page.evaluate(() => {
        const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const lum = (c: string) => {
          const [r, g, b] = rgb(c).map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        const ratio = (a: string, b: string) => {
          const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
          return (x! + 0.05) / (y! + 0.05);
        };
        const ground = getComputedStyle(document.body).backgroundColor;
        const of = (sel: string, prop: "stroke" | "fill") => {
          const e = document.querySelector(sel);
          return e === null ? null : ratio(getComputedStyle(e)[prop], ground);
        };
        return {
          line: of("path.ov-line-mark:not(.broken)", "stroke"),
          broken: of("path.ov-line-mark.broken", "stroke"),
          bar: of("path.ov-bar", "fill"),
          dot: of("circle.ov-dot", "fill"),
          rule: of("line.ov-break", "stroke"),
        };
      });
      for (const [mark, r] of Object.entries(contrast)) {
        expect(r, mark).not.toBeNull();
        expect(r!, mark).toBeGreaterThanOrEqual(3);
      }
      await page.screenshot({
        path: join(tmpdir(), `overview-trends-390-${scheme}.png`),
        fullPage: true,
      });
      // The theme took: dark ground is not light ground.
      const [r] = fit.dark.match(/\d+/g)!.map(Number);
      if (scheme === "dark") expect(r!).toBeLessThan(80);
      else expect(r!).toBeGreaterThan(180);
    },
  );

  // P1-78g's Done-when, review round 1 (T7): everyone signed in sees the same page.
  // The shared password ignores the user name, so two names are two people at the gate.
  // That also makes this identical by construction: it proves the live server renders
  // `/` for a signed-in visitor, not that names cannot change it. The evidence for
  // that, with a control, is cockpit/tests/overview/page.ssr.test.ts "everyone signed
  // in sees the same page (T7)" (review round 3, T2).
  it("two people signed in get the same overview", async () => {
    const overview = async (user: string) => {
      const page = await signedIn(user);
      await page.goto(`${origin}/`);
      await expect.poll(() => page.locator("h1").first().textContent()).toContain("Overview");
      const html = await page.evaluate(() =>
        [...document.querySelectorAll("h1, section")].map((e) => e.outerHTML).join("\n"),
      );
      // Relative times may tick between the two loads; everything else must match.
      return html.replace(/\b(just now|\d+ (?:minute|hour|day|week|month|year)s? ago)/g, "<ago>");
    };
    const erik = await overview("erik");
    const tim = await overview("tim");
    expect(erik).toContain(LONG_NAME);
    expect(tim).toBe(erik);
  });

  it("a page's stylesheets leave with it", async () => {
    const page = await signedIn();
    await page.goto(`${origin}/s/acme`);
    await page.waitForLoadState("networkidle");
    const siteSheets = await pageSheets(page);
    // tokens + base (the shell's two, P1-78e) + site + submission
    expect(siteSheets.length).toBe(4);

    await follow(page, "/audits", "Prospect audits");
    const auditSheets = await pageSheets(page);
    // tokens + base + audits; none of the site page's sheets is still in the head.
    expect(auditSheets.length).toBe(3);
    for (const sheet of siteSheets.slice(2)) expect(auditSheets).not.toContain(sheet);
    expect(auditSheets.slice(0, 2)).toEqual(siteSheets.slice(0, 2));
    // However a sheet arrived (an inline <style> or a <link>), none of the site
    // page's rules applies now. `.tiles` is the site page's alone.
    const selectors = (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.styleSheets]
          // The font sheets (Adobe Fonts, Google Fonts; P1-78e) are cross-origin,
          // and the browser refuses to let a script read their rules. Every sheet
          // the cockpit serves is same-origin or inline, and all of those are read.
          .filter((sh) => sh.href === null || new URL(sh.href).origin === location.origin)
          .flatMap((sh) => [...sh.cssRules].map((r) => (r as CSSStyleRule).selectorText ?? "")),
      );
    expect(await selectors()).not.toContain(".tiles");
    await follow(page, "/fleet", "Sites");
    await page.locator('a[href="/s/acme"]').first().click();
    await page.waitForURL(`${origin}/s/acme`);
    // Positive control: on the site page itself the rule is there.
    await expect.poll(selectors, { timeout: 10_000 }).toContain(".tiles");
  });

  it("a navigation within one route mounts the page afresh, as a full load did", async () => {
    const page = await signedIn();
    const documents: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "document") documents.push(r.url());
    });
    await page.goto(`${origin}/submissions?status=new`);
    await page.waitForLoadState("networkidle");
    // Something only this mount carries: a full load, or a fresh mount, loses it.
    await page.$eval("h1", (h) => h.setAttribute("data-this-mount", ""));
    await page.locator('a[href="/submissions"]').first().click();
    await page.waitForURL(`${origin}/submissions`);
    // The heading reads the same before and after, so wait on the mark itself.
    await expect
      .poll(() => page.$$("h1[data-this-mount]").then((h) => h.length), {
        timeout: 10_000,
      })
      .toBe(0);
    expect(await page.locator("h1").count()).toBe(1);
    // ...and it was the client router, not a full load, that mounted it.
    expect(documents).toHaveLength(1);
  });

  it("a path no page owns renders without the snapshot, and leaving it loads one in full", async () => {
    const page = await signedIn();
    const documents: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
    });
    const res = await page.goto(`${origin}/no-such-page`);
    expect(res?.status()).toBe(404);
    expect(await page.content()).not.toContain("pat@example.com");
    await page.waitForLoadState("networkidle");
    await follow(page, "/submissions", "Submissions");
    expect(await page.content()).toContain("pat@example.com");
    expect(documents).toEqual(["/no-such-page", "/submissions"]);
  });

  it("after a change, the next navigation is a full load and shows it", async () => {
    const page = await signedIn();
    const documents: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
    });
    await page.goto(`${origin}/submissions?status=new`);
    await page.waitForLoadState("networkidle");
    expect(await page.content()).toContain("pat@example.com");
    const posted = page.waitForResponse((r) => r.url().includes("/api/submissions/"));
    await page
      .locator("button", { hasText: /^Archive$/ })
      .first()
      .click();
    const resp = await posted;
    expect(resp.status()).toBe(200);
    await follow(page, "/submissions", "Submissions");
    // A fresh read: the lead's row now says archived, and only an "archived"
    // status button state could have come from the server.
    const row = page.locator("li.subm-item", { hasText: "pat@example.com" }).first();
    await expect.poll(() => row.textContent(), { timeout: 10_000 }).toContain("archived");
    expect(documents).toEqual(["/submissions", "/submissions"]);
  });

  it("after a change, Back and Forward load the page in full too", async () => {
    const page = await signedIn();
    const documents: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
    });
    await page.goto(`${origin}/triage`); // P1-78f: the start page moved
    await page.waitForLoadState("networkidle");
    await follow(page, "/submissions", "Submissions");
    const posted = page.waitForResponse((r) => r.url().includes("/api/submissions/"));
    await page
      .locator("li.subm-item", { hasText: "pat@example.com" })
      .locator("button", { hasText: /^Spam$/ })
      .click();
    expect((await posted).status()).toBe(200);
    // Back lands on `/triage` and reloads it in full. Mark this document, so the wait
    // below is for a new one, fully loaded and hydrated, before stepping Forward:
    // a step taken while the reload is in flight aborts it.
    await page.evaluate(() => Object.assign(window, { __beforeBack: true }));
    await page.goBack();
    await page.waitForURL(`${origin}/triage`);
    await page.waitForFunction(
      () =>
        !("__beforeBack" in window) &&
        document.readyState === "complete" &&
        document.querySelector("a[href='/submissions']") !== null,
      undefined,
      { timeout: 15_000 },
    );
    await page.waitForLoadState("networkidle");
    expect(documents).toEqual(["/triage", "/triage"]);
    await page.goForward();
    await page.waitForURL(`${origin}/submissions`);
    // That reload read a fresh snapshot, so Forward derives in the browser and
    // already shows the change.
    const row = page.locator("li.subm-item", { hasText: "pat@example.com" }).first();
    await expect.poll(() => row.textContent(), { timeout: 10_000 }).toContain("spam");
    expect(documents).toEqual(["/triage", "/triage"]);
  });

  it("on focus with nothing changed, one counter read and no notice", async () => {
    const page = await signedIn();
    const data: string[] = [];
    const checks: number[] = [];
    page.on("request", (r) => {
      if (r.url().includes("__data.json")) data.push(r.url());
    });
    page.on("response", (r) => {
      if (r.url().endsWith("/api/cockpit/version")) checks.push(r.status());
    });
    await page.goto(`${origin}/submissions`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => checks.length, { timeout: 10_000 }).toBe(1);
    await page.waitForLoadState("networkidle");
    expect(checks).toEqual([200]);
    expect(data).toEqual([]);
    expect(await page.locator(".cockpit-newer").count()).toBe(0);
  });

  it("a change elsewhere shows a notice and leaves the page as it is until the operator reloads", async () => {
    // The operator's decision 2026-10-22-1541: the page never changes under
    // them; a notice says the store moved, and they reload when they choose.
    const page = await signedIn();
    const data: string[] = [];
    const documents: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("__data.json")) data.push(r.url());
      if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
    });
    await page.goto(`${origin}/s/acme`);
    await page.waitForLoadState("networkidle");
    await page.$eval("h1", (h) => h.setAttribute("data-this-mount", ""));
    const contact = page.locator("input[data-detail-field='pointOfContact']");
    await contact.fill("half typed");

    const db = await openDb({ url: process.env.TURSO_DATABASE_URL ?? "" });
    await db
      .insertInto("submissions")
      .values({
        id: "sub-notice",
        site_id: "recB",
        form_type: "contact",
        name: "Noor",
        email: "noor@elsewhere.example",
        status: "new",
        notify_status: "sent",
        submitted_at: new Date().toISOString(),
      } as never)
      .execute();
    await db.destroy();
    // The live region is there, empty, before the notice, so a screen reader
    // announces what appears in it (review round 1 of the notice).
    const region = page.locator("[role='status']", { has: page.locator("button") });
    expect(await page.locator("[role='status']").count()).toBeGreaterThan(0);
    expect(await region.count()).toBe(0);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => page.locator(".cockpit-newer").count(), { timeout: 10_000 }).toBe(1);
    expect(await page.locator(".cockpit-newer").getAttribute("role")).toBe("status");
    expect(await region.textContent()).toContain("Newer data is available.");
    // Nothing read, nothing redrawn, nothing typed lost.
    expect(data).toEqual([]);
    expect(await page.$$("h1[data-this-mount]")).toHaveLength(1);
    expect(await contact.inputValue()).toBe("half typed");

    // The next navigation reads the store afresh: a full load.
    await follow(page, "/submissions", "Submissions");
    expect(documents).toEqual(["/s/acme", "/submissions"]);
    expect(await page.content()).toContain("noor@elsewhere.example");
  });

  it("the notice's Reload loads the page in full", async () => {
    const page = await signedIn();
    const documents: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
    });
    await page.goto(`${origin}/fleet`);
    await page.waitForLoadState("networkidle");
    const db = await openDb({ url: process.env.TURSO_DATABASE_URL ?? "" });
    await db
      .updateTable("sites")
      .set({ name: "Beta, renamed" } as never)
      .where("id", "=", "recB")
      .execute();
    await db.destroy();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.locator(".cockpit-newer button", { hasText: "Reload" }).click({ timeout: 10_000 });
    await page.waitForLoadState("networkidle");
    expect(documents).toEqual(["/fleet", "/fleet"]);
    expect(await page.content()).toContain("Beta, renamed");
    expect(await page.locator(".cockpit-newer").count()).toBe(0);
  });

  it("a check that finds the session ended makes the next navigation a full load, and says nothing", async () => {
    // Review round 1 of the notice: the layout's wiring of the session check had
    // no test.
    const page = await signedIn();
    await page.route("**/api/cockpit/version", (r) =>
      r.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "unauthorized" }),
      }),
    );
    await page.goto(`${origin}/fleet`);
    await page.waitForLoadState("networkidle");
    const answered = page.waitForResponse((r) => r.url().endsWith("/api/cockpit/version"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await answered;
    await expect
      .poll(() => page.evaluate(() => document.body.hasAttribute("data-sveltekit-reload")))
      .toBe(true);
    expect(await page.locator(".cockpit-newer").count()).toBe(0);
    expect(page.url()).toBe(`${origin}/fleet`);
  });

  it("a signed-out browser gets no snapshot", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const res = await page.request.get(`${origin}/__data.json`, { maxRedirects: 0 });
    // The hook answers before any load runs; for a data request SvelteKit's
    // client expects a redirect as JSON (kit 3 adds its status).
    expect(await res.json()).toEqual({
      type: "redirect",
      status: 302,
      location: "/auth/login?returnTo=%2F",
    });
  });
});

/**
 * What Netlify deploys from the same build (P1-69, SvelteKit 3 and
 * adapter-netlify 7). Kit 2's adapter wrote `.netlify/functions-internal` and
 * read `publish` from netlify.toml; adapter 7 writes Netlify's Frameworks API
 * (`.netlify/v1/`) and takes `publish` as its own option, defaulting to `build`,
 * so the two must name one directory or the deploy publishes no assets.
 */
describe("the built app's Netlify surface", () => {
  /** Every route the sources declare: a page or an endpoint, as kit ids. */
  function sourceRoutes(): string[] {
    const routes = join(ROOT, "cockpit/src/routes");
    const ids: string[] = [];
    const walk = (d: string) => {
      const names = readdirSync(d, { withFileTypes: true });
      if (names.some((e) => e.name === "+page.svelte" || e.name === "+server.ts"))
        ids.push(`/${d.slice(routes.length + 1)}`.replace(/\/$/, "") || "/");
      for (const e of names) if (e.isDirectory()) walk(join(d, e.name));
    };
    walk(routes);
    return ids.sort();
  }

  it("builds every route the sources declare", async () => {
    const { manifest } = (await import(join(OUT, "server/manifest.js"))) as {
      manifest: { routes: { id: string }[] };
    };
    const source = sourceRoutes();
    // Control: the walk sees the pages a visitor reaches and the endpoints.
    expect(source).toEqual(expect.arrayContaining(["/", "/fleet", "/s/[slug]", "/auth/login"]));
    expect(manifest.routes.map((r) => r.id).sort()).toEqual(source);
  });

  it("serves them all from one function on /*, as kit 2's build did", () => {
    const fn = readFileSync(join(ROOT, ".netlify/v1/functions/sveltekit-render.mjs"), "utf-8");
    const config = /export const config = (\{[\s\S]*?\});/.exec(fn)?.[1];
    expect(JSON.parse(config ?? "null")).toMatchObject({
      path: ["/*"],
      excludedPath: ["/.netlify/*"],
      preferStatic: true,
    });
  });

  it("publishes the browser assets where netlify.toml says, with kit's immutable cache", () => {
    const toml = readFileSync(join(ROOT, "netlify.toml"), "utf-8");
    const publish = /^\s*publish = "([^"]+)"$/m.exec(toml)?.[1];
    expect(publish).toBe("cockpit/build");
    expect(readdirSync(join(ROOT, publish!, "_app/immutable")).length).toBeGreaterThan(0);
    // ...and from THIS build: adapter 7 clears only its own publish directory,
    // so a misnamed one leaves an earlier build's assets here, looking right.
    const version = (dir: string) => readFileSync(join(dir, "_app/version.json"), "utf-8");
    expect(version(join(ROOT, publish!))).toBe(version(join(OUT, "client")));
    const framework = JSON.parse(readFileSync(join(ROOT, ".netlify/v1/config.json"), "utf-8")) as {
      headers: { for: string; values: Record<string, string> }[];
    };
    expect(framework.headers).toContainEqual({
      for: "/_app/immutable/*",
      values: { "cache-control": "public, immutable, max-age=31536000" },
    });
  });
});
