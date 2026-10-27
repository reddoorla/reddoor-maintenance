import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Page from "../../src/routes/s/[slug]/+page.svelte";
import { buildSiteView, type SiteView } from "../../src/lib/site/view.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";
import { gatingFields } from "../../../src/reports/checklist.js";
import { input, pending, reportRow, cleanEvidence, siteRow, type SiteInput } from "./fixtures.js";
import {
  withdrawConfirmText,
  UNAPPROVE_CONFIRM_TEXT,
} from "../../../src/dashboard/report-confirm.js";

/**
 * /s/:slug's actions, executed (#582). Each test mounts the real page component
 * in happy-dom with the data the browser would receive, clicks or types, and
 * asserts the exact request and the DOM that follows. These replace the old
 * page's inline script, which only `new Function` ever parsed.
 */

let target: HTMLElement;
let app: Record<string, unknown> | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
let confirmMock: ReturnType<typeof vi.fn>;
let reloadMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Mount the page with its load data as the client receives it: serialized and
 *  parsed. JSON is stricter than SvelteKit's devalue, so this proves both. */
function render(i: SiteInput): HTMLElement {
  const view = buildSiteView(i.site, i.reports, i.submissions, i.spam, i.now, i.alarm);
  const wire = JSON.parse(JSON.stringify(view)) as SiteView;
  expect(wire).toEqual(view);
  app = mount(Page, { target, props: { data: { view: wire } } });
  flushSync();
  return target;
}

async function settle(): Promise<void> {
  for (let n = 0; n < 3; n++) await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

const $ = <T extends Element = HTMLElement>(sel: string) => {
  const el = target.querySelector<T>(sel);
  if (!el) throw new Error(`no ${sel}`);
  return el;
};
const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(target.querySelectorAll<T>(sel));

function lastCall() {
  const call = fetchMock.mock.calls.at(-1)!;
  return { url: call[0] as string, init: call[1] as RequestInit };
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  fetchMock = vi.fn(async () => json({ ok: true }));
  confirmMock = vi.fn(() => true);
  reloadMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", confirmMock);
  vi.stubGlobal("location", { ...window.location, reload: reloadMock });
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
  vi.unstubAllGlobals();
});

/** A health-red pending report: the gate fails, so Approve is disabled and
 *  "Send anyway…" is offered. */
const red = () =>
  pending({
    id: "rp",
    reportId: "rep_p",
    autoEvidence: {
      ...cleanEvidence("Maintenance"),
      [gatingFields("Maintenance")[0]!]: {
        result: "fail",
        checkedAt: "2026-07-06T00:00:00.000Z",
        note: "x",
      },
    },
  });

describe("Approve", () => {
  const twins = () => $$<HTMLButtonElement>('button.approve[data-report-id="rp"]');

  it("posts to this report's approve URL and marks BOTH twins approved", async () => {
    render(input({ reports: [pending({ id: "rp", reportId: "rep_p" })] }));
    expect(twins()).toHaveLength(2);
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)));
    twins()[1]!.click();
    flushSync();
    // In flight: every twin disabled; only the clicked one spins.
    expect(twins().map((b) => b.disabled)).toEqual([true, true]);
    expect(twins()[1]!.classList.contains("is-loading")).toBe(true);
    expect(twins()[1]!.getAttribute("aria-busy")).toBe("true");
    expect(twins()[0]!.classList.contains("is-loading")).toBe(false);
    expect(lastCall()).toEqual({ url: "/api/reports/rp/approve", init: { method: "POST" } });
    resolve(json({ ok: true }));
    await settle();
    for (const b of twins()) {
      expect(b.textContent).toBe("Approved");
      expect(b.classList.contains("is-approved")).toBe(true);
      expect(b.disabled).toBe(true);
    }
    expect(twins()[1]!.classList.contains("is-loading")).toBe(false);
    expect(twins()[1]!.hasAttribute("aria-busy")).toBe(false);
    expect($<HTMLButtonElement>("button.withdraw").disabled).toBe(true);
  });

  it("a send-blocked refusal says Blocked, carries the blockers as the title, and re-enables", async () => {
    render(input({ reports: [pending({ id: "rp", reportId: "rep_p" })] }));
    fetchMock.mockResolvedValueOnce(
      json({ reason: "send-blocked", blockers: ["recipients: none", "header: missing"] }, 409),
    );
    twins()[0]!.click();
    await settle();
    for (const b of twins()) {
      expect(b.textContent).toBe("Blocked");
      expect(b.title).toBe("recipients: none\nheader: missing");
      expect(b.disabled).toBe(false);
    }
  });

  it("a withdrawn refusal kills approve, withdraw and the override", async () => {
    render(input({ reports: [red()] }));
    // The gate is red, so Approve is server-rendered disabled; force the click
    // the way a stale page or a twin would.
    twins()[0]!.disabled = false;
    fetchMock.mockResolvedValueOnce(json({ reason: "withdrawn" }, 409));
    twins()[0]!.click();
    await settle();
    for (const b of twins()) {
      expect(b.textContent).toBe("Withdrawn");
      expect(b.disabled).toBe(true);
    }
    expect($<HTMLButtonElement>("button.withdraw").disabled).toBe(true);
    expect($<HTMLButtonElement>("button.override-toggle").disabled).toBe(true);
    expect($<HTMLButtonElement>("button.override-submit").disabled).toBe(true);
    expect($<HTMLInputElement>("input.override-reason").disabled).toBe(true);
  });

  it("any other refusal says Failed, keeps a missing title off, and re-enables", async () => {
    render(input({ reports: [pending({ id: "rp", reportId: "rep_p" })] }));
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    twins()[0]!.click();
    await settle();
    for (const b of twins()) {
      expect(b.textContent).toBe("Failed");
      expect(b.hasAttribute("title")).toBe(false);
      expect(b.disabled).toBe(false);
    }
  });

  it("a network failure says Failed and re-enables", async () => {
    render(input({ reports: [pending({ id: "rp", reportId: "rep_p" })] }));
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    twins()[0]!.click();
    await settle();
    expect(twins().map((b) => [b.textContent, b.disabled])).toEqual([
      ["Failed", false],
      ["Failed", false],
    ]);
  });

  it("is server-rendered disabled, and marked, when a send blocker fails", () => {
    render(input({ site: siteRow({ pointOfContact: null }), reports: [pending({ id: "rp" })] }));
    expect(twins()[0]!.disabled).toBe(true);
    expect(twins()[0]!.dataset.sendBlocked).toBe("1");
  });
});

describe("Send anyway… (override)", () => {
  it("toggles the form open and closed", () => {
    render(input({ reports: [red()] }));
    const form = $(".override-form");
    expect(form.hidden).toBe(true);
    $("button.override-toggle").click();
    flushSync();
    expect(form.hidden).toBe(false);
    $("button.override-toggle").click();
    flushSync();
    expect(form.hidden).toBe(true);
  });

  it("refuses an empty reason without a request", async () => {
    render(input({ reports: [red()] }));
    $<HTMLInputElement>("input.override-reason").value = "   ";
    $("button.override-submit").click();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($(".override-status").textContent).toBe("Reason required");
  });

  it("posts the trimmed reason and marks the report overridden", async () => {
    render(input({ reports: [red()] }));
    $<HTMLInputElement>("input.override-reason").value = "  client asked  ";
    $("button.override-submit").click();
    flushSync();
    expect($(".override-status").textContent).toBe("Sending…");
    expect($<HTMLButtonElement>("button.override-submit").disabled).toBe(true);
    await settle();
    expect(lastCall()).toEqual({
      url: "/api/reports/rp/approve?override=1",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "client asked" }),
      },
    });
    expect($(".override-status").textContent).toBe("Overridden");
    expect($<HTMLInputElement>("input.override-reason").disabled).toBe(true);
    expect($$("button.approve").map((b) => b.textContent)).toEqual(["Overridden", "Overridden"]);
    expect($<HTMLButtonElement>("button.withdraw").disabled).toBe(true);
  });

  it("shows the server's blockers, or the reason-required refusal, and re-enables", async () => {
    render(input({ reports: [red()] }));
    $<HTMLInputElement>("input.override-reason").value = "why";
    fetchMock.mockResolvedValueOnce(json({ blockers: ["a", "b"] }, 409));
    $("button.override-submit").click();
    await settle();
    expect($(".override-status").textContent).toBe("a; b");
    expect($<HTMLButtonElement>("button.override-submit").disabled).toBe(false);
    fetchMock.mockResolvedValueOnce(json({ reason: "override-reason-required" }, 400));
    $("button.override-submit").click();
    await settle();
    expect($(".override-status").textContent).toBe("Reason required");
    fetchMock.mockRejectedValueOnce(new Error("x"));
    $("button.override-submit").click();
    await settle();
    expect($(".override-status").textContent).toBe("Failed");
    expect($<HTMLButtonElement>("button.override-submit").disabled).toBe(false);
  });
});

describe("Don't send (withdraw)", () => {
  const r = () => pending({ id: "rp", reportId: "rep_p" });

  it("does nothing when the confirm is declined", async () => {
    render(input({ reports: [r()] }));
    confirmMock.mockReturnValueOnce(false);
    $("button.withdraw").click();
    await settle();
    expect(confirmMock).toHaveBeenCalledWith(withdrawConfirmText(r()));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("withdraws, and kills both Approve twins", async () => {
    render(input({ reports: [r()] }));
    expect($$<HTMLButtonElement>("button.approve").map((b) => b.disabled)).toEqual([false, false]);
    $("button.withdraw").click();
    await settle();
    expect($$<HTMLButtonElement>("button.approve").map((b) => [b.textContent, b.disabled])).toEqual(
      [
        ["Withdrawn", true],
        ["Withdrawn", true],
      ],
    );
  });

  it("withdraws, and kills the override", async () => {
    render(input({ reports: [{ ...red() }] }));
    $("button.withdraw").click();
    await settle();
    expect(lastCall()).toEqual({ url: "/api/reports/rp/withdraw", init: { method: "POST" } });
    expect($("button.withdraw").textContent).toBe("Withdrawn");
    expect($$<HTMLButtonElement>("button.approve").map((b) => [b.textContent, b.disabled])).toEqual(
      [
        ["Withdrawn", true],
        ["Withdrawn", true],
      ],
    );
    expect($<HTMLButtonElement>("button.override-toggle").disabled).toBe(true);
  });

  it("names an approval or a send that beat it, and otherwise re-enables", async () => {
    render(input({ reports: [r()] }));
    fetchMock.mockResolvedValueOnce(json({ reason: "already-approved" }, 409));
    $("button.withdraw").click();
    await settle();
    expect($("button.withdraw").textContent).toBe("Already approved");
    expect($<HTMLButtonElement>("button.withdraw").disabled).toBe(true);
    expect($$<HTMLButtonElement>("button.approve").map((b) => [b.textContent, b.disabled])).toEqual(
      [
        ["Approved", true],
        ["Approved", true],
      ],
    );
  });

  it("already-sent stays dead; an unknown reason is named and re-enabled", async () => {
    render(input({ reports: [r()] }));
    fetchMock.mockResolvedValueOnce(json({ reason: "already-sent" }, 409));
    $("button.withdraw").click();
    await settle();
    expect($("button.withdraw").textContent).toBe("Already sent");
    expect($<HTMLButtonElement>("button.withdraw").disabled).toBe(true);
    if (app) unmount(app);
    target.innerHTML = "";
    render(input({ reports: [r()] }));
    fetchMock.mockResolvedValueOnce(json({ reason: "locked" }, 409));
    $("button.withdraw").click();
    await settle();
    expect($("button.withdraw").textContent).toBe("Failed: locked");
    expect($<HTMLButtonElement>("button.withdraw").disabled).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error("x"));
    $("button.withdraw").click();
    await settle();
    expect($("button.withdraw").textContent).toBe("Failed");
  });
});

describe("Unapprove", () => {
  const approved = () =>
    reportRow({ id: "ra", reportId: "rep_a", sentAt: null, approvedToSend: true });

  it("confirms, posts, and reloads on success", async () => {
    render(input({ reports: [approved()] }));
    $("button.unapprove").click();
    await settle();
    expect(confirmMock).toHaveBeenCalledWith(UNAPPROVE_CONFIRM_TEXT);
    expect(lastCall()).toEqual({ url: "/api/reports/ra/unapprove", init: { method: "POST" } });
    expect($("button.unapprove").textContent).toBe("Unapproved");
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the confirm is declined", async () => {
    render(input({ reports: [approved()] }));
    confirmMock.mockReturnValueOnce(false);
    $("button.unapprove").click();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  for (const [reason, label, dead] of [
    ["already-sent", "Already sent", true],
    ["sending", "Sending now", true],
    ["withdrawn", "Withdrawn", true],
    ["other", "Failed: other", false],
  ] as const) {
    it(`a ${reason} refusal reads "${label}"`, async () => {
      render(input({ reports: [approved()] }));
      fetchMock.mockResolvedValueOnce(json({ reason }, 409));
      $("button.unapprove").click();
      await settle();
      expect($("button.unapprove").textContent).toBe(label);
      expect($<HTMLButtonElement>("button.unapprove").disabled).toBe(dead);
      expect(reloadMock).not.toHaveBeenCalled();
    });
  }
});

describe("refresh preview and Trigger Renovate", () => {
  it("refresh preview dispatches the re-render and says to reload", async () => {
    render(input({ reports: [pending({ id: "rp" })] }));
    $("button.rerender").click();
    flushSync();
    expect($("button.rerender").textContent).toBe("Refreshing…");
    await settle();
    expect(lastCall()).toEqual({ url: "/api/reports/rp/rerender", init: { method: "POST" } });
    expect($("button.rerender").textContent).toBe("Queued, reload in ~2 min");
    expect($<HTMLButtonElement>("button.rerender").disabled).toBe(true);
  });

  it("refresh preview re-enables on failure", async () => {
    render(input({ reports: [pending({ id: "rp" })] }));
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    $("button.rerender").click();
    await settle();
    expect($("button.rerender").textContent).toBe("Failed");
    expect($<HTMLButtonElement>("button.rerender").disabled).toBe(false);
  });

  it("Trigger Renovate posts to the site's dispatch URL", async () => {
    render(input());
    $("button.trigger-renovate").click();
    flushSync();
    expect($("button.trigger-renovate").textContent).toBe("Dispatching…");
    await settle();
    expect(lastCall()).toEqual({
      url: "/api/sites/acme-co/trigger-renovate",
      init: { method: "POST" },
    });
    expect($("button.trigger-renovate").textContent).toBe("Dispatched");
    expect($<HTMLButtonElement>("button.trigger-renovate").disabled).toBe(true);
    if (app) unmount(app);
    target.innerHTML = "";
    render(input());
    fetchMock.mockResolvedValueOnce(new Response("", { status: 502 }));
    $("button.trigger-renovate").click();
    await settle();
    expect($("button.trigger-renovate").textContent).toBe("Failed");
    expect($<HTMLButtonElement>("button.trigger-renovate").disabled).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error("x"));
    if (app) unmount(app);
    target.innerHTML = "";
    render(input());
    $("button.trigger-renovate").click();
    await settle();
    expect($("button.trigger-renovate").textContent).toBe("Failed");
    expect($<HTMLButtonElement>("button.trigger-renovate").disabled).toBe(false);
  });
});

describe("site details editor", () => {
  const DETAILS = "/api/sites/acme-co/details";
  const body = () => JSON.parse(lastCall().init.body as string) as { field: string; value: string };
  const saved = (field: string) => $(`.detail-saved[data-for="${field}"]`).textContent;
  const fire = (el: Element, type: string) => {
    el.dispatchEvent(new Event(type, { bubbles: true }));
    flushSync();
  };

  it("a select saves on change", async () => {
    render(input());
    const s = $<HTMLSelectElement>("#detail-maintenanceFreq");
    s.value = "Yearly";
    fire(s, "change");
    await settle();
    expect(lastCall().url).toBe(DETAILS);
    expect(lastCall().init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(body()).toEqual({ field: "maintenanceFreq", value: "Yearly" });
    expect(saved("maintenanceFreq")).toBe(" saved");
  });

  it("a checkbox posts its checked state, never its 'on' value", async () => {
    render(input());
    const c = $<HTMLInputElement>("#detail-requireTurnstile");
    c.checked = true;
    fire(c, "change");
    await settle();
    expect(body()).toEqual({ field: "requireTurnstile", value: "true" });
    c.checked = false;
    fire(c, "change");
    await settle();
    expect(body()).toEqual({ field: "requireTurnstile", value: "false" });
  });

  it("the multi-select posts every selection, comma-joined", async () => {
    render(input());
    const s = $<HTMLSelectElement>("#detail-acceptedWatchConditions");
    for (const o of Array.from(s.options))
      o.selected = o.value === "SEO" || o.value === "no git repo";
    fire(s, "change");
    await settle();
    expect(body()).toEqual({ field: "acceptedWatchConditions", value: "SEO,no git repo" });
  });

  it("an input never saves on a blur without an edit gesture", async () => {
    render(input());
    const i = $<HTMLInputElement>("#detail-gitRepo");
    i.value = "someone/else"; // the browser rewriting .value on its own
    fire(i, "blur");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an edited input saves on blur, once, and a failed save retries on the next blur", async () => {
    render(input());
    const i = $<HTMLInputElement>("#detail-gitRepo");
    i.value = "reddoorla/other";
    fire(i, "input");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    fire(i, "blur");
    await settle();
    expect(body()).toEqual({ field: "gitRepo", value: "reddoorla/other" });
    expect(saved("gitRepo")).toBe(" failed");
    fire(i, "blur");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(saved("gitRepo")).toBe(" saved");
    fire(i, "blur");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("an edit back to the stored value does not save", async () => {
    render(input());
    const i = $<HTMLInputElement>("#detail-gitRepo");
    i.value = "x";
    fire(i, "input");
    i.value = "reddoorla/acme";
    fire(i, "blur");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a secret posts what was typed, and does not repost it on the next blur", async () => {
    render(input());
    const i = $<HTMLInputElement>("#detail-mailchimpApiKey");
    expect(i.getAttribute("value")).toBeNull();
    i.value = "new-key";
    fire(i, "input");
    fire(i, "blur");
    await settle();
    expect(body()).toEqual({ field: "mailchimpApiKey", value: "new-key" });
    fire(i, "blur");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stored CRLF text is not a change: an edit undone before blur posts nothing (review round 2)", async () => {
    render(input({ site: siteRow({ copyIntro: "line one\r\nline two" }) }));
    const t = $<HTMLTextAreaElement>("#detail-copyIntro");
    // Type a character and delete it: an edit gesture, and the textarea back to
    // what a browser shows for the stored text, CR LF as LF.
    t.value = "line one\nline twox";
    fire(t, "input");
    t.value = "line one\nline two";
    fire(t, "input");
    fire(t, "blur");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("every editor is enabled once mounted (the SSR parity test pins it disabled before)", () => {
    render(input({ reports: [pending({ id: "rp" })] }));
    for (const el of document.querySelectorAll<HTMLInputElement>(
      "[data-detail-field], textarea[data-commentary-for]",
    ))
      expect(el.disabled, el.id).toBe(false);
  });

  it("a textarea and a date save the same way", async () => {
    render(input());
    const t = $<HTMLTextAreaElement>("#detail-copyIntro");
    t.value = "Hello";
    fire(t, "input");
    fire(t, "blur");
    await settle();
    expect(body()).toEqual({ field: "copyIntro", value: "Hello" });
    const d = $<HTMLInputElement>("#detail-testingDay");
    expect(d.value).toBe("2026-04-10");
    d.value = "2026-05-01";
    fire(d, "input");
    fire(d, "blur");
    await settle();
    expect(body()).toEqual({ field: "testingDay", value: "2026-05-01" });
  });

  it("a network failure marks ✗", async () => {
    render(input());
    fetchMock.mockRejectedValueOnce(new Error("x"));
    const s = $<HTMLSelectElement>("#detail-testingFreq");
    s.value = "None";
    fire(s, "change");
    await settle();
    expect(saved("testingFreq")).toBe(" failed");
  });
});

describe("commentary", () => {
  const blur = (el: Element) => {
    el.dispatchEvent(new Event("blur"));
    flushSync();
  };

  it("saves on blur only when changed, and moves its baseline on success", async () => {
    render(input({ reports: [pending({ id: "rp", commentary: "old" })] }));
    const t = $<HTMLTextAreaElement>('textarea[data-commentary-for="rp"]');
    blur(t);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    t.value = "new words";
    blur(t);
    await settle();
    expect(lastCall()).toEqual({
      url: "/api/reports/rp/commentary",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "new words" }),
      },
    });
    expect($('.commentary-saved[data-for="rp"]').textContent).toBe(" saved");
    blur(t);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stored CRLF text is not a change: a plain focus and blur posts nothing (review round 1)", async () => {
    render(input({ reports: [pending({ id: "rc", commentary: "line one\r\nline two" })] }));
    const t = $<HTMLTextAreaElement>('textarea[data-commentary-for="rc"]');
    // What a browser's textarea exposes for that text: CR LF normalised to LF.
    t.value = "line one\nline two";
    blur(t);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed save marks ✗ and retries on the next blur", async () => {
    render(input({ reports: [reportRow({ id: "ra", sentAt: null, approvedToSend: true })] }));
    const t = $<HTMLTextAreaElement>('textarea[data-commentary-for="ra"]');
    t.value = "typo fix";
    fetchMock.mockResolvedValueOnce(new Response("", { status: 409 }));
    blur(t);
    await settle();
    expect($('.commentary-saved[data-for="ra"]').textContent).toBe(" failed");
    fetchMock.mockRejectedValueOnce(new Error("x"));
    blur(t);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect($('.commentary-saved[data-for="ra"]').textContent).toBe(" failed");
  });
});

describe("submission status", () => {
  it("posts the status, then shows ✓ and stays disabled", async () => {
    render(input({ submissions: [makeSubmissionRow({ id: "s 1" })] }));
    const b = $<HTMLButtonElement>('button.subm-status[data-status="read"]');
    b.click();
    flushSync();
    expect(b.disabled).toBe(true);
    await settle();
    expect(lastCall()).toEqual({
      url: "/api/submissions/s%201/status",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "read" }),
      },
    });
    expect(b.textContent).toBe("Done");
    expect(b.disabled).toBe(true);
  });

  it("the bounce acknowledge posts { ack }", async () => {
    render(input({ submissions: [makeSubmissionRow({ id: "s1", notifyStatus: "bounced" })] }));
    $('button.subm-status[data-ack="notify-bounce"]').click();
    await settle();
    expect(lastCall().init.body).toBe(JSON.stringify({ ack: "notify-bounce" }));
  });

  it("a refusal or a network failure says Failed and re-enables", async () => {
    render(input({ submissions: [makeSubmissionRow({ id: "s1" })] }));
    const b = $<HTMLButtonElement>('button.subm-status[data-status="archived"]');
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    b.click();
    await settle();
    expect([b.textContent, b.disabled]).toEqual(["Failed", false]);
    fetchMock.mockRejectedValueOnce(new Error("x"));
    b.click();
    await settle();
    expect([b.textContent, b.disabled]).toEqual(["Failed", false]);
  });
});
