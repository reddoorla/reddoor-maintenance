import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parse } from "node-html-parser";
import type { RequestEvent } from "@sveltejs/kit";
import Page from "../../src/routes/triage/+page.svelte";
import BacklogTop from "../../src/lib/backlog/BacklogTop.svelte";
import { fallback } from "../../src/routes/api/backlog/+server.js";
import { buildCockpitView } from "../../src/lib/cockpit/view.js";
import { buildBacklogView, BACKLOG_FILE_HREF } from "../../src/lib/backlog/view.js";
import type { BacklogPanel } from "../../../src/dashboard/backlog-source.js";
import { mintSession, SESSION_COOKIE } from "../../../src/dashboard/auth/session.js";
import { renderPage } from "../_helpers/parity.js";
import { cases, NOW } from "../home/fixtures.js";

/**
 * P1-111: the backlog's top five on /triage, fetched by the page from
 * `GET /api/backlog`, which reads the private workspace repo per request. Every
 * signed-in user may read it (the operator, 2026-11-23: "it's fine if they see
 * it, the audience is just me"); a signed-out caller gets none of it. The text
 * is invented.
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

function render(panel: BacklogPanel | null) {
  const html = renderPage(BacklogTop, { view: panel ? buildBacklogView(panel, LATER) : null });
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

describe("/triage's page", () => {
  it("server-renders the section's frame while the read is in flight", () => {
    const doc = parse(
      renderPage(Page, {
        data: { view: buildCockpitView(model, NOW), backlogSource: "/api/backlog" },
      }),
    );
    expect(doc.querySelector("section.backlog h2")!.text).toBe("Backlog: the top five");
    expect(doc.querySelector(".backlog-loading")!.text).toBe("Reading BACKLOG.md…");
  });

  it("shows no section when its load names no source", () => {
    const doc = parse(renderPage(Page, { data: { view: buildCockpitView(model, NOW) } }));
    expect(doc.querySelector("section.backlog")).toBeNull();
  });
});

describe("GET /api/backlog", () => {
  const ORIGINAL_ENV = { ...process.env };
  const SECRET = "test-session-secret-0123456789abcdef";
  const MD = "## P1\n| # | Item |\n| --- | --- |\n| P1-901 | **Paint the fence** |\n";
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      DASHBOARD_SESSION_SECRET: SECRET,
      DASHBOARD_ALLOWED_EMAILS: "op@example.com,erik@example.com",
      GOOGLE_OAUTH_CLIENT_ID: "id",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      CONTEXT: "production",
      GH_TOKEN: "dash-token",
    };
    delete process.env.DASHBOARD_PASSWORD;
    fetchMock = vi.fn(async (url: string) =>
      String(url).includes("/commits?") ? Response.json([]) : new Response(MD),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  async function get(email: string | null, method = "GET") {
    const headers: Record<string, string> = { accept: "application/json" };
    if (email) {
      headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(mintSession(email, SECRET, new Date()))}`;
    }
    const request = new Request("https://cockpit.example/api/backlog", { method, headers });
    return fallback({ request, params: {} } as unknown as RequestEvent);
  }

  it("gives a signed-in operator the top five, read with the dashboard's GH_TOKEN", async () => {
    const res = await get("op@example.com");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as BacklogPanel;
    expect(body.kind === "ok" && body.items.map((i) => i.id)).toEqual(["P1-901"]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer dash-token");
  });

  it("gives any allowlisted address the same, not only the operator's", async () => {
    const body = (await (await get("erik@example.com")).json()) as BacklogPanel;
    expect(body.kind === "ok" && body.items.map((i) => i.id)).toEqual(["P1-901"]);
  });

  it("gives a signed-out caller a 401 and none of the backlog, without reading it", async () => {
    const res = await get(null);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("Paint the fence");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives an address off the allowlist a 403 and none of the backlog", async () => {
    const res = await get("stranger@example.com");
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("Paint the fence");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers any other method 405", async () => {
    expect((await get("op@example.com", "POST")).status).toBe(405);
  });
});
