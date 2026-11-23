import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parse } from "node-html-parser";
import type { RequestEvent } from "@sveltejs/kit";
import Page from "../../src/routes/triage/+page.svelte";
import { load as serverLoad } from "../../src/routes/triage/+page.server.js";
import { handle } from "../../src/hooks.server.js";
import { buildCockpitView } from "../../src/lib/cockpit/view.js";
import { buildBacklogView, BACKLOG_FILE_HREF } from "../../src/lib/backlog/view.js";
import type { BacklogPanel } from "../../../src/dashboard/backlog-source.js";
import { mintSession, SESSION_COOKIE } from "../../../src/dashboard/auth/session.js";
import { renderPage } from "../_helpers/parity.js";
import { cases, NOW } from "../home/fixtures.js";

/**
 * P1-111: the backlog's top five on /triage. Read on the server per request
 * from the private workspace repo; every signed-in user may see it (the
 * operator, 2026-11-23: "it's fine if they see it, the audience is just me"),
 * and a signed-out request never reaches the load. The text is invented.
 */

const model = cases()[0]![1];

const PANEL: BacklogPanel = {
  kind: "ok",
  rerankedAt: "2026-11-23T13:20:00.000Z",
  writtenAt: "2026-11-23T17:35:00Z",
  items: [
    { rank: 1, id: "P1-901", title: "Paint the fence", tier: "🟢", status: null },
    {
      rank: 2,
      id: "P1-902",
      title: "Fix the gate latch",
      tier: "mixed",
      status: {
        date: "2026-11-21",
        sentence: "#2010 closed #1755.",
        refs: [
          { label: "#2010", href: "https://github.com/reddoorla/reddoor-maintenance/issues/2010" },
          { label: "#1755", href: "https://github.com/reddoorla/reddoor-maintenance/issues/1755" },
        ],
      },
    },
    { rank: 3, id: "P1-903", title: "Water the beds", tier: null, status: null },
  ],
};

/** Two hours after the fixture file's last write. */
const LATER = new Date("2026-11-23T19:35:00Z");

function render(panel: BacklogPanel) {
  const html = renderPage(Page, {
    data: { view: buildCockpitView(model, NOW), backlog: buildBacklogView(panel, LATER) },
  });
  return parse(html);
}

describe("/triage's backlog section", () => {
  it("lists the items in rank order with ID, tier, title, status and linked refs", () => {
    const doc = render(PANEL);
    const section = doc.querySelector("section.backlog")!;
    expect(section.querySelector("h2")!.text).toBe("Backlog: the top five");
    const items = section.querySelectorAll("li.backlog-item");
    expect(items.map((li) => li.getAttribute("data-id"))).toEqual(["P1-901", "P1-902", "P1-903"]);
    expect(items.map((li) => li.querySelector(".backlog-rank")!.text)).toEqual(["1", "2", "3"]);
    const second = items[1]!;
    expect(second.querySelector(".backlog-title")!.text).toBe("Fix the gate latch");
    expect(second.querySelector(".backlog-tier")!.text).toBe("mixed");
    expect(second.querySelector(".backlog-status")!.text.replace(/\s+/g, " ").trim()).toBe(
      "Status Nov 21: #2010 closed #1755.",
    );
    expect(
      second.querySelectorAll(".backlog-refs a").map((a) => [a.text, a.getAttribute("href")]),
    ).toEqual([
      ["#2010", "https://github.com/reddoorla/reddoor-maintenance/issues/2010"],
      ["#1755", "https://github.com/reddoorla/reddoor-maintenance/issues/1755"],
    ]);
    // No tier cell, no empty tier pill; no status, no status line.
    expect(items[2]!.querySelector(".backlog-tier")).toBeNull();
    expect(items[0]!.querySelector(".backlog-status")).toBeNull();
  });

  it("dates the ranking and the file's last write in PT, and links the file", () => {
    const meta = render(PANEL).querySelector(".backlog-meta")!;
    expect(meta.text.replace(/\s+/g, " ").trim()).toBe(
      `Ranked Nov 23, 5:20am PT · file last written Nov 23, 9:35am PT (2 hours ago) · BACKLOG.md →`,
    );
    expect(meta.querySelector("a")!.getAttribute("href")).toBe(BACKLOG_FILE_HREF);
  });

  it("shows why when the backlog cannot be read", () => {
    const doc = render({ kind: "unavailable", reason: "The dashboard has no GH_TOKEN set." });
    expect(doc.querySelector(".backlog-unavailable")!.text).toContain(
      "The dashboard has no GH_TOKEN set.",
    );
    expect(doc.querySelectorAll("li.backlog-item")).toHaveLength(0);
  });
});

describe("/triage's server load", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("reads the backlog with the dashboard's GH_TOKEN", async () => {
    process.env.GH_TOKEN = "dash-token";
    const fetch = vi.fn(async (url: string) =>
      String(url).includes("/commits?")
        ? Response.json([])
        : new Response("## P1\n| # | Item |\n| --- | --- |\n| P1-901 | **Paint the fence** |\n"),
    );
    vi.stubGlobal("fetch", fetch);
    const data = (await serverLoad({} as Parameters<typeof serverLoad>[0])) as {
      backlog: BacklogPanel;
    };
    expect(data.backlog.kind === "ok" && data.backlog.items.map((i) => i.id)).toEqual(["P1-901"]);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer dash-token");
  });
});

describe("/triage's data behind the sign-in gate", () => {
  const ORIGINAL_ENV = { ...process.env };
  const SECRET = "test-session-secret-0123456789abcdef";
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      DASHBOARD_SESSION_SECRET: SECRET,
      DASHBOARD_ALLOWED_EMAILS: "op@example.com,erik@example.com",
      GOOGLE_OAUTH_CLIENT_ID: "id",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      CONTEXT: "production",
    };
    delete process.env.DASHBOARD_PASSWORD;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function dataRequest(headers: Record<string, string>) {
    return {
      request: new Request("https://cockpit.example/triage/__data.json", { headers }),
      url: new URL("https://cockpit.example/triage"),
      route: { id: "/triage" },
      locals: {} as App.Locals,
    } as unknown as RequestEvent;
  }

  it("refuses a signed-out request before any load runs", async () => {
    const resolve = vi.fn(async () => new Response("backlog data"));
    const res = await handle({ event: dataRequest({}), resolve });
    expect(resolve).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(await res.text()).not.toContain("backlog data");
  });

  it("refuses an address off the allowlist", async () => {
    const token = mintSession("stranger@example.com", SECRET, new Date());
    const resolve = vi.fn(async () => new Response("backlog data"));
    await handle({
      event: dataRequest({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` }),
      resolve,
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("serves any allowlisted address, not only the operator's", async () => {
    const token = mintSession("erik@example.com", SECRET, new Date());
    const resolve = vi.fn(async () => new Response("backlog data"));
    await handle({
      event: dataRequest({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` }),
      resolve,
    });
    expect(resolve).toHaveBeenCalledOnce();
  });
});
