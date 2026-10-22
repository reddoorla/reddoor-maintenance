import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildSubmissionsPageData,
  type SubmissionsPageData,
} from "../../src/routes/submissions/data.js";
import { mount, unmount, flushSync } from "svelte";
import Page from "../../src/routes/submissions/+page.svelte";
import type { SubmissionsPageModel } from "../../../src/dashboard/submissions-page.js";
import { model } from "./fixtures.js";

/**
 * /submissions behaviour (#582): the triage buttons and the bulk mark-read
 * confirm, run as the browser runs them. Each test clicks the real page and
 * asserts the request it sends and what the button says after.
 */

/** What the browser gets: the load data after serialization. Plain JSON must
 *  survive it unchanged. */
function served(m: SubmissionsPageModel): SubmissionsPageData {
  const data = buildSubmissionsPageData(m);
  const round = JSON.parse(JSON.stringify(data));
  expect(round).toEqual(data);
  return round;
}

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;
const fetchMock = vi.fn();

function render(m: SubmissionsPageModel = model()) {
  target = document.createElement("div");
  document.body.append(target);
  app = mount(Page, { target, props: { data: served(m) } });
  flushSync();
}

function button(id: string, label: string): HTMLButtonElement {
  const b = [...target.querySelectorAll<HTMLButtonElement>("button.subm-status")].find(
    (x) => x.dataset.id === id && x.textContent === label,
  );
  if (!b) throw new Error(`no "${label}" button for ${id}`);
  return b;
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
  vi.unstubAllGlobals();
});

describe("submission triage buttons", () => {
  it("Read posts {status: read} to the row's status endpoint and shows ✓", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render();
    const b = button("sub_plain", "Read");
    b.click();
    flushSync();
    expect(b.disabled).toBe(true);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/submissions/sub_plain/status");
    expect(init).toEqual({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "read" }),
    });
    expect(b.textContent).toBe("✓");
    expect(b.disabled).toBe(true);
  });

  it("Archive and Spam post their own status", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render();
    button("sub_plain", "Archive").click();
    button("sub_plain", "Spam").click();
    await settle();
    expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body))).toEqual([
      { status: "archived" },
      { status: "spam" },
    ]);
  });

  it("Not spam → new posts {status: new} on an auto-spam row", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render();
    button("sub_auto", "Not spam → new").click();
    await settle();
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ status: "new" });
  });

  it("acknowledging a bounce posts {ack: notify-bounce}, not a status", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render();
    button("sub_bounce_perm", "Not dead — acknowledge").click();
    await settle();
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ ack: "notify-bounce" });
  });

  it("an id with a slash is percent-encoded into the URL", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render();
    button("sub/odd id", "Read").click();
    await settle();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/submissions/sub%2Fodd%20id/status");
  });

  it("a refused request says Failed and re-arms the button", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    render();
    const b = button("sub_plain", "Read");
    b.click();
    await settle();
    expect(b.textContent).toBe("Failed");
    expect(b.disabled).toBe(false);
  });

  it("a network error says Failed and re-arms the button", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    render();
    const b = button("sub_plain", "Archive");
    b.click();
    await settle();
    expect(b.textContent).toBe("Failed");
    expect(b.disabled).toBe(false);
  });
});

describe("bulk mark-read", () => {
  function submit(form: HTMLFormElement): SubmitEvent {
    const ev = new SubmitEvent("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(ev);
    return ev;
  }

  it("asks first, with the count, and a refusal stops the submit", () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    render(model({ markableNewCount: 4 }));
    const ev = submit(target.querySelector<HTMLFormElement>("form.bulk-read")!);
    expect(confirmMock).toHaveBeenCalledWith(
      "Mark all 4 filtered new submissions as read? Spam and operator-touched rows are never affected.",
    );
    expect(ev.defaultPrevented).toBe(true);
  });

  it("a yes lets the form post, with the active filter as fields", () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    render(
      model({
        markableNewCount: 1,
        filter: { site: "site-a", type: "", status: "new", q: "x", from: "", to: "", reason: "" },
      }),
    );
    const form = target.querySelector<HTMLFormElement>("form.bulk-read")!;
    const ev = submit(form);
    expect(ev.defaultPrevented).toBe(false);
    expect(form.method).toBe("post");
    expect(form.getAttribute("action")).toBe("/submissions");
    expect([...new FormData(form).entries()]).toEqual([
      ["action", "mark-read"],
      ["site", "site-a"],
      ["status", "new"],
      ["q", "x"],
    ]);
  });
});
