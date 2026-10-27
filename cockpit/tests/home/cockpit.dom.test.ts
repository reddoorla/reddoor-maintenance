import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Page from "../../src/routes/+page.svelte";
import { buildCockpitView } from "../../src/lib/cockpit/view.js";
import { RF_KEY, RF_CONFIRM } from "../../src/lib/cockpit/fleet-refresh.js";
import { cases, NOW } from "./fixtures.js";

/**
 * `/`, ported (#582): the page's behaviour, run in a DOM. Each test mounts the
 * real page with data that crossed the server/browser boundary, clicks, and
 * asserts the `fetch` calls and what the page then shows: the ↻ Audit fleet
 * follower (dispatch, poll, finish, fail, 401, resume, ceiling). The browse
 * panel's filter chips moved to Sites with its cards (cockpit/tests/fleet/
 * sites.dom.test.ts), and Trigger Renovate lives on /s/:slug (site.dom), since
 * #672 step 3.
 */

type FetchReply = { status?: number; ok?: boolean; json?: unknown } | Error;

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
let replies: FetchReply[];
let reload: ReturnType<typeof vi.fn>;

function reply(r: FetchReply) {
  if (r instanceof Error) return Promise.reject(r);
  const status = r.status ?? 200;
  return Promise.resolve({
    status,
    ok: r.ok ?? (status >= 200 && status < 300),
    json: () => Promise.resolve(r.json ?? null),
  });
}

/** The data the browser gets: plain JSON, nothing a serializer would drop. */
function viewOf(model = cases()[10]![1]) {
  const view = buildCockpitView(model, NOW);
  const wire = JSON.parse(JSON.stringify(view));
  expect(wire).toStrictEqual(view);
  return wire;
}

function render(model?: Parameters<typeof viewOf>[0]) {
  app = mount(Page, { target, props: { data: { view: viewOf(model) } } });
  flushSync();
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  flushSync();
}

const button = () => target.querySelector<HTMLButtonElement>("button.refresh-fleet")!;
const panel = () => target.querySelector<HTMLElement>("#rf-status")!;
const rowsText = () =>
  [...panel().querySelectorAll(".rf-row")].map((r) => r.textContent!.replace(/\s+/g, " ").trim());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  target = document.createElement("div");
  document.body.append(target);
  replies = [];
  fetchMock = vi.fn(() => reply(replies.shift() ?? { status: 500, ok: false }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  reload = vi.fn();
  vi.stubGlobal("location", { reload });
  localStorage.clear();
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("↻ Audit fleet", () => {
  it("asks first, and does nothing when the operator declines", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    render();
    button().click();
    await settle();
    expect(confirm).toHaveBeenCalledWith(RF_CONFIRM);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });

  it("dispatches, saves the run, and starts following it", async () => {
    replies.push({ json: { since: "2026-06-11T12:00:00Z" } });
    render();
    button().click();
    flushSync();
    expect(button().textContent).toBe("Auditing…");
    expect(button().disabled).toBe(true);
    await settle();
    expect(fetchMock.mock.calls[0]).toEqual(["/api/fleet/refresh", { method: "POST" }]);
    expect(button().textContent).toBe("Audit running…");
    expect(button().disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem(RF_KEY)!)).toEqual({
      since: "2026-06-11T12:00:00Z",
      startedAt: NOW.getTime(),
    });
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/fleet/refresh/status?since=2026-06-11T12%3A00%3A00Z",
    ]);
  });

  it("shows starting… until the first status lands", async () => {
    replies.push({ json: { since: "S" } });
    fetchMock.mockImplementationOnce(() => reply({ json: { since: "S" } }));
    fetchMock.mockImplementationOnce(() => new Promise(() => {})); // status never answers
    render();
    button().click();
    await settle();
    expect(rowsText()).toEqual(["starting…"]);
    expect(panel().querySelector(".rf-spin")).not.toBeNull();
  });

  it("renders each run, links only github.com runs, and polls every 10 s", async () => {
    replies.push(
      { json: { since: "S" } },
      {
        json: {
          status: {
            perWorkflow: [
              {
                workflow: "fleet-lighthouse.yml",
                state: "in_progress",
                url: "https://github.com/o/r/actions/runs/1",
              },
              { workflow: "fleet-security.yml", state: "failure", url: "javascript:alert(1)" },
              {
                workflow: "fleet-smoke.yml",
                state: "timed_out",
                url: "https://github.com/o/r/actions/runs/3",
              },
              { workflow: "fleet-other.yml", state: "success" },
            ],
            allDone: false,
          },
        },
      },
    );
    render();
    button().click();
    await settle();
    expect(rowsText()).toEqual([
      "lighthouse — in progress<1m / ~48m · view run →",
      "security — failure",
      "smoke — timed out run",
      "other — success",
    ]);
    const links = [...panel().querySelectorAll("a")].map((a) => [
      a.textContent,
      a.getAttribute("href"),
      a.getAttribute("target"),
    ]);
    expect(links).toEqual([
      ["view run →", "https://github.com/o/r/actions/runs/1", "_blank"],
      ["run", "https://github.com/o/r/actions/runs/3", "_blank"],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]).toEqual(["/api/fleet/refresh/status?since=S"]);
  });

  it("escapes what the status API sends", async () => {
    replies.push(
      { json: { since: "S" } },
      {
        json: {
          status: { perWorkflow: [{ workflow: "<img src=x onerror=alert(1)>", state: "queued" }] },
        },
      },
    );
    render();
    button().click();
    await settle();
    expect(panel().querySelector("img")).toBeNull();
    expect(rowsText()[0]).toContain("<img src=x onerror=alert(1)> — queued");
  });

  it("reloads two seconds after every run succeeded, and forgets the run", async () => {
    replies.push(
      { json: { since: "S" } },
      {
        json: {
          status: {
            perWorkflow: [{ workflow: "fleet-security.yml", state: "success" }],
            allDone: true,
            anyFailure: false,
          },
        },
      },
    );
    render();
    button().click();
    await settle();
    expect(rowsText()).toEqual(["security — success", "Done — reloading…"]);
    expect(localStorage.getItem(RF_KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(1999);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("offers a Reload button and frees the audit button when a run failed", async () => {
    replies.push(
      { json: { since: "S" } },
      {
        json: {
          status: {
            perWorkflow: [{ workflow: "fleet-security.yml", state: "failure" }],
            allDone: true,
            anyFailure: true,
          },
        },
      },
    );
    render();
    button().click();
    await settle();
    const reloadBtn = [...panel().querySelectorAll("button")].find(
      (b) => b.textContent === "Reload",
    )!;
    expect(reloadBtn).toBeDefined();
    expect(button().textContent).toBe("Audit fleet");
    expect(button().disabled).toBe(false);
    expect(localStorage.getItem(RF_KEY)).toBeNull();
    reloadBtn.click();
    expect(reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops on a 401 and says to sign in again", async () => {
    replies.push({ json: { since: "S" } }, { status: 401, ok: false });
    render();
    button().click();
    await settle();
    expect(rowsText()).toEqual(["starting…", "Session expired — reload to sign in."]);
    expect(button().textContent).toBe("Audit fleet");
    expect(button().disabled).toBe(false);
    expect(localStorage.getItem(RF_KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says Failed to start when the dispatch is refused or throws", async () => {
    replies.push({ status: 502, ok: false });
    render();
    button().click();
    await settle();
    expect(button().textContent).toBe("Failed to start");
    expect(button().disabled).toBe(false);
    replies.push(new Error("offline"));
    button().click();
    await settle();
    expect(button().textContent).toBe("Failed to start");
    expect(button().disabled).toBe(false);
    expect(localStorage.getItem(RF_KEY)).toBeNull();
  });

  it("keeps polling through errors, then gives up at the 90-minute ceiling", async () => {
    replies.push({ json: { since: "S" } });
    render();
    button().click();
    await settle();
    // Every status poll from here fails (500, or a thrown fetch).
    fetchMock.mockImplementation(() => reply(new Error("blip")));
    await vi.advanceTimersByTimeAsync(89 * 60 * 1000);
    expect(rowsText()).toEqual(["starting…"]);
    expect(button().disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(rowsText()).toEqual(["starting…", "Still running — reload later."]);
    expect(button().textContent).toBe("Audit fleet");
    expect(button().disabled).toBe(false);
    expect(localStorage.getItem(RF_KEY)).toBeNull();
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("resumes a run saved by an earlier page load", async () => {
    localStorage.setItem(
      RF_KEY,
      JSON.stringify({ since: "S0", startedAt: NOW.getTime() - 5 * 60_000 }),
    );
    replies.push({
      json: {
        status: { perWorkflow: [{ workflow: "fleet-lighthouse.yml", state: "in_progress" }] },
      },
    });
    render();
    await settle();
    expect(button().textContent).toBe("Audit running…");
    expect(button().disabled).toBe(true);
    expect(fetchMock.mock.calls[0]).toEqual(["/api/fleet/refresh/status?since=S0"]);
    expect(rowsText()).toEqual(["lighthouse — in progress5m / ~48m"]);
  });

  it("forgets a saved run older than the ceiling instead of resuming it", async () => {
    localStorage.setItem(
      RF_KEY,
      JSON.stringify({ since: "S0", startedAt: NOW.getTime() - 91 * 60_000 }),
    );
    render();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(RF_KEY)).toBeNull();
    expect(button().disabled).toBe(false);
  });
});
