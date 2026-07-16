import { describe, it, expect } from "vitest";
import {
  renderSubmissionRow,
  SUBMISSION_STATUS_SCRIPT,
  isVisibleInStrip,
  SUBMISSION_STYLES,
} from "../../src/dashboard/submission-view.js";
import type { SubmissionRow } from "../../src/reports/submission-row.js";

function row(overrides: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: "sub_1",
    submissionId: 7,
    siteId: "recSite",
    formType: "contact",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "555-1234",
    message: "Hello <there>",
    extraFields: null,
    sourceUrl: "https://example.com/contact",
    utm: null,
    submittedAt: "2026-06-20T10:00:00.000Z",
    status: "new",
    notifyStatus: "sent",
    resendMessageId: null,
    ...overrides,
  };
}

describe("renderSubmissionRow", () => {
  it("renders the form type, submitter, status pill, and triage buttons", () => {
    const html = renderSubmissionRow(row());
    expect(html).toContain("contact");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
    expect(html).toContain("pill subm-new");
    expect(html).toContain('data-status="read"');
    expect(html).toContain('data-status="archived"');
    expect(html).toContain('data-status="spam"');
    expect(html).toContain("/api/submissions/sub_1/status");
  });
  it("escapes hostile content in the message", () => {
    const html = renderSubmissionRow(row({ message: "<img src=x onerror=alert(1)>" }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
  it("exposes the status client script as a string", () => {
    expect(SUBMISSION_STATUS_SCRIPT).toContain("button.subm-status");
    expect(SUBMISSION_STATUS_SCRIPT).toContain("b.dataset.status");
  });
});

describe("isVisibleInStrip", () => {
  it("hides auto-filtered spam from the per-site strip", () => {
    expect(isVisibleInStrip(row({ status: "spam_auto" }))).toBe(false);
  });
  it("keeps every other status in the strip", () => {
    for (const s of ["new", "read", "archived", "spam"] as const) {
      expect(isVisibleInStrip(row({ status: s }))).toBe(true);
    }
  });
});

describe("renderSubmissionRow — auto-spam provenance + recovery", () => {
  it("shows a provenance badge with score and reasons when scored", () => {
    const html = renderSubmissionRow(
      row({ status: "spam_auto", spamScore: 130, spamReason: "turnstile-fail,links:2" }),
    );
    expect(html).toContain("subm-provenance");
    expect(html).toContain("130");
    expect(html).toContain("turnstile-fail,links:2");
  });
  it("omits the provenance badge when there is no score", () => {
    const html = renderSubmissionRow(row({ status: "new", spamScore: null }));
    expect(html).not.toContain("subm-provenance");
  });
  it("offers a 'Not spam → new' recovery button only on auto-spam rows", () => {
    const auto = renderSubmissionRow(row({ status: "spam_auto", spamScore: 120 }));
    expect(auto).toContain("Not spam → new");
    expect(auto).toContain('data-status="new"');
    const clean = renderSubmissionRow(row({ status: "new" }));
    expect(clean).not.toContain("Not spam → new");
  });
  it("escapes hostile spamReason content in the badge title", () => {
    const html = renderSubmissionRow(
      row({ status: "spam_auto", spamScore: 100, spamReason: '"><img src=x>' }),
    );
    expect(html).not.toContain("<img src=x");
  });
});

describe("renderSubmissionRow — visible spam reasons (requireTurnstile canary)", () => {
  it("shows the reasons as visible chip text next to the badge, not only in the tooltip", () => {
    const html = renderSubmissionRow(
      row({
        status: "spam_auto",
        spamScore: 130,
        spamReason: "turnstile-required-absent,links:2",
      }),
    );
    // A text node, not an attribute value — tooltips never render on iPad/phone.
    expect(html).toContain('<span class="subm-reasons">turnstile-required-absent · links:2</span>');
    // The existing tooltip stays.
    expect(html).toContain('title="turnstile-required-absent,links:2"');
  });
  it("truncates a long reason list in the chip but keeps the full list in the detail row", () => {
    const html = renderSubmissionRow(
      row({ status: "spam_auto", spamScore: 200, spamReason: "a,b,c,d,e" }),
    );
    expect(html).toContain('<span class="subm-reasons">a · b · c +2 more</span>');
    expect(html).toContain('<span class="k">Spam</span> score 200 — a, b, c, d, e');
  });
  it("adds a Spam row (score + full reasons) to the expanded detail block", () => {
    const html = renderSubmissionRow(
      row({
        status: "spam_auto",
        spamScore: 130,
        spamReason: "turnstile-required-absent,duplicate-body",
      }),
    );
    expect(html).toContain(
      '<span class="k">Spam</span> score 130 — turnstile-required-absent, duplicate-body',
    );
  });
  it("shows the Spam detail row on a scored-but-delivered row (no auto-spam badge)", () => {
    const html = renderSubmissionRow(row({ status: "new", spamScore: 20, spamReason: "links:1" }));
    expect(html).toContain('<span class="k">Spam</span> score 20 — links:1');
    expect(html).not.toContain("subm-provenance");
  });
  it("omits the Spam detail row and chip on an unscored row", () => {
    const html = renderSubmissionRow(row({ status: "new" }));
    expect(html).not.toContain('<span class="k">Spam</span>');
    expect(html).not.toContain("subm-reasons");
  });
  it("escapes hostile spamReason content in the chip and detail row", () => {
    const html = renderSubmissionRow(
      row({ status: "spam_auto", spamScore: 100, spamReason: "<img src=x onerror=alert(1)>" }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("SUBMISSION_STYLES", () => {
  it("styles the spam_auto pill so a new status is not unstyled", () => {
    expect(SUBMISSION_STYLES).toContain(".pill.subm-spam_auto");
  });
});
