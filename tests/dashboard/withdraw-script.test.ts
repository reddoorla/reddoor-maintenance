import { describe, it, expect, vi } from "vitest";
import {
  renderSiteDashboardHtml,
  withdrawConfirmText,
  UNAPPROVE_CONFIRM_TEXT,
} from "../../src/dashboard/render.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { gatingFields } from "../../src/reports/checklist.js";
import type { ReportRow } from "../../src/reports/report-fields.js";

/**
 * P1-28: the page's action handlers, EXECUTED. The render tests only assert on
 * markup and the twin tests on the script's shape, so a "Don't send" handler
 * that fetched the approve URL — approving the draft it was meant to withdraw —
 * or skipped its confirm() would pass them all. This runs the served script
 * against a minimal DOM stub built from the rendered buttons and inputs, with fetch,
 * confirm and CSS stubbed, and clicks.
 */

const cleanEvidence = Object.fromEntries(
  gatingFields("Maintenance").map((f) => [
    f,
    { result: "pass" as const, checkedAt: "2026-09-01T00:00:00.000Z", note: "" },
  ]),
);

function pending(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP1",
    reportId: "rep_001",
    siteId: "recSITE",
    reportType: "Maintenance",
    period: "2026-09",
    periodStart: null,
    periodEnd: null,
    completedOn: "2026-09-30",
    lighthouse: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    searchFoundPage1: null,
    searchPosition: null,
    lastTestedDate: null,
    commentary: null,
    subjectOverride: null,
    draftReady: true,
    approvedToSend: false,
    sentAt: null,
    approvedAt: null,
    approvedBy: null,
    deliveryStatus: "pending",
    renderedHtmlAttachment: null,
    resendMessageId: null,
    checklist: {},
    autoEvidence: cleanEvidence,
    sendOverride: false,
    overrideReason: null,
    overrideBy: null,
    overrideAt: null,
    withdrawnAt: null,
    withdrawnBy: null,
    sendStartedAt: null,
    ...over,
  };
}

type Listener = () => Promise<void> | void;
type Btn = {
  tag: string;
  cls: string[];
  dataset: Record<string, string>;
  disabled: boolean;
  textContent: string;
  title: string;
  listeners: Listener[];
  addEventListener: (type: string, fn: Listener) => void;
  classList: { add: (c: string) => void; remove: (c: string) => void };
  setAttribute: () => void;
  removeAttribute: () => void;
  closest: () => { querySelector: (sel: string) => Record<string, unknown> };
};

const decode = (v: string) =>
  v
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function controlsFrom(html: string): Btn[] {
  const found = [
    ...[...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((m) => [
      "button",
      m[1]!,
      m[2]!,
    ]),
    ...[...html.matchAll(/<input\b([^>]*?)\/?>/g)].map((m) => ["input", m[1]!, ""]),
  ];
  return found.map(([tag, rawAttrs, text]) => {
    const m = [null, rawAttrs, text] as const;
    const attrs = Object.fromEntries(
      [...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1]!, decode(a[2]!)]),
    );
    const dataset: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("data-"))
        dataset[k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
    }
    const b: Btn = {
      tag: tag!,
      cls: (attrs.class ?? "").split(/\s+/),
      dataset,
      disabled: /\sdisabled(\s|$)/.test(m[1]!),
      textContent: decode(m[2]!),
      title: "",
      listeners: [],
      addEventListener: (type, fn) => {
        if (type === "click") b.listeners.push(fn);
      },
      classList: { add: () => {}, remove: () => {} },
      setAttribute: () => {},
      removeAttribute: () => {},
      // The override form around a submit: a filled reason and a status line.
      closest: () => ({
        querySelector: (sel: string) =>
          sel === ".override-reason" ? { value: "client asked", disabled: false } : {},
      }),
    };
    return b;
  });
}

/** The CSS.escape subset the ids here need, and a selector parser that undoes it
 *  — an id with a quote only resolves when the script escaped it. */
const CSS = { escape: (s: string) => s.replace(/["\\]/g, "\\$&") };

function page(reports: ReportRow[], responses: Record<string, { status: number; body: unknown }>) {
  const html = renderSiteDashboardHtml(
    makeWebsiteRow({
      id: "recSITE",
      name: "Acme",
      pointOfContact: "owner@acme.example.com",
      headerImage: { url: "https://x/h.png", filename: "h.png", type: "image/png" },
    }),
    reports,
    [],
    null,
    new Date("2026-09-30T12:00:00Z"),
    null,
  );
  const buttons = controlsFrom(html);
  const document = {
    querySelectorAll: (sel: string) => {
      const m = /^(button|input)\.([\w-]+)(?:\[data-report-id="((?:\\.|[^"\\])*)"\])?$/.exec(sel);
      if (!m) return [];
      const id = m[3]?.replace(/\\(.)/g, "$1");
      return buttons.filter(
        (b) =>
          b.tag === m[1] &&
          b.cls.includes(m[2]!) &&
          (id === undefined || b.dataset.reportId === id),
      );
    },
    querySelector: () => null,
  };
  const fetch = vi.fn(async (url: string) => {
    const r = responses[url] ?? { status: 500, body: null };
    if (r.status === 0) throw new TypeError("Failed to fetch");
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  });
  const confirm = vi.fn(() => true);
  const src = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  new Function("document", "fetch", "confirm", "CSS", src)(document, fetch, confirm, CSS);
  const find = (cls: string, id = "recREP1") =>
    buttons.filter((b) => b.cls.includes(cls) && b.dataset.reportId === id);
  const click = async (b: Btn) => {
    for (const fn of b.listeners) await fn();
  };
  return { buttons, fetch, confirm, find, click };
}

const WITHDRAW = "/api/reports/recREP1/withdraw";
const APPROVE = "/api/reports/recREP1/approve";

describe("Don't send — the served handler, executed", () => {
  it("confirm() declined → no request at all, button untouched", async () => {
    const p = page([pending()], { [WITHDRAW]: { status: 200, body: { status: "withdrawn" } } });
    p.confirm.mockReturnValue(false);
    const [w] = p.find("withdraw");
    await p.click(w!);
    expect(p.confirm).toHaveBeenCalledWith(withdrawConfirmText(pending()));
    expect(p.fetch).not.toHaveBeenCalled();
    expect(w!.disabled).toBe(false);
  });

  it("confirm() accepted → exactly one POST, to the WITHDRAW url, after the confirm", async () => {
    const p = page([pending()], { [WITHDRAW]: { status: 200, body: { status: "withdrawn" } } });
    const [w] = p.find("withdraw");
    await p.click(w!);
    expect(p.fetch).toHaveBeenCalledTimes(1);
    expect(p.fetch).toHaveBeenCalledWith(WITHDRAW, { method: "POST" });
    expect(p.confirm.mock.invocationCallOrder[0]!).toBeLessThan(
      p.fetch.mock.invocationCallOrder[0]!,
    );
    expect(w!.textContent).toBe("Withdrawn");
  });

  it("success disables EVERY approve twin (and the override controls)", async () => {
    const red = pending({ autoEvidence: {} });
    const p = page([red], { [WITHDRAW]: { status: 200, body: { status: "withdrawn" } } });
    const twins = p.find("approve");
    expect(twins).toHaveLength(2);
    twins.forEach((t) => (t.disabled = false));
    const override = ["override-toggle", "override-submit", "override-reason"].map(
      (c) => p.find(c)[0]!,
    );
    override.forEach((c) => expect(c.disabled).toBe(false));
    await p.click(p.find("withdraw")[0]!);
    for (const t of twins) {
      expect(t.disabled).toBe(true);
      expect(t.textContent).toBe("Withdrawn");
    }
    override.forEach((c) => expect(c.disabled).toBe(true));
  });

  it("a refusal it can retry re-enables the button and names the reason", async () => {
    const p = page([pending()], {
      [WITHDRAW]: { status: 409, body: { status: "noop", reason: "not-draft-ready" } },
    });
    const [w] = p.find("withdraw");
    await p.click(w!);
    expect(w!.disabled).toBe(false);
    expect(w!.textContent).toBe("Failed: not-draft-ready");
  });

  it("refused as already approved → stays disabled, says so, and the approve twins read Approved", async () => {
    const p = page([pending()], {
      [WITHDRAW]: { status: 409, body: { status: "noop", reason: "already-approved" } },
    });
    const [w] = p.find("withdraw");
    const twins = p.find("approve");
    await p.click(w!);
    expect(w!.disabled).toBe(true);
    expect(w!.textContent).toBe("Already approved");
    for (const t of twins) {
      expect(t.textContent).toBe("Approved");
      expect(t.disabled).toBe(true);
    }
  });

  it("refused as already sent → stays disabled and says so", async () => {
    const p = page([pending()], {
      [WITHDRAW]: { status: 409, body: { status: "noop", reason: "already-sent" } },
    });
    const [w] = p.find("withdraw");
    await p.click(w!);
    expect(w!.disabled).toBe(true);
    expect(w!.textContent).toBe("Already sent");
  });

  it("a network error re-enables the button reading Failed", async () => {
    const p = page([pending()], { [WITHDRAW]: { status: 0, body: null } });
    const [w] = p.find("withdraw");
    await p.click(w!);
    expect(w!.disabled).toBe(false);
    expect(w!.textContent).toBe("Failed");
  });
});

describe("Approve / override vs a withdrawn report — the served handlers, executed", () => {
  it("approve answered 409 withdrawn → twins read Withdrawn and stay disabled; Don't send goes dead", async () => {
    const p = page([pending()], {
      [APPROVE]: { status: 409, body: { status: "noop", reason: "withdrawn" } },
    });
    const twins = p.find("approve");
    await p.click(twins[0]!);
    for (const t of twins) {
      expect(t.textContent).toBe("Withdrawn");
      expect(t.disabled).toBe(true);
    }
    expect(p.find("withdraw")[0]!.disabled).toBe(true);
  });

  it("approve answered 409 withdrawn → the override toggle, submit and reason go dead too", async () => {
    const p = page([pending({ autoEvidence: {} })], {
      [APPROVE]: { status: 409, body: { status: "noop", reason: "withdrawn" } },
    });
    const override = ["override-toggle", "override-submit", "override-reason"].map(
      (c) => p.find(c)[0]!,
    );
    override.forEach((c) => expect(c.disabled).toBe(false));
    await p.click(p.find("approve")[0]!);
    override.forEach((c) => expect(c.disabled).toBe(true));
  });

  it("an approve network error re-enables every twin reading Failed", async () => {
    const p = page([pending()], { [APPROVE]: { status: 0, body: null } });
    const twins = p.find("approve");
    await p.click(twins[0]!);
    for (const t of twins) {
      expect(t.textContent).toBe("Failed");
      expect(t.disabled).toBe(false);
    }
  });

  it("approve success disables Don't send", async () => {
    const p = page([pending()], { [APPROVE]: { status: 200, body: { status: "approved" } } });
    await p.click(p.find("approve")[0]!);
    expect(p.find("withdraw")[0]!.disabled).toBe(true);
  });

  it("override success disables Don't send", async () => {
    const url = "/api/reports/recREP1/approve?override=1";
    const p = page([pending({ autoEvidence: {} })], {
      [url]: { status: 200, body: { status: "overridden" } },
    });
    await p.click(p.find("override-submit")[0]!);
    expect(p.fetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: "POST" }));
    expect(p.find("withdraw")[0]!.disabled).toBe(true);
  });

  it("control: an approve failure for another reason re-enables the twins and leaves Don't send", async () => {
    const p = page([pending()], {
      [APPROVE]: { status: 409, body: { status: "blocked", reason: "send-blocked", blockers: [] } },
    });
    const twins = p.find("approve");
    await p.click(twins[0]!);
    for (const t of twins) {
      expect(t.textContent).toBe("Blocked");
      expect(t.disabled).toBe(false);
    }
    expect(p.find("withdraw")[0]!.disabled).toBe(false);
  });

  it("an id carrying a quote still reaches both twins (the selector is CSS-escaped)", async () => {
    const id = 'rec"Q';
    const url = `/api/reports/${encodeURIComponent(id)}/approve`;
    const p = page([pending({ id })], { [url]: { status: 200, body: { status: "approved" } } });
    const twins = p.find("approve", id);
    expect(twins).toHaveLength(2);
    await p.click(twins[0]!);
    for (const t of twins) expect(t.textContent).toBe("Approved");
  });
});

const UNAPPROVE = "/api/reports/recREP1/unapprove";
const approved = (over: Partial<ReportRow> = {}) =>
  pending({
    approvedToSend: true,
    approvedAt: "2026-10-08T15:11:12Z",
    approvedBy: "dashboard",
    ...over,
  });

describe("Unapprove (#1262) — rendered only where it can succeed", () => {
  it("an approved, unsent report carries exactly one Unapprove and no Approve", () => {
    const p = page([approved()], {});
    expect(p.find("unapprove")).toHaveLength(1);
    expect(p.find("approve")).toHaveLength(0);
  });

  it.each([
    ["a pending draft", pending()],
    ["a sent report", approved({ sentAt: "2026-10-09T09:23:00Z" })],
    ["a withdrawn report", approved({ withdrawnAt: "2026-10-08T00:00:00Z" })],
    ["a report the send batch has claimed", approved({ sendStartedAt: "2026-10-09T16:07:03Z" })],
  ])("%s carries no Unapprove", (_, r) => {
    expect(page([r], {}).find("unapprove")).toHaveLength(0);
  });

  it("a claimed, unsent report says when its send started instead", () => {
    const html = renderSiteDashboardHtml(
      makeWebsiteRow({ id: "recSITE", name: "Acme" }),
      [approved({ sendStartedAt: "2026-10-09T16:07:03Z" })],
      [],
      null,
      new Date("2026-10-09T17:00:00Z"),
      null,
    );
    expect(html).toContain("Send started 2026-10-09 16:07Z");
  });
});

describe("Unapprove — the served handler, executed", () => {
  const withLocation = async (fn: (reload: ReturnType<typeof vi.fn>) => Promise<void>) => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    try {
      await fn(reload);
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it("confirm() declined → no request at all, button untouched", async () => {
    const p = page([approved()], { [UNAPPROVE]: { status: 200, body: { status: "unapproved" } } });
    p.confirm.mockReturnValue(false);
    const [u] = p.find("unapprove");
    await p.click(u!);
    expect(p.confirm).toHaveBeenCalledWith(UNAPPROVE_CONFIRM_TEXT);
    expect(p.fetch).not.toHaveBeenCalled();
    expect(u!.disabled).toBe(false);
  });

  it("confirm() accepted → exactly one POST, to the UNAPPROVE url, then a reload", async () => {
    await withLocation(async (reload) => {
      const p = page([approved()], {
        [UNAPPROVE]: { status: 200, body: { status: "unapproved" } },
      });
      const [u] = p.find("unapprove");
      await p.click(u!);
      expect(p.fetch).toHaveBeenCalledTimes(1);
      expect(p.fetch).toHaveBeenCalledWith(UNAPPROVE, { method: "POST" });
      expect(u!.textContent).toBe("Unapproved");
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  it("refused as already sent → stays disabled, says so, no reload", async () => {
    await withLocation(async (reload) => {
      const p = page([approved()], {
        [UNAPPROVE]: { status: 409, body: { status: "noop", reason: "already-sent" } },
      });
      const [u] = p.find("unapprove");
      await p.click(u!);
      expect(u!.disabled).toBe(true);
      expect(u!.textContent).toBe("Already sent");
      expect(reload).not.toHaveBeenCalled();
    });
  });

  it("refused as sending → stays disabled and says so", async () => {
    const p = page([approved()], {
      [UNAPPROVE]: { status: 409, body: { status: "noop", reason: "sending" } },
    });
    const [u] = p.find("unapprove");
    await p.click(u!);
    expect(u!.disabled).toBe(true);
    expect(u!.textContent).toBe("Sending now");
  });

  it("refused as withdrawn → stays disabled and says so", async () => {
    const p = page([approved()], {
      [UNAPPROVE]: { status: 409, body: { status: "noop", reason: "withdrawn" } },
    });
    const [u] = p.find("unapprove");
    await p.click(u!);
    expect(u!.disabled).toBe(true);
    expect(u!.textContent).toBe("Withdrawn");
  });

  it("a network error re-enables the button reading Failed", async () => {
    const p = page([approved()], { [UNAPPROVE]: { status: 0, body: null } });
    const [u] = p.find("unapprove");
    await p.click(u!);
    expect(u!.disabled).toBe(false);
    expect(u!.textContent).toBe("Failed");
  });
});
