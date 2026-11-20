import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { openDb } from "../../src/db/client.js";
import { recordFleetEvent } from "../../src/db/fleet-events.js";
import { NIGHTLIES } from "../../scripts/nightly-conductor.mjs";
import { seededNights } from "../_helpers/bar-nights.js";
import { expectedNight, HEALTH_CHECK_NAMES } from "../../cockpit/src/lib/overview/view.js";
import {
  BAR_MS,
  BAR_STAGGER_MS,
  INTRO_MS,
  MAX_MOTION_MS,
  SPARK_MS,
} from "../../cockpit/src/lib/overview/motion.js";
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

// #2147: a test's pages close when it ends. Left open until afterAll, every finished test kept a
// page running its ticker and clock: renderers from 25 to 45 in four minutes and a load average of
// 51 on 4 CPUs, in a local run of the ticker block at 4x, so the later tests ran on a starved machine.
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});

afterAll(async () => {
  for (const c of contexts) await c.close();
  await browser?.close();
  await new Promise((r) => http?.close(r));
  rmSync(dir, { recursive: true, force: true });
});

async function signedIn(user = "op", options: BrowserContextOptions = {}): Promise<Page> {
  const raw = process.env.COCKPIT_CPU_THROTTLE;
  const rate = raw === undefined ? 1 : Number(raw);
  if (raw !== undefined && !(Number.isFinite(rate) && rate >= 1)) {
    throw new Error("COCKPIT_CPU_THROTTLE must be a number of at least 1");
  }
  // The gate redirects rather than challenging, so the header goes on every request.
  const context = await browser.newContext({
    ...options,
    extraHTTPHeaders: {
      authorization: `Basic ${Buffer.from(`${user}:${PASSWORD}`).toString("base64")}`,
    },
  });
  contexts.push(context);
  const page = await context.newPage();
  // #2147: COCKPIT_CPU_THROTTLE=<rate> slows every page's CPU by that factor, as a loaded CI
  // runner does, so a test that acts before the page's script has run can be made to fail here.
  if (rate > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }
  return page;
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

/** P1-87 PR 8a, item 4: a measured figure's text is the count's until it has counted up (its digits
 *  sit over the model's string meanwhile), so a test that reads a figure waits for every one to finish. */
const figuresSettled = (page: Page) =>
  expect
    .poll(() => page.locator(".ov-num[data-countable]:not([data-counted])").count(), {
      timeout: 10_000,
    })
    .toBe(0);

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
      await figuresSettled(page);
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
          await figuresSettled(page);
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
        // clipped content count as fitting (review round 4, T1). P1-87 PR 5b: the
        // moving ticker is clipped by design inside its own window, so that window is
        // left out by name, only while its row is moving; the window itself must end
        // inside the screen, and the reduced-motion pass below checks it unexempted.
        tickerMoving:
          getComputedStyle(document.querySelector(".ov-ticker-run")!).animationName !== "none",
        tickerRight: document.querySelector(".ov-ticker-window")!.getBoundingClientRect().right,
        wide: [...document.body.querySelectorAll("*")]
          .filter((e) => {
            if (e.closest(".visually-hidden, .ov-table thead") !== null) return false;
            if (
              e.closest(".ov-ticker-window") !== null &&
              getComputedStyle(document.querySelector(".ov-ticker-run")!).animationName !== "none"
            )
              return false;
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
      expect(fit.tickerMoving).toBe(true);
      expect(fit.tickerRight).toBeLessThanOrEqual(fit.width + 0.5);
      // Under reduced motion the ticker stands still and wraps: the same check, with
      // no box left out for it (P1-87 PR 5b).
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const still = await page.evaluate(() => ({
        moving:
          getComputedStyle(document.querySelector(".ov-ticker-run")!).animationName !== "none",
        wide: [...document.querySelectorAll(".ov-ticker, .ov-ticker *")]
          .filter((e) => {
            const d = getComputedStyle(e).display;
            return d !== "inline" && d !== "contents" && e.clientWidth > 0;
          })
          .filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map(
            (e) => `${e.tagName.toLowerCase()}.${e.className}: ${e.scrollWidth} > ${e.clientWidth}`,
          ),
      }));
      expect(still.moving).toBe(false);
      expect(still.wide).toEqual([]);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "no-preference" });
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
      await figuresSettled(page);
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
    contexts.push(context);
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

// P1-87 PR 5b: the site ticker under the first screen, measured in the built app. It
// moves as a marquee, stops on a press of its pause button or while it is pointed at,
// and stands still under reduced motion, where its copy is gone and both sites read as
// plain text.
describe("the site ticker, in a browser (P1-87 PR 5b)", () => {
  const transform = (page: Page) =>
    page.locator(".ov-ticker-run").evaluate((el) => getComputedStyle(el).transform);
  /** The row's horizontal offset, read from its computed matrix(a, b, c, d, tx, ty). */
  const translateX = (matrix: string) => Number(matrix.slice(7, -1).split(",")[4]);
  const names = (page: Page) => page.locator(".ov-ticker-list:not(.copy) > li").allTextContents();
  /** The row's animation name: "ov-ticker" while it moves, "none" while it is still. */
  const animation = (page: Page) =>
    page.locator(".ov-ticker-run").evaluate((el) => getComputedStyle(el).animationName);
  /** The row is still only once its animation reports paused and two frames have landed.
   *  A computed style can flip before the animation itself does, so one more frame of motion
   *  can read as a row that never stopped (r2 E: -21.0992px, then -22.0165px). */
  const settledPaused = async (page: Page) => {
    await page
      .waitForFunction(
        () =>
          (document.querySelector(".ov-ticker-run") as HTMLElement | null)?.getAnimations()[0]
            ?.playState === "paused",
        undefined,
        { timeout: 10_000 },
      )
      .catch(() => {
        throw new Error("the ticker never reported paused within 10 s");
      });
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
  };

  /** #2147: the row is on the page and the ticker's script has run. The server render already holds
   *  the row, so a count alone can pass before the script attaches its listeners, and a slow runner
   *  then acts on a page that cannot respond (0 listeners counted, a drag that never starts). The
   *  script sets data-js in the same effect that attaches every listener, and the attribute reaches
   *  the DOM only after that effect has run, on each mount, to its end.
   *  P1-87 PR 8a: then the overview's count-up has finished. It rewrites the figures every frame for
   *  900 ms, and each layout lets Chromium re-hover a stale pointer position: after a drag dropped
   *  outside the window, that stale pointerover (#2134, pre-existing) landed inside it far more often
   *  while the figures counted (the drag-out and pen tests failed at 1x; with a settled page they pass).
   *  These tests are about the ticker, not the intro, so they act on a settled page. */
  const tickerReady = async (page: Page, items = 2) => {
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(items);
    await page.locator('.ov-ticker-window[data-js="true"]').waitFor({ state: "attached" });
    await figuresSettled(page);
  };

  /** #2152 round 1: a looping test closes the previous run's pages before opening the next, so one
   *  run's page is alive at a time (a run that leaves 20 pages animating starves the later runs). */
  const nextRun = async (user?: string, options?: BrowserContextOptions) => {
    for (const c of contexts.splice(0)) await c.close();
    return signedIn(user, options);
  };

  it("moves, with the seeded sites in its row", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    const all = (await names(page)).join(" | ");
    expect(all).toContain("Acme");
    expect(all).toContain("Beta");
    expect(
      await page.locator(".ov-ticker-run").evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("ov-ticker");
    const before = await transform(page);
    await expect.poll(() => transform(page), { message: "the row moves" }).not.toBe(before);
  });

  it("stops when its pause button is pressed", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    // The row must be moving before it is paused: poll for a change, so a slow first frame
    // on a fresh build does not read as a row that never moved.
    const moving = await transform(page);
    await expect
      .poll(() => transform(page), { message: `the row moves before pause (was ${moving})` })
      .not.toBe(moving);
    await page.locator(".ov-ticker-pause").click();
    expect(await page.locator(".ov-ticker-pause").getAttribute("aria-pressed")).toBe("true");
    // The paused class lands on Svelte's next update: take the baseline only once the
    // animation reports paused and two frames have landed (CI, f554677c: -13.76px then -14.68px).
    await settledPaused(page);
    const paused = await transform(page);
    await page.waitForTimeout(1500);
    expect(await transform(page), "the row stands still once paused").toBe(paused);
  });

  it("stops while the pointer is over it", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    // The row must move before the pointer is on it: poll for a change, as the pause test does.
    const moving = await transform(page);
    await expect
      .poll(() => transform(page), {
        message: `the row moves before the pointer is on it (was ${moving})`,
      })
      .not.toBe(moving);
    await page.locator(".ov-ticker-window").hover();
    await settledPaused(page);
    const hovered = await transform(page);
    await page.waitForTimeout(1500);
    expect(await transform(page)).toBe(hovered);
  });

  // P1-87 PR 5b review r3 C: the pause keys on the whole window, not on the list alone (mutant
  // X11). The padding above and below the row is never under the list, so a pointer there must
  // still stop the row.
  it("stops while the pointer is over the window's padding, not only over the list", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    // boundingBox is in the viewport, so bring the window into it first.
    await page.locator(".ov-ticker-window").scrollIntoViewIfNeeded();
    const win = (await page.locator(".ov-ticker-window").boundingBox())!;
    const points = [
      { label: "the top padding", x: win.x + win.width / 2, y: win.y + 1 },
      { label: "the bottom padding", x: win.x + win.width / 2, y: win.y + win.height - 1 },
    ];
    for (const { label, x, y } of points) {
      // Point out of the window first, so the row moves again, then point at the padding.
      await page.mouse.move(0, 0);
      const moving = await transform(page);
      await expect
        .poll(() => transform(page), { message: `the row moves before ${label} is pointed at` })
        .not.toBe(moving);
      await page.mouse.move(x, y);
      expect(
        await page.evaluate(
          ([px, py]) =>
            document.elementFromPoint(px, py) === document.querySelector(".ov-ticker-window"),
          [x, y] as const,
        ),
        `${label} is the window itself, not the list`,
      ).toBe(true);
      await settledPaused(page);
      const hovered = await transform(page);
      await page.waitForTimeout(1500);
      expect(await transform(page), `the row stands still under ${label}`).toBe(hovered);
    }
  });

  it("under reduced motion stands still: no animation, no copy, no button, both sites as text", async () => {
    const page = await signedIn();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    expect(
      await page.locator(".ov-ticker-run").evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
    expect(
      await page.locator(".ov-ticker-list.copy").evaluate((el) => getComputedStyle(el).display),
    ).toBe("none");
    expect(await page.locator(".ov-ticker-pause").isVisible()).toBe(false);
    const all = (await names(page)).join(" | ");
    expect(all).toContain("Acme");
    expect(all).toContain("Beta");
  });

  // P1-87 PR 5b review r3 D: under forced colours the pressed pause button's thicker border must
  // not make it taller, or the ticker below jumps on each press.
  it("under forced colours the pressed pause button keeps its size, and the ticker below stays put", async () => {
    const page = await signedIn();
    await page.emulateMedia({ forcedColors: "active" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    const button = page.locator(".ov-ticker-pause");
    await button.scrollIntoViewIfNeeded();
    const unpressed = (await button.boundingBox())!;
    const windowBefore = (await page.locator(".ov-ticker-window").boundingBox())!;
    await button.click();
    expect(await button.getAttribute("aria-pressed")).toBe("true");
    // The precondition: the press really does thicken the border under forced colours (r4 nit).
    expect(
      await button.evaluate((el) => getComputedStyle(el).borderTopWidth),
      "the pressed button's border is 3px under forced colours",
    ).toBe("3px");
    const pressed = (await button.boundingBox())!;
    const windowAfter = (await page.locator(".ov-ticker-window").boundingBox())!;
    expect(
      Math.abs(pressed.height - unpressed.height),
      `the pressed button is as tall as unpressed (${unpressed.height}px, pressed ${pressed.height}px)`,
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(windowAfter.y - windowBefore.y),
      "the ticker below does not move on a press",
    ).toBeLessThanOrEqual(0.5);
  });

  it("at 390px the ticker adds no sideways scroll to the page", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  // P1-87 PR 5b review r2 A: a press on a moving link opens it. Chromium focuses a link on
  // mousedown; the still layout must not follow a mouse focus, or the row reflows under the
  // pointer between press and release and the click lands on nothing.
  // r3 B: the row is moved well along before the press. A snap back moves link 2 only once the
  // row has moved, and the earlier test hovered about 1 s after load, when it had moved about 50px.
  it("opens the link a visitor clicks while the row is paused under the pointer", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page, 3);
    const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(2) a");
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    const linkWidth = (await link.boundingBox())!.width;
    await expect
      .poll(async () => -translateX(await transform(page)), {
        message: `the row moves on past link 2's ${linkWidth}px before the press`,
        timeout: 15_000,
      })
      .toBeGreaterThan(linkWidth + 20);
    await page.locator(".ov-ticker-window").hover();
    await settledPaused(page);
    const before = (await link.boundingBox())!;
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    // The press focuses link 2. It must not move under the pointer, or the release lands elsewhere.
    const during = (await link.boundingBox())!;
    expect(
      Math.abs(during.x - before.x),
      "link 2 does not move under the press",
    ).toBeLessThanOrEqual(1);
    await page.mouse.up();
    await expect
      .poll(() => page.url().endsWith(href!), { message: `the click opens ${href}` })
      .toBe(true);
  });

  // P1-87 PR 5b review r1 B: a visitor who tabs into the moving row reads its links, so
  // each focused link must be inside the window and the row must stand still meanwhile.
  it("keeps each focused link inside the window, and stands the row still, at 1280px and 390px", async () => {
    const geometry = (page: Page) =>
      page.evaluate(() => {
        const a = (document.activeElement as HTMLElement).getBoundingClientRect();
        const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
        return {
          link: { l: a.left - 4, t: a.top - 4, r: a.right + 4, b: a.bottom + 4 },
          window: { l: w.left, t: w.top, r: w.right, b: w.bottom },
        };
      });
    const focused = (page: Page) =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return {
          tag: el.tagName.toLowerCase(),
          inMovingList: el.closest(".ov-ticker-list:not(.copy)") !== null,
        };
      });
    for (const width of [1280, 390]) {
      const page = await nextRun();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page);
      await page.locator(".ov-ticker-pause").focus();
      for (const n of [1, 2]) {
        await page.keyboard.press("Tab");
        expect(await focused(page), `link ${n} at ${width}px`).toEqual({
          tag: "a",
          inMovingList: true,
        });
        const g = await geometry(page);
        expect(g.link.l, `link ${n} left edge at ${width}px`).toBeGreaterThanOrEqual(g.window.l);
        expect(g.link.r, `link ${n} right edge at ${width}px`).toBeLessThanOrEqual(g.window.r);
        expect(g.link.t, `link ${n} top edge at ${width}px`).toBeGreaterThanOrEqual(g.window.t);
        expect(g.link.b, `link ${n} bottom edge at ${width}px`).toBeLessThanOrEqual(g.window.b);
        await expect
          .poll(() => animation(page), { message: `the row is still on link ${n} at ${width}px` })
          .toBe("none");
        // The loop's copy is hidden meanwhile: a focused copy would be a second, inert row (r2 E, B3).
        expect(
          await page.locator(".ov-ticker-list.copy").evaluate((el) => getComputedStyle(el).display),
          `the copy is hidden at ${width}px`,
        ).toBe("none");
        expect(await page.locator(".ov-ticker-window").evaluate((el) => el.scrollLeft)).toBe(0);
      }
      // Tab on past the last ticker link: the row moves again, and nothing was scrolled.
      for (let i = 0; i < 6; i++) {
        const inTicker = await page.evaluate(
          () => document.activeElement!.closest(".ov-ticker") !== null,
        );
        if (!inTicker) break;
        await page.keyboard.press("Tab");
      }
      expect(
        await page.evaluate(() => document.activeElement!.closest(".ov-ticker") !== null),
      ).toBe(false);
      expect(await page.locator(".ov-ticker-window").evaluate((el) => el.scrollLeft)).toBe(0);
      expect(
        await page.locator(".ov-ticker-run").evaluate((el) => getComputedStyle(el).animationName),
      ).toBe("ov-ticker");
    }
  });

  // P1-87 PR 5b review r4 M2: a keyboard user in the still list who clicks a link with the mouse
  // keeps the click. Chromium focuses the link on mousedown without :focus-visible, so the still
  // layout must hold while focus moves between links inside the window.
  it("a mouse press on link 2 in the still list keeps the row still and the click lands, at 1280, 768 and 390px", async () => {
    for (const width of [1280, 768, 390]) {
      const page = await nextRun();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page);
      await page.locator(".ov-ticker-pause").focus();
      await page.keyboard.press("Tab");
      await expect
        .poll(() => animation(page), { message: `the row is still after a Tab at ${width}px` })
        .toBe("none");
      const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(2) a");
      const href = await link.getAttribute("href");
      expect(href, `link 2 is a link at ${width}px`).toBeTruthy();
      const before = (await link.boundingBox())!;
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
      await page.mouse.down();
      // The press focuses link 2. It must not move under the pointer, or the release lands elsewhere.
      const during = (await link.boundingBox())!;
      expect(
        Math.abs(during.x - before.x),
        `link 2 does not move sideways under the press at ${width}px`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(during.y - before.y),
        `link 2 does not move up or down under the press at ${width}px`,
      ).toBeLessThanOrEqual(1);
      expect(await animation(page), `the row stays still under the press at ${width}px`).toBe(
        "none",
      );
      await page.mouse.up();
      await expect
        .poll(() => page.url().endsWith(href!), {
          message: `the click opens ${href} at ${width}px`,
        })
        .toBe(true);
    }
  });

  // P1-87 PR 5b review r4 M1: a link focused by a mouse press, then a key press, then the pointer
  // leaving the window, leaves the focused link in view: the row stands still once the pointer is
  // gone, so the link cannot scroll out of the window.
  it("a right press on link 1, Escape, then the pointer leaving the window stills the row with link 1 in view, at 1280px and 390px", async () => {
    for (const width of [1280, 390]) {
      const page = await nextRun();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page);
      const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a");
      const href = await link.getAttribute("href");
      expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
      await page.locator(".ov-ticker-window").hover();
      await settledPaused(page);
      const box = (await link.boundingBox())!;
      await page.locator(".ov-ticker-window").scrollIntoViewIfNeeded();
      const win = (await page.locator(".ov-ticker-window").boundingBox())!;
      const left = Math.max(box.x, win.x, 0) + 1;
      const right = Math.min(box.x + box.width, win.x + win.width, width) - 1;
      await page.mouse.move((left + right) / 2, box.y + box.height / 2);
      await page.mouse.down({ button: "right" });
      await page.mouse.up({ button: "right" });
      expect(
        await page.evaluate(
          () => document.activeElement!.closest("a")?.getAttribute("href") ?? null,
        ),
        `the right press leaves link 1 focused at ${width}px`,
      ).toBe(href);
      await page.keyboard.press("Escape");
      await page.mouse.move(2, 2);
      await expect
        .poll(() => animation(page), {
          message: `the row stands still once the pointer has left, at ${width}px`,
          timeout: 5_000,
        })
        .toBe("none");
      expect(
        await page.evaluate(
          () => document.activeElement!.closest("a")?.getAttribute("href") ?? null,
        ),
        `link 1 holds the focus at ${width}px`,
      ).toBe(href);
      const g = await page.evaluate(() => {
        const a = document.activeElement!.getBoundingClientRect();
        const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
        return {
          l: a.left,
          t: a.top,
          r: a.right,
          b: a.bottom,
          wl: w.left,
          wt: w.top,
          wr: w.right,
          wb: w.bottom,
        };
      });
      expect(
        g.l,
        `the focused link's left edge is in the window at ${width}px`,
      ).toBeGreaterThanOrEqual(g.wl);
      expect(
        g.r,
        `the focused link's right edge is in the window at ${width}px`,
      ).toBeLessThanOrEqual(g.wr);
      expect(
        g.t,
        `the focused link's top edge is in the window at ${width}px`,
      ).toBeGreaterThanOrEqual(g.wt);
      expect(
        g.b,
        `the focused link's bottom edge is in the window at ${width}px`,
      ).toBeLessThanOrEqual(g.wb);
    }
  });

  // P1-87 PR 5b review r3 A and r4 C: a key press after a mouse press on a link must not still the
  // row under the pointer. Keys that do not scroll the page keep the page still, so the test reads
  // the link under the pointer's own x and y.
  it("a key press after a mouse press on a link leaves the row moving and the link under the pointer, at 1280px and 390px", async () => {
    for (const width of [1280, 390]) {
      const page = await nextRun();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page);
      const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a");
      const href = await link.getAttribute("href");
      expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
      await page.locator(".ov-ticker-window").hover();
      await settledPaused(page);
      // The point is on the link and inside the window and the screen: a long name is wider
      // than a 390px screen, so its centre can lie off the page.
      const box = (await link.boundingBox())!;
      await page.locator(".ov-ticker-window").scrollIntoViewIfNeeded();
      const win = (await page.locator(".ov-ticker-window").boundingBox())!;
      const left = Math.max(box.x, win.x, 0) + 1;
      const right = Math.min(box.x + box.width, win.x + win.width, width) - 1;
      const x = (left + right) / 2;
      const y = box.y + box.height / 2;
      const windowHeight = async () =>
        (await page.locator(".ov-ticker-window").boundingBox())!.height;
      const heightBefore = await windowHeight();
      await page.mouse.move(x, y);
      // A right press focuses the link as a left press does, and opens nothing.
      await page.mouse.down({ button: "right" });
      await page.mouse.up({ button: "right" });
      expect(
        await page.evaluate(
          () => document.activeElement!.closest("a")?.getAttribute("href") ?? null,
        ),
        `the right press leaves link 1 focused at ${width}px`,
      ).toBe(href);
      for (const key of ["Escape", "Shift", "a"]) {
        const scrollBefore = await page.evaluate(() => window.scrollY);
        await page.keyboard.press(key);
        expect(
          await page.evaluate(() => window.scrollY),
          `${key} does not scroll the page at ${width}px`,
        ).toBe(scrollBefore);
        expect(await animation(page), `the row keeps moving after ${key} at ${width}px`).toBe(
          "ov-ticker",
        );
      }
      expect(
        Math.abs((await windowHeight()) - heightBefore),
        `the window keeps its height at ${width}px`,
      ).toBeLessThanOrEqual(1);
      const after = (await link.boundingBox())!;
      expect(
        Math.abs(after.x - box.x),
        `link 1 does not move sideways at ${width}px`,
      ).toBeLessThanOrEqual(1);
      expect(
        await page.evaluate(
          ([px, py]) =>
            document.elementFromPoint(px, py)?.closest("a")?.getAttribute("href") ?? null,
          [x, y] as const,
        ),
        `the link under the pointer is still link 1 at ${width}px`,
      ).toBe(href);
      // The pointer leaves the window: the focused link is in a still row, as in M1.
      await page.mouse.move(2, 2);
      await expect
        .poll(() => animation(page), {
          message: `the row stills once the pointer leaves at ${width}px`,
          timeout: 5_000,
        })
        .toBe("none");
      // Tab moves on to link 2, inside the moving list, and the row stays still.
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          return {
            tag: el.tagName.toLowerCase(),
            inMovingList: el.closest(".ov-ticker-list:not(.copy)") !== null,
          };
        }),
        `Tab moves to link 2 at ${width}px`,
      ).toEqual({ tag: "a", inMovingList: true });
      expect(await animation(page), `the row stands still with the focus in it at ${width}px`).toBe(
        "none",
      );
    }
  });

  // P1-87 PR 5b review r4 nit 2: focus that arrives with no key press on the page (a toolbar Tab,
  // a screen reader, a script) stills the row, as a keyboard focus does.
  it("a focus with no key press on the page, as a toolbar Tab or a screen reader gives, stills the row", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    expect(await animation(page), "the row moves before any focus").toBe("ov-ticker");
    // A press in the window first, then a focus with no key press: the press must not hold the
    // row moving (the old pointer flag waited for a Tab, and a toolbar Tab sends no page key).
    await page.locator(".ov-ticker-window").scrollIntoViewIfNeeded();
    const win = (await page.locator(".ov-ticker-window").boundingBox())!;
    await page.mouse.click(win.x + win.width / 2, win.y + 2);
    await page.evaluate(() =>
      (
        document.querySelector(".ov-ticker-list:not(.copy) > li:nth-child(2) a") as HTMLElement
      ).focus(),
    );
    await expect
      .poll(() => animation(page), {
        message: "the row stands still after a focus with no key press",
      })
      .toBe("none");
    const inWindow = await page.evaluate(() => {
      const a = document.activeElement!.getBoundingClientRect();
      const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
      return a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
    });
    expect(inWindow, "the focused link is inside the window").toBe(true);
  });

  // P1-87 PR 5b review r4 M1, the other side: a mouse focus with no key press is no keyboard focus,
  // so the row keeps moving once the pointer leaves. Chromium shows no focus ring for it, and the
  // still layout waits for a ring (the re-check reads :focus-visible, not :focus).
  it("a right press on link 1 with no key press keeps the row moving once the pointer leaves, with no ring", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a");
    await page.locator(".ov-ticker-window").hover();
    await settledPaused(page);
    const box = (await link.boundingBox())!;
    const win = (await page.locator(".ov-ticker-window").boundingBox())!;
    const left = Math.max(box.x, win.x, 0) + 1;
    const right = Math.min(box.x + box.width, win.x + win.width, 1280) - 1;
    await page.mouse.move((left + right) / 2, box.y + box.height / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    expect(
      await page.evaluate(() => document.activeElement!.tagName.toLowerCase()),
      "the right press focuses link 1",
    ).toBe("a");
    expect(
      await page.evaluate(() => document.activeElement!.matches(":focus-visible")),
      "a mouse focus shows no focus ring",
    ).toBe(false);
    await page.mouse.move(2, 2);
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    expect(
      await animation(page),
      "the row keeps moving: a mouse focus with no ring does not still it",
    ).toBe("ov-ticker");
  });

  // P1-87 PR 5b review r4 A: a press on the pause button, then a Tab into the ticker, stills the row.
  it("a press on the pause button, then a Tab into the ticker, stills the row", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    await page.locator(".ov-ticker-pause").click();
    expect(await page.locator(".ov-ticker-pause").getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => document.activeElement!.closest(".ov-ticker-list:not(.copy)") !== null,
      ),
      "Tab from the pause button lands in the moving list",
    ).toBe(true);
    await expect
      .poll(() => animation(page), { message: "the row stands still once the focus is in it" })
      .toBe("none");
  });

  // P1-87 PR 5b review r4 major 2: a press in the window, a click below it, and a Shift+Tab back in
  // stills the row on the last link. Pressing in the window must not leave the row in a press state.
  it("a press in the window's padding, a click below it, then Shift+Tab back in stills the row on a link inside the window", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    await page.locator(".ov-ticker-window").scrollIntoViewIfNeeded();
    const win = (await page.locator(".ov-ticker-window").boundingBox())!;
    await page.mouse.move(win.x + win.width / 2, win.y + 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.locator("#ov-leads").click();
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return (
          el.tagName.toLowerCase() === "a" && el.closest(".ov-ticker-list:not(.copy)") !== null
        );
      }),
      "Shift+Tab lands on a link in the moving list",
    ).toBe(true);
    await expect
      .poll(() => animation(page), { message: "the row stands still on the focused link" })
      .toBe("none");
    const inWindow = await page.evaluate(() => {
      const a = document.activeElement!.getBoundingClientRect();
      const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
      return a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
    });
    expect(inWindow, "the focused link is inside the window").toBe(true);
  });

  // P1-87 PR 5b review r4 leaving: focus that leaves the window restarts the row.
  it("Shift+Tab from link 1 back to the pause button restarts the row", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    await page.locator(".ov-ticker-pause").focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => animation(page)).toBe("none");
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement!.className)).toContain(
      "ov-ticker-pause",
    );
    await expect
      .poll(() => animation(page), { message: "the row moves again once focus leaves the window" })
      .toBe("ov-ticker");
  });

  // P1-87 PR 5b review r4 no-script: with no script at all, the CSS fallback still stills the row.
  it("with no script, a Tab to a ticker link still stands the row still", async () => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      extraHTTPHeaders: {
        authorization: `Basic ${Buffer.from(`op:${PASSWORD}`).toString("base64")}`,
      },
    });
    contexts.push(context);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
    expect(await animation(page), "the row moves before any focus").toBe("ov-ticker");
    for (let i = 0; i < 40; i++) {
      const onLink = await page.evaluate(
        () => document.activeElement!.closest(".ov-ticker-list:not(.copy)") !== null,
      );
      if (onLink) break;
      await page.keyboard.press("Tab");
    }
    expect(
      await page.evaluate(
        () => document.activeElement!.closest(".ov-ticker-list:not(.copy)") !== null,
      ),
      "Tab reaches a link in the moving list without script",
    ).toBe(true);
    expect(await animation(page), "the row stands still with no script").toBe("none");
    expect(await page.locator(".ov-ticker-window").getAttribute("data-js")).toBeNull();
    const inWindow = await page.evaluate(() => {
      const a = document.activeElement!.getBoundingClientRect();
      const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
      return a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
    });
    expect(inWindow, "the focused link is inside the window with no script").toBe(true);
  });

  // P1-87 PR 5b review r5 A: a touch tap's focus arrives after its pointerup, so the tap is a press:
  // the still layout must not take the link out from under the tap.
  it("a touch tap on link 2 or 3 opens that link, at 1280px and 390px", async () => {
    const cases = [
      { width: 1280, touch: false, n: 2 },
      { width: 1280, touch: false, n: 3 },
      { width: 390, touch: true, n: 2 },
    ];
    for (const { width, touch, n } of cases) {
      const page = await nextRun("op", { hasTouch: true, isMobile: touch });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page, 3);
      const link = page.locator(`.ov-ticker-list:not(.copy) > li:nth-child(${n}) a`);
      const href = await link.getAttribute("href");
      expect(href, `link ${n} is a link at ${width}px`).toBeTruthy();
      // The window and the link must be on the screen and the link wholly inside the window before the
      // tap: the row moves past the link, and a tap off the screen tests nothing.
      await page.locator(".ov-ticker-window").scrollIntoViewIfNeeded();
      const point = () =>
        page.evaluate((n) => {
          const a = document
            .querySelector(`.ov-ticker-list:not(.copy) > li:nth-child(${n}) a`)!
            .getBoundingClientRect();
          const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
          const inWindow =
            a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
          const onScreen =
            a.left >= 0 && a.right <= innerWidth && a.top >= 0 && a.bottom <= innerHeight;
          return {
            inside: inWindow && onScreen,
            x: (a.left + a.right) / 2,
            y: (a.top + a.bottom) / 2,
          };
        }, n);
      await expect
        .poll(async () => (await point()).inside, {
          message: `link ${n} comes into the window on screen at ${width}px`,
          timeout: 15_000,
        })
        .toBe(true);
      const p = await point();
      await page.touchscreen.tap(p.x, p.y);
      await expect
        .poll(() => page.url().endsWith(href!), {
          message: `the tap opens link ${n} (${href}) at ${width}px`,
        })
        .toBe(true);
    }
  });

  // P1-87 PR 5b review r5 correctness major 1: a focus made before the script loads (a Tab through
  // the server-rendered page) gets the still layout once the script runs.
  it("a focus made before the script loads stands the row still once the script runs", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    await page.route("**/_app/**/*.js", async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`${origin}/`, { waitUntil: "commit" });
    await page.waitForSelector(".ov-ticker-pause");
    await page.locator(".ov-ticker-pause").focus();
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => document.activeElement!.closest(".ov-ticker-list:not(.copy)") !== null,
      ),
      "Tab lands on link 1 before the script runs",
    ).toBe(true);
    release();
    await expect
      .poll(() => page.locator(".ov-ticker-window").getAttribute("data-js"), {
        message: "the script sets data-js",
      })
      .not.toBeNull();
    await expect
      .poll(() => page.locator(".ov-ticker-window").getAttribute("data-still"), {
        message: "the script stills the row for the focus made before it ran",
      })
      .not.toBeNull();
    await expect
      .poll(() => animation(page), { message: "the row stands still on link 1" })
      .toBe("none");
    const inWindow = await page.evaluate(() => {
      const a = document.activeElement!.getBoundingClientRect();
      const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
      return a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
    });
    expect(inWindow, "link 1 is inside the window").toBe(true);
  });

  // P1-87 PR 5b review r5 accessibility major 2 and minor: a press with no release cannot hold the
  // row. A window blur and a context menu each clear the press.
  it("a left press with no release is cleared by the window's blur, and a right press by its context menu", async () => {
    for (const button of ["left", "right"] as const) {
      const page = await nextRun();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page);
      await page.locator(".ov-ticker-window").scrollIntoViewIfNeeded();
      const win = (await page.locator(".ov-ticker-window").boundingBox())!;
      await page.evaluate(() => {
        (window as unknown as { __ctx: number }).__ctx = 0;
        document.addEventListener("contextmenu", () => {
          (window as unknown as { __ctx: number }).__ctx++;
        });
      });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: win.x + win.width / 2,
        y: win.y + 2,
        button,
        buttons: button === "left" ? 1 : 2,
        clickCount: 1,
      });
      if (button === "left") {
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      } else {
        // Log whether Chromium sends a real context menu for this press (it may not on Linux).
        const fired = await page.evaluate(() => (window as unknown as { __ctx: number }).__ctx);
        console.log(`right press with no release: native contextmenu events = ${fired}`);
        if (fired === 0) {
          await page.evaluate(() =>
            document
              .querySelector(".ov-ticker-window")!
              .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
          );
        }
      }
      await page.mouse.move(2, 2);
      await page.locator(".ov-ticker-pause").focus();
      await page.keyboard.press("Tab");
      await expect
        .poll(() => animation(page), {
          message: `after a ${button} press with no release, a Tab in stills the row`,
        })
        .toBe("none");
    }
  });

  // P1-87 PR 5b review r5 correctness major 3: a press on non-link text in the still list keeps the
  // layout until the release, and the row moves once the focus has gone to the body.
  it("a press on non-link text in the still list keeps the row still until the release, then the row moves", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    await page.locator(".ov-ticker-pause").focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => animation(page)).toBe("none");
    const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(2) a");
    const fact = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(2) .ov-ticker-fact");
    const before = (await link.boundingBox())!;
    const factBox = (await fact.boundingBox())!;
    await page.mouse.move(factBox.x + factBox.width / 2, factBox.y + factBox.height / 2);
    await page.mouse.down();
    const during = (await link.boundingBox())!;
    expect(
      Math.abs(during.x - before.x),
      "link 2 does not move under a press on the text beside it",
    ).toBeLessThanOrEqual(1);
    expect(
      await page.locator(".ov-ticker-window").getAttribute("data-still"),
      "the still layout holds during the press",
    ).not.toBeNull();
    await page.mouse.up();
    await expect
      .poll(() => page.locator(".ov-ticker-window").getAttribute("data-still"), {
        message: "after the release the focus is on the body, so the row moves again",
      })
      .toBeNull();
  });

  // P1-87 PR 5b review r5 tests major 1: the key re-check (onKey) is what stills a link focused by a
  // mouse press once a key is pressed; the other rules cannot do it.
  it("a key press after a right press on link 1 and the pointer leaving stills the row, and the precondition holds first", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a");
    const href = await link.getAttribute("href");
    await page.locator(".ov-ticker-window").hover();
    await settledPaused(page);
    const box = (await link.boundingBox())!;
    const win = (await page.locator(".ov-ticker-window").boundingBox())!;
    const left = Math.max(box.x, win.x, 0) + 1;
    const right = Math.min(box.x + box.width, win.x + win.width, 1280) - 1;
    await page.mouse.move((left + right) / 2, box.y + box.height / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await page.mouse.move(2, 2);
    // The precondition: the row moves, link 1 holds the focus, and the focus shows no ring.
    await expect
      .poll(() => animation(page), { message: "the precondition: the row moves" })
      .toBe("ov-ticker");
    expect(
      await page.evaluate(() => document.activeElement!.closest("a")?.getAttribute("href") ?? null),
      "the precondition: link 1 holds the focus",
    ).toBe(href);
    expect(
      await page.evaluate(() => document.activeElement!.matches(":focus-visible")),
      "the precondition: no focus ring",
    ).toBe(false);
    await page.keyboard.press("Shift");
    await expect
      .poll(() => animation(page), {
        message: "a key press re-checks the focus and stills the row",
        timeout: 5_000,
      })
      .toBe("none");
    const inWindow = await page.evaluate(() => {
      const a = document.activeElement!.getBoundingClientRect();
      const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
      return a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
    });
    expect(inWindow, "link 1 is inside the window").toBe(true);
  });

  // P1-87 PR 5b review r5 tests major 2: focus that leaves the window to nowhere (a click on the page
  // background, which takes no focus) restarts the row.
  it("focus that leaves the window to nowhere restarts the row", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    await page.locator(".ov-ticker-pause").focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => animation(page)).toBe("none");
    await page.mouse.click(1275, 5);
    expect(
      await page.evaluate(() => document.activeElement === document.body),
      "the background click takes the focus to the body",
    ).toBe(true);
    await expect
      .poll(() => animation(page), { message: "the row moves again once focus is nowhere" })
      .toBe("ov-ticker");
    // Focus lost with no pointer at all (a script's blur): no release follows, so the focusout alone
    // must restart the row.
    await page.locator(".ov-ticker-pause").focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => animation(page)).toBe("none");
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await expect
      .poll(() => animation(page), { message: "a blur with no pointer restarts the row" })
      .toBe("ov-ticker");
  });

  // P1-87 PR 5b review r5 nit 5: a pointercancel ends a press, so the next keyboard focus stills the row.
  it("a pointercancel ends a press in the window's padding, so a Tab in stills the row", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    await page.locator(".ov-ticker-window").scrollIntoViewIfNeeded();
    const win = (await page.locator(".ov-ticker-window").boundingBox())!;
    await page.mouse.move(win.x + win.width / 2, win.y + 2);
    await page.mouse.down();
    await page.evaluate(() =>
      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerType: "mouse" }),
      ),
    );
    await page.mouse.move(2, 2);
    await page.locator(".ov-ticker-pause").focus();
    await page.keyboard.press("Tab");
    await expect
      .poll(() => animation(page), { message: "after a cancelled press, a Tab in stills the row" })
      .toBe("none");
  });

  // P1-87 PR 5b review r4 C, listeners: the ticker's listeners leave with the page, so a round trip
  // from / to a site page and back leaves the same count on /, and the site page has none of them.
  it("the ticker's listeners are removed when the page is left, and a round trip leaves the same count", async () => {
    const types = {
      doc: ["keydown", "pointerup", "pointercancel", "pointerover", "pointerdown"],
      win: [
        "focusin",
        "focusout",
        "pointerdown",
        "pointerleave",
        "pointerover",
        "pointerenter",
        "pointermove",
      ],
    } as const;
    const counts = async (page: Page) => {
      const cdp = await page.context().newCDPSession(page);
      const count = async (expression: string, want: readonly string[]) => {
        const { result } = await cdp.send("Runtime.evaluate", { expression });
        if (!result.objectId) return Object.fromEntries(want.map((t) => [t, 0]));
        const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
          objectId: result.objectId,
          depth: 0,
        });
        return Object.fromEntries(
          want.map((t) => [t, listeners.filter((l: { type: string }) => l.type === t).length]),
        );
      };
      const doc = await count("document", types.doc);
      const win = await count('document.querySelector(".ov-ticker-window")', types.win);
      await cdp.detach();
      return { doc, win };
    };
    // The site page on its own, loaded directly: the baseline the ticker must return to.
    const direct = await signedIn();
    await direct.setViewportSize({ width: 1280, height: 900 });
    await direct.goto(`${origin}/s/acme`);
    await direct.waitForLoadState("networkidle");
    const baseline = await counts(direct);
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    const first = await counts(page);
    expect(
      first.doc,
      "one of each on / after the first load; none of the old pointer types",
    ).toEqual({
      keydown: 1,
      pointerup: 1,
      pointercancel: 1,
      pointerover: 0,
      pointerdown: 0,
    });
    expect(first.win, "one of each on the ticker window after the first load").toEqual({
      focusin: 1,
      focusout: 1,
      pointerdown: 1,
      pointerleave: 1,
      pointerover: 1,
      pointerenter: 1,
      pointermove: 1,
    });
    for (let trip = 0; trip < 3; trip++) {
      // Playwright would wait for the moving row to stop before a click, so the click is
      // dispatched on the element: SvelteKit's router takes it as a visitor's click.
      await page
        .locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a")
        .evaluate((a) => (a as HTMLElement).click());
      await page.waitForURL(/\/s\//);
      const there = await counts(page);
      expect(there.doc, `the document's listeners on the site page, trip ${trip}`).toEqual(
        baseline.doc,
      );
      expect(there.win, `the site page has no ticker window, trip ${trip}`).toEqual({
        focusin: 0,
        focusout: 0,
        pointerdown: 0,
        pointerleave: 0,
        pointerover: 0,
        pointerenter: 0,
        pointermove: 0,
      });
      await page.goBack();
      await page.waitForURL(`${origin}/`);
      await tickerReady(page);
      expect(await counts(page), `the counts on / after round trip ${trip}`).toEqual(first);
    }
  });

  // P1-87 PR 5b review r6 B.1: a touch tap outside the ticker, then a Tab into it within 300 ms. The
  // tap's release held the press state for 1 s, so the focus never stood the row still once the
  // window ended, and the focused link slid out of the window.
  it("a touch tap outside the ticker, then a Tab into it within 300 ms, stands the row still with the link in the window, at 1280px and 390px", async () => {
    const inMovingList = (page: Page) =>
      page.evaluate(() => {
        const a = document.activeElement;
        return a instanceof HTMLAnchorElement && a.closest(".ov-ticker-list:not(.copy)") !== null;
      });
    const stillSet = (page: Page) =>
      page.locator(".ov-ticker-window").evaluate((el) => el.hasAttribute("data-still"));
    const inWindow = (page: Page) =>
      page.evaluate(() => {
        const a = document.activeElement!.getBoundingClientRect();
        const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
        return a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
      });
    for (const width of [1280, 390]) {
      const page = await nextRun("op", { hasTouch: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page);
      const heading = page.getByRole("heading", { name: "Every site", exact: true });
      await heading.scrollIntoViewIfNeeded();
      const h = (await heading.boundingBox())!;
      expect(h, `the heading is on screen at ${width}px`).not.toBeNull();
      await page.touchscreen.tap(h.x + h.width / 2, h.y + h.height / 2);
      const tapped = Date.now();
      // Tab until a ticker link has focus. Each press is a keyboard focus after the tap.
      for (let i = 0; i < 6 && !(await inMovingList(page)); i++) {
        await page.keyboard.press("Tab");
      }
      expect(
        Date.now() - tapped,
        `a link has focus within 300 ms of the tap at ${width}px`,
      ).toBeLessThan(300);
      expect(await inMovingList(page), `a ticker link has focus at ${width}px`).toBe(true);
      expect(
        await page.evaluate(() => document.activeElement!.matches(":focus-visible")),
        `the focused link is :focus-visible at ${width}px`,
      ).toBe(true);
      expect(await inWindow(page), `the focused link is in the window at once at ${width}px`).toBe(
        true,
      );
      // A tap outside the window is no press in the window, so it counts for nothing: the row is
      // still at once, within 300 ms of the focus, and not by a poll.
      expect(
        await stillSet(page),
        `the row stands still within 300 ms of the focus, at ${width}px`,
      ).toBe(true);
      expect(Date.now() - tapped, `the still list is up within 300 ms at ${width}px`).toBeLessThan(
        300,
      );
      await page.waitForTimeout(2_000);
      expect(await stillSet(page), `the row is still 2 s on at ${width}px`).toBe(true);
      expect(await inWindow(page), `the focused link is in the window 2 s on at ${width}px`).toBe(
        true,
      );
    }
  });

  // P1-87 PR 5b review r6 B.2: a touch press and release inside the window, then a keyboard focus on
  // a link within 200 ms. The window's end must re-check the focus, so the row stands still by 1.6 s
  // after the release, with the link in the window.
  it("a touch press and release inside the window, then a Tab to a link within 200 ms, stands the row still by 1.6 s after the release, at 1280px and 390px", async () => {
    for (const width of [1280, 390]) {
      const page = await nextRun("op", { hasTouch: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page);
      await page.locator(".ov-ticker-pause").focus();
      // The press lands on the text of the moving list (a pill or a fact, never a link), inside the window.
      // The row moves, so the spot is polled for rather than read once.
      const findFact = () =>
        page.evaluate(() => {
          const win = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
          for (const f of document.querySelectorAll(
            ".ov-ticker-list:not(.copy) .pill, .ov-ticker-list:not(.copy) .ov-ticker-fact",
          )) {
            const r = f.getBoundingClientRect();
            const x = (r.left + r.right) / 2;
            const y = (r.top + r.bottom) / 2;
            const inside =
              r.left >= win.left &&
              r.right <= win.right &&
              r.top >= win.top &&
              r.bottom <= win.bottom;
            if (inside && document.elementFromPoint(x, y) === f) return { x, y };
          }
          return null;
        });
      let target: { x: number; y: number } | null = null;
      await expect
        .poll(
          async () => {
            target = await findFact();
            return target !== null;
          },
          { message: `a fact text sits in the window at ${width}px`, timeout: 10_000 },
        )
        .toBe(true);
      await page.evaluate(() => {
        document.addEventListener(
          "pointerup",
          () => {
            (window as Window & { __rel?: number }).__rel = performance.now();
          },
          { capture: true, once: true },
        );
      });
      await page.touchscreen.tap(target!.x, target!.y);
      const released = Date.now();
      await page.keyboard.press("Tab");
      expect(
        Date.now() - released,
        `the Tab follows the release within 200 ms at ${width}px`,
      ).toBeLessThan(200);
      expect(
        await page.evaluate(() => {
          const a = document.activeElement;
          return (
            a instanceof HTMLAnchorElement &&
            a.closest(".ov-ticker-list:not(.copy)") !== null &&
            a.matches(":focus-visible")
          );
        }),
        `a ticker link has keyboard focus at ${width}px`,
      ).toBe(true);
      const probe = await page.evaluate(
        () =>
          new Promise<{ stillAt: number | null; stillBy900: boolean; startedAt: number }>(
            (done) => {
              const rel = (window as Window & { __rel?: number }).__rel!;
              const startedAt = performance.now() - rel;
              let stillBy900 = false;
              const tick = () => {
                const since = performance.now() - rel;
                const set = document.querySelector(".ov-ticker-window")!.hasAttribute("data-still");
                if (set && since < 900) stillBy900 = true;
                if (set) return done({ stillAt: since, stillBy900, startedAt });
                if (since > 5_000) return done({ stillAt: null, stillBy900, startedAt });
                requestAnimationFrame(tick);
              };
              tick();
            },
          ),
      );
      expect(
        probe.startedAt,
        `the sampling began within 900 ms of the release at ${width}px`,
      ).toBeLessThan(900);
      expect(
        probe.stillBy900,
        `the press counted: the row moves at 900 ms after the release at ${width}px`,
      ).toBe(false);
      const stillAt = probe.stillAt;
      expect(stillAt, `the row stands still within 5 s at ${width}px`).not.toBeNull();
      expect(
        stillAt!,
        `the press counted: the row stands still no earlier than 1 s after the release at ${width}px`,
      ).toBeGreaterThanOrEqual(1_000);
      expect(
        stillAt!,
        `the row stands still by 1.6 s after the release at ${width}px`,
      ).toBeLessThanOrEqual(1_600);
      expect(
        await page.evaluate(() => {
          const a = document.activeElement!.getBoundingClientRect();
          const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
          return a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
        }),
        `the focused link is in the window at ${width}px`,
      ).toBe(true);
    }
  });

  // The helpers for round 7: a touch swipe, a pen or mouse event through CDP (Playwright's page.mouse
  // cannot send a pen), the row's still state, and a sample of the row over time.
  const dataStill = (page: Page) =>
    page.locator(".ov-ticker-window").evaluate((el) => el.hasAttribute("data-still"));
  const focusedHref = (page: Page) =>
    page.evaluate(() => document.activeElement!.closest("a")?.getAttribute("href") ?? null);
  const swipe = async (page: Page, x: number, y: number) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 5; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (60 * i) / 5, y }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  };
  const pointer = (
    cdp: Awaited<ReturnType<BrowserContext["newCDPSession"]>>,
    type: "mouseMoved" | "mousePressed" | "mouseReleased",
    x: number,
    y: number,
    pointerType: "mouse" | "pen",
    button: "left" | "right" = "left",
  ) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: type === "mouseMoved" ? "none" : button,
      buttons: type === "mousePressed" ? (button === "right" ? 2 : 1) : 0,
      clickCount: type === "mouseMoved" ? 0 : 1,
      pointerType,
    });
  /** The row's still state and animation, sampled every 100 ms for `ms`. */
  const watchRow = async (page: Page, ms: number) => {
    const seen: { still: boolean; anim: string }[] = [];
    for (let t = 0; t < ms; t += 100) {
      seen.push(
        await page.evaluate(() => ({
          still: document.querySelector(".ov-ticker-window")!.hasAttribute("data-still"),
          anim: getComputedStyle(document.querySelector(".ov-ticker-run")!).animationName,
        })),
      );
      await page.waitForTimeout(100);
    }
    return seen;
  };
  /** A point inside the window on an element matching `selector` that is the element at that point. */
  const pointOn = (page: Page, selector: string) =>
    page.evaluate((sel) => {
      const win = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
      for (const f of document.querySelectorAll(sel)) {
        const r = f.getBoundingClientRect();
        const x = (r.left + r.right) / 2;
        const y = (r.top + r.bottom) / 2;
        const inside = x >= win.left && x <= win.right && y >= win.top && y <= win.bottom;
        if (inside && document.elementFromPoint(x, y) === f) return { x, y };
      }
      return null;
    }, selector);
  const headingPoint = async (page: Page) => {
    const heading = page.getByRole("heading", { name: "Every site", exact: true });
    await heading.scrollIntoViewIfNeeded();
    const h = (await heading.boundingBox())!;
    return { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  };

  // P1-87 PR 5b review r7 B.1 (route 1 of the A.4 major): a mouse resting over link 1 keeps the row
  // moving after a touch that moves no focus. The swipe goes on the heading, then on the window's
  // own bottom edge (a touch over the window, which must not clear the mouse's presence).
  it("a mouse resting on link 1 after a right press and Escape keeps the row moving through a touch swipe and a Shift, on the heading or the window's edge, at 1280px and 390px", async () => {
    for (const width of [1280, 390]) {
      for (const on of ["heading", "edge"] as const) {
        const page = await nextRun("op", { hasTouch: true });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${origin}/`);
        await tickerReady(page);
        const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a");
        const href = await link.getAttribute("href");
        expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
        await page.locator(".ov-ticker-window").hover();
        await settledPaused(page);
        const box = (await link.boundingBox())!;
        const win = (await page.locator(".ov-ticker-window").boundingBox())!;
        const left = Math.max(box.x, win.x, 0) + 1;
        const right = Math.min(box.x + box.width, win.x + win.width, width) - 1;
        const mx = (left + right) / 2;
        const my = box.y + box.height / 2;
        await page.mouse.move(mx, my);
        await page.mouse.down({ button: "right" });
        await page.mouse.up({ button: "right" });
        await page.keyboard.press("Escape");
        // Precondition: link 1 holds a visible keyboard focus, the mouse is over the window, and the
        // row is not still.
        expect(await focusedHref(page), `link 1 holds the focus at ${width}px`).toBe(href);
        expect(
          await page.evaluate(() => document.activeElement!.matches(":focus-visible")),
          `the focused link is :focus-visible at ${width}px`,
        ).toBe(true);
        expect(
          await page.evaluate(
            ([x, y]) => document.elementFromPoint(x, y)?.closest(".ov-ticker-window") !== null,
            [mx, my] as const,
          ),
          `the pointer is over the window at ${width}px`,
        ).toBe(true);
        expect(await dataStill(page), `the row is not still before the swipe at ${width}px`).toBe(
          false,
        );
        const start =
          on === "heading"
            ? await headingPoint(page)
            : { x: win.x + win.width / 2 - 30, y: win.y + win.height - 4 };
        await swipe(page, start.x, start.y);
        await page.keyboard.press("Shift");
        const seen = await watchRow(page, 1600);
        expect(
          seen.some((s) => s.still),
          `the row never stands still after a swipe on the ${on} at ${width}px`,
        ).toBe(false);
        expect(
          seen.every((s) => s.anim === "ov-ticker"),
          `the row keeps its moving layout after a swipe on the ${on} at ${width}px`,
        ).toBe(true);
      }
    }
  });

  // P1-87 PR 5b review r7 B.2 (route 2): a mouse rests on a fact in the row, a touch taps a pill in the
  // row, the mouse moves 1 px, and a Tab follows within 1 s. The row must not stand still under the mouse.
  it("a mouse resting on a fact, a touch tap on a pill, a 1 px mouse move and a Tab within 1 s leave the row moving until 1.6 s after the tap, at 1280px", async () => {
    const page = await signedIn("op", { hasTouch: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await tickerReady(page);
    // The window sits below the fold at 900px: scroll it in, so its points are on screen.
    await page.locator(".ov-ticker-window").scrollIntoViewIfNeeded();
    let rest: { x: number; y: number } | null = null;
    await expect
      .poll(
        async () => {
          rest = await pointOn(page, ".ov-ticker-list:not(.copy) .ov-ticker-fact");
          return rest !== null;
        },
        { message: "a fact sits in the window at 1280px", timeout: 10_000 },
      )
      .toBe(true);
    await page.mouse.move(rest!.x, rest!.y);
    await settledPaused(page);
    let pill: { x: number; y: number } | null = null;
    await expect
      .poll(
        async () => {
          pill = await pointOn(page, ".ov-ticker-list:not(.copy) .pill");
          return pill !== null;
        },
        { message: "a pill sits in the window at 1280px", timeout: 10_000 },
      )
      .toBe(true);
    await page.evaluate(
      ([x, y]) => {
        (window as Window & { __rest?: Element | null }).__rest = document.elementFromPoint(x, y);
      },
      [rest!.x, rest!.y] as const,
    );
    await page.touchscreen.tap(pill!.x, pill!.y);
    const tapped = Date.now();
    // The 1 px move stays on the fact the mouse rests on: the row is paused under the window's hover.
    await page.mouse.move(rest!.x + 1, rest!.y);
    expect(
      await page.evaluate(
        ([x, y]) =>
          document.elementFromPoint(x, y) ===
          (window as Window & { __rest?: Element | null }).__rest,
        [rest!.x + 1, rest!.y] as const,
      ),
      "the 1 px move stays on the fact the mouse rested on",
    ).toBe(true);
    await page.keyboard.press("Tab");
    expect(Date.now() - tapped, "the Tab follows the tap within 1 s").toBeLessThan(1_000);
    expect(
      await page.evaluate(() => {
        const a = document.activeElement;
        return (
          a instanceof HTMLAnchorElement &&
          a.closest(".ov-ticker-list:not(.copy)") !== null &&
          a.matches(":focus-visible")
        );
      }),
      "a ticker link has keyboard focus",
    ).toBe(true);
    const seen = await watchRow(page, Math.max(100, 1_600 - (Date.now() - tapped)));
    expect(
      seen.some((s) => s.still),
      "the row never stands still under the resting mouse, 1.6 s after the tap",
    ).toBe(false);
    expect(
      seen.every((s) => s.anim === "ov-ticker"),
      "the row keeps its moving layout under the resting mouse",
    ).toBe(true);
  });

  // P1-87 PR 5b review r7 B.3: a pen is a pointer, as a mouse is. A pen tap outside the row stands the
  // row still once the press window ends, as a touch does; a pen resting on link 1 keeps the row moving
  // after a Shift. Playwright's page.mouse sends no pen, so these go through CDP.
  it("a pen tap outside the ticker, then a Tab into it within 300 ms, stands the row still with the link in the window, at 1280px and 390px", async () => {
    for (const width of [1280, 390]) {
      const page = await nextRun();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page);
      await page.evaluate(() => {
        (window as Window & { __pen?: string[] }).__pen = [];
        document.addEventListener(
          "pointerup",
          (e) => (window as Window & { __pen?: string[] }).__pen!.push(e.pointerType),
          { capture: true },
        );
      });
      const cdp = await page.context().newCDPSession(page);
      const h = await headingPoint(page);
      await pointer(cdp, "mousePressed", h.x, h.y, "pen");
      await pointer(cdp, "mouseReleased", h.x, h.y, "pen");
      const tapped = Date.now();
      expect(
        await page.evaluate(() => (window as Window & { __pen?: string[] }).__pen),
        `the tap arrived as a pen at ${width}px`,
      ).toEqual(["pen"]);
      for (
        let i = 0;
        i < 6 &&
        !(await page.evaluate(() => {
          const a = document.activeElement;
          return a instanceof HTMLAnchorElement && a.closest(".ov-ticker-list:not(.copy)") !== null;
        }));
        i++
      ) {
        await page.keyboard.press("Tab");
      }
      expect(
        Date.now() - tapped,
        `a link has focus within 300 ms of the tap at ${width}px`,
      ).toBeLessThan(300);
      expect(
        await page.evaluate(() => {
          const a = document.activeElement!;
          return (
            a instanceof HTMLAnchorElement &&
            a.closest(".ov-ticker-list:not(.copy)") !== null &&
            a.matches(":focus-visible")
          );
        }),
        `a ticker link has visible focus at ${width}px`,
      ).toBe(true);
      // A pen tap outside the window counts for nothing, as a touch's does: the row is still at once.
      expect(
        await dataStill(page),
        `the row stands still within 300 ms of the focus at ${width}px`,
      ).toBe(true);
      await page.waitForTimeout(2_000);
      expect(await dataStill(page), `the row is still 2 s on at ${width}px`).toBe(true);
      expect(
        await page.evaluate(() => {
          const a = document.activeElement!.getBoundingClientRect();
          const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
          return a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
        }),
        `the focused link is in the window at ${width}px`,
      ).toBe(true);
    }
  });

  it("a pen resting on link 1, a right press on it, Escape, then a Shift keeps the row moving under the pen, at 1280px and 390px", async () => {
    for (const width of [1280, 390]) {
      const page = await nextRun();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page);
      const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a");
      const href = await link.getAttribute("href");
      expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
      const cdp = await page.context().newCDPSession(page);
      // P1-87 PR 5b review r8 B.3: the pen alone takes the window. A CDP pen move also sends Chromium's
      // compatibility mouse events to the window (measured on e13f628c), which would hide a mouse-only
      // flag, so the hover is a synthetic pen pointerover, pointerenter and pointermove.
      // The pointerType log is installed before the scroll, so a mouse event the scroll's own synthetic
      // move delivers to the window is caught by the precondition below instead of going unseen.
      await page.evaluate(() => {
        const seen: string[] = [];
        (window as Window & { __types?: string[] }).__types = seen;
        const w = document.querySelector(".ov-ticker-window")!;
        for (const t of ["pointerover", "pointerenter", "pointermove", "pointerdown", "pointerup"])
          w.addEventListener(t, (e) => seen.push((e as PointerEvent).pointerType));
      });
      await page.locator(".ov-ticker-window").scrollIntoViewIfNeeded();
      const hover = (await page.locator(".ov-ticker-window").boundingBox())!;
      await page.evaluate(
        ([hx, hy]) => {
          const w = document.querySelector(".ov-ticker-window")!;
          for (const t of ["pointerover", "pointerenter", "pointermove"])
            w.dispatchEvent(
              new PointerEvent(t, {
                pointerType: "pen",
                pointerId: 3,
                isPrimary: true,
                clientX: hx,
                clientY: hy,
                bubbles: true,
              }),
            );
        },
        [hover.x + hover.width / 2, hover.y + hover.height / 2] as const,
      );
      const types = await page.evaluate(() => (window as Window & { __types?: string[] }).__types!);
      expect(types, `the pen hover reached the window, and only the pen, at ${width}px`).toEqual([
        "pen",
        "pen",
        "pen",
      ]);
      const box = (await link.boundingBox())!;
      const win = (await page.locator(".ov-ticker-window").boundingBox())!;
      const left = Math.max(box.x, win.x, 0) + 1;
      const right = Math.min(box.x + box.width, win.x + win.width, width) - 1;
      const x = (left + right) / 2;
      const y = box.y + box.height / 2;
      await pointer(cdp, "mousePressed", x, y, "pen", "right");
      await pointer(cdp, "mouseReleased", x, y, "pen", "right");
      expect(
        await focusedHref(page),
        `the pen's right press leaves link 1 focused at ${width}px`,
      ).toBe(href);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Shift");
      const seen = await watchRow(page, 1600);
      expect(
        seen.some((s) => s.still),
        `the row keeps moving under the pen after a key press at ${width}px`,
      ).toBe(false);
      expect(
        await page.evaluate(
          ([px, py]) => document.elementFromPoint(px, py)?.closest(".ov-ticker-window") !== null,
          [x, y] as const,
        ),
        `the pen is still over the window at ${width}px`,
      ).toBe(true);
    }
  });

  // P1-87 PR 5b review r8 B.1 (the drag, round 8's major): a press on link 1 that drags it. Chromium
  // starts the link drag with dragstart, then pointercancel and a mouse pointerleave on the window
  // while the pointer is still over it, then dragend at the drop (the logged order on e13f628c:
  // dragstart, pointercancel, pointerleave, dragend; the next pointerover comes about 400 ms later).
  // The row must not stand still under the resting mouse. The control 8fc54f17 fails 8 of 10 at
  // 1280px and 5 of 10 at 390px, so five runs at each width are red there almost every time.
  const dragLink1 = async (page: Page, width: number, end: "inside" | "outside") => {
    await page.evaluate(() => {
      const log: string[] = ((window as Window & { __drag?: string[] }).__drag = []);
      document
        .querySelector(".ov-ticker-window")!
        .addEventListener("dragstart", () => log.push("dragstart"));
    });
    const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a");
    await page.locator(".ov-ticker-window").hover();
    await settledPaused(page);
    const box = (await link.boundingBox())!;
    const win = (await page.locator(".ov-ticker-window").boundingBox())!;
    const left = Math.max(box.x, win.x, 0) + 1;
    const right = Math.min(box.x + box.width, win.x + win.width, width) - 1;
    const x = (left + right) / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) await page.mouse.move(x + 3 * i, y);
    let dropY = y;
    if (end === "outside") {
      // The window is overflow: hidden and its hit area ends at its box, so a point 0.5 px below it is
      // already outside at every width. The drop point is the first point below the box that
      // elementFromPoint reports outside the window.
      dropY = await page.evaluate((bottom) => {
        for (let yy = bottom + 2; yy < bottom + 300; yy += 2) {
          const e = document.elementFromPoint(window.innerWidth / 2, yy);
          if (!e || e.closest(".ov-ticker-window") === null) return yy;
        }
        return -1;
      }, win.y + win.height);
      expect(dropY, "a point below the window is outside it").toBeGreaterThan(0);
      for (let i = 1; i <= 10; i++) await page.mouse.move(x + 12, y + ((dropY - y) * i) / 10);
    }
    await page.mouse.up();
    return { x: x + 12, y: dropY };
  };
  const dragStarted = (page: Page) =>
    page.evaluate(() =>
      ((window as Window & { __drag?: string[] }).__drag ?? []).includes("dragstart"),
    );

  it("a press on link 1 that drags it, then a rest and a Shift, keeps the row moving under the resting mouse, at 1280px and 390px", async () => {
    for (const width of [1280, 390]) {
      for (let run = 1; run <= 5; run++) {
        const page = await nextRun();
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${origin}/`);
        await tickerReady(page);
        const href = await page
          .locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a")
          .getAttribute("href");
        expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
        const drop = await dragLink1(page, width, "inside");
        expect(
          await dragStarted(page),
          `a drag started on the window at ${width}px, run ${run}`,
        ).toBe(true);
        expect(
          await focusedHref(page),
          `link 1 holds the focus after the drag at ${width}px, run ${run}`,
        ).toBe(href);
        expect(
          await page.evaluate(
            ([px, py]) => document.elementFromPoint(px, py)?.closest(".ov-ticker-window") != null,
            [drop.x, drop.y] as const,
          ),
          `the mouse is over the window after the drag at ${width}px, run ${run}`,
        ).toBe(true);
        await page.waitForTimeout(400);
        await page.keyboard.press("Shift");
        expect(
          await page.evaluate(() => document.activeElement!.matches(":focus-visible")),
          `link 1 is :focus-visible after the Shift at ${width}px, run ${run}`,
        ).toBe(true);
        const seen = await watchRow(page, 1600);
        expect(
          seen.some((s) => s.still),
          `the row keeps moving under the resting mouse after a drag at ${width}px, run ${run}`,
        ).toBe(false);
      }
    }
  });

  it("a press on link 1 dragged out of the window and released there, then a Shift at once, stands the row still with link 1 in the window, at 1280px and 390px", async () => {
    for (const width of [1280, 390]) {
      const page = await nextRun();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page);
      const href = await page
        .locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a")
        .getAttribute("href");
      expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
      const drop = await dragLink1(page, width, "outside");
      expect(await dragStarted(page), `a drag started on the window at ${width}px`).toBe(true);
      expect(
        await page.evaluate(
          ([px, py]) => document.elementFromPoint(px, py)?.closest(".ov-ticker-window") === null,
          [drop.x, drop.y] as const,
        ),
        `the drop is outside the window at ${width}px`,
      ).toBe(true);
      expect(await focusedHref(page), `link 1 holds the focus at ${width}px`).toBe(href);
      // A real user moves the pointer once more, a few px and still outside, then presses a key. The
      // late pointerover from the window (Chromium's stale hover) arrives 16 to 51 ms after the row
      // goes still, because the still layout grows the window under the pointer. That event comes
      // after the stilling, so it is not a race with the key. With the fix, the move outside settles
      // the flag false through the document listener.
      await page.mouse.move(drop.x + 3, drop.y);
      expect(
        await page.evaluate(
          ([px, py]) => document.elementFromPoint(px, py)?.closest(".ov-ticker-window") === null,
          [drop.x + 3, drop.y] as const,
        ),
        `the pointer is still outside the window after its move at ${width}px`,
      ).toBe(true);
      await page.keyboard.press("Shift");
      await expect
        .poll(() => dataStill(page), {
          message: `the row stands still within 300 ms of the Shift after a drag out of the window at ${width}px`,
          timeout: 300,
        })
        .toBe(true);
      expect(
        await page.evaluate(() => {
          const a = document.activeElement!.getBoundingClientRect();
          const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
          return a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
        }),
        `link 1 is in the window once the row is still at ${width}px`,
      ).toBe(true);
    }
  });

  // P1-87 PR 5b review r9 B.1 (round 9's major): a drag that is dropped inside the window, then the
  // mouse leaves it. Chromium sends the window no pointerleave for that first move out (the flag set
  // by the drag would stay true), so the next pointer event on the page must settle the flag. Two
  // variants: (a) the drop on link 1's middle, then one move 20 px below the window; (b) the drop 1 px
  // inside the window's bottom edge, then 3 px steps down until the pointer is outside. Each runs five
  // times at each width, so the page at 5c8b5dab fails 26 of 30 runs.
  const dragInsideThenLeave = async (
    page: Page,
    width: number,
    variant: "one-move" | "bottom-edge",
  ) => {
    await page.evaluate(() => {
      const log: string[] = ((window as Window & { __drag?: string[] }).__drag = []);
      document
        .querySelector(".ov-ticker-window")!
        .addEventListener("dragstart", () => log.push("dragstart"));
    });
    const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a");
    await page.locator(".ov-ticker-window").hover();
    await settledPaused(page);
    const box = (await link.boundingBox())!;
    const win = (await page.locator(".ov-ticker-window").boundingBox())!;
    const left = Math.max(box.x, win.x, 0) + 1;
    const right = Math.min(box.x + box.width, win.x + win.width, width) - 1;
    const x = (left + right) / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) await page.mouse.move(x + 3 * i, y);
    const dropX = x + 12;
    const bottom = win.y + win.height;
    const inside = (px: number, py: number) =>
      page.evaluate(
        ([qx, qy]) => document.elementFromPoint(qx, qy)?.closest(".ov-ticker-window") != null,
        [px, py] as const,
      );
    let dropY: number;
    if (variant === "one-move") {
      await page.mouse.up();
      expect(await inside(dropX, y), `the drop is inside the window at ${width}px`).toBe(true);
      dropY = bottom + 20;
      await page.mouse.move(dropX, dropY);
    } else {
      dropY = bottom - 1;
      await page.mouse.move(dropX, dropY);
      await page.mouse.up();
      expect(await inside(dropX, dropY), `the drop is inside the window at ${width}px`).toBe(true);
      while (await inside(dropX, dropY)) {
        dropY += 3;
        await page.mouse.move(dropX, dropY);
        expect(dropY, `the pointer leaves the window at ${width}px`).toBeLessThan(bottom + 300);
      }
    }
    expect(await dragStarted(page), `a drag started on the window at ${width}px`).toBe(true);
    expect(
      await inside(dropX, dropY),
      `the pointer is outside the window after its move at ${width}px`,
    ).toBe(false);
  };

  it("a drag dropped inside the window, then the mouse moved out, then a Shift at once, stands the row still with link 1 in the window, at 1280px, 768px and 390px", async () => {
    for (const width of [1280, 768, 390]) {
      for (const variant of ["one-move", "bottom-edge"] as const) {
        for (let run = 1; run <= 5; run++) {
          const page = await nextRun();
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${origin}/`);
          await tickerReady(page);
          const href = await page
            .locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a")
            .getAttribute("href");
          expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
          await dragInsideThenLeave(page, width, variant);
          await page.waitForTimeout(100);
          await page.keyboard.press("Shift");
          await expect
            .poll(() => dataStill(page), {
              message: `the row stands still within 1.6 s of the Shift (${variant}, ${width}px, run ${run})`,
              timeout: 1_600,
            })
            .toBe(true);
          expect(
            await focusedHref(page),
            `link 1 holds the focus (${variant}, ${width}px, run ${run})`,
          ).toBe(href);
          expect(
            await page.evaluate(() => {
              const a = document.activeElement!.getBoundingClientRect();
              const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
              return (
                a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom
              );
            }),
            `link 1 is in the window once the row is still (${variant}, ${width}px, run ${run})`,
          ).toBe(true);
        }
      }
    }
  });

  // P1-87 PR 5b review r10 B.1 (round 10's major): the window sits at the viewport's bottom (the page
  // scrolled so its bottom edge is at the viewport's bottom). A drag is dropped 1 px inside that edge,
  // then the mouse leaves the page: (a) one 3 px step down, or (b) one jump to 30 px below the viewport.
  // Chromium sends no pointer event for that move (its boundary tracking was reset at dragstart), so
  // only a document mouseout with no related target can settle the flag. Five runs per variant at each
  // width, so the page at 974df34a fails them.
  const dragToBottomEdgeAndLeave = async (
    page: Page,
    width: number,
    variant: "step-off" | "jump-off",
  ) => {
    await page.evaluate(() => {
      const log: string[] = ((window as Window & { __drag?: string[] }).__drag = []);
      document
        .querySelector(".ov-ticker-window")!
        .addEventListener("dragstart", () => log.push("dragstart"));
      const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
      window.scrollBy(0, w.bottom - window.innerHeight + 1);
    });
    await page.waitForTimeout(100);
    const scrolled = (await page.locator(".ov-ticker-window").boundingBox())!;
    expect(
      scrolled.y + scrolled.height,
      `the window's bottom is at the viewport's bottom at ${width}px`,
    ).toBeGreaterThan(898);
    const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a");
    await page.locator(".ov-ticker-window").hover();
    await settledPaused(page);
    const box = (await link.boundingBox())!;
    const win = (await page.locator(".ov-ticker-window").boundingBox())!;
    const left = Math.max(box.x, win.x, 0) + 1;
    const right = Math.min(box.x + box.width, win.x + win.width, width) - 1;
    const x = (left + right) / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) await page.mouse.move(x + 3 * i, y);
    const dropX = x + 12;
    const bottom = win.y + win.height;
    let dy = y;
    while (dy < bottom - 1) {
      dy = Math.min(bottom - 1, dy + 3);
      await page.mouse.move(dropX, dy);
    }
    await page.mouse.up();
    const inside = (px: number, py: number) =>
      page.evaluate(
        ([qx, qy]) => document.elementFromPoint(qx, qy)?.closest(".ov-ticker-window") != null,
        [px, py] as const,
      );
    expect(await dragStarted(page), `a drag started on the window at ${width}px`).toBe(true);
    expect(await inside(dropX, bottom - 1), `the drop is inside the window at ${width}px`).toBe(
      true,
    );
    const leaveY = variant === "step-off" ? bottom - 1 + 3 : 900 + 30;
    await page.mouse.move(dropX, leaveY);
    expect(
      await inside(dropX, leaveY),
      `the pointer is off the window after its move at ${width}px (${variant})`,
    ).toBe(false);
  };

  it("a drag dropped 1 px inside the window's bottom edge, with the window at the viewport's bottom, then the mouse off the page and a Shift, stands the row still with link 1 in the window, at 1280px, 768px and 390px", async () => {
    for (const width of [1280, 768, 390]) {
      for (const variant of ["step-off", "jump-off"] as const) {
        for (let run = 1; run <= 5; run++) {
          const page = await nextRun();
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${origin}/`);
          await tickerReady(page);
          const href = await page
            .locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a")
            .getAttribute("href");
          expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
          await dragToBottomEdgeAndLeave(page, width, variant);
          await page.waitForTimeout(100);
          await page.keyboard.press("Shift");
          await expect
            .poll(() => dataStill(page), {
              message: `the row stands still within 1.6 s of the Shift (${variant}, ${width}px, run ${run})`,
              timeout: 1_600,
            })
            .toBe(true);
          expect(
            await focusedHref(page),
            `link 1 holds the focus (${variant}, ${width}px, run ${run})`,
          ).toBe(href);
          expect(
            await page.evaluate(() => {
              const a = document.activeElement!.getBoundingClientRect();
              const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
              return (
                a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom
              );
            }),
            `link 1 is in the window once the row is still (${variant}, ${width}px, run ${run})`,
          ).toBe(true);
        }
      }
    }
  });

  // P1-87 PR 5b review r10 B.2 (F1, the page listener's re-check): a drag dropped inside the window, a
  // rest of 150 ms, a Shift while the row still moves (the flag holds it), then one move from the row
  // to the page outside the window, with no key after it. The page listener must re-check on that
  // move. Five runs at 1280px and 390px.
  it("a drag dropped inside the window, a Shift while the mouse rests, then one move from the row into the page with no key, stands the row still with link 1 in the window, at 1280px and 390px", async () => {
    for (const width of [1280, 390]) {
      for (let run = 1; run <= 5; run++) {
        const page = await nextRun();
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${origin}/`);
        await tickerReady(page);
        const href = await page
          .locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a")
          .getAttribute("href");
        expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
        await dragLink1(page, width, "inside");
        expect(
          await dragStarted(page),
          `a drag started on the window at ${width}px, run ${run}`,
        ).toBe(true);
        expect(
          await focusedHref(page),
          `link 1 holds the focus after the drag at ${width}px, run ${run}`,
        ).toBe(href);
        await page.waitForTimeout(150);
        await page.keyboard.press("Shift");
        expect(
          await dataStill(page),
          `the row still moves under the resting mouse before the move at ${width}px, run ${run}`,
        ).toBe(false);
        expect(
          await page.evaluate(() => document.activeElement!.matches(":focus-visible")),
          `link 1 is :focus-visible after the Shift at ${width}px, run ${run}`,
        ).toBe(true);
        const target = await page.evaluate(() => {
          const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
          return { x: w.left + 40, y: w.top - 30 };
        });
        expect(target.y, `the window has room above it at ${width}px`).toBeGreaterThan(0);
        await page.mouse.move(target.x, target.y);
        expect(
          await page.evaluate(
            ([px, py]) =>
              document.elementFromPoint(px, py) !== null &&
              document.elementFromPoint(px, py)!.closest(".ov-ticker-window") === null,
            [target.x, target.y] as const,
          ),
          `the pointer is on the page outside the window at ${width}px, run ${run}`,
        ).toBe(true);
        await expect
          .poll(() => dataStill(page), {
            message: `the row stands still within 1.6 s of the move off the row, no key (${width}px, run ${run})`,
            timeout: 1_600,
          })
          .toBe(true);
        expect(
          await page.evaluate(() => {
            const a = document.activeElement!.getBoundingClientRect();
            const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
            return a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
          }),
          `link 1 is in the window once the row is still at ${width}px, run ${run}`,
        ).toBe(true);
      }
    }
  });

  // P1-87 PR 5b review r11 B.4 (F1, mutant 86): onDocOut's own re-check. A drag dropped 1 px inside the
  // window's bottom edge, a rest of 150 ms, a Shift while the row still moves (the flag holds it), then
  // the mouse off the page with no key after it: (a) one 3 px step off the bottom, or (b) one jump to
  // x = -30. Only onDocOut's requestAnimationFrame(recheck) can stand the row still here, since B.1
  // presses its key after the leave. Five runs per variant at 1280px and 390px.
  it("a drag dropped 1 px inside the window's bottom edge, a Shift while the row still moves, then the mouse off the page with no key, stands the row still with link 1 in the window, at 1280px and 390px", async () => {
    for (const width of [1280, 390]) {
      for (const variant of ["step-off", "jump-off"] as const) {
        for (let run = 1; run <= 5; run++) {
          const page = await nextRun();
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${origin}/`);
          await tickerReady(page);
          const href = await page
            .locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a")
            .getAttribute("href");
          expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
          await page.evaluate(() => {
            const log: string[] = ((window as Window & { __drag?: string[] }).__drag = []);
            document
              .querySelector(".ov-ticker-window")!
              .addEventListener("dragstart", () => log.push("dragstart"));
            const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
            window.scrollBy(0, w.bottom - window.innerHeight + 1);
          });
          await page.waitForTimeout(100);
          const scrolled = (await page.locator(".ov-ticker-window").boundingBox())!;
          expect(
            scrolled.y + scrolled.height,
            `the window's bottom is at the viewport's bottom at ${width}px, run ${run}`,
          ).toBeGreaterThan(898);
          const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a");
          await page.locator(".ov-ticker-window").hover();
          await settledPaused(page);
          const box = (await link.boundingBox())!;
          const win = (await page.locator(".ov-ticker-window").boundingBox())!;
          const left = Math.max(box.x, win.x, 0) + 1;
          const right = Math.min(box.x + box.width, win.x + win.width, width) - 1;
          const x = (left + right) / 2;
          const y = box.y + box.height / 2;
          await page.mouse.move(x, y);
          await page.mouse.down();
          for (let i = 1; i <= 4; i++) await page.mouse.move(x + 3 * i, y);
          const dropX = x + 12;
          const bottom = win.y + win.height;
          let dy = y;
          while (dy < bottom - 1) {
            dy = Math.min(bottom - 1, dy + 3);
            await page.mouse.move(dropX, dy);
          }
          await page.mouse.up();
          const inside = (px: number, py: number) =>
            page.evaluate(
              ([qx, qy]) => document.elementFromPoint(qx, qy)?.closest(".ov-ticker-window") != null,
              [px, py] as const,
            );
          expect(await dragStarted(page), `a drag started on the window at ${width}px`).toBe(true);
          expect(
            await inside(dropX, bottom - 1),
            `the drop is inside the window at ${width}px, run ${run}`,
          ).toBe(true);
          await page.waitForTimeout(150);
          await page.keyboard.press("Shift");
          expect(
            await dataStill(page),
            `the row still moves under the resting mouse before the leave (${variant}, ${width}px, run ${run})`,
          ).toBe(false);
          expect(
            await page.evaluate(() => document.activeElement!.matches(":focus-visible")),
            `link 1 is :focus-visible after the Shift (${variant}, ${width}px, run ${run})`,
          ).toBe(true);
          expect(
            await focusedHref(page),
            `link 1 holds the focus before the leave (${variant}, ${width}px, run ${run})`,
          ).toBe(href);
          // No key after this move: only the document mouseout's own re-check can stand the row still.
          const leave =
            variant === "step-off" ? { x: dropX, y: bottom - 1 + 3 } : { x: -30, y: bottom - 1 };
          await page.mouse.move(leave.x, leave.y);
          expect(
            await inside(leave.x, leave.y),
            `the pointer is off the window after its move at ${width}px (${variant}, run ${run})`,
          ).toBe(false);
          await expect
            .poll(() => dataStill(page), {
              message: `the row stands still within 1.6 s of the leave, no key (${variant}, ${width}px, run ${run})`,
              timeout: 1_600,
            })
            .toBe(true);
          expect(
            await focusedHref(page),
            `link 1 holds the focus once the row is still (${variant}, ${width}px, run ${run})`,
          ).toBe(href);
          expect(
            await page.evaluate(() => {
              const a = document.activeElement!.getBoundingClientRect();
              const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
              return (
                a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom
              );
            }),
            `link 1 is in the window once the row is still (${variant}, ${width}px, run ${run})`,
          ).toBe(true);
        }
      }
    }
  });

  // P1-87 PR 5b review r10 B.3 (F2, mutant 71): a drag out of the window, released outside, then a
  // Shift at once with no further move. Ten runs at each of 1280px and 390px, and the count is the
  // assertion: at least 5 of 10 runs must stand the row still within 1.6 s of the Shift, and every
  // still run must hold link 1 focused inside the window. The threshold is not "every run" on purpose.
  // After an outside drop, Chromium's stale pointerover from the window sometimes lands before the key
  // frame and sets the flag again, so the row stays moving. That is a pre-existing minor, filed
  // separately, and it happens 1 to 3 runs in 10 on this page. Mutant 71 (dragend settles the flag true
  // wherever the drop lands) makes it 0 of 10, so a bar of 5 pins 71 and leaves the stale hover room.
  const stillWithin = async (page: Page, ms: number) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await dataStill(page)) return true;
      await page.waitForTimeout(50);
    }
    return false;
  };
  it("a drag out of the window released outside, then a Shift at once, stands the row still with link 1 in the window, at least 5 of 10 runs at 1280px and at 390px", async () => {
    for (const width of [1280, 390]) {
      let stillRuns = 0;
      for (let run = 1; run <= 10; run++) {
        const page = await nextRun();
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${origin}/`);
        await tickerReady(page);
        const href = await page
          .locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a")
          .getAttribute("href");
        expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
        const drop = await dragLink1(page, width, "outside");
        expect(
          await dragStarted(page),
          `a drag started on the window at ${width}px, run ${run}`,
        ).toBe(true);
        expect(
          await page.evaluate(
            ([px, py]) => document.elementFromPoint(px, py)?.closest(".ov-ticker-window") === null,
            [drop.x, drop.y] as const,
          ),
          `the drop is outside the window at ${width}px, run ${run}`,
        ).toBe(true);
        expect(await focusedHref(page), `link 1 holds the focus at ${width}px, run ${run}`).toBe(
          href,
        );
        await page.keyboard.press("Shift");
        const still = await stillWithin(page, 1_600);
        if (!still) continue;
        stillRuns++;
        expect(
          await focusedHref(page),
          `a still run holds link 1 focus at ${width}px, run ${run}`,
        ).toBe(href);
        expect(
          await page.evaluate(() => {
            const a = document.activeElement!.getBoundingClientRect();
            const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
            return a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
          }),
          `a still run has link 1 inside the window at ${width}px, run ${run}`,
        ).toBe(true);
      }
      expect(
        stillRuns,
        `at least 5 of 10 runs stand still within 1.6 s of a Shift at once after a drag out (${width}px)`,
      ).toBeGreaterThanOrEqual(5);
    }
  });

  // P1-87 PR 5b review r8 B.3: a mouse that rests after a pen has left, then moves 1 px within one
  // element. The window's pointermove is the only event that sees it (pointerover does not fire).
  it("a mouse that rests after a pen has left, then moves 1 px within one element, keeps the row moving: pointermove alone is seen, at 1280px and 390px", async () => {
    for (const width of [1280, 390]) {
      const page = await nextRun();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page);
      const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a");
      const href = await link.getAttribute("href");
      expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
      await page.locator(".ov-ticker-window").hover();
      await settledPaused(page);
      const box = (await link.boundingBox())!;
      const win = (await page.locator(".ov-ticker-window").boundingBox())!;
      const left = Math.max(box.x, win.x, 0) + 1;
      const right = Math.min(box.x + box.width, win.x + win.width, width) - 1;
      const mx = (left + right) / 2;
      const my = box.y + box.height / 2;
      await page.mouse.move(mx, my);
      // A pen leaves the window while the mouse rests on link 1 (CDP cannot send two pointers at
      // once, so the pen's leave is a synthetic pointerleave on the window).
      await page.evaluate(() =>
        document
          .querySelector(".ov-ticker-window")!
          .dispatchEvent(new PointerEvent("pointerleave", { pointerType: "pen", pointerId: 2 })),
      );
      await page.evaluate(() => {
        (window as Window & { __ev?: string[] }).__ev = [];
        for (const t of ["pointerover", "pointerenter", "pointermove"])
          document
            .querySelector(".ov-ticker-window")!
            .addEventListener(t, () => (window as Window & { __ev?: string[] }).__ev!.push(t));
      });
      await page.mouse.move(mx + 1, my);
      expect(
        await page.evaluate(() => (window as Window & { __ev?: string[] }).__ev),
        `the 1 px move is a pointermove alone at ${width}px`,
      ).toEqual(["pointermove"]);
      await page.mouse.down({ button: "right" });
      await page.mouse.up({ button: "right" });
      await page.keyboard.press("Escape");
      expect(await focusedHref(page), `link 1 holds the focus at ${width}px`).toBe(href);
      expect(
        await page.evaluate(() => document.activeElement!.matches(":focus-visible")),
        `link 1 is :focus-visible at ${width}px`,
      ).toBe(true);
      await page.keyboard.press("Shift");
      const seen = await watchRow(page, 1200);
      expect(
        seen.some((s) => s.still),
        `the row keeps moving under the mouse at ${width}px`,
      ).toBe(false);
    }
  });

  // P1-87 PR 5b review r8 B.3: a pen resting on link 1, a right press, Escape, then the pen leaves the
  // window (round 4's M1 rule with a pen). The hover and the leave are synthetic pen events, as in the
  // pen-resting test, because a CDP pen move also sends compatibility mouse events, which would clear a
  // flag that only a mouse leave clears. The press and the keys are real.
  it("a pen resting on link 1, a right press, Escape, then the pen leaving the window stands the row still with link 1 in the window, at 1280px and 390px", async () => {
    for (const width of [1280, 390]) {
      const page = await nextRun();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await tickerReady(page);
      const link = page.locator(".ov-ticker-list:not(.copy) > li:nth-child(1) a");
      const href = await link.getAttribute("href");
      expect(href, `link 1 is a link at ${width}px`).toBeTruthy();
      const cdp = await page.context().newCDPSession(page);
      await page.locator(".ov-ticker-window").scrollIntoViewIfNeeded();
      const hover = (await page.locator(".ov-ticker-window").boundingBox())!;
      await page.evaluate(
        ([hx, hy]) => {
          const w = document.querySelector(".ov-ticker-window")!;
          for (const t of ["pointerover", "pointerenter", "pointermove"])
            w.dispatchEvent(
              new PointerEvent(t, {
                pointerType: "pen",
                pointerId: 3,
                isPrimary: true,
                clientX: hx,
                clientY: hy,
                bubbles: true,
              }),
            );
        },
        [hover.x + hover.width / 2, hover.y + hover.height / 2] as const,
      );
      const box = (await link.boundingBox())!;
      const win = (await page.locator(".ov-ticker-window").boundingBox())!;
      const left = Math.max(box.x, win.x, 0) + 1;
      const right = Math.min(box.x + box.width, win.x + win.width, width) - 1;
      const x = (left + right) / 2;
      const y = box.y + box.height / 2;
      await pointer(cdp, "mousePressed", x, y, "pen", "right");
      await pointer(cdp, "mouseReleased", x, y, "pen", "right");
      expect(
        await focusedHref(page),
        `the pen's right press leaves link 1 focused at ${width}px`,
      ).toBe(href);
      await page.keyboard.press("Escape");
      expect(
        await page.evaluate(() => document.activeElement!.matches(":focus-visible")),
        `link 1 is :focus-visible after Escape at ${width}px`,
      ).toBe(true);
      await page.evaluate(() =>
        document
          .querySelector(".ov-ticker-window")!
          .dispatchEvent(
            new PointerEvent("pointerleave", { pointerType: "pen", pointerId: 3, isPrimary: true }),
          ),
      );
      await expect
        .poll(() => dataStill(page), {
          message: `the row stands still once the pen has left at ${width}px`,
          timeout: 1_600,
        })
        .toBe(true);
      expect(
        await page.evaluate(() => {
          const a = document.activeElement!.getBoundingClientRect();
          const w = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
          return a.left >= w.left && a.right <= w.right && a.top >= w.top && a.bottom <= w.bottom;
        }),
        `link 1 is in the window once the row is still at ${width}px`,
      ).toBe(true);
    }
  });
});

describe("the overview's motion, in a browser (P1-87 PR 8a)", () => {
  /** The page's script has run: it sets this marker in onMount, on the element the intro reads. */
  const motionReady = async (page: Page) => {
    await page.locator('.ov-first[data-motion-ready="true"]').waitFor({ state: "attached" });
  };
  /** Every bar's row: its name, its inline style, and the timing of its fill and unknown spans. */
  const barRows = (page: Page) =>
    page.locator(".ov-checks-list > li.ov-check").evaluateAll((lis) =>
      lis.map((li) => {
        const timing = (el: Element | null) =>
          el
            ? el.getAnimations().map((a) => ({
                name: (a as CSSAnimation).animationName,
                // calc() is float arithmetic in the browser (680 ms reads as 679.9999999999999).
                delay: Math.round(Number(a.effect!.getTiming().delay)),
                duration: Number(a.effect!.getTiming().duration),
              }))
            : null;
        return {
          name: li.querySelector(".ov-check-name")!.textContent!.trim(),
          fill: timing(li.querySelector(".ov-check-fill")),
          unknown: timing(li.querySelector(".ov-check-unknown")),
        };
      }),
    );
  /** Each bar's rendered fill against the model's share of the bar, read from the row's own count
   *  (the pass count, and the "of N" the page keeps for assistive tech). */
  const barShares = (page: Page) =>
    page.locator(".ov-checks-list > li.ov-check").evaluateAll((lis) =>
      lis.map((li) => {
        const bar = li.querySelector(".ov-check-bar")!.getBoundingClientRect().width;
        const count = li.querySelector(".ov-check-count")!;
        const pass = Number(count.textContent!.trim().split(/\s/)[0]);
        const total = Number(
          count.querySelector(".visually-hidden")!.textContent!.replace(/\D/g, ""),
        );
        const fill = li.querySelector(".ov-check-fill")?.getBoundingClientRect().width ?? 0;
        return { fill, expected: (bar * pass) / total, bar };
      }),
    );
  const barAnimations = (page: Page) =>
    page.evaluate(
      () => document.querySelector(".ov-checks-list")!.getAnimations({ subtree: true }).length,
    );

  it("fills each bar in check order: ov-bar-fill, 80 ms apart, for 600 ms (item 3)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const rows = await barRows(page);
    expect(rows.map((r) => r.name)).toEqual([...HEALTH_CHECK_NAMES]);
    const filled = rows.filter((r) => r.fill !== null);
    expect(filled.length, "the seeded sites give more than one bar a fill").toBeGreaterThan(1);
    // P1-87 PR 8a, review round 1 (n1): the unknown segments' order is pinned only if one exists.
    expect(
      rows.filter((r) => r.unknown !== null).length,
      "the seeded sites give an unknown segment",
    ).toBeGreaterThan(0);
    rows.forEach((r, i) => {
      if (r.fill !== null) {
        expect(r.fill, `${r.name}'s fill`).toHaveLength(1);
        expect(r.fill![0]).toMatchObject({
          name: "ov-bar-fill",
          delay: i * BAR_STAGGER_MS,
          duration: BAR_MS,
        });
      }
      if (r.unknown !== null) {
        expect(r.unknown, `${r.name}'s unknown`).toHaveLength(1);
        expect(r.unknown![0]).toMatchObject({
          name: "ov-bar-fill",
          delay: i * BAR_STAGGER_MS + BAR_MS,
          duration: BAR_MS,
        });
      }
    });
  });

  it("ends each fill at its model's share of the bar (item 3)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    await page.evaluate(() =>
      Promise.all(
        document
          .querySelector(".ov-checks-list")!
          .getAnimations({ subtree: true })
          .map((a) => a.finished),
      ),
    );
    for (const s of await barShares(page)) {
      if (s.fill === 0) continue;
      expect(
        Math.abs(s.fill - s.expected),
        `a fill is ${s.fill}px, its share ${s.expected}px`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("under reduced motion no bar animates, and every fill is at its share at once (item 3)", async () => {
    const page = await signedIn("op", { reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    expect(await barAnimations(page)).toBe(0);
    for (const s of await barShares(page)) {
      if (s.fill === 0) continue;
      expect(Math.abs(s.fill - s.expected)).toBeLessThanOrEqual(1);
    }
  });

  it("a client return to / plays no bar animation (item 3)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    await follow(page, "/fleet", "Sites");
    await follow(page, "/", "Overview");
    await motionReady(page);
    expect(await page.locator(".ov-checks-list").getAttribute("data-intro")).toBeNull();
    expect(await barAnimations(page)).toBe(0);
  });

  // P1-87 PR 8a, review round 1 (F2): a refresh that inserts a fill does not replay the intro on it.
  // The refresh is the page's own: the Contact form's second site passes in the DB, and the page's
  // clock moves on so its cycle clock re-reads (as the feed test does). The site is put back after.
  const contactFills = (page: Page) =>
    page
      .locator(".ov-check", { hasText: "Contact form" })
      .locator(".ov-check-fill")
      .evaluateAll((els) =>
        els.map((el) => el.getAnimations().map((a) => (a as CSSAnimation).animationName)),
      );
  const setContactForm = async (value: "pass" | null) => {
    const db = await openDb({ url: dbUrl });
    try {
      await db
        .updateTable("site_health")
        .set({ form_e2e_ok: value, form_e2e_checked_at: new Date().toISOString() } as never)
        .where("site_id", "=", "recB")
        .execute();
    } finally {
      await db.destroy();
    }
  };
  it("a refresh that adds a fill plays no intro on it (item 3, review round 1 F2)", async () => {
    const page = await signedIn();
    await page.clock.install();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    // Past the intro's end, so the refresh is not a first load.
    await page.waitForTimeout(INTRO_MS + 500);
    expect(await contactFills(page)).toEqual([]);
    try {
      await setContactForm("pass");
      const now = await page.evaluate(() => Date.now());
      await page.clock.setSystemTime(now + 25 * 3_600_000);
      await page.clock.runFor(60_000);
      await expect.poll(() => contactFills(page), { timeout: 10_000 }).toHaveLength(1);
      expect(await contactFills(page), "the new fill runs no animation").toEqual([[]]);
      expect(await page.locator(".ov-checks-list").getAttribute("data-intro")).toBeNull();
    } finally {
      await setContactForm(null);
    }
  });

  // P1-87 PR 8a, review round 1 (F3, T1): the fail-safe and the count never show at once. A frame
  // sampler, installed before the page's script, records each frame's time, whether the first
  // countable figure's final number is visible, and what its count span shows.
  const sampleFigure = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as {
        __figure: { t: number; visible: boolean; count: string; start: number | null }[];
      };
      w.__figure = [];
      const frame = () => {
        const p = document.querySelector<HTMLElement>(".ov-num[data-countable]");
        if (p) {
          const fin = p.querySelector<HTMLElement>(".ov-num-final");
          const count = p.querySelector<HTMLElement>(".ov-num-count");
          // The fail-safe's own start: the 2 s runs from when the page first styles, which is
          // after navigation start (about 0.5 s here), so the window is read from this start.
          const fail = fin
            ?.getAnimations()
            .find((a) => (a as CSSAnimation).animationName === "ov-failsafe");
          w.__figure.push({
            t: performance.now(),
            visible: fin ? getComputedStyle(fin).visibility === "visible" : false,
            count: count?.textContent ?? "",
            start: typeof fail?.startTime === "number" ? fail.startTime : null,
          });
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  const figureFrames = (page: Page) =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __figure: { t: number; visible: boolean; count: string; start: number | null }[];
          }
        ).__figure,
    );
  /** The last sampled frame shows the final number: polled, since a sample can predate the style update. */
  const endsVisible = (page: Page) =>
    expect
      .poll(async () => (await figureFrames(page)).at(-1)?.visible ?? false, { timeout: 5_000 })
      .toBe(true);
  it("with the script blocked, a countable figure shows at the fail-safe, not before (item 4, review round 1 C)", async () => {
    const page = await signedIn();
    await sampleFigure(page);
    await page.route("**/_app/**", (route) => route.abort());
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => performance.now() > 2500);
    const frames = await figureFrames(page);
    const timed = frames.filter((f) => f.start !== null);
    expect(timed.length, "the fail-safe runs").toBeGreaterThan(0);
    const at = (f: { t: number; start: number | null }) => f.t - f.start!;
    const before = timed.filter((f) => at(f) < 1800);
    expect(before.length, "frames sampled in the first 1.8 s of the fail-safe").toBeGreaterThan(0);
    expect(
      before.some((f) => f.visible),
      "the figure is hidden before 1.8 s",
    ).toBe(false);
    expect(
      timed.some((f) => at(f) <= 2300 && f.visible),
      "the figure is visible by 2.3 s of the fail-safe",
    ).toBe(true);
    expect(
      frames.every((f) => f.count === ""),
      "nothing counts without the script",
    ).toBe(true);
  });

  // Round 2 (r2): the bundle is held 2.5 s, not 1.5 s, so a count that began just after the fail-safe
  // (style at about 0.46 s, plus the hold) cannot pass for one the test should have seen.
  it("with the script delayed 2.5 s, the figure never shows with a count, and it ends visible (item 4, review round 1 C)", async () => {
    const page = await signedIn();
    await sampleFigure(page);
    await page.route("**/_app/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => performance.now() > 4500);
    const frames = await figureFrames(page);
    expect(frames.length).toBeGreaterThan(0);
    expect(
      frames.some((f) => f.visible && f.count !== ""),
      "no frame shows the final number and a count at once",
    ).toBe(false);
    expect(
      frames.every((f) => f.count === ""),
      "no count runs after the fail-safe",
    ).toBe(true);
    await endsVisible(page);
  });

  it("the fail-safe never reveals the final number over a running count (item 4, review round 1 C)", async () => {
    const page = await signedIn();
    await sampleFigure(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    // Wait for the first countable figure's count to be running (data-counting, digits in it).
    await page.waitForFunction(() => {
      const p = document.querySelector<HTMLElement>(".ov-num[data-countable]");
      return (
        p?.hasAttribute("data-counting") &&
        (p.querySelector(".ov-num-count")?.textContent ?? "") !== ""
      );
    });
    // The fail-safe fires now: finish its animation where it is, if the page still has one. A page
    // with the selector guard has none while the figure counts, so nothing changes there.
    await page.evaluate(() => {
      const f = document.querySelector<HTMLElement>(".ov-num[data-countable] .ov-num-final");
      for (const a of f?.getAnimations() ?? [])
        if ((a as CSSAnimation).animationName === "ov-failsafe") a.finish();
    });
    await figuresSettled(page);
    const frames = await figureFrames(page);
    expect(
      frames.some((f) => f.visible && f.count !== ""),
      "no frame shows the final number over a count",
    ).toBe(false);
    await endsVisible(page);
  });

  it("at 1x a normal load hides the figure from its first frame, and the count runs (item 4, review round 1 C)", async () => {
    const page = await signedIn();
    await sampleFigure(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    await figuresSettled(page);
    const frames = await figureFrames(page);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]!.visible, "the first frame hides the final number").toBe(false);
    expect(
      frames.some((f) => f.count !== ""),
      "the count runs",
    ).toBe(true);
    await endsVisible(page);
  });

  it("with no script, the fills reach their shares (item 3)", async () => {
    const page = await signedIn("op", { javaScriptEnabled: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    // The model's share of each filled bar, as the server wrote it (the inline width).
    const shares = [
      ...(await page.content()).matchAll(/class="ov-check-fill" style="width: ([\d.]+)%"/g),
    ].map((m) => Number(m[1]));
    expect(shares.length, "the seeded sites give more than one bar a fill").toBeGreaterThan(1);
    // The bars are CSS only and run without script: wait past the last fill's end (1.1 s for seven
    // bars), then read the rendered widths.
    await page.waitForTimeout(MAX_MOTION_MS / 2);
    const fills = await page.locator(".ov-check-fill").evaluateAll((els) =>
      els.map((el) => {
        const bar = el.parentElement!.getBoundingClientRect().width;
        return { rendered: el.getBoundingClientRect().width, bar };
      }),
    );
    expect(fills.length).toBe(shares.length);
    fills.forEach((f, i) =>
      expect(Math.abs(f.rendered - (f.bar * shares[i]!) / 100), `fill ${i}`).toBeLessThanOrEqual(1),
    );
  });

  it("every animation on the overview ends by MAX_MOTION_MS, except the ticker's (item 3)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    // Pre-8a animations on this page: the ticker's row only (.ov-ticker-run), which loops by design.
    const ends = await page.evaluate(() =>
      document
        .getAnimations()
        .filter(
          (a) =>
            !((a.effect as KeyframeEffect | null)?.target as Element | null)?.matches?.(
              ".ov-ticker-run",
            ),
        )
        .map((a) => ({
          name: (a as CSSAnimation).animationName ?? "",
          end: a.effect!.getComputedTiming().endTime as number,
        })),
    );
    expect(ends.length, "the bars animate").toBeGreaterThan(0);
    // Item 4's draw-ins are in the same list: the sparklines' line draw and its dots' fade.
    expect(ends.map((e) => e.name)).toEqual(expect.arrayContaining(["ov-spark-draw"]));
    for (const e of ends) {
      expect(Number.isFinite(e.end), `${e.name} has a finite end`).toBe(true);
      expect(e.end, `${e.name} ends`).toBeLessThanOrEqual(MAX_MOTION_MS);
    }
  });

  /** Every frame until each measured figure has finished counting (3 s at most). Per tile, the
   *  counting digits, the visually hidden copy, the whole text of the figure and its flags, all read
   *  in the page's own frames, so a sample is never a stale read. */
  type TileFrame = {
    counting: boolean;
    counted: boolean;
    countable: boolean;
    unknown: boolean;
    digits: string;
    copy: string;
    text: string;
  };
  const countFrames = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<TileFrame[][]>((done) => {
          const out: TileFrame[][] = [];
          const started = performance.now();
          const frame = () => {
            out.push(
              [...document.querySelectorAll<HTMLElement>(".ov-tiles > .ov-tile")].map((t) => {
                const num = t.querySelector<HTMLElement>(".ov-num")!;
                return {
                  counting: num.hasAttribute("data-counting"),
                  counted: num.hasAttribute("data-counted"),
                  countable: num.hasAttribute("data-countable"),
                  unknown: num.classList.contains("unknown"),
                  digits: num.querySelector(".ov-num-count")?.textContent ?? "",
                  copy: (t.querySelector(":scope > .visually-hidden")?.textContent ?? "").replace(
                    /\s+/g,
                    "",
                  ),
                  text: (num.textContent ?? "").replace(/\s+/g, ""),
                };
              }),
            );
            const pending = document.querySelectorAll(
              ".ov-num:not([data-counted])[data-countable]",
            ).length;
            if (pending === 0 || performance.now() - started > 3000) done(out);
            else requestAnimationFrame(frame);
          };
          frame();
        }),
    );

  it("counts each measured figure up once, from 0, to the model's own string (item 4)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const frames = await countFrames(page);
    const first = frames[0]!;
    const model = first.map((t) => t.copy);
    // Measured from the model's own words (digits, with commas where they group), not from a marker.
    const measured = model.flatMap((m, i) => (/^(\d+|\d{1,3}(,\d{3})+)$/.test(m) ? [i] : []));
    expect(
      measured.length,
      "the seeded tiles include more than one measured figure",
    ).toBeGreaterThan(1);
    const counted = new Map<number, boolean>();
    for (const [k, f] of frames.entries()) {
      f.forEach((t, i) => {
        const at = `frame ${k}, tile ${i} (${model[i]})`;
        expect(t.copy, `${at}: the visually hidden copy`).toBe(model[i]);
        if (t.counted) counted.set(i, true);
        // Once counted, a figure never counts again.
        if (counted.get(i)) expect(t.counting, `${at}: counted, then counting again`).toBe(false);
        if (!t.counting) return;
        expect(measured, `${at}: only a measured figure counts`).toContain(i);
        expect(
          t.digits.length,
          `${at}: its digits are no longer than the model's`,
        ).toBeLessThanOrEqual(model[i]!.length);
        expect(
          Number(t.digits.replace(/,/g, "")),
          `${at}: its digits never pass the model's`,
        ).toBeLessThanOrEqual(Number(model[i]!.replace(/,/g, "")));
      });
    }
    const last = frames.at(-1)!;
    for (const i of measured) {
      expect(last[i]!.text, `tile ${i} ends on the model's string`).toBe(model[i]);
    }
    const below = frames.some((f) => f.some((t, i) => t.counting && t.digits !== model[i]));
    expect(below, "a count-up frame shows a number below the model's").toBe(true);
  });

  it("a figure that reads a word never counts (item 4)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const frames = await countFrames(page);
    const words = frames[0]!.flatMap((t, i) => (t.unknown ? [i] : []));
    expect(words.length, "the seeded tiles include a figure that reads a word").toBeGreaterThan(0);
    for (const f of frames) {
      for (const i of words) {
        expect(f[i]!.counting, `tile ${i} is counting`).toBe(false);
        expect(f[i]!.countable, `tile ${i} is countable`).toBe(false);
      }
    }
  });

  it("under reduced motion no figure counts, and each reads its model's string at once (item 4)", async () => {
    const page = await signedIn("op", { reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const frames = await countFrames(page);
    expect(frames.length).toBe(1);
    expect(frames.flat().some((t) => t.counting)).toBe(false);
    expect(frames[0]!.every((t) => t.text === t.copy)).toBe(true);
  });

  it("a full load of /fleet, then its Overview link, plays no intro: no bar animates and no figure counts (item 3's correction, item 4)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/fleet`);
    await expect
      .poll(() => page.locator("h1").first().textContent(), { timeout: 10_000 })
      .toContain("Sites");
    await follow(page, "/", "Overview");
    await motionReady(page);
    expect(await page.locator(".ov-tiles").getAttribute("data-intro")).toBeNull();
    expect(await barAnimations(page)).toBe(0);
    const frames = await countFrames(page);
    expect(frames.flat().some((t) => t.counting)).toBe(false);
  });

  it("a client return to / after a full load of / shows the final figures at once (item 4)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    await follow(page, "/fleet", "Sites");
    await follow(page, "/", "Overview");
    await motionReady(page);
    const frames = await countFrames(page);
    expect(frames.length).toBe(1);
    expect(frames.flat().some((t) => t.counting)).toBe(false);
    expect(frames[0]!.every((t) => t.text === t.copy)).toBe(true);
  });

  it("with no script, every figure reads its model's string and shows; the sparklines end drawn (item 4)", async () => {
    const page = await signedIn("op", { javaScriptEnabled: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    const figures = await page.locator(".ov-tile").evaluateAll((tiles) =>
      tiles.map((t) => {
        const num = t.querySelector<HTMLElement>(".ov-num")!;
        return {
          text: (num.textContent ?? "").replace(/\s+/g, ""),
          copy: (t.querySelector(":scope > .visually-hidden")?.textContent ?? "").replace(
            /\s+/g,
            "",
          ),
          visibility: getComputedStyle(num.querySelector(".ov-num-final")!).visibility,
        };
      }),
    );
    expect(figures.length).toBeGreaterThan(1);
    for (const f of figures) {
      expect(f.text).toBe(f.copy);
      expect(f.visibility).toBe("visible");
    }
    await page.evaluate(() =>
      Promise.all(
        [...document.querySelectorAll(".ov-spark polyline")].flatMap((el) =>
          el.getAnimations().map((a) => a.finished),
        ),
      ),
    );
    const offsets = await page
      .locator(".ov-spark polyline")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).strokeDashoffset));
    expect(offsets.length).toBeGreaterThan(0);
    for (const o of offsets) expect(o).toBe("0px");
  });

  it("the sparklines draw in over SPARK_MS and end whole; under reduced motion they do not move (item 4)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const lines = await page.locator(".ov-spark polyline").evaluateAll((els) =>
      els.map((el) =>
        el.getAnimations().map((a) => ({
          name: (a as CSSAnimation).animationName,
          duration: Number(a.effect!.getTiming().duration),
        })),
      ),
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l).toEqual([{ name: "ov-spark-draw", duration: SPARK_MS }]);
    }
    await page.evaluate(() =>
      Promise.all(
        [...document.querySelectorAll(".ov-spark polyline")].map(
          (el) => el.getAnimations()[0]!.finished,
        ),
      ),
    );
    const ends = await page
      .locator(".ov-spark polyline")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).strokeDashoffset));
    for (const o of ends) expect(o).toBe("0px");

    const still = await signedIn("op", { reducedMotion: "reduce" });
    await still.setViewportSize({ width: 1280, height: 900 });
    await still.goto(`${origin}/`);
    await motionReady(still);
    expect(
      await still
        .locator(".ov-spark polyline")
        .evaluateAll((els) => els.reduce((n, el) => n + el.getAnimations().length, 0)),
    ).toBe(0);
    const stillEnds = await still
      .locator(".ov-spark polyline")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).strokeDashoffset));
    for (const o of stillEnds) expect(o).toBe("0px");
  });
  // P1-87 PR 8a, item 5: the trend charts' hover line and readout, by mouse, keyboard and touch.
  const chart = (page: Page, ci = 0) =>
    page.locator("figure.ov-trend").nth(ci).locator("svg.ov-chart");
  const readout = (page: Page, ci = 0) =>
    page.locator("figure.ov-trend").nth(ci).locator("p.ov-trend-readout");
  /** The readout's words, trimmed of the markup's whitespace. */
  const readoutText = async (page: Page, ci = 0) =>
    ((await readout(page, ci).textContent()) ?? "").trim();
  const nightRects = (page: Page, ci = 0) =>
    page.locator("figure.ov-trend").nth(ci).locator("rect.ov-hit");
  const cursorOf = (page: Page, ci = 0) =>
    page.locator("figure.ov-trend").nth(ci).locator("line.ov-trend-cursor");
  /** The chart's nights' words, in order, from the hover targets' data. */
  const titlesOf = (page: Page, ci = 0) =>
    nightRects(page, ci).evaluateAll((rs) => rs.map((r) => r.getAttribute("data-title")!));
  /** WCAG 2.x relative luminance and contrast ratio, from an `rgb()`/`rgba()` string. */
  const contrastOf = (a: string, b: string) => {
    const lum = (c: string) => {
      const [r, g, bl] = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((v) => {
        const x = Number(v) / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  it("a hover draws the line at that night's centre and reads that night's words (item 5)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const titles = await titlesOf(page);
    expect(titles.length, "the seeded chart has a night per slot").toBeGreaterThan(5);
    const k = 5;
    await nightRects(page).nth(k).hover();
    const geo = await nightRects(page)
      .nth(k)
      .evaluate((r) => ({
        centre: Number(r.getAttribute("x")) + Number(r.getAttribute("width")) / 2,
      }));
    const cursor = page.locator("figure.ov-trend").nth(0).locator("line.ov-trend-cursor");
    expect(await cursor.count()).toBe(1);
    expect(Number(await cursor.getAttribute("x1"))).toBeCloseTo(geo.centre, 1);
    expect(await readoutText(page)).toBe(titles[k]);
  });

  it("the arrow keys step a night at a time, End and Home go to the ends, and Escape clears (item 5)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const titles = await titlesOf(page);
    await chart(page).focus();
    // Round 2 (H): with no night chosen the slider reports the newest, so Right selects it (not the
    // oldest) and Left steps back from it.
    await page.keyboard.press("ArrowRight");
    expect(await readoutText(page), "from no night, Right selects the newest").toBe(titles.at(-1));
    await page.keyboard.press("ArrowLeft");
    expect(await readoutText(page), "Left steps back one from the newest").toBe(titles.at(-2));
    await page.keyboard.press("ArrowRight");
    expect(await readoutText(page)).toBe(titles.at(-1));
    await page.keyboard.press("End");
    expect(await readoutText(page)).toBe(titles.at(-1));
    await page.keyboard.press("ArrowRight");
    expect(await readoutText(page), "the last night stays").toBe(titles.at(-1));
    await page.keyboard.press("Home");
    expect(await readoutText(page)).toBe(titles[0]);
    await page.keyboard.press("ArrowLeft");
    expect(await readoutText(page), "the first night stays, no wrap").toBe(titles[0]);
    await page.keyboard.press("Escape");
    expect(await readoutText(page)).toBe(
      "Point at a night, or focus the chart and use the arrow keys, to read it.",
    );
    expect(
      await page.locator("figure.ov-trend").nth(0).locator("line.ov-trend-cursor").count(),
    ).toBe(0);
  });

  // P1-87 PR 8a, review round 1 (D), changed in round 2 (G, R1, R2): the slider's value is the
  // announcement. A key step moves it; leaving the chart returns it to the newest night.
  it("the slider's value follows the keys, and falls back to the newest night once focus leaves (item 5, review round 1 D, round 2 G)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const titles = await titlesOf(page);
    const n = titles.length;
    expect(await chart(page).getAttribute("aria-valuenow"), "at rest: the newest night").toBe(
      String(n),
    );
    await chart(page).focus();
    await page.keyboard.press("Home");
    expect(await chart(page).getAttribute("aria-valuetext"), "a key speaks its night").toBe(
      titles[0],
    );
    expect(await chart(page).getAttribute("aria-valuenow")).toBe("1");
    await page.keyboard.press("ArrowRight");
    expect(await chart(page).getAttribute("aria-valuetext")).toBe(titles[1]);
    expect(await chart(page).getAttribute("aria-valuenow")).toBe("2");
    await page.keyboard.press("Tab");
    expect(await chart(page).getAttribute("aria-valuenow"), "leaving: the newest night").toBe(
      String(n),
    );
    expect(await chart(page).getAttribute("aria-valuetext")).toBe(titles[n - 1]);
    expect(await readoutText(page), "the visible readout is idle again").toBe(
      "Point at a night, or focus the chart and use the arrow keys, to read it.",
    );
  });

  // P1-87 PR 8a, round 2 (G, R1, R2): a hover previews a night; the keyboard's night stays put.
  it("a hover on a focused chart previews a night and leaves the slider on the key night; leaving restores it (item 5, round 2 G)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const titles = await titlesOf(page);
    const keyNight = titles.length - 2;
    await chart(page).focus();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowLeft");
    const keyNow = String(keyNight + 1);
    expect(await chart(page).getAttribute("aria-valuenow")).toBe(keyNow);
    expect(await chart(page).getAttribute("aria-valuetext")).toBe(titles[keyNight]);
    for (const k of [3, 6]) {
      await nightRects(page).nth(k).hover();
      expect(await readoutText(page), `hover ${k} shows its night`).toBe(titles[k]);
      const centre = await nightRects(page)
        .nth(k)
        .evaluate((r) => Number(r.getAttribute("x")) + Number(r.getAttribute("width")) / 2);
      expect(Number(await cursorOf(page).getAttribute("x1"))).toBeCloseTo(centre, 1);
      expect(
        await chart(page).getAttribute("aria-valuenow"),
        `hover ${k} keeps the key night`,
      ).toBe(keyNow);
      expect(await chart(page).getAttribute("aria-valuetext")).toBe(titles[keyNight]);
    }
    await page.mouse.move(0, 0);
    expect(await readoutText(page), "leaving: the key night is back").toBe(titles[keyNight]);
    expect(await chart(page).getAttribute("aria-valuenow")).toBe(keyNow);
    expect(
      await page.locator("figure.ov-trend").nth(0).locator("line.ov-trend-cursor").count(),
    ).toBe(1);
    // Round 2 (G-3): the chart has no live region; the slider's value is the one announcement.
    // Round 3 (t1): any live role counts, and the figure itself too.
    const live = '[aria-live],[role="status"],[role="log"],[role="alert"]';
    expect(
      await page.locator("figure.ov-trend").nth(0).locator(live).count(),
      "no live region inside the chart",
    ).toBe(0);
    expect(
      await page
        .locator("figure.ov-trend")
        .nth(0)
        .evaluate((f, sel) => f.matches(sel) || f.hasAttribute("aria-live"), live),
      "the figure itself is no live region",
    ).toBe(false);
  });

  // P1-87 PR 8a, round 3 (I, R3-A1): a key step is an act, so it ends a hover's preview. After a click
  // and a key, the readout and the cursor follow the key night, and a pointer that moves on previews again.
  it("a key step after a click ends the hover preview: the readout and cursor follow the keys, and a new hover previews again (item 5, round 3 I)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const titles = await titlesOf(page);
    const n = titles.length;
    const centreOf = (k: number) =>
      nightRects(page)
        .nth(k)
        .evaluate((r) => Number(r.getAttribute("x")) + Number(r.getAttribute("width")) / 2);
    await nightRects(page).nth(4).hover();
    await nightRects(page).nth(4).click();
    expect(await readoutText(page)).toBe(titles[4]);
    await page.keyboard.press("ArrowRight");
    expect(await readoutText(page), "a key step after a click shows the key night").toBe(titles[5]);
    expect(Number(await cursorOf(page).getAttribute("x1"))).toBeCloseTo(await centreOf(5), 1);
    expect(await chart(page).getAttribute("aria-valuenow")).toBe("6");
    await page.keyboard.press("End");
    expect(await readoutText(page)).toBe(titles[n - 1]);
    expect(Number(await cursorOf(page).getAttribute("x1"))).toBeCloseTo(await centreOf(n - 1), 1);
    expect(await chart(page).getAttribute("aria-valuenow")).toBe(String(n));
    await nightRects(page).nth(2).hover();
    expect(await readoutText(page), "a new hover previews again").toBe(titles[2]);
    expect(Number(await cursorOf(page).getAttribute("x1"))).toBeCloseTo(await centreOf(2), 1);
    expect(await chart(page).getAttribute("aria-valuenow"), "a hover is not a key choice").toBe(
      String(n),
    );
    // Round 4 (M2): the key step ends the preview on every chart, not only the first. The same
    // click, step, readout and cursor on chart 1, whose preview is its own (hoverSel[1]).
    const titles1 = await titlesOf(page, 1);
    const centreOn1 = (k: number) =>
      nightRects(page, 1)
        .nth(k)
        .evaluate((r) => Number(r.getAttribute("x")) + Number(r.getAttribute("width")) / 2);
    await nightRects(page, 1).nth(4).hover();
    await nightRects(page, 1).nth(4).click();
    expect(await readoutText(page, 1), "chart 1: the click shows its key night").toBe(titles1[4]);
    await page.keyboard.press("ArrowRight");
    expect(await readoutText(page, 1), "chart 1: a key step ends its preview").toBe(titles1[5]);
    expect(Number(await cursorOf(page, 1).getAttribute("x1"))).toBeCloseTo(await centreOn1(5), 1);
    expect(await chart(page, 1).getAttribute("aria-valuenow")).toBe("6");
  });

  it("a hover shows its night on screen, and the slider keeps the newest night while nothing is chosen by key (item 5, review round 1 D, round 2 G)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const titles = await titlesOf(page);
    const k = 4;
    await nightRects(page).nth(k).hover();
    expect(await readoutText(page), "the visible readout shows the night").toBe(titles[k]);
    expect(await chart(page).getAttribute("aria-valuenow"), "a hover is not a key choice").toBe(
      String(titles.length),
    );
    expect(await chart(page).getAttribute("aria-valuetext")).toBe(titles.at(-1));
  });

  // P1-87 PR 8a, review round 1 (E): a chart clears on Tab away, a hover is its own chart's, and a pointer
  // that leaves the chart clears it.
  const IDLE = "Point at a night, or focus the chart and use the arrow keys, to read it.";
  const cursors = (page: Page, ci: number) =>
    page.locator("figure.ov-trend").nth(ci).locator("line.ov-trend-cursor").count();
  it("Tab away from a focused chart clears its night and its cursor (item 5, review round 1 T2)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const titles = await titlesOf(page);
    await chart(page).focus();
    // Round 2 (H): from no night, Right selects the newest; Home selects the oldest, as this test reads.
    await page.keyboard.press("Home");
    expect(await readoutText(page)).toBe(titles[0]);
    await page.keyboard.press("Tab");
    expect(await readoutText(page), "the idle prompt is visible again").toBe(IDLE);
    expect(await cursors(page, 0), "no cursor on chart 0").toBe(0);
  });

  // P1-87 PR 8a, round 2 (H, R3): with nothing selected the slider reports the newest night, and Right
  // selects that night; it must not jump to the oldest.
  it("ArrowRight with no night selected keeps the slider on the newest night, not the oldest (item 5, round 2 H)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const titles = await titlesOf(page);
    await chart(page).focus();
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowRight");
    expect(await chart(page).getAttribute("aria-valuenow"), "Right selects the newest").toBe(
      String(titles.length),
    );
    expect(await chart(page).getAttribute("aria-valuetext")).toBe(titles.at(-1));
  });

  it("a hover on one chart does not select a night on the next (item 5, review round 1 T3)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const titles = await titlesOf(page);
    await nightRects(page, 0).nth(5).hover();
    expect(await readoutText(page, 0)).toBe(titles[5]);
    expect(await cursors(page, 0)).toBe(1);
    expect(await cursors(page, 1), "chart 1 draws no cursor").toBe(0);
    expect(await readoutText(page, 1), "chart 1 reads idle").toBe(IDLE);
  });

  it("a pointer that moves off a chart clears its night and its cursor (item 5, review round 1 T4)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    await nightRects(page).nth(5).hover();
    expect(await cursors(page, 0)).toBe(1);
    await page.mouse.move(0, 0);
    expect(await readoutText(page), "the idle prompt is back").toBe(IDLE);
    expect(await cursors(page, 0), "no cursor after the pointer leaves").toBe(0);
  });

  it("a night with no reading reads as the model says, never as 0 (item 5)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    // The seed writes sixteen nights and skips the ninth before the newest (i = 9): that gap is on
    // every chart, so chart 0 has one.
    const titles = await titlesOf(page);
    const gap = titles.findIndex((t) => t.endsWith("no count that night"));
    expect(gap, "the seed has a gap night on the first chart").toBeGreaterThan(-1);
    await nightRects(page).nth(gap).hover();
    const words = await readoutText(page);
    expect(words).toBe(titles[gap]);
    expect(words).toMatch(/no count that night$/);
    expect(words).not.toMatch(/: 0/);
  });

  it("the focus ring is at least 2px wide and 3:1 against the page, in light and dark, at 1280px and 390px", async () => {
    for (const width of [1280, 390])
      for (const scheme of ["light", "dark"] as const) {
        const page = await signedIn();
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`${origin}/`);
        await motionReady(page);
        await chart(page).focus();
        await page.keyboard.press("ArrowRight");
        const ring = await chart(page).evaluate((svg) => {
          const cs = getComputedStyle(svg);
          let el: Element | null = svg;
          let bg = "";
          while (el) {
            const c = getComputedStyle(el).backgroundColor;
            if (c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c)) {
              bg = c;
              break;
            }
            el = el.parentElement;
          }
          return {
            width: Number.parseFloat(cs.outlineWidth),
            style: cs.outlineStyle,
            colour: cs.outlineColor,
            bg: bg || getComputedStyle(document.documentElement).backgroundColor,
          };
        });
        const where = `${width}px ${scheme}`;
        expect(ring.style, where).toBe("solid");
        expect(ring.width, where).toBeGreaterThanOrEqual(2);
        expect(contrastOf(ring.colour, ring.bg), where).toBeGreaterThanOrEqual(3);
      }
  });

  it("a click on a column selects it, so a touch reads it too, at 390px (item 5)", async () => {
    const page = await signedIn("op", { hasTouch: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const titles = await titlesOf(page);
    await nightRects(page).nth(4).tap();
    expect(await readoutText(page)).toBe(titles[4]);
    expect(
      await page.locator("figure.ov-trend").nth(0).locator("line.ov-trend-cursor").count(),
    ).toBe(1);
    // Round 3 (t2): the tap chooses the night for the slider too. A touch never sets a hover preview,
    // so the assertions below pin the key night the slider reports, not the absence of a preview.
    expect(await chart(page).getAttribute("aria-valuenow"), "the tap is the key night").toBe("5");
    expect(await chart(page).getAttribute("aria-valuetext")).toBe(titles[4]);
  });

  it("reduced motion changes nothing but the motion: the readout works and the line does not animate (item 5)", async () => {
    const page = await signedIn("op", { reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    const titles = await titlesOf(page);
    await nightRects(page).nth(3).hover();
    expect(await readoutText(page)).toBe(titles[3]);
    const animating = await page
      .locator("line.ov-trend-cursor")
      .evaluateAll((els) => els.reduce((n, el) => n + el.getAnimations().length, 0));
    expect(animating).toBe(0);
  });

  it("forced colours draw the hover line in CanvasText (item 5)", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(`${origin}/`);
    await motionReady(page);
    await nightRects(page).nth(2).hover();
    const stroke = await page
      .locator("figure.ov-trend")
      .nth(0)
      .locator("line.ov-trend-cursor")
      .evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.color = "CanvasText";
        document.body.append(probe);
        const canvasText = getComputedStyle(probe).color;
        probe.remove();
        return { stroke: getComputedStyle(el).stroke, canvasText };
      });
    expect(stroke.stroke).toBe(stroke.canvasText);
  });

  // P1-87 PR 8a, item 7: a new feed line slides in on a data refresh. The refresh is the page's own:
  // its cycle clock re-reads the snapshot once the view is stale, so the test moves the page's clock
  // past that point (no hook in product code). The new event is written to the test DB and removed.
  const oneLine = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
  /** Records, from before the page's script, each line the page marks new (`data-new`). The
   *  observer sees a mark however short its life, so a 400 ms slide cannot be missed. */
  const watchNewLines = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __newMarks: string[] };
      w.__newMarks = [];
      const note = (el: Element) => {
        if (el.matches(".ov-lately li[data-new]"))
          w.__newMarks.push((el.textContent ?? "").replace(/\s+/g, " ").trim());
      };
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "attributes") note(r.target as Element);
          else
            for (const n of r.addedNodes) {
              if (!(n instanceof Element)) continue;
              note(n);
              n.querySelectorAll(".ov-lately li[data-new]").forEach((el) => note(el));
            }
        }
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-new"],
      });
    });
  const newMarks = (page: Page) =>
    page.evaluate(() => (window as unknown as { __newMarks: string[] }).__newMarks);
  /** Adds one feed event, then moves the page's clock a day on, so the next tick re-reads. */
  const refreshFeed = async (page: Page, id: string) => {
    const db = await openDb({ url: dbUrl });
    try {
      await recordFleetEvent(db, {
        id,
        ts: new Date().toISOString(),
        type: "vuln_cleared",
        siteId: null,
        siteName: "Hillcrest Veterinary",
        summary: "cleared",
        data: null,
      });
    } finally {
      await db.destroy();
    }
    const now = await page.evaluate(() => Date.now());
    await page.clock.setSystemTime(now + 25 * 3_600_000);
    await page.clock.runFor(60_000);
  };
  const removeFeedEvent = async (id: string) => {
    const db = await openDb({ url: dbUrl });
    try {
      await db.deleteFrom("fleet_events").where("id", "=", id).execute();
    } finally {
      await db.destroy();
    }
  };

  it("slides the one new feed line in on a data refresh, and no other line moves (item 7)", async () => {
    const id = "pr8a-feed-refresh";
    const page = await signedIn();
    await watchNewLines(page);
    await page.clock.install();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await motionReady(page);
    // The first load marks no line new.
    expect(await newMarks(page)).toEqual([]);
    // Each row names its place, so a row can be followed across the refresh.
    await page
      .locator(".ov-lately li")
      .evaluateAll((lis) => lis.forEach((li, i) => li.setAttribute("data-probe", String(i))));
    const oldFirst = oneLine(await page.locator('.ov-lately li[data-probe="0"]').textContent());
    try {
      await refreshFeed(page, id);
      // The refresh has landed when the new line is in the list (before any marking is judged).
      await expect
        .poll(() => page.locator(".ov-lately li", { hasText: "Vulnerability cleared" }).count(), {
          timeout: 10_000,
        })
        .toBe(1);
      await expect.poll(() => newMarks(page), { timeout: 10_000 }).toHaveLength(1);
      expect((await newMarks(page))[0]).toContain("Vulnerability cleared");
      expect(await page.locator(".ov-lately li[data-new]").count()).toBe(1);
      // The new line slides in with the feed's animation.
      const names = await page.waitForFunction(
        () => {
          const el = document.querySelector<HTMLElement>(".ov-lately li[data-new]");
          const found = el ? el.getAnimations().map((a) => (a as CSSAnimation).animationName) : [];
          return found.length > 0 ? found : null;
        },
        undefined,
        { timeout: 5_000 },
      );
      expect(await names.jsonValue()).toEqual(["ov-feed-in"]);
      // The other lines carry no animation.
      const others = await page
        .locator(".ov-lately li:not([data-new])")
        .evaluateAll((lis) => lis.map((li) => li.getAnimations().length));
      expect(others.length).toBeGreaterThan(0);
      expect(others.every((n) => n === 0)).toBe(true);
      // The line that was first is still the same row, one place down: keyed by its line, not its place.
      expect(oneLine(await page.locator('.ov-lately li[data-probe="0"]').textContent())).toBe(
        oldFirst,
      );
    } finally {
      await removeFeedEvent(id);
    }
  });

  it("under reduced motion the new feed line is marked but nothing animates (item 7)", async () => {
    const id = "pr8a-feed-still";
    const page = await signedIn("op", { reducedMotion: "reduce" });
    await watchNewLines(page);
    await page.clock.install();
    await page.goto(`${origin}/`);
    await motionReady(page);
    expect(await newMarks(page)).toEqual([]);
    try {
      await refreshFeed(page, id);
      await expect
        .poll(() => page.locator(".ov-lately li", { hasText: "Vulnerability cleared" }).count(), {
          timeout: 10_000,
        })
        .toBe(1);
      await expect.poll(() => newMarks(page), { timeout: 10_000 }).toHaveLength(1);
      expect(await page.locator(".ov-lately li[data-new]").count()).toBe(1);
      const running = await page
        .locator(".ov-lately li")
        .evaluateAll((lis) => lis.map((li) => li.getAnimations().length));
      expect(running.every((n) => n === 0)).toBe(true);
    } finally {
      await removeFeedEvent(id);
    }
  });
});

describe("PR 8c, How this works motion", () => {
  /** Each step's data-lit, in order. */
  const litFlags = (page: Page) =>
    page
      .locator("ol.how-steps > li")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-lit")));
  /** The script's marker, set in the same effect that attaches the observer (never server-rendered). */
  const stepsScripted = (page: Page) =>
    page.locator('ol.how-steps[data-js="true"]').waitFor({ state: "attached" });
  /** Brings step i to the middle of the viewport, so it is well past the 0.6 threshold. */
  const scrollToStep = (page: Page, i: number) =>
    page
      .locator("ol.how-steps > li")
      .nth(i)
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
  /** The WCAG contrast ratio of two computed rgb(...) colours. */
  const contrast = (a: string, b: string) => {
    const lum = (rgb: string) => {
      const [r, g, bl] = rgb
        .match(/\d+(\.\d+)?/g)!
        .slice(0, 3)
        .map((x) => Number(x) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  it("on load at 1280x700, the steps below the fold are unlit, and scrolling each into view lights it", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${origin}/how`);
    await stepsScripted(page);
    const below = await page
      .locator("ol.how-steps > li")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top >= window.innerHeight));
    expect(below.some(Boolean), "the premise: at least one step is below the fold").toBe(true);
    const before = await litFlags(page);
    below.forEach((isBelow, i) =>
      expect(before[i], `step ${i} below the fold is unlit on load`).toBe(
        isBelow ? "false" : "true",
      ),
    );
    for (let i = 0; i < below.length; i++) {
      await scrollToStep(page, i);
      await expect
        .poll(async () => (await litFlags(page))[i], { message: `step ${i} lights once in view` })
        .toBe("true");
    }
  });

  it("step k never lights before step k-1", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${origin}/how`);
    await stepsScripted(page);
    // Record the order in which steps turn lit after the observer is installed.
    await page.evaluate(() => {
      const ol = document.querySelector("ol.how-steps")!;
      const items = Array.from(ol.children);
      const order: number[] = [];
      (window as unknown as { __lightOrder: number[] }).__lightOrder = order;
      new MutationObserver((records) => {
        for (const r of records) {
          const el = r.target as Element;
          if (el.getAttribute("data-lit") === "true" && r.oldValue !== "true")
            order.push(items.indexOf(el));
        }
      }).observe(ol, {
        attributes: true,
        attributeFilter: ["data-lit"],
        attributeOldValue: true,
        subtree: true,
      });
    });
    // The last step first: it is in view, but every step above it must light before it does.
    const n = await page.locator("ol.how-steps > li").count();
    await scrollToStep(page, n - 1);
    await expect.poll(async () => (await litFlags(page)).every((f) => f === "true")).toBe(true);
    const order = await page.evaluate(
      () => (window as unknown as { __lightOrder: number[] }).__lightOrder,
    );
    expect(order.length, "some steps lit after the observer was installed").toBeGreaterThan(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("each step's light takes 300 ms, the transition's length", async () => {
    const page = await signedIn();
    await page.goto(`${origin}/how`);
    await stepsScripted(page);
    const duration = await page
      .locator("ol.how-steps > li")
      .first()
      .evaluate((el) => getComputedStyle(el, "::before").transitionDuration);
    expect(duration.split(",")[0]).toBe("0.3s");
  });

  it("under reduced motion nothing moves: every step is lit on load, and nothing is animating", async () => {
    const page = await signedIn("op", { reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${origin}/how`);
    await stepsScripted(page);
    expect(new Set(await litFlags(page)), "every step lit on load").toEqual(new Set(["true"]));
    const n = await page.locator("ol.how-steps > li").count();
    await scrollToStep(page, n - 1);
    expect(
      (await litFlags(page)).every((f) => f === "true"),
      "every step lit after scrolling to the last",
    ).toBe(true);
    const running = await page
      .locator("ol.how-steps, ol.how-steps *")
      .evaluateAll((els) => els.reduce((k, el) => k + el.getAnimations().length, 0));
    expect(running, "no animation is running under reduced motion").toBe(0);
  });

  it("with no script, the server render shows every step lit and no script marker", async () => {
    const page = await signedIn("op", { javaScriptEnabled: false });
    await page.goto(`${origin}/how`);
    const html = await page.content();
    expect(html.match(/<ol class="how-steps"[^>]*>/)![0]).not.toContain("data-js");
    expect((html.match(/data-lit="true"/g) ?? []).length).toBe(8);
    expect(html).not.toContain('data-lit="false"');
  });

  it("an unlit step keeps its result in the DOM, and its muted text meets 4.5:1 on its panel in both themes", async () => {
    for (const colorScheme of ["light", "dark"] as const) {
      const page = await signedIn("op", { colorScheme });
      await page.setViewportSize({ width: 1280, height: 700 });
      await page.goto(`${origin}/how`);
      await stepsScripted(page);
      const unlit = await page.locator("ol.how-steps > li[data-lit='false']").evaluateAll((els) =>
        els.map((el) => {
          const result = el.querySelector(".how-step-last")!;
          return {
            text: result.textContent?.trim() ?? "",
            display: getComputedStyle(result).display,
            visibility: getComputedStyle(result).visibility,
            color: getComputedStyle(result).color,
            panel: getComputedStyle(el).backgroundColor,
          };
        }),
      );
      expect(unlit.length, `${colorScheme}: some steps are unlit below the fold`).toBeGreaterThan(
        0,
      );
      for (const u of unlit) {
        expect(u.text.length, `${colorScheme}: the result text is in the DOM`).toBeGreaterThan(0);
        expect(u.display, `${colorScheme}: the result is not display:none`).not.toBe("none");
        expect(u.visibility, `${colorScheme}: the result is not hidden`).not.toBe("hidden");
        expect(
          contrast(u.color, u.panel),
          `${colorScheme}: unlit result ${u.color} on ${u.panel}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      await page.close();
    }
  });

  // PR 8c item 9: a lead's journey. The dot runs once, Replay restarts it, and the branch is a
  // disclosure. Nothing here moves under reduced motion, and the server render shows the end state.
  /** The dot's running and finished animations, with their timing. */
  const dotAnimations = (page: Page) =>
    page.locator("section.how-lead .how-dot").evaluate((el) =>
      el.getAnimations().map((a) => {
        const t = (a.effect as KeyframeEffect).getTiming();
        return { playState: a.playState, duration: t.duration, iterations: t.iterations };
      }),
    );
  /** The script's marker on the lead flow, set in the same effect that attaches the listeners. */
  const leadScripted = (page: Page) =>
    page.locator('ol.how-lead-flow[data-js="true"]').waitFor({ state: "attached" });
  /** Brings the lead chapter to the middle of the viewport, well past the 0.6 threshold. */
  const scrollToLead = (page: Page) =>
    page.locator("section.how-lead").evaluate((el) => el.scrollIntoView({ block: "center" }));

  it("the lead's dot starts when the chapter is 0.6 in view, runs once in 3.5 s, and rests at the inbox", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${origin}/how`);
    await leadScripted(page);
    const below = await page
      .locator("section.how-lead")
      .evaluate((el) => el.getBoundingClientRect().top >= window.innerHeight);
    expect(below, "the premise: the lead chapter is below the fold on load").toBe(true);
    expect(await dotAnimations(page), "the dot does not run before the chapter is in view").toEqual(
      [],
    );
    await scrollToLead(page);
    await expect
      .poll(async () => (await dotAnimations(page)).length, { message: "the dot starts once" })
      .toBe(1);
    const [run] = await dotAnimations(page);
    expect(run!.duration, "the run's length is LEAD_DOT_MS, 3.5 s").toBe(3500);
    expect(run!.iterations, "the run is not a loop").toBe(1);
    await expect
      .poll(async () => (await dotAnimations(page))[0]?.playState, { timeout: 4_500 })
      .toBe("finished");
    const dot = page.locator("section.how-lead .how-dot");
    expect(await dot.getAttribute("aria-hidden")).toBe("true");
    expect(await dot.isVisible(), "the dot is shown once the script runs").toBe(true);
  });

  it("Replay restarts the run from the form", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${origin}/how`);
    await leadScripted(page);
    await scrollToLead(page);
    await expect
      .poll(async () => (await dotAnimations(page))[0]?.playState, { timeout: 4_500 })
      .toBe("finished");
    const replay = page.locator("section.how-lead button.how-replay");
    expect(await replay.isVisible(), "Replay is shown once the script runs").toBe(true);
    expect(await replay.getAttribute("type")).toBe("button");
    await replay.click();
    const again = await page.evaluate(() => {
      const [a] = document.querySelector("section.how-lead .how-dot")!.getAnimations();
      return { playState: a?.playState, currentTime: a?.currentTime ?? null };
    });
    expect(again.playState, "Replay starts a new run").toBe("running");
    expect(again.currentTime, "the new run starts at the form").toBeLessThan(1000);
  });

  it("under reduced motion nothing moves: no dot, no Replay, no running animation, and no stage is marked", async () => {
    const page = await signedIn("op", { reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${origin}/how`);
    await leadScripted(page);
    await scrollToLead(page);
    expect(await page.locator("section.how-lead .how-dot").isVisible(), "hidden").toBe(false);
    expect(await page.locator("section.how-lead button.how-replay").isVisible(), "hidden").toBe(
      false,
    );
    expect(await dotAnimations(page)).toEqual([]);
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === "running").length,
    );
    expect(running, "no animation is running under reduced motion").toBe(0);
    expect(
      await page.locator("ol.how-lead-flow [data-passed]").count(),
      "no stage is marked as passed",
    ).toBe(0);
  });

  it("the branch is closed on the client, and its button toggles it by mouse, Enter and Space", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${origin}/how`);
    await leadScripted(page);
    const toggle = page.locator("section.how-lead button.how-branch-toggle");
    const region = page.locator("#how-branch-text");
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
    expect(await region.isVisible(), "closed on the client").toBe(false);
    await toggle.click();
    expect(await toggle.getAttribute("aria-expanded")).toBe("true");
    expect((await region.textContent())?.replace(/\s+/g, " ").trim()).toBe(
      "If an email to the client fails, the lead is still kept in our own inbox, and repeated bounces raise an alarm for us.",
    );
    await toggle.focus();
    await page.keyboard.press("Enter");
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
    expect(await region.isVisible(), "hidden").toBe(false);
    await page.keyboard.press("Space");
    expect(await toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await region.isVisible(), "visible").toBe(true);
  });

  it("with no script, the branch is open with its text, and Replay and the dot are hidden", async () => {
    const page = await signedIn("op", { javaScriptEnabled: false });
    await page.goto(`${origin}/how`);
    expect(
      await page.locator("section.how-lead button.how-branch-toggle").getAttribute("aria-expanded"),
    ).toBe("true");
    expect(await page.locator("#how-branch-text").isVisible(), "visible").toBe(true);
    expect(await page.locator("section.how-lead button.how-replay").isVisible(), "hidden").toBe(
      false,
    );
    expect(await page.locator("section.how-lead .how-dot").isVisible(), "hidden").toBe(false);
  });

  // PR 8c item 10: the ladder's levels are disclosures. Each opens its panel (today's sites and
  // the 21-night line); Escape closes an open panel and returns focus to its button.
  /** The script's marker on the ladder, set in the same effect that attaches its listeners. */
  const ladderScripted = (page: Page) =>
    page.locator('ol.how-ladder[data-js="true"]').waitFor({ state: "attached" });
  const levelButton = (page: Page, tier: string) =>
    page.locator(`ol.how-ladder button.how-level[data-level="${tier}"]`);
  const levelPanel = (page: Page, tier: string) => page.locator(`#how-level-${tier}`);

  it("each level's button opens its panel by click, Enter and Space, and Escape closes it and returns focus", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${origin}/how`);
    await ladderScripted(page);
    for (const tier of ["ok", "watch", "attention", "broken"]) {
      expect(
        await levelButton(page, tier).getAttribute("aria-expanded"),
        `${tier} starts closed`,
      ).toBe("false");
      expect(await levelPanel(page, tier).isVisible(), `${tier} panel closed`).toBe(false);
    }
    await levelButton(page, "broken").click();
    expect(await levelButton(page, "broken").getAttribute("aria-expanded")).toBe("true");
    expect(await levelPanel(page, "broken").isVisible(), "panel open after click").toBe(true);
    expect(await levelPanel(page, "ok").isVisible(), "other levels stay closed").toBe(false);
    await page.keyboard.press("Escape");
    expect(await levelButton(page, "broken").getAttribute("aria-expanded"), "Escape closes").toBe(
      "false",
    );
    expect(await levelPanel(page, "broken").isVisible()).toBe(false);
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute("data-level")),
      "focus returns to the level's button",
    ).toBe("broken");
    await levelButton(page, "attention").focus();
    await page.keyboard.press("Enter");
    expect(await levelButton(page, "attention").getAttribute("aria-expanded")).toBe("true");
    await page.keyboard.press("Space");
    expect(await levelButton(page, "attention").getAttribute("aria-expanded")).toBe("false");
  });

  it("opening fades in over 200 ms under motion, and under reduced motion it opens at once with no animation", async () => {
    const page = await signedIn();
    await page.goto(`${origin}/how`);
    await ladderScripted(page);
    await levelButton(page, "ok").click();
    const [anim] = await levelPanel(page, "ok").evaluate((el) =>
      el
        .getAnimations()
        .map((a) => ({ duration: (a.effect as KeyframeEffect).getTiming().duration })),
    );
    expect(anim?.duration, "the open runs 200 ms").toBe(200);

    const still = await signedIn("op", { reducedMotion: "reduce" });
    await still.goto(`${origin}/how`);
    await ladderScripted(still);
    await levelButton(still, "ok").click();
    expect(await levelPanel(still, "ok").isVisible(), "open at once").toBe(true);
    const running = await still.evaluate(
      () => document.getAnimations().filter((a) => a.playState === "running").length,
    );
    expect(running, "no animation under reduced motion").toBe(0);
  });

  it("with no script, every level's panel is open, with its sites and nights line", async () => {
    const page = await signedIn("op", { javaScriptEnabled: false });
    await page.goto(`${origin}/how`);
    for (const tier of ["ok", "watch", "attention", "broken"]) {
      expect(await levelButton(page, tier).getAttribute("aria-expanded")).toBe("true");
      expect(await levelPanel(page, tier).isVisible(), `${tier} panel visible`).toBe(true);
    }
    expect(await levelPanel(page, "ok").textContent()).toContain("every check passing");
  });
});
