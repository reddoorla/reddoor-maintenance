import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { openDb } from "../../src/db/client.js";
import { recordFleetEvent } from "../../src/db/fleet-events.js";
import { NIGHTLIES } from "../../scripts/nightly-conductor.mjs";
import { seededNights } from "../_helpers/bar-nights.js";
import { expectedNight } from "../../cockpit/src/lib/overview/view.js";
import { trafficWindows } from "../../src/fleet-daily/traffic.js";

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
let dbUrl: string;
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
  // Review round 3 (tests M2, a11y m3): the Contact form row carries a long count, so the
  // count column and the phone layout are measured with one. Acme's form test failed on a
  // fresh run, Beta has a fresh stamp and no result, and Lee's site has no stamp (not
  // checked): "1 test failed, not yet a verdict · 1 no verdict · 1 not checked".
  // Review round 4 (tests M1): Acme also has a passing Live and Certificate, so at least
  // one check bar draws a fill for the "fill inside track" browser test to measure.
  const passing = {
    uptime_reachable: "pass",
    url_resolves: "pass",
    browser_checked_at: now,
    url_checked_at: now,
    cert_days_remaining: 90,
    domain_checked_at: now,
  };
  for (const [site_id, extra] of [
    ["recA", { form_e2e_ok: "fail", ...passing }],
    ["recB", { form_e2e_ok: null }],
  ] as const)
    await db
      .insertInto("site_health")
      .values({ site_id, ...extra, form_e2e_checked_at: now } as never)
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
  // Review round 5 (R5-8): two fleet_daily nights (three from 10pm to 6am Pacific, when
  // the bar's own run night is written too, P1-87 PR 5a), the newest expected one by now,
  // so fleet_daily reaches `/` through the real loader and the overview's windowed
  // counts and reliability are figures, not "not yet collected". These are their
  // short forms; the longer ones (a stopped nightly, nights not recorded) are pinned
  // in the SSR tests, not laid out here. The newest night is taken at seed time, so a
  // run that crosses 6am Pacific between seeding and the check would read one night
  // behind.
  const newest = expectedNight(new Date());
  // P1-87 PR 7a, review round 1 (A.3): the newest night's search half reads 12,345,678
  // impressions over its 28 days, so the widest figure a tile can carry is on the page.
  const searchWindow = trafficWindows(newest).search;
  const spreadOver = (total: number, n: number) =>
    Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));
  const searchDaily = (() => {
    const clicks = spreadOver(1234, 28);
    const shown = spreadOver(12345678, 28);
    return Array.from({ length: 28 }, (_, i) => ({
      date: new Date(Date.parse(`${searchWindow.startDate}T00:00:00Z`) + i * 86_400_000)
        .toISOString()
        .slice(0, 10),
      clicks: clicks[i]!,
      impressions: shown[i]!,
    }));
  })();
  const newestTraffic = {
    traffic: {
      value: {
        visits: { value: null, reason: "not in this row" },
        search: {
          value: {
            clicks: 1234,
            impressions: 12345678,
            window: { ...searchWindow },
            sitesRead: 16,
            sitesWithProperty: 18,
            daily: searchDaily,
          },
        },
        sites: [],
      },
    },
  };
  // P1-87 PR 5a, review round 3 (Group C): the bar's own run night is written too, so the bar
  // reads recorded at any hour (see seededNights). Its backup did not run, so it renders a
  // `none` step for the forced-colours check.
  for (const { night, merged, backupRan } of seededNights(new Date()))
    await db
      .insertInto("fleet_daily")
      .values({
        night,
        counts: JSON.stringify({
          steps: Object.fromEntries(
            NIGHTLIES.map((n: { file: string }) => [
              n.file,
              n.file === "fleet-db-backup.yml" && !backupRan
                ? null
                : { outcome: "completed", runId: 1, conclusion: "success" },
            ]),
          ),
          prsMerged: { value: merged },
          events: { value: { pr_automerged: merged / 6, vuln_cleared: 3 } },
          ...(night === newest ? newestTraffic : {}),
        }),
        written_at: new Date().toISOString(),
      })
      .execute();
  // P1-78h: fourteen older nights, so section 8 draws its charts in the 390px check.
  // They carry only the blocks the trends read and no step results, so the nightly's
  // reliability above still counts only its seeded recorded nights. Each is on the current
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
  // P1-87 PR 4: one event for the Lately feed, and a sweep newer than it, which the feed leaves out.
  await recordFleetEvent(db, {
    id: "pr4-merge",
    ts: new Date(Date.now() - 3_600_000).toISOString(),
    type: "pr_automerged",
    siteId: "recA",
    siteName: "Acme",
    summary: "auto-merged Bump lodash",
    data: null,
  });
  await recordFleetEvent(db, {
    id: "pr4-sweep",
    ts: new Date().toISOString(),
    type: "fleet_swept",
    siteId: null,
    siteName: null,
    summary: "Swept 2 sites",
    data: null,
  });
  await db.destroy();
}

beforeAll(async () => {
  ensureBuilt();
  dir = mkdtempSync(join(tmpdir(), "cockpit-nav-"));
  const url = `file:${join(dir, "fleet.db")}`;
  dbUrl = url;
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

/** The newest night's stored counts, as text, so a test can put them back. */
async function newestCounts(): Promise<string> {
  const db = await openDb({ url: dbUrl });
  try {
    const row = await db
      .selectFrom("fleet_daily")
      .select("counts")
      .where("night", "=", expectedNight(new Date()))
      .executeTakeFirstOrThrow();
    return row.counts;
  } finally {
    await db.destroy();
  }
}

async function putNewestCounts(counts: string): Promise<void> {
  const db = await openDb({ url: dbUrl });
  try {
    await db
      .updateTable("fleet_daily")
      .set({ counts })
      .where("night", "=", expectedNight(new Date()))
      .execute();
  } finally {
    await db.destroy();
  }
}

/** The days from `from` to `to`, both included, as YYYY-MM-DD. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** `total` split over `n` days, each day a whole count, the parts summing to `total`. */
const spreadOver = (total: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));

/** Re-seeds the newest night's traffic so the visits tile reads `visits` and the search tile
 *  reads `impressions`, both as readings the overview accepts. Returns the counts it replaced. */
async function seedTraffic(visits: number, impressions: number): Promise<string> {
  const saved = await newestCounts();
  const newest = expectedNight(new Date());
  const w = trafficWindows(newest);
  const visitDays = [
    ...daysBetween(w.previous.startDate, w.previous.endDate),
    ...daysBetween(w.current.startDate, w.current.endDate),
  ];
  const previousDays = visitDays.length - 30;
  const visitsDaily = visitDays.map((date, i) => ({
    date,
    visits:
      i < previousDays
        ? spreadOver(300, previousDays)[i]!
        : spreadOver(visits, 30)[i - previousDays]!,
  }));
  const searchDays = daysBetween(w.search.startDate, w.search.endDate);
  const clicks = spreadOver(1234, searchDays.length);
  const shown = spreadOver(impressions, searchDays.length);
  const counts = JSON.parse(saved);
  counts.traffic = {
    value: {
      visits: {
        value: {
          current: visits,
          previous: 300,
          currentWindow: w.current,
          previousWindow: w.previous,
          sitesRead: 16,
          sitesWithProperty: 18,
          daily: visitsDaily,
        },
      },
      search: {
        value: {
          clicks: 1234,
          impressions,
          window: w.search,
          sitesRead: 16,
          sitesWithProperty: 18,
          daily: searchDays.map((date, i) => ({
            date,
            clicks: clicks[i]!,
            impressions: shown[i]!,
          })),
        },
      },
      sites: [],
    },
  };
  await putNewestCounts(JSON.stringify(counts));
  return saved;
}

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

    await follow(page, "/how", "How this works");
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
    // fleet_daily reached the page through the real loader (review round 5, R5-8): the
    // changes-shipped tile is the newest seeded night's prsMerged (612) less the one
    // before (600), over the one night between them (P1-87 PR 3 moved the nightly
    // steps line to /how, so this reads a first-screen tile instead).
    const shipped = page.locator(".ov-tile", { hasText: "changes shipped" });
    await expect.poll(() => shipped.locator(".ov-num").textContent()).toBe("12");
    await expect.poll(() => shipped.textContent()).toContain("over the last night");
  });

  // P1-87 PR 3, round 1: every check bar starts and ends in the same place, whatever
  // its count says, and the two panels sit side by side with one top at 1280px.
  // P1-87 PR 4: the Lately column is the first screen's third panel: beside the two at
  // 1280px, below them at 390px. It names the seeded merge and folds out the sweep.
  it("Lately sits beside the first screen at 1280px and below it at 390px, with no sweeps and no overflow", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await expect.poll(() => page.locator(".ov-lately li").count()).toBeGreaterThan(0);
    const lines = await page.locator(".ov-lately li").allTextContents();
    expect(lines.some((t) => t.includes("Acme"))).toBe(true);
    expect(lines.every((t) => !/swept/i.test(t))).toBe(true);
    const wide = await page
      .locator(".ov-health, .ov-happening, .ov-lately")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(wide).toHaveLength(3);
    expect(new Set(wide).size).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    const narrow = await page.locator(".ov-happening, .ov-lately").evaluateAll((els) =>
      els.map((e) => ({
        top: Math.round(e.getBoundingClientRect().top),
        bottom: Math.round(e.getBoundingClientRect().bottom),
      })),
    );
    expect(narrow).toHaveLength(2);
    expect(narrow[1]!.top).toBeGreaterThanOrEqual(narrow[0]!.bottom);
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  // P1-87 PR 5a: the nightly audit bar under the first screen's three panels. At 1280px its
  // nine segments share one row below them; at 390px they stack, each below the last.
  it("the nightly audit's nine segments sit below the three panels at 1280px and stack at 390px, with no overflow", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    // The precondition: all nine segments rendered (eight steps and the wait).
    await expect.poll(() => page.locator(".ov-cycle-seg").count()).toBe(9);
    const wide = await page.evaluate(() => {
      const panelsBottom = Math.max(
        ...[...document.querySelectorAll(".ov-health, .ov-happening, .ov-lately")].map(
          (e) => e.getBoundingClientRect().bottom,
        ),
      );
      const tops = [...document.querySelectorAll(".ov-cycle-seg")].map((e) =>
        Math.round(e.getBoundingClientRect().top),
      );
      return { panelsBottom, tops };
    });
    expect(new Set(wide.tops).size).toBe(1);
    expect(Math.min(...wide.tops)).toBeGreaterThanOrEqual(wide.panelsBottom);
    await page.setViewportSize({ width: 390, height: 844 });
    const narrow = await page.locator(".ov-cycle-seg").evaluateAll((els) =>
      els.map((e) => ({
        top: Math.round(e.getBoundingClientRect().top),
        bottom: Math.round(e.getBoundingClientRect().bottom),
      })),
    );
    expect(narrow).toHaveLength(9);
    for (let i = 1; i < narrow.length; i++) {
      expect(narrow[i]!.top).toBeGreaterThanOrEqual(narrow[i - 1]!.bottom);
    }
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  // P1-87 PR 5a, review round 1 (accessibility majors and minors): the bar's next-run time
  // fits its column at the widths between the stacked and the wide layouts, where the page
  // scrolled sideways and clipped it.
  it("the nightly audit's times fit their columns at 768px and 1000px, with no sideways scroll", async () => {
    const page = await signedIn();
    for (const width of [768, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      // The precondition: all nine segments rendered (eight steps and the wait).
      await expect.poll(() => page.locator(".ov-cycle-seg").count()).toBe(9);
      // The screen-reader words are clipped to one pixel by design (.visually-hidden), so
      // they are not part of the layout this checks.
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll(".ov-cycle *:not(.visually-hidden)")]
          .filter((e) => e.closest(".visually-hidden") === null)
          .filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map((e) => `${e.tagName.toLowerCase()}.${String(e.getAttribute("class"))}`),
      );
      expect(clipped, `at ${width}px`).toEqual([]);
      // The page's own sideways scroll is not this bar's: at 768px the Leads sites table is
      // wider than the page (a pre-existing overflow outside the bar, not in this PR). The
      // bar's section must not overflow its own box.
      const barOverflows = await page.evaluate(() => {
        const s = document.querySelector<HTMLElement>(".ov-cycle")!;
        return s.scrollWidth > s.clientWidth + 1;
      });
      expect(barOverflows, `at ${width}px`).toBe(false);
    }
  });

  // P1-87 PR 5a, review round 1, accessibility critical 1 and major 2: under forced colours
  // the bars keep a border the browser draws (their background is the page's colour), and
  // the marker keeps a left border. The running bars' stripes are a pattern, so they are not
  // checked here.
  it("under forced colours every non-running bar draws a border, and the marker a left border, at 1280px", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(`${origin}/`);
    await expect.poll(() => page.locator(".ov-cycle-seg").count()).toBe(9);
    const bars = await page.evaluate(() =>
      [...document.querySelectorAll(".ov-cycle-seg")].map((li) => {
        const cs = getComputedStyle(li.querySelector(".ov-cycle-bar")!);
        const sides = ["Top", "Right", "Bottom", "Left"].map((d) => ({
          width: Number.parseFloat(cs.getPropertyValue(`border-${d.toLowerCase()}-width`)),
          style: cs.getPropertyValue(`border-${d.toLowerCase()}-style`),
        }));
        return {
          cls: li.getAttribute("class") ?? "",
          drawn: sides.some((x) => x.width >= 1 && x.style !== "none"),
        };
      }),
    );
    // Precondition: a finished step and an unfinished one rendered, so the check is not empty.
    expect(bars.some((b) => /\b(done|none)\b/.test(b.cls))).toBe(true);
    for (const b of bars) {
      if (/\brunning\b/.test(b.cls)) continue;
      expect(b.drawn, b.cls).toBe(true);
    }
    const marker = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".ov-cycle-marker");
      return el === null ? null : Number.parseFloat(getComputedStyle(el).borderLeftWidth);
    });
    // The seeded newest night is recorded, so the bar has a marker to check (P1-87 PR 5a,
    // review round 2): a bar that drops its marker under forced colours fails here.
    expect(marker, "the marker is rendered").not.toBeNull();
    expect(marker!).toBeGreaterThan(0);
    // P1-87 PR 5a, review round 3 (correctness major 2): a `none` step is dashed at 2px
    // under forced colours, as the forced block says. The base rule once beat it at 1px.
    expect(
      await page.locator(".ov-cycle-seg.none").count(),
      "a none step rendered",
    ).toBeGreaterThan(0);
    const noneBorder = await page
      .locator(".ov-cycle-seg.none .ov-cycle-bar")
      .first()
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return { width: cs.borderTopWidth, style: cs.borderTopStyle };
      });
    expect(noneBorder).toEqual({ width: "2px", style: "dashed" });
  });

  // P1-87 PR 4, review round 2 B: at 1280px the feed is the tallest first-screen panel, so
  // without `align-items: start` on the row, Health and Happening stretch to its height. Its
  // time column is fixed, so every line's text starts at one x.
  it("at 1280px Lately is the tallest panel and Health keeps its own height; every line's text starts at one x", async () => {
    const db = await openDb({ url: dbUrl });
    try {
      // Five more lines: one dated (6.5 days old) and four from today's hours. The dated line
      // is the oldest, so the 8-line cap keeps it only while seven lines are newer: the seeds
      // above and below add three, so four hour lines leave it the eighth.
      for (let i = 0; i < 5; i++)
        await recordFleetEvent(db, {
          id: `pr4-fill-${i}`,
          ts:
            i === 0
              ? new Date(Date.now() - 6.5 * 86_400_000).toISOString()
              : new Date(Date.now() - i * 1_800_000).toISOString(),
          type: "pr_automerged",
          siteId: null,
          siteName: "Hillcrest Veterinary Hospital and Dental Care of the Northern Valley",
          summary: "renewed",
          data: null,
        });
      const page = await signedIn();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${origin}/`);
      await expect.poll(() => page.locator(".ov-lately li").count()).toBeGreaterThan(6);
      // Each panel's own content height: its last child's bottom plus its bottom padding.
      const measured = await page.evaluate(() => {
        const panels = ["ov-health", "ov-happening", "ov-lately"].map((c) =>
          document.querySelector<HTMLElement>(`.${c}`),
        );
        if (panels.some((p) => p === null)) return null;
        return (panels as HTMLElement[]).map((el) => {
          const box = el.getBoundingClientRect();
          const last = el.lastElementChild!.getBoundingClientRect();
          const padBottom = parseFloat(getComputedStyle(el).paddingBottom);
          return { height: box.height, content: last.bottom - box.top + padBottom };
        });
      });
      // All three panels measured. Lately's own content is the tallest, so a row that
      // stretches shows it in Health's box: Health's height must match its own content.
      expect(measured).not.toBeNull();
      expect(measured!).toHaveLength(3);
      expect(measured!.every((m) => m.height > 0)).toBe(true);
      const [health, , lately] = measured!;
      expect(lately!.content).toBeGreaterThan(health!.content);
      expect(Math.abs(health!.height - health!.content)).toBeLessThanOrEqual(2);
      expect(Math.abs(measured![1]!.height - measured![1]!.content)).toBeLessThanOrEqual(2);
      // Both kinds of stamp render: a dated one (its date ends in a comma) and an undated one.
      const stamps = await page.$$eval(".ov-lately time", (ts) =>
        ts.map((t) => t.textContent ?? ""),
      );
      expect(stamps.some((t) => t.includes(","))).toBe(true);
      expect(stamps.some((t) => !t.includes(","))).toBe(true);
      const starts = await page.$$eval(".ov-lately li", (lis) =>
        lis.map((li) => (li.children[1] as HTMLElement).getBoundingClientRect().left),
      );
      expect(starts.length).toBeGreaterThan(6);
      expect(Math.max(...starts) - Math.min(...starts)).toBeLessThanOrEqual(1);
    } finally {
      await db.deleteFrom("fleet_events").where("id", "like", "pr4-fill-%").execute();
      await db.destroy();
    }
  });

  // P1-87 PR 4, review round 1 F: between 60rem and 75rem Lately spans both columns, below them.
  it("Lately spans the two panels' columns at 1100px, and its top is below both", async () => {
    const page = await signedIn();
    await page.goto(`${origin}/`);
    for (const width of [1100]) {
      await page.setViewportSize({ width, height: 900 });
      const rects = await page.locator(".ov-health, .ov-happening, .ov-lately").evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { left: r.left, width: r.width, top: r.top, bottom: r.bottom };
        }),
      );
      // It measured all three panels, each with a width.
      expect(rects).toHaveLength(3);
      expect(rects.every((r) => r.width > 0)).toBe(true);
      const gap = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.querySelector(".ov-first")!).columnGap),
      );
      const [health, happening, lately] = rects as [
        (typeof rects)[number],
        (typeof rects)[number],
        (typeof rects)[number],
      ];
      expect(
        Math.abs(lately!.width - (health!.width + gap + happening!.width)),
      ).toBeLessThanOrEqual(2);
      expect(lately!.top).toBeGreaterThanOrEqual(Math.max(health!.bottom, happening!.bottom));
    }
  });

  it("the overview's check bars line up and its panels share a top at 1280px", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await expect.poll(() => page.locator(".ov-check-bar").count()).toBe(7);
    const bars = await page.locator(".ov-check-bar").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.width)];
      }),
    );
    expect(new Set(bars.map((b) => b.join(","))).size).toBe(1);
    expect(bars[0]![1]).toBeGreaterThan(100);
    const tops = await page
      .locator(".ov-health, .ov-happening")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops).toHaveLength(2);
    expect(tops[0]).toBe(tops[1]);
  });

  // P1-87 PR 3, round 2: each fill lies inside its own track (the bar is its containing
  // block), and on a phone every bar keeps its width, with the count under it.
  it("each check's fill lies inside its own track at 1280px, and every bar keeps its width at 390px", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await expect.poll(() => page.locator(".ov-check-bar").count()).toBe(7);
    // Review round 4 (tests M1): the seed gives Acme a passing check, so a fill is measured
    // here, and every fill and every unknown part lies inside its own track.
    const parts = await page.locator(".ov-check").evaluateAll((rows) =>
      rows.flatMap((row) => {
        const bar = row.querySelector(".ov-check-bar")!.getBoundingClientRect();
        return [...row.querySelectorAll(".ov-check-fill, .ov-check-unknown")].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            kind: el.classList.contains("ov-check-fill") ? "fill" : "unknown",
            inside:
              r.left >= bar.left - 0.5 &&
              r.right <= bar.right + 0.5 &&
              r.top >= bar.top - 0.5 &&
              r.bottom <= bar.bottom + 0.5,
          };
        });
      }),
    );
    expect(parts.filter((p) => p.kind === "fill").length).toBeGreaterThan(0);
    expect(parts.filter((p) => p.kind === "unknown").length).toBeGreaterThan(0);
    expect(parts.every((p) => p.inside)).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/`);
    await expect.poll(() => page.locator(".ov-check-bar").count()).toBe(7);
    const widths = await page
      .locator(".ov-check-bar")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(100);
  });

  // P1-87 PR 7a, review round 1 (A.3): the newest night's search impressions, 12,345,678 (eight
  // digits with their commas, seeded above with visits not in the row), stay on one line inside
  // their tile at the phone's width and at a laptop's, and the right edge is inside the tile.
  it.each([390, 1280])(
    "the search tile's 12,345,678 stays on one line inside its tile at %spx",
    async (width) => {
      const page = await signedIn();
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${origin}/`);
      await expect.poll(() => page.locator(".ov-tile").count()).toBe(8);
      const fit = await page.evaluate(() => {
        const num = [...document.querySelectorAll(".ov-num")].find(
          (e) => e.textContent?.trim() === "12,345,678",
        ) as HTMLElement | undefined;
        if (!num) return null;
        const tile = num.closest(".ov-tile")!.getBoundingClientRect();
        const textRects = (el: Element): DOMRect[] => {
          // The text boxes only: a flex item span is a box of its own, one pixel off the text.
          const out: DOMRect[] = [];
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            const r = document.createRange();
            r.selectNodeContents(n);
            out.push(...r.getClientRects());
          }
          return out.filter((r) => r.width > 0);
        };
        const rects = textRects(num);
        return {
          tops: [...new Set(rects.map((r) => Math.round(r.top)))],
          right: Math.max(...rects.map((r) => r.right)),
          tileRight: tile.right,
          tileLeft: tile.left,
          left: Math.min(...rects.map((r) => r.left)),
        };
      });
      expect(fit).not.toBeNull();
      // One line: every box of the figure's text starts at the same top.
      expect(fit!.tops).toHaveLength(1);
      expect(fit!.left).toBeGreaterThanOrEqual(fit!.tileLeft);
      expect(fit!.right).toBeLessThanOrEqual(fit!.tileRight);
    },
  );

  // P1-87 PR 7a, review round 2 (B.1, B.2, B.3) and review round 3 (M1, M2, the tests minor): a
  // long figure beside a three-digit one, in the same row. The visits tile holds 345 and the
  // search tile holds the figure (the newest night's traffic is re-seeded for it, and put back).
  // The harness has no brand font: it falls back to Liberation Sans, where "12,345,678" is 5.00em.
  // The shipped Pragmatica 700 is wider, by a per-figure ratio that moves with the font size
  // (measured in this page with the Adobe kit served, round 4): RATIO below. The figure's width
  // in the shipped font is its fallback width times its ratio. A figure on one line must fit its
  // tile at that width. A figure too wide for its tile breaks only after a comma: each line but
  // the last ends with ",", and every line fits its tile, or only its trailing "," passes the
  // edge by at most half the column gap (hanging punctuation). The search tile is the grid's right
  // column, so that comma hangs past the grid's edge into the page's side margin, not into the
  // gutter: half the gap only caps the overhang, and the no-sideways-scroll check is what guards it.
  // At 320px with a 32px default that overhang is the one accepted case. The size is never below
  // the body text (1rem) or the label's, so the reader's text size is kept.
  // Level: a figure on one line has its text's bottom and its label's top level with 345's,
  // within 1px. A wrapped figure is taller than 345, so only its fit is asserted there.
  // The figure's text is the plain figure: no break character is spoken.
  // Measured ratios (shipped / fallback character-box advance, Pragmatica 700 from the kit,
  // in the harness's pages, 1280 to 320px, default fonts 16 to 32px, figure sizes 16 to 34px):
  //   "12,345,678": 1.155 at 16px (1280, 1440), 1.146 at 16px (320), 1.1552 at 20px, 1.1739 at 32px (320, 390),
  //     1.1895 at 24px (390, 1920); the widest measured, 1.1895, is rounded up to 1.19.
  //   "1,234,567": 1.1774 at 16px, 1.1794 at 20px, 1.1871 at 32px, 1.2072 at 24px (390, 1920),
  //     1.2085 at 20px (390); rounded up to 1.21.
  //   "123,456,789": 1.1640 at 16px, 1.1617 at 20px, 1.1801 at 32px, 1.1978 at 24px (1920),
  //     1.1965 at 20px (390); rounded up to 1.20.
  // Fallback advances, for the same cases: "12,345,678" 101.30px at 16px (20.23px figure), 120.22px
  // at 24px, 160.16px at 32px; "1,234,567" 90.03, 106.86, 142.36px; "123,456,789" 112.55, 133.58,
  // 177.95px.
  // The 1.15 this test used before round 4 was measured on the 12,345,678 case only, and it
  // predicts 1,234,567 at 390/24 as one line where Pragmatica wraps it (round 4, tests major 1).
  /** Shipped-font ratio per figure: its measured maximum over 16 to 34px, rounded up (see above). */
  const RATIO: Record<string, number> = {
    "12,345,678": 1.19,
    "1,234,567": 1.21,
    "123,456,789": 1.2,
  };
  /** Figures that wrap at the default font in the shipped font (a filed residual, round 4). */
  const WRAPS_AT_DEFAULT = new Set(["123,456,789"]);
  type Measured = {
    groups: { text: string; width: number; comma: number }[];
    tileWidth: number;
    gap: number;
  };
  /**
   * The shipped lines, estimated: comma groups packed greedily into lines at the shipped width
   * (the fallback's width times the figure's ratio). A line fits if it is inside the tile, or if
   * only its trailing comma passes the tile's edge and it overhangs by at most half the column gap
   * (a cap only: the search tile is the right column, so the comma hangs past the grid's edge into
   * the page margin, and the caller's scrollWidth check is the real guard).
   * The fallback does not wrap where Pragmatica does (390px at 24px: 120px in a 126px tile), so
   * the estimate, not the fallback's own lines, is what the shipped font's breaks are checked against.
   */
  function shippedLines(m: Measured, ratio: number): { text: string; fits: boolean }[] {
    const fits = (g: Measured["groups"]): boolean => {
      const width = ratio * g.reduce((s, x) => s + x.width, 0);
      if (width <= m.tileWidth) return true;
      const last = g[g.length - 1]!;
      if (!last.text.endsWith(",")) return false;
      const withoutComma = width - ratio * last.comma;
      return withoutComma <= m.tileWidth && width - m.tileWidth <= m.gap / 2;
    };
    const lines: { text: string; fits: boolean }[] = [];
    let cur: Measured["groups"] = [];
    for (const g of m.groups) {
      if (cur.length > 0 && !fits([...cur, g])) {
        lines.push({ text: cur.map((x) => x.text).join(""), fits: fits(cur) });
        cur = [];
      }
      cur.push(g);
    }
    if (cur.length > 0) lines.push({ text: cur.map((x) => x.text).join(""), fits: fits(cur) });
    return lines;
  }

  it.each(["1,234,567", "12,345,678", "123,456,789"])(
    "the search tile's %s fits its tile at every width and font size, one line level with visits' 345 or broken only after a comma (review rounds 2 and 3)",
    async (figure) => {
      const saved = await seedTraffic(345, Number(figure.replace(/,/g, "")));
      try {
        const measure = (page: Page) =>
          page.evaluate((figure) => {
            const figs = [...document.querySelectorAll<HTMLElement>(".ov-num")];
            const num = figs.find((e) => e.textContent?.trim() === figure);
            const three = figs.find((e) => e.textContent?.trim() === "345");
            if (!num || !three) return null;
            const tile = num.closest(".ov-tile")!;
            const other = three.closest(".ov-tile")!;
            // Each character's own box, grouped by its line (its top), in reading order; and each
            // comma group (its digits and its comma) with its width, for the shipped estimate.
            const byTop = new Map<number, string>();
            const groups: { text: string; width: number; comma: number }[] = [];
            let groupText = "";
            let groupWidth = 0;
            let advance = 0; // the figure's width on one line: its characters' boxes, summed
            const walker = document.createTreeWalker(num, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              const text = n.textContent ?? "";
              for (let i = 0; i < text.length; i++) {
                const r = document.createRange();
                r.setStart(n, i);
                r.setEnd(n, i + 1);
                const box = r.getBoundingClientRect();
                advance += box.width;
                const top = Math.round(box.top);
                byTop.set(top, (byTop.get(top) ?? "") + text[i]);
                groupText += text[i];
                groupWidth += box.width;
                if (text[i] === ",") {
                  groups.push({ text: groupText, width: groupWidth, comma: box.width });
                  groupText = "";
                  groupWidth = 0;
                }
              }
            }
            if (groupText) groups.push({ text: groupText, width: groupWidth, comma: 0 });
            const textRects = (el: Element): DOMRect[] => {
              // The text boxes only: a flex item span is a box of its own, one pixel off the text.
              const out: DOMRect[] = [];
              const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
              for (let n = w.nextNode(); n; n = w.nextNode()) {
                const r = document.createRange();
                r.selectNodeContents(n);
                out.push(...r.getClientRects());
              }
              return out.filter((r) => r.width > 0);
            };
            const rects = textRects(num);
            const box = tile.getBoundingClientRect();
            const label = (t: Element) => t.querySelector(".ov-label")!.getBoundingClientRect().top;
            const textBottom = (el: HTMLElement) => {
              return Math.max(...textRects(el).map((r) => r.bottom));
            };
            return {
              text: num.textContent ?? "",
              lines: [...byTop.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s),
              groups,
              left: Math.min(...rects.map((r) => r.left)),
              right: Math.max(...rects.map((r) => r.right)),
              tileLeft: box.left,
              tileRight: box.right,
              tileWidth: box.width,
              gap: parseFloat(getComputedStyle(tile.parentElement!).columnGap),
              labelTops: [label(tile), label(other)],
              textBottoms: [textBottom(num), textBottom(three)],
              rootFont: getComputedStyle(document.documentElement).fontSize,
              figureFont: getComputedStyle(num).fontSize,
              labelFont: getComputedStyle(tile.querySelector(".ov-label")!).fontSize,
              wbrs: num.querySelectorAll("wbr").length,
              advance,
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
            };
          }, figure);
        const open = async (width: number, standard?: number) => {
          const page = await signedIn();
          await page.setViewportSize({ width, height: 844 });
          if (standard !== undefined) {
            const cdp = await page.context().newCDPSession(page);
            await cdp.send("Page.setFontSizes", { fontSizes: { standard } });
          }
          await page.goto(`${origin}/`);
          await expect.poll(() => page.locator(".ov-tile").count()).toBe(8);
          return page;
        };
        // The sideways-scroll check is kept to the three cases the round-2 test checked: at
        // 768px and at 24px on a laptop the page is wider than the screen for reasons this figure
        // does not cause (`table.ov-leads-sites`, pre-existing; see the PR body).
        const cases: [number, number | undefined, boolean][] = [
          [390, undefined, false],
          [768, undefined, false],
          [1280, undefined, false],
          [1440, undefined, false],
          [390, 24, true],
          [1920, 24, true],
          [390, 32, true],
          [320, 32, false],
        ];
        for (const [width, standard, sideways] of cases) {
          const where = `${width}px${standard === undefined ? "" : ` at ${standard}px`}`;
          const m = await measure(await open(width, standard));
          expect(m, where).not.toBeNull();
          expect(m!.text, `${where} plain figure`).toBe(figure);
          expect(m!.rootFont, `${where} root`).toBe(`${standard ?? 16}px`);
          // The size floor: never below the body text, nor the label's.
          expect(parseFloat(m!.figureFont), `${where} floor`).toBeGreaterThanOrEqual(
            parseFloat(m!.rootFont),
          );
          expect(parseFloat(m!.figureFont), `${where} label floor`).toBeGreaterThanOrEqual(
            parseFloat(m!.labelFont),
          );
          if (sideways)
            expect(m!.scrollWidth, `${where} sideways`).toBeLessThanOrEqual(m!.innerWidth);
          // The shipped width: the fallback's, times this figure's ratio.
          const ratio = RATIO[figure]!;
          const fits = m!.advance * ratio <= m!.tileWidth;
          // At the default font the shipped figure is one line at every width tested (round 2,
          // B.1), so the margin must hold there, and a size that wraps at the default font fails.
          // 123,456,789 wraps at the default font at 1280 to 1920px in the shipped font (filed
          // residual, round 4), so for it the default-font case is checked by the break rule below.
          if (standard === undefined && !WRAPS_AT_DEFAULT.has(figure))
            expect(m!.advance * ratio, `${where} margin at the default font`).toBeLessThanOrEqual(
              m!.tileWidth,
            );
          if (fits) {
            // One line: inside its tile at the shipped width, and level with 345.
            expect(m!.lines.length, `${where} one line`).toBe(1);
            expect(m!.advance * ratio, `${where} fits`).toBeLessThanOrEqual(m!.tileWidth);
            expect(m!.left, `${where} left`).toBeGreaterThanOrEqual(m!.tileLeft);
            expect(m!.right, `${where} right`).toBeLessThanOrEqual(m!.tileRight);
            expect(
              Math.abs(m!.labelTops[0]! - m!.labelTops[1]!),
              `${where} label tops`,
            ).toBeLessThanOrEqual(1);
            expect(
              Math.abs(m!.textBottoms[0]! - m!.textBottoms[1]!),
              `${where} text bottoms`,
            ).toBeLessThanOrEqual(1);
          } else {
            // Wrapped: the break points are the commas, the figure never runs sideways, and each
            // line of the shipped estimate fits its tile or hangs only its trailing comma.
            expect(m!.wbrs, `${where} a break after each comma`).toBe(figure.split(",").length - 1);
            const lines = shippedLines(m!, ratio);
            expect(lines.length, `${where} wraps in the shipped estimate`).toBeGreaterThan(1);
            lines.forEach((line, i) => {
              if (i < lines.length - 1)
                expect(line.text.endsWith(","), `${where} break after a comma: ${line.text}`).toBe(
                  true,
                );
              expect(line.fits, `${where} shipped line ${line.text} inside its tile`).toBe(true);
            });
            m!.lines.slice(0, -1).forEach((line) => {
              expect(line.endsWith(","), `${where} fallback break after a comma: ${line}`).toBe(
                true,
              );
            });
            expect(m!.left, `${where} left`).toBeGreaterThanOrEqual(m!.tileLeft);
            expect(m!.right, `${where} right`).toBeLessThanOrEqual(m!.tileRight);
            expect(m!.scrollWidth, `${where} sideways`).toBeLessThanOrEqual(m!.innerWidth);
          }
        }
      } finally {
        await putNewestCounts(saved);
      }
    },
    120_000,
  );

  // P1-87 PR 3, review round 3 (a11y m3, tests M2): with a long count on a row, the bars
  // keep their width. The count column is 9rem wide, so 1000px keeps every bar at 140px or
  // more; on a phone every bar is at least 100px wide, and its count sits under it.
  it("a long count keeps every bar wide: 140px at 1000px, and under the bar at 390px", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(`${origin}/`);
    await expect.poll(() => page.locator(".ov-check-bar").count()).toBe(7);
    const long = await page
      .locator(".ov-check", { hasText: "Contact form" })
      .locator(".ov-check-count")
      .textContent();
    expect(long).toContain("1 test failed, not yet a verdict · 1 no verdict · 1 not checked");
    const wide = await page
      .locator(".ov-check-bar")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    for (const w of wide) expect(w).toBeGreaterThanOrEqual(140);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/`);
    await expect.poll(() => page.locator(".ov-check-bar").count()).toBe(7);
    const phone = await page.locator(".ov-check").evaluateAll((rows) =>
      rows.map((row) => {
        const bar = row.querySelector(".ov-check-bar")!.getBoundingClientRect();
        const count = row.querySelector(".ov-check-count")!.getBoundingClientRect();
        return { width: bar.width, below: count.top >= bar.bottom - 0.5 };
      }),
    );
    expect(phone).toHaveLength(7);
    for (const row of phone) {
      expect(row.width).toBeGreaterThanOrEqual(100);
      expect(row.below).toBe(true);
    }
  });

  // P1-87 PR 1, review round 2: on a small laptop (1000px) each flow stays one row,
  // so no arrow starts a wrapped row and the last step stays in the chain.
  it("How this works keeps each flow on one row at 1000px", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(`${origin}/how`);
    await expect.poll(() => page.locator("h1").first().textContent()).toContain("How this works");
    const tops = await page.$$eval(".how-flow", (flows) =>
      flows.map((f) => [...f.children].map((li) => Math.round(li.getBoundingClientRect().top))),
    );
    expect(tops.length).toBe(3);
    for (const row of tops) expect(new Set(row).size).toBe(1);
    // Each chapter's heading is regular weight, not the browser's bold.
    const headings = await page.$$eval(".how-chapter h2", (hs) =>
      hs.map((h) => getComputedStyle(h).fontWeight),
    );
    expect(headings).toHaveLength(5);
    expect(new Set(headings)).toEqual(new Set(["400"]));
    // Each box after the first has its arrow, pointing along the row: not the phone's.
    const arrows = await page.$$eval(".how-flow > li + li", (els) =>
      els.map((e) => [
        getComputedStyle(e, "::before").content,
        getComputedStyle(e, "::before").transform,
      ]),
    );
    for (const [content] of arrows) expect(content).not.toBe("none");
    expect(new Set(arrows.map(([, t]) => t)).size).toBe(1);
    expect(arrows[0]![1]).not.toBe("none");
    // On a phone the same arrow turns to point down the column.
    await page.setViewportSize({ width: 390, height: 800 });
    const phone = await page.$eval(
      ".how-flow > li + li",
      (e) => getComputedStyle(e, "::before").transform,
    );
    expect(phone).not.toBe("none");
    expect(phone).not.toBe(arrows[0]![1]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1000,
    );
  });

  // P1-87 PR 1, review round 5: at 768px (under 60rem) the ladder is two columns, so
  // its four boxes form a 2x2 grid and Broken is not alone in a row.
  it("How this works lays the ladder out as a 2x2 grid at 768px", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 768, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${origin}/how`);
    await expect.poll(() => page.locator("h1").first().textContent()).toContain("How this works");
    const tops = await page.$$eval(".how-ladder li", (els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)),
    );
    expect(tops).toHaveLength(4);
    expect(tops[0]).toBe(tops[1]);
    expect(tops[2]).toBe(tops[3]);
    expect(tops[2]).toBeGreaterThan(tops[0]!);
  });

  // P1-87 PR 1, review round 6: the ladder is four columns at 1000px, and its bars
  // and hairlines are the widths the page's notes promise.
  // Review round 7: the bars and hairlines are checked in both themes, not only in light.
  it.each(["light", "dark"] as const)(
    "How this works sets the ladder's four levels on one row, with its bar widths, at 1000px in the %s theme",
    async (scheme) => {
      const page = await signedIn();
      await page.setViewportSize({ width: 1000, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${origin}/how`);
      await expect.poll(() => page.locator("h1").first().textContent()).toContain("How this works");
      const ladder = await page.$$eval(".how-ladder li", (els) =>
        els.map((e) => ({
          cls: e.className,
          top: Math.round(e.getBoundingClientRect().top),
          bar: getComputedStyle(e).borderTopWidth,
          textTop: Math.round(e.firstElementChild!.getBoundingClientRect().top),
        })),
      );
      expect(ladder).toHaveLength(4);
      expect(new Set(ladder.map((l) => l.top)).size).toBe(1);
      // Broken's word sits level with the others' even with its thicker bar.
      expect(new Set(ladder.map((l) => l.textTop)).size).toBe(1);
      // Only Broken's bar is wider than 4px, and it is 8px.
      expect(Object.fromEntries(ladder.map((l) => [l.cls, l.bar]))).toEqual({
        ok: "4px",
        watch: "4px",
        attention: "4px",
        broken: "8px",
      });
      // Every flow box but the filled end box has the 1px hairline.
      const hairlines = await page.$$eval(".how-flow li:not(.how-end)", (els) =>
        els.map((e) => getComputedStyle(e).borderTopWidth),
      );
      expect(hairlines.length).toBeGreaterThan(0);
      expect(new Set(hairlines)).toEqual(new Set(["1px"]));
      // Review round 7: each hairline is the --rule token's colour, resolved by a probe.
      const rule = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.color = "var(--rule)";
        document.body.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      });
      const hairlineColors = await page.$$eval(".how-flow li:not(.how-end)", (els) =>
        els.map((e) => getComputedStyle(e).borderTopColor),
      );
      expect(hairlineColors).toHaveLength(hairlines.length);
      for (const c of hairlineColors) expect(c).toBe(rule);
      // The filled end box's hairline is its own fill, so the rule does not cross it.
      const ends = await page.$$eval(".how-flow li.how-end", (els) =>
        els.map((e) => [getComputedStyle(e).borderTopColor, getComputedStyle(e).backgroundColor]),
      );
      expect(ends.length).toBe(3);
      for (const [border, fill] of ends) expect(border).toBe(fill);
      // Review round 7 (nit): the end box's hairline is 1px, like the rest of the flow.
      const endWidths = await page.$$eval(".how-flow li.how-end", (els) =>
        els.map((e) => getComputedStyle(e).borderTopWidth),
      );
      expect(endWidths).toHaveLength(3);
      for (const w of endWidths) expect(w).toBe("1px");
    },
  );

  // P1-87 PR 1, review round 6: at 390px the ladder is one column, four rows in order.
  // Review round 7: also at 470px, which is under the 30rem (480px) rule's edge.
  it.each([390, 470])(
    "How this works stacks the ladder's four levels in one column at %spx",
    async (width) => {
      const page = await signedIn();
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(`${origin}/how`);
      await expect.poll(() => page.locator("h1").first().textContent()).toContain("How this works");
      const boxes = await page.$$eval(".how-ladder li", (els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { top: Math.round(r.top), left: Math.round(r.left) };
        }),
      );
      expect(boxes).toHaveLength(4);
      expect(new Set(boxes.map((b) => b.left)).size).toBe(1);
      for (let i = 1; i < boxes.length; i++)
        expect(boxes[i]!.top).toBeGreaterThan(boxes[i - 1]!.top);
    },
  );

  // P1-87 PR 1, review round 7: the four-column rule starts at 60rem (960px), so at
  // 970px all four levels share one row too, not only at 1000px.
  it("How this works sets the ladder's four levels on one row at 970px", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 970, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${origin}/how`);
    await expect.poll(() => page.locator("h1").first().textContent()).toContain("How this works");
    const tops = await page.$$eval(".how-ladder li", (els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)),
    );
    expect(tops).toHaveLength(4);
    expect(new Set(tops).size).toBe(1);
  });

  // P1-87 PR 1: How this works on a 390px-wide phone, in both themes, with nothing
  // wider than its box: the flows stack, and How we count opens inside the screen.
  it.each(["light", "dark"] as const)(
    "How this works fits a 390px-wide screen in the %s theme",
    async (scheme) => {
      const page = await signedIn();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${origin}/how`);
      await expect.poll(() => page.locator("h1").first().textContent()).toContain("How this works");
      expect(await page.locator("section.how-chapter").count()).toBe(5);
      await page.locator(".how-count summary").click();
      const fit = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: window.innerWidth,
        wide: [...document.body.querySelectorAll("*")]
          .filter((e) => {
            const d = getComputedStyle(e).display;
            return d !== "inline" && d !== "contents" && e.clientWidth > 0;
          })
          .filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map(
            (e) => `${e.tagName.toLowerCase()}.${e.className}: ${e.scrollWidth} > ${e.clientWidth}`,
          ),
        flowRight: Math.max(
          ...[...document.querySelectorAll(".how-flow li, .how-steps li, .how-ladder li")].map(
            (e) => e.getBoundingClientRect().right,
          ),
        ),
      }));
      expect(fit.wide).toEqual([]);
      expect(fit.scroll).toBeLessThanOrEqual(fit.width);
      expect(fit.flowRight).toBeLessThanOrEqual(fit.width);
      // The flows stack: on a phone each box is on its own row, under the one before.
      const flows = await page.$$eval(".how-flow", (fs) =>
        fs.map((f) =>
          [...f.children].map((li) => {
            const r = li.getBoundingClientRect();
            return { top: Math.round(r.top), left: Math.round(r.left) };
          }),
        ),
      );
      expect(flows).toHaveLength(3);
      for (const boxes of flows) {
        expect(new Set(boxes.map((b) => b.top)).size).toBe(boxes.length);
        expect(new Set(boxes.map((b) => b.left)).size).toBe(1);
      }
      // The filled end box's words are readable, and no arrow leads into the first box.
      const ends = await page.$$eval(".how-flow li.how-end", (els) =>
        els.map((e) => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]),
      );
      expect(ends.length).toBe(3);
      for (const [color, background] of ends) expect(color).not.toBe(background);
      const firstArrows = await page.$$eval(".how-flow > li:first-child", (els) =>
        els.map((e) => getComputedStyle(e, "::before").content),
      );
      expect(firstArrows).toEqual(["none", "none", "none"]);
      // Every box after the first has its arrow, turned to point down the column.
      const arrows = await page.$$eval(".how-flow > li + li", (els) =>
        els.map((e) => [
          getComputedStyle(e, "::before").content,
          getComputedStyle(e, "::before").transform,
        ]),
      );
      expect(arrows.length).toBeGreaterThan(8);
      for (const [content] of arrows) expect(content).not.toBe("none");
      expect(new Set(arrows.map(([, t]) => t)).size).toBe(1);
      // The end box's words meet 4.5:1 on its fill.
      const contrast = await page.$$eval(".how-flow li.how-end", (els) =>
        els.map((e) => {
          const lum = (c: string) => {
            const [r, g, b] = c
              .match(/\d+(\.\d+)?/g)!
              .slice(0, 3)
              .map(Number)
              .map((v) => {
                const x = v / 255;
                return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
              });
            return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
          };
          const [a, b] = [lum(getComputedStyle(e).color), lum(getComputedStyle(e).backgroundColor)];
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        }),
      );
      for (const r of contrast) expect(r).toBeGreaterThanOrEqual(4.5);
      // Broken's bar is the Broken red, and no other level's is.
      const bars = await page.$$eval(".how-ladder li", (els) =>
        els.map((e) => [e.className, getComputedStyle(e).borderTopColor]),
      );
      const red = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.color = "var(--broken-fill)";
        document.body.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      });
      expect(bars.filter(([, c]) => c === red).map(([k]) => k)).toEqual(["broken"]);
    },
  );

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
      // The first screen's health panel and its eight number tiles (P1-87 PR 3; the two traffic
      // tiles first, P1-87 PR 7a).
      expect(await page.locator(".ov-health").count()).toBe(1);
      expect(await page.locator(".ov-tile").count()).toBe(8);
      expect(await page.locator(".ov-leads-sites tbody th", { hasText: LONG_NAME }).count()).toBe(
        1,
      );
      // P1-78h: section 8 draws its charts, so they are laid out here too: four, and the
      // three traffic charts (P1-87 PR 7b).
      expect(await page.locator("figure.ov-trend svg.ov-chart").count()).toBe(7);
      await page.locator(".ov-trend-table summary").first().click();
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
          dot: of("circle.ov-dot:not(.broken)", "fill"),
          // Review round 2 (T3): the first dot drawn is Attention's, so Broken's own.
          brokenDot: of("circle.ov-dot.broken", "fill"),
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
      // The bar's "in N hours" renders only once the page's clock has started in the
      // browser (the server cannot know the browser's time), so read the page after that
      // first tick, or one load can be read between hydration and the tick (P1-87 PR 5a:
      // CI at 9b296709 read erik after the tick and tim before it).
      await expect.poll(() => page.locator(".ov-cycle-until").count()).toBe(1);
      const html = await page.evaluate(() =>
        [...document.querySelectorAll("h1, section")].map((e) => e.outerHTML).join("\n"),
      );
      // Relative times may tick between the two loads; everything else must match.
      // The nightly bar's marker and its "in N hours" are the same kind of reading: where
      // the clock is, so they tick between the loads too (P1-87 PR 5a).
      return (
        html
          .replace(/\b(just now|\d+ (?:minute|hour|day|week|month|year)s? ago)/g, "<ago>")
          // The marker's position only: Fleet health's own `left:` values are compared exactly.
          .replace(/(class="ov-cycle-marker[^"]*" style="left: )[\d.e+-]+%;?/g, "$1<marker>%")
          .replace(/(<span class="ov-cycle-until">)[^<]*/g, "$1<until>")
      );
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
