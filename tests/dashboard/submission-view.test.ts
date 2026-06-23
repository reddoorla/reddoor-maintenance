import { describe, it, expect } from "vitest";
import {
  renderSubmissionRow,
  SUBMISSION_STATUS_SCRIPT,
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
