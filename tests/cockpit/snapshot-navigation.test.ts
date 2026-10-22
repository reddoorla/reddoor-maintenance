import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { openDb } from "../../src/db/client.js";

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

/** The newest file the cockpit build reads: its own sources and the shared `src/`. */
function newestSource(): number {
  let newest = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  walk(join(ROOT, "cockpit/src"));
  walk(join(ROOT, "src"));
  return newest;
}

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
  await db
    .insertInto("submissions")
    .values({
      id: "sub-auto",
      site_id: "recB",
      form_type: "contact",
      name: "Sam",
      email: "sam@filtered.example",
      message: "Hello",
      status: "spam_auto",
      spam_score: 7,
      spam_reason: "links",
      notify_status: "skipped",
      submitted_at: new Date().toISOString(),
    } as never)
    .execute();
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

async function signedIn(): Promise<Page> {
  // The gate redirects rather than challenging, so the header goes on every request.
  const context = await browser.newContext({
    extraHTTPHeaders: {
      authorization: `Basic ${Buffer.from(`op:${PASSWORD}`).toString("base64")}`,
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

    const first = await page.goto(`${origin}/`);
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
    await follow(page, "/", "fleet cockpit");

    expect(data).toEqual([]);
    expect(documents).toEqual([`${origin}/`]);
  });

  it("a page's stylesheets leave with it", async () => {
    const page = await signedIn();
    await page.goto(`${origin}/s/acme`);
    await page.waitForLoadState("networkidle");
    const siteSheets = await pageSheets(page);
    // base + site + submission
    expect(siteSheets.length).toBe(3);

    await follow(page, "/audits", "Prospect audits");
    const auditSheets = await pageSheets(page);
    // base + audits; none of the site page's sheets is still in the head.
    expect(auditSheets.length).toBe(2);
    for (const sheet of siteSheets.slice(1)) expect(auditSheets).not.toContain(sheet);
    expect(auditSheets[0]).toBe(siteSheets[0]);
    // However a sheet arrived (an inline <style> or a <link>), none of the site
    // page's rules applies now. `.tiles` is the site page's alone.
    const selectors = (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.styleSheets].flatMap((sh) =>
          [...sh.cssRules].map((r) => (r as CSSStyleRule).selectorText ?? ""),
        ),
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

  it("after a change, the page shows it at once, with no full load", async () => {
    const page = await signedIn();
    const documents: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
    });
    await page.goto(`${origin}/submissions?status=new`);
    await page.waitForLoadState("networkidle");
    const row = page.locator("li.subm-item", { hasText: "pat@example.com" });
    expect(await row.count()).toBe(1);
    const posted = page.waitForResponse((r) => r.url().includes("/api/submissions/"));
    const reread = page.waitForResponse((r) => r.url().includes("__data.json"));
    await row.locator("button", { hasText: /^Archive$/ }).click();
    expect((await posted).status()).toBe(200);
    // The snapshot is read again and this very page re-derives: the lead has left
    // the "new" bucket without a reload.
    expect((await reread).status()).toBe(200);
    await expect.poll(() => row.count(), { timeout: 10_000 }).toBe(0);
    await follow(page, "/submissions", "Submissions");
    await expect
      .poll(
        () => page.locator("li.subm-item", { hasText: "pat@example.com" }).first().textContent(),
        {
          timeout: 10_000,
        },
      )
      .toContain("archived");
    expect(documents).toEqual(["/submissions"]);
  });

  it("after a change, Back and Forward show it too, still without a full load", async () => {
    const page = await signedIn();
    const documents: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
    });
    await page.goto(`${origin}/`);
    await page.waitForLoadState("networkidle");
    await follow(page, "/submissions", "Submissions");
    const posted = page.waitForResponse((r) => r.url().includes("/api/submissions/"));
    const reread = page.waitForResponse((r) => r.url().includes("__data.json"));
    await page
      .locator("li.subm-item", { hasText: "pat@example.com" })
      .locator("button", { hasText: /^Spam$/ })
      .click();
    expect((await posted).status()).toBe(200);
    await reread;
    await page.goBack();
    await page.waitForURL(`${origin}/`);
    await page.goForward();
    await page.waitForURL(`${origin}/submissions`);
    const row = page.locator("li.subm-item", { hasText: "pat@example.com" }).first();
    await expect.poll(() => row.textContent(), { timeout: 10_000 }).toContain("spam");
    expect(documents).toEqual(["/"]);
  });

  it("on focus: nothing changed reads only the counter; a lead written elsewhere shows", async () => {
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
    const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));

    // Nothing written since the page loaded: one counter read, no snapshot read.
    await focus();
    await expect.poll(() => checks.length, { timeout: 10_000 }).toBe(1);
    await page.waitForLoadState("networkidle");
    expect(checks).toEqual([200]);
    expect(data).toEqual([]);

    // Another writer (the form-ingest path, here directly) adds a lead.
    const db = await openDb({ url: process.env.TURSO_DATABASE_URL ?? "" });
    await db
      .insertInto("submissions")
      .values({
        id: "sub-elsewhere",
        site_id: "recB",
        form_type: "contact",
        name: "Robin",
        email: "robin@elsewhere.example",
        status: "new",
        notify_status: "sent",
        submitted_at: new Date().toISOString(),
      } as never)
      .execute();
    await db.destroy();
    await focus();
    await expect.poll(() => data.length, { timeout: 10_000 }).toBe(1);
    await expect
      .poll(() => page.content(), { timeout: 10_000 })
      .toContain("robin@elsewhere.example");
  });

  it("after a change a row's buttons post what they say, and the page remounts", async () => {
    // Review round 1: buttons keyed by position kept their old labels over the
    // next button's action once the row re-derived ("Archive" posted spam).
    const page = await signedIn();
    await page.goto(`${origin}/submissions`);
    await page.waitForLoadState("networkidle");
    await page.$eval("h1", (h) => h.setAttribute("data-this-mount", ""));
    const row = page.locator("li.subm-item", { hasText: "sam@filtered.example" });
    const posted = page.waitForResponse((r) => r.url().includes("/api/submissions/"));
    const reread = page.waitForResponse((r) => r.url().includes("__data.json"));
    await row.locator("button", { hasText: "Not spam" }).click();
    expect((await posted).status()).toBe(200);
    await reread;
    // A fresh snapshot remounts the page, as a fresh load would.
    await expect.poll(() => page.$$("h1[data-this-mount]").then((h) => h.length)).toBe(0);
    await expect.poll(() => row.locator("button", { hasText: "Not spam" }).count()).toBe(0);
    const buttons = await row
      .locator("button.subm-status")
      .evaluateAll((els) => els.map((b) => [b.textContent?.trim(), b.getAttribute("data-status")]));
    expect(buttons).toEqual([
      ["Read", "read"],
      ["Archive", "archived"],
      ["Spam", "spam"],
    ]);
  });

  it("an unchanged check keeps the page as it is; a refresh waits while a field is in use", async () => {
    const page = await signedIn();
    const data: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("__data.json")) data.push(r.url());
    });
    await page.goto(`${origin}/s/acme`);
    await page.waitForLoadState("networkidle");
    await page.$eval("h1", (h) => h.setAttribute("data-this-mount", ""));
    const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const versionAnswer = () =>
      page.waitForResponse((r) => r.url().endsWith("/api/cockpit/version"));

    // Nothing changed: the page is not remounted.
    const answered = versionAnswer();
    await focus();
    await answered;
    await page.waitForLoadState("networkidle");
    expect(await page.$$("h1[data-this-mount]")).toHaveLength(1);
    expect(data).toEqual([]);

    // The operator starts typing in a field; meanwhile a lead arrives elsewhere.
    const field = page.locator("input[data-detail-field='pointOfContact']");
    await field.click();
    await field.pressSequentially("Half-typed");
    const db = await openDb({ url: process.env.TURSO_DATABASE_URL ?? "" });
    await db
      .insertInto("submissions")
      .values({
        id: "sub-while-typing",
        site_id: "recB",
        form_type: "contact",
        name: "Kai",
        email: "kai@elsewhere.example",
        status: "new",
        notify_status: "sent",
        submitted_at: new Date().toISOString(),
      } as never)
      .execute();
    await db.destroy();
    await focus();
    await page.waitForTimeout(500);
    // No refresh while the field is in use: the text stays, the page stays.
    expect(data).toEqual([]);
    expect(await field.inputValue()).toBe("Half-typed");
    expect(await page.$$("h1[data-this-mount]")).toHaveLength(1);
    // The operator moves on to a non-field (the page heading): the refresh runs
    // (the field's own save posts first, as it always did on blur).
    await page.locator("h1").click();
    await expect.poll(() => data.length, { timeout: 10_000 }).toBeGreaterThan(0);
  });

  it("a failed save keeps what the operator typed and its ✗; the page is not remounted", async () => {
    // Review round 2: a refresh after every post remounted the page, so a save
    // the server refused put the stored value back and dropped the ✗, and the
    // retry on the next blur (DetailField) never came.
    const page = await signedIn();
    await page.route("**/api/sites/acme/details", (r) => r.fulfill({ status: 500, body: "down" }));
    const data: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("__data.json")) data.push(r.url());
    });
    await page.goto(`${origin}/s/acme`);
    await page.waitForLoadState("networkidle");
    await page.$eval("h1", (h) => h.setAttribute("data-this-mount", ""));
    const field = page.locator("input[data-detail-field='url']");
    await field.fill("operator typed this");
    const posted = page.waitForResponse((r) => r.url().endsWith("/api/sites/acme/details"));
    await page.locator("h1").click();
    expect((await posted).status()).toBe(500);
    // The action still reads the snapshot again; the counter has not moved.
    await expect.poll(() => data.length, { timeout: 10_000 }).toBe(1);
    await page.waitForLoadState("networkidle");
    expect(await field.inputValue()).toBe("operator typed this");
    expect(await page.locator(".detail-saved[data-for='url']").textContent()).toContain("✗");
    expect(await page.$$("h1[data-this-mount]")).toHaveLength(1);
  });

  it("a failed save keeps its text and ✗ through a remount for an earlier save of its own", async () => {
    // Review round 3: the operator saves one field, tabs to the next, and that
    // save fails; the refresh the first save left waiting remounted the page
    // (the counter had moved) and took the second field's text and ✗ with it.
    const page = await signedIn();
    await page.route("**/api/sites/acme/details", async (r) => {
      const body = r.request().postDataJSON() as { field?: string };
      if (body.field !== "pointOfContact") return r.continue();
      // Slower than the snapshot read, so a remount that did not wait for the
      // answer would land before it, and its ✗ with the old field.
      await new Promise((done) => setTimeout(done, 1500));
      return r.fulfill({ status: 500, body: "down" });
    });
    await page.goto(`${origin}/s/acme`);
    await page.waitForLoadState("networkidle");
    await page.$eval("h1", (h) => h.setAttribute("data-this-mount", ""));
    const url = page.locator("input[data-detail-field='url']");
    const contact = page.locator("input[data-detail-field='pointOfContact']");
    await url.fill("https://acme.example.org");
    const first = page.waitForResponse((r) => r.url().endsWith("/api/sites/acme/details"));
    await contact.click();
    expect((await first).status()).toBe(200);
    await contact.fill("Typed B");
    const second = page.waitForResponse((r) => r.url().endsWith("/api/sites/acme/details"));
    await page.locator("h1").click();
    expect((await second).status()).toBe(500);
    // The first save moved the counter: the page remounts, and keeps B.
    await expect
      .poll(() => page.$$("h1[data-this-mount]").then((h) => h.length), { timeout: 10_000 })
      .toBe(0);
    expect(await url.inputValue()).toBe("https://acme.example.org");
    expect(await contact.inputValue()).toBe("Typed B");
    expect(await page.locator(".detail-saved[data-for='pointOfContact']").textContent()).toContain(
      "✗",
    );
  });

  it("a failed save keeps its text and ✗ through a remount for a write elsewhere", async () => {
    const page = await signedIn();
    await page.route("**/api/sites/acme/details", (r) => r.fulfill({ status: 500, body: "down" }));
    await page.goto(`${origin}/s/acme`);
    await page.waitForLoadState("networkidle");
    await page.$eval("h1", (h) => h.setAttribute("data-this-mount", ""));
    const contact = page.locator("input[data-detail-field='pointOfContact']");
    await contact.fill("Typed elsewhere");
    const posted = page.waitForResponse((r) => r.url().endsWith("/api/sites/acme/details"));
    await page.locator("h1").click();
    expect((await posted).status()).toBe(500);
    await page.waitForLoadState("networkidle");
    const db = await openDb({ url: process.env.TURSO_DATABASE_URL ?? "" });
    await db
      .updateTable("sites")
      .set({ name: "Beta, once more" } as never)
      .where("id", "=", "recB")
      .execute();
    await db.destroy();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect
      .poll(() => page.$$("h1[data-this-mount]").then((h) => h.length), { timeout: 10_000 })
      .toBe(0);
    expect(await contact.inputValue()).toBe("Typed elsewhere");
    expect(await page.locator(".detail-saved[data-for='pointOfContact']").textContent()).toContain(
      "✗",
    );
    // And the next blur retries it, as before.
    const retried = page.waitForResponse((r) => r.url().endsWith("/api/sites/acme/details"));
    await contact.click();
    await page.locator("h1").click();
    expect(JSON.parse((await retried).request().postData() ?? "{}")).toEqual({
      field: "pointOfContact",
      value: "Typed elsewhere",
    });
  });

  it("a read that lands while the operator has stepped into a field waits for them", async () => {
    // Review round 3: a check already under way when the operator clicked into
    // a field remounted the page under their cursor.
    const page = await signedIn();
    await page.goto(`${origin}/s/acme`);
    await page.waitForLoadState("networkidle");
    await page.$eval("h1", (h) => h.setAttribute("data-this-mount", ""));
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/__data.json*", async (r) => {
      await held;
      await r.continue();
    });
    const db = await openDb({ url: process.env.TURSO_DATABASE_URL ?? "" });
    await db
      .updateTable("sites")
      .set({ name: "Beta, while typing" } as never)
      .where("id", "=", "recB")
      .execute();
    await db.destroy();
    const read = page.waitForResponse((r) => r.url().includes("__data.json"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForRequest((r) => r.url().includes("__data.json"));
    const contact = page.locator("input[data-detail-field='pointOfContact']");
    const stored = await contact.inputValue();
    await contact.click();
    await contact.pressSequentially("half typed");
    release();
    await read;
    await page.waitForTimeout(300);
    expect(await page.$$("h1[data-this-mount]")).toHaveLength(1);
    expect(await contact.inputValue()).toContain("half typed");
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute("data-detail-field")),
    ).toBe("pointOfContact");
    // Once they leave the field, the remount it held goes ahead: here with no
    // save (the text put back as it was), so leaving is all that releases it.
    await page.unroute("**/__data.json*");
    await contact.fill(stored);
    const saves: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/sites/acme/details")) saves.push(r.url());
    });
    await page.locator("h1").click();
    await expect
      .poll(() => page.$$("h1[data-this-mount]").then((h) => h.length), { timeout: 10_000 })
      .toBe(0);
    expect(saves).toEqual([]);
  });

  it("a change elsewhere redraws the page, keeping the open lead and the chip filter", async () => {
    // Review round 2: the remount for a fresh snapshot closed every open
    // <details> and reset the page's own filters whenever anyone wrote.
    const page = await signedIn();
    const data: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("__data.json")) data.push(r.url());
    });
    const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const elsewhere = async (name: string) => {
      const db = await openDb({ url: process.env.TURSO_DATABASE_URL ?? "" });
      await db
        .updateTable("sites")
        .set({ name } as never)
        .where("id", "=", "recB")
        .execute();
      await db.destroy();
    };

    await page.goto(`${origin}/submissions`);
    await page.waitForLoadState("networkidle");
    await page.$eval("h1", (h) => h.setAttribute("data-this-mount", ""));
    const lead = page.locator("li.subm-item", { hasText: "sam@filtered.example" });
    await lead.locator("summary").click();
    // Which leads are open, by the submission their buttons act on.
    const openLeads = () =>
      page.$$eval("li.subm-item details[open]", (els) =>
        els.map((e) => e.parentElement?.querySelector("[data-id]")?.getAttribute("data-id")),
      );
    const before = await openLeads();
    expect(before).toHaveLength(1);
    await elsewhere("Beta, renamed");
    await focus();
    await expect.poll(() => data.length, { timeout: 10_000 }).toBe(1);
    // Redrawn from the new snapshot (a fresh mount), with the same lead open.
    await expect.poll(() => page.$$("h1[data-this-mount]").then((h) => h.length)).toBe(0);
    expect(await openLeads()).toEqual(before);

    await page.goto(`${origin}/fleet`);
    await page.waitForLoadState("networkidle");
    const chip = page
      .locator(".signal-filters button[data-filter]:not([data-filter='all'])")
      .first();
    const picked = await chip.getAttribute("data-filter");
    await chip.click();
    await page.$eval("h1", (h) => h.setAttribute("data-this-mount", ""));
    await elsewhere("Beta, renamed again");
    await focus();
    await expect
      .poll(() => page.$$("h1[data-this-mount]").then((h) => h.length), {
        timeout: 10_000,
      })
      .toBe(0);
    expect(
      await page
        .locator(`.signal-filters button[data-filter='${picked}']`)
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("a signed-out browser gets no snapshot", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const res = await page.request.get(`${origin}/__data.json`, { maxRedirects: 0 });
    // The hook answers before any load runs; for a data request SvelteKit's
    // client expects a redirect as JSON.
    expect(await res.json()).toEqual({ type: "redirect", location: "/auth/login?returnTo=%2F" });
  });
});
