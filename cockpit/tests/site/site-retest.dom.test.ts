import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Page from "../../src/routes/s/[slug]/+page.svelte";
import { buildSiteView, type SiteView } from "../../src/lib/site/view.js";
import { buildSiteAlarmContext } from "../../../src/dashboard/fleet-cockpit.js";
import { input, siteRow } from "./fixtures.js";

/**
 * The /s/:slug page's Re-test now button, executed in happy-dom
 * (reddoorla/reddoor-maintenance#1888): the four outcomes of its click, as
 * site.dom.test.ts pins Trigger Renovate's, and its styling beside that button.
 */

let target: HTMLElement;
let app: Record<string, unknown> | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Two broken links, checked an hour before input()'s now: a browser reason, re-testable. */
function render(): void {
  const i = input();
  const site = siteRow({
    linksOk: false,
    brokenLinks: 2,
    browserCheckedAt: "2026-06-15T09:00:00.000Z",
  });
  const alarm = buildSiteAlarmContext(site, [], "", i.now);
  const view = buildSiteView(site, [], [], null, i.now, alarm, "acme-co");
  const wire = JSON.parse(JSON.stringify(view)) as SiteView;
  app = mount(Page, { target, props: { data: { view: wire } } });
  flushSync();
}

function remount(): void {
  if (app) unmount(app);
  app = null;
  target.replaceChildren();
  render();
}

async function settle(): Promise<void> {
  for (let n = 0; n < 3; n++) await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

const button = () => {
  const el = target.querySelector<HTMLButtonElement>("button.site-retest");
  if (!el) throw new Error("no button.site-retest");
  return el;
};

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  fetchMock = vi.fn(async () => json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
  vi.unstubAllGlobals();
});

describe("Re-test now", () => {
  it("started: posts to the site's retest URL, stays disabled, and links the run", async () => {
    render();
    fetchMock.mockResolvedValueOnce(json({ ok: true, runsUrl: "https://github.com/x/runs" }));
    button().click();
    flushSync();
    expect(button().textContent).toBe("Starting…");
    expect(button().disabled).toBe(true);
    await settle();
    const call = fetchMock.mock.calls.at(-1)!;
    expect(call[0]).toBe("/api/sites/acme-co/retest");
    expect(call[1]).toMatchObject({ method: "POST" });
    expect(button().textContent).toBe("Re-test started: reload in a few minutes");
    expect(button().disabled).toBe(true);
    expect(target.querySelector<HTMLAnchorElement>("a.site-retest-runs")?.href).toBe(
      "https://github.com/x/runs",
    );
  });

  it("409 nothing-to-retest: says so, and the button stays disabled", async () => {
    render();
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: "nothing-to-retest" }, 409));
    button().click();
    await settle();
    expect(button().textContent).toBe("Nothing to re-test");
    expect(button().disabled).toBe(true);
    expect(target.querySelector("a.site-retest-runs")).toBeNull();
  });

  it("a 502 says Failed and re-enables", async () => {
    render();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 502 }));
    button().click();
    await settle();
    expect(button().textContent).toBe("Failed");
    expect(button().disabled).toBe(false);
  });

  it("a thrown fetch says Failed and re-enables", async () => {
    remount();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    button().click();
    await settle();
    expect(button().textContent).toBe("Failed");
    expect(button().disabled).toBe(false);
  });

  it("is styled with the page's other action button: base, hover, focus-visible, disabled", () => {
    // happy-dom's import.meta.url is not a file URL; vitest runs from the repo root.
    const css = readFileSync(join(process.cwd(), "cockpit/src/routes/s/[slug]/site.css"), "utf8");
    const groups = [...css.matchAll(/([^{}]+)\{/g)].map((m) =>
      m[1]!.split(",").map((x) => x.trim()),
    );
    for (const state of ["", ":hover:not(:disabled)", ":focus-visible", ":disabled"]) {
      const shared = groups.some(
        (sels) =>
          sels.includes(`button.trigger-renovate${state}`) &&
          sels.includes(`button.site-retest${state}`),
      );
      expect(shared, state || "base").toBe(true);
    }
  });
});
