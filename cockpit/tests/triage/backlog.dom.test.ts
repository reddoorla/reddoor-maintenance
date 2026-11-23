import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Page from "../../src/routes/triage/+page.svelte";
import { buildCockpitView } from "../../src/lib/cockpit/view.js";
import type { BacklogPanel } from "../../../src/dashboard/backlog-source.js";
import { cases, NOW } from "../home/fixtures.js";

/** P1-111: /triage fetches the backlog once it is on screen. The text is invented. */

const PANEL: BacklogPanel = {
  kind: "ok",
  rerankedAt: "2026-11-23T13:20:00.000Z",
  writtenAt: null,
  items: [
    { rank: 1, id: "P1-901", title: "Paint the fence", tier: "🟢", status: null },
    { rank: 2, id: "P1-902", title: "Fix the gate latch", tier: "🟡", status: null },
  ],
};

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

function answer(r: { status: number; json?: unknown } | Error) {
  fetchMock.mockImplementation(() =>
    r instanceof Error
      ? Promise.reject(r)
      : Promise.resolve({
          status: r.status,
          ok: r.status >= 200 && r.status < 300,
          json: () => Promise.resolve(r.json ?? null),
        }),
  );
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  flushSync();
}

function mountPage() {
  const view = JSON.parse(JSON.stringify(buildCockpitView(cases()[0]![1], NOW)));
  app = mount(Page, { target, props: { data: { view, backlogSource: "/api/backlog" } } });
  flushSync();
}

const text = (sel: string) =>
  target.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
  vi.unstubAllGlobals();
});

describe("/triage's backlog fetch", () => {
  it("asks the source once, then lists what it answered", async () => {
    answer({ status: 200, json: PANEL });
    mountPage();
    expect(text(".backlog-loading")).toBe("Reading BACKLOG.md…");
    await settle();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/backlog");
    expect(
      [...target.querySelectorAll("li.backlog-item")].map((li) => li.getAttribute("data-id")),
    ).toEqual(["P1-901", "P1-902"]);
    expect(text(".backlog-loading")).toBeNull();
  });

  it("says a sign-in lapsed on a 401", async () => {
    answer({ status: 401 });
    mountPage();
    await settle();
    expect(text(".backlog-unavailable")).toContain("Signed out: reload the page to sign in.");
  });

  it("names the status of any other failure", async () => {
    answer({ status: 502 });
    mountPage();
    await settle();
    expect(text(".backlog-unavailable")).toContain("The backlog read failed (HTTP 502).");
  });

  it("says so when the request itself fails", async () => {
    answer(new TypeError("offline"));
    mountPage();
    await settle();
    expect(text(".backlog-unavailable")).toContain("no answer from the cockpit");
  });
});
