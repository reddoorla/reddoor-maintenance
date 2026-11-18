import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

async function signedIn(user = "op", options: BrowserContextOptions = {}): Promise<Page> {
  // The gate redirects rather than challenging, so the header goes on every request.
  const context = await browser.newContext({
    ...options,
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
      // The first screen's health panel and its six number tiles (P1-87 PR 3).
      expect(await page.locator(".ov-health").count()).toBe(1);
      expect(await page.locator(".ov-tile").count()).toBe(6);
      expect(await page.locator(".ov-leads-sites tbody th", { hasText: LONG_NAME }).count()).toBe(
        1,
      );
      // P1-78h: section 8 draws its four charts, so they are laid out here too.
      expect(await page.locator("figure.ov-trend svg.ov-chart").count()).toBe(4);
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

  it("moves, with the seeded sites in its row", async () => {
    const page = await signedIn();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/`);
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(3);
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
      const page = await signedIn();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await expect
        .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
        .toBeGreaterThanOrEqual(2);
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
      const page = await signedIn();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await expect
        .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
        .toBeGreaterThanOrEqual(2);
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
      const page = await signedIn();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await expect
        .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
        .toBeGreaterThanOrEqual(2);
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
      const page = await signedIn();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await expect
        .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
        .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
      const page = await signedIn("op", { hasTouch: true, isMobile: touch });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await expect
        .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
        .toBeGreaterThanOrEqual(3);
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
      const page = await signedIn();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${origin}/`);
      await expect
        .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
        .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
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
      doc: ["keydown", "pointerup", "pointercancel"],
      win: ["focusin", "focusout", "pointerdown", "pointerleave"],
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
    await expect
      .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
      .toBeGreaterThanOrEqual(2);
    const first = await counts(page);
    expect(first.doc, "one of each on / after the first load").toEqual({
      keydown: 1,
      pointerup: 1,
      pointercancel: 1,
    });
    expect(first.win, "one of each on the ticker window after the first load").toEqual({
      focusin: 1,
      focusout: 1,
      pointerdown: 1,
      pointerleave: 1,
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
      });
      await page.goBack();
      await page.waitForURL(`${origin}/`);
      await expect
        .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
        .toBeGreaterThanOrEqual(2);
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
      const page = await signedIn("op", { hasTouch: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await expect
        .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
        .toBeGreaterThanOrEqual(2);
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
      expect(Date.now() - tapped, `a link has focus within 300 ms of the tap at ${width}px`).toBeLessThan(300);
      expect(await inMovingList(page), `a ticker link has focus at ${width}px`).toBe(true);
      expect(
        await page.evaluate(() => document.activeElement!.matches(":focus-visible")),
        `the focused link is :focus-visible at ${width}px`,
      ).toBe(true);
      expect(await inWindow(page), `the focused link is in the window at once at ${width}px`).toBe(
        true,
      );
      await expect
        .poll(() => stillSet(page), {
          message: `the row stands still once the window has ended, at ${width}px`,
          timeout: 3_000,
        })
        .toBe(true);
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
      const page = await signedIn("op", { hasTouch: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/`);
      await expect
        .poll(() => page.locator(".ov-ticker-list:not(.copy) > li").count())
        .toBeGreaterThanOrEqual(2);
      await page.locator(".ov-ticker-pause").focus();
      // The press lands on the text of the moving list (a pill or a fact, never a link), inside the window.
      // The row moves, so the spot is polled for rather than read once.
      const findFact = () =>
        page.evaluate(() => {
          const win = document.querySelector(".ov-ticker-window")!.getBoundingClientRect();
          for (const f of document.querySelectorAll(".ov-ticker-list:not(.copy) .pill, .ov-ticker-list:not(.copy) .ov-ticker-fact")) {
            const r = f.getBoundingClientRect();
            const x = (r.left + r.right) / 2;
            const y = (r.top + r.bottom) / 2;
            const inside =
              r.left >= win.left && r.right <= win.right && r.top >= win.top && r.bottom <= win.bottom;
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
      expect(Date.now() - released, `the Tab follows the release within 200 ms at ${width}px`).toBeLessThan(200);
      expect(
        await page.evaluate(() => {
          const a = document.activeElement;
          return a instanceof HTMLAnchorElement && a.closest(".ov-ticker-list:not(.copy)") !== null && a.matches(":focus-visible");
        }),
        `a ticker link has keyboard focus at ${width}px`,
      ).toBe(true);
      const stillAt = await page.evaluate(
        () =>
          new Promise<number | null>((done) => {
            const start = performance.now();
            const tick = () => {
              if (document.querySelector(".ov-ticker-window")!.hasAttribute("data-still")) {
                return done(performance.now() - (window as Window & { __rel?: number }).__rel!);
              }
              if (performance.now() - start > 5_000) return done(null);
              requestAnimationFrame(tick);
            };
            tick();
          }),
      );
      expect(stillAt, `the row stands still within 5 s at ${width}px`).not.toBeNull();
      expect(stillAt!, `the row stands still by 1.6 s after the release at ${width}px`).toBeLessThanOrEqual(1_600);
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
});
