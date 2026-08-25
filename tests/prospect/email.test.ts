import { describe, it, expect } from "vitest";
import {
  buildAuditEmail,
  sendAuditEmail,
  parseProspectAuditRecipients,
} from "../../src/prospect/email.js";
import { renderProspectReport } from "../../src/prospect/render.js";
import { PROBES_SKIPPED, ANALYZE_SKIPPED } from "../../src/prospect/pipeline.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";
import type {
  AnalyzeResult,
  ChecksResult,
  CrawlResult,
  LighthouseScores,
  ProbesResult,
  ProspectAuditResult,
} from "../../src/prospect/types.js";

// Fixture style mirrors tests/prospect/render.test.ts — same field shapes, a
// local `over` builder per stage, and a `result()` that assembles a full,
// valid ProspectAuditResult with everything measured by default.

function crawlData(over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    origin: "https://acme.example",
    robotsTxt: null,
    agentAccess: [],
    sitemap: { present: true, urlCount: 3 },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages: [],
    ...over,
  };
}

function checksData(over: Partial<ChecksResult> = {}): ChecksResult {
  return {
    crawlerAccessMeasured: true,
    crawlerAccess: { blockedAi: [], allowedAi: ["GPTBot"], blockedClassical: [] },
    jsDependence: {
      avgMissing: 0.1,
      perPage: [{ url: "https://acme.example/", missing: 0.1, renderedWords: 400 }],
    },
    schema: { typesFound: ["LocalBusiness"], missingExpected: [], invalidBlocks: 0 },
    meta: {
      pageCount: 1,
      missingTitle: 0,
      missingDescription: 0,
      missingCanonical: 0,
      missingSocial: 0,
      pagesWithoutExtract: 0,
    },
    headings: { pagesWithoutH1: 0, pagesWithLevelSkips: 0 },
    securityHeaders: { present: ["x-frame-options"], missing: [] },
    sitemapMeasured: true,
    sitemapPresent: true,
    llmsTxtMeasured: true,
    llmsTxtPresent: false,
    viewportOk: true,
    ...over,
  };
}

function lighthouseData(over: Partial<LighthouseScores> = {}): LighthouseScores {
  return {
    performance: 80,
    accessibility: 90,
    bestPractices: 85,
    seo: 95,
    summary: "lighthouse: all categories passing",
    status: "pass",
    ...over,
  };
}

function analyzeData(over: Partial<AnalyzeResult> = {}): AnalyzeResult {
  return {
    businessName: "Acme Roofing",
    business: "A roofing contractor.",
    entityClarity: { score: 80, missing: [] },
    buyerQuestions: [
      {
        question: "cost?",
        answered: "yes",
        quotable: true,
        page: "https://acme.example/",
        evidence: "$1,200",
      },
    ],
    fixes: [
      {
        title: "Add a sitemap",
        why: "Crawlers can't discover pages.",
        impact: "high",
        effort: "low",
        tier: "crawl",
      },
      {
        title: "Fix headings",
        why: "H1 is missing on the homepage.",
        impact: "medium",
        effort: "low",
        tier: "content",
      },
      {
        title: "Add FAQ schema",
        why: "Answer engines quote FAQ blocks.",
        impact: "low",
        effort: "medium",
        tier: "content",
      },
      {
        title: "Compress hero image",
        why: "It's slowing first paint.",
        impact: "low",
        effort: "low",
        tier: "technical",
      },
    ],
    narrative: { findability: "ok", readability: "ok", answers: "ok" },
    ...over,
  };
}

function probesData(over: Partial<ProbesResult> = {}): ProbesResult {
  return {
    answers: [],
    visibilityScore: 50,
    brandedRecognized: true,
    competitorsSeen: [],
    ...over,
  };
}

function result(over: Partial<ProspectAuditResult> = {}): ProspectAuditResult {
  return {
    url: "https://acme.example/",
    businessName: "Acme Roofing",
    generatedAt: "2026-08-24T12:00:00.000Z",
    scores: { findability: 80, readability: 70, answers: 90, aiVisibility: 50 },
    crawl: { ok: true, data: crawlData() },
    checks: { ok: true, data: checksData() },
    lighthouse: { ok: true, data: lighthouseData() },
    analyze: { ok: true, data: analyzeData() },
    probes: { ok: true, data: probesData() },
    ...over,
  };
}

function captureResend(): { client: ResendClient; sent: ResendSendInput[] } {
  const sent: ResendSendInput[] = [];
  return {
    sent,
    client: {
      async send(input) {
        sent.push(input);
        return { messageId: `msg_${sent.length}` };
      },
    },
  };
}

describe("buildAuditEmail", () => {
  it("names the business in the subject", () => {
    const { subject } = buildAuditEmail(result(), { link: "https://x/r/tok" });
    expect(subject).toContain("Acme Roofing");
  });

  it("falls back to the hostname when no business name resolved", () => {
    const { subject, html } = buildAuditEmail(result({ businessName: null }), { link: null });
    expect(subject).toContain("acme.example");
    expect(html).toContain("acme.example");
  });

  it("shows all four scores with their labels", () => {
    const { html } = buildAuditEmail(result(), { link: null });
    for (const label of ["Findability", "Readability", "Answers", "AI Visibility"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("80");
    expect(html).toContain("70");
  });

  it("names an unmeasured score as 'Not measured' rather than printing a number", () => {
    const r = result({
      scores: { findability: 80, readability: 70, answers: null, aiVisibility: null },
      analyze: { ok: false, error: ANALYZE_SKIPPED },
      probes: { ok: false, error: PROBES_SKIPPED },
    });
    const { html } = buildAuditEmail(r, { link: null });
    expect(html).toContain("Not measured");
    // The section names WHICH scores and why, in plain words — not just a bare count.
    expect(html).toContain("Answers");
    expect(html).toContain(ANALYZE_SKIPPED);
    expect(html).toContain("AI Visibility");
    expect(html).toContain(PROBES_SKIPPED);
  });

  it("explains a checks-stage failure for both findability and readability", () => {
    const r = result({
      scores: { findability: null, readability: null, answers: 90, aiVisibility: 50 },
      checks: { ok: false, error: "fetch timed out after 30s" },
    });
    const { html } = buildAuditEmail(r, { link: null });
    expect(html).toContain("fetch timed out after 30s");
    expect(html.match(/fetch timed out after 30s/g)?.length).toBe(2);
  });

  it("explains a lighthouse failure even when it didn't null a score", () => {
    const r = result({ lighthouse: { ok: false, error: "lhci crashed" } });
    const { html } = buildAuditEmail(r, { link: null });
    expect(html).toContain("Lighthouse");
    expect(html).toContain("lhci crashed");
  });

  it("says nothing was unmeasured when every stage succeeded and every score is present", () => {
    const { html } = buildAuditEmail(result(), { link: "https://x/r/tok" });
    expect(html).not.toContain("Not measured</h2>");
  });

  it("lists only the top few fixes, in impact order", () => {
    const { html } = buildAuditEmail(result(), { link: null });
    expect(html).toContain("Add a sitemap");
    expect(html).toContain("Fix headings");
    // The 4th fixture fix (low impact) is beyond the "top few" cutoff.
    expect(html).not.toContain("Compress hero image");
    expect(html.indexOf("Add a sitemap")).toBeLessThan(html.indexOf("Fix headings"));
  });

  it("explains fixes are unavailable when analyze failed, instead of an empty list", () => {
    const r = result({ analyze: { ok: false, error: ANALYZE_SKIPPED } });
    const { html } = buildAuditEmail(r, { link: null });
    expect(html).toContain("Fixes not available");
    expect(html).toContain(ANALYZE_SKIPPED);
  });

  it("includes the shareable link when present, and a plain note when it's null", () => {
    const withLink = buildAuditEmail(result(), { link: "https://dash.example/r/abc123" });
    expect(withLink.html).toContain("https://dash.example/r/abc123");

    const withoutLink = buildAuditEmail(result(), { link: null });
    expect(withoutLink.html).toContain("No shareable link");
    expect(withoutLink.html).toContain("attached");
  });

  it("escapes untrusted business name, fix text and stage error text in the HTML body", () => {
    const r = result({
      businessName: "<img src=x onerror=alert(1)> & Sons",
      analyze: {
        ok: true,
        data: analyzeData({
          fixes: [
            {
              title: "<script>steal()</script>",
              why: "Because <b>reasons</b> & stuff",
              impact: "high",
              effort: "low",
              tier: "content",
            },
          ],
        }),
      },
      lighthouse: { ok: false, error: "<script>alert(2)</script>" },
    });
    const { html } = buildAuditEmail(r, { link: null });
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script>steal()</script>");
    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; Sons");
  });

  it("collapses a newline embedded in the business name so it can't break the subject header", () => {
    const r = result({ businessName: "Acme\r\nBcc: attacker@evil.example" });
    const { subject } = buildAuditEmail(r, { link: null });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain("Acme Bcc: attacker@evil.example");
  });

  it("returns the real rendered client-facing report as attachmentHtml", () => {
    const r = result();
    const { attachmentHtml } = buildAuditEmail(r, { link: null });
    expect(attachmentHtml).toBe(renderProspectReport(r));
  });
});

describe("parseProspectAuditRecipients", () => {
  it("splits, trims, and drops empties", () => {
    expect(parseProspectAuditRecipients(" tucker@x.com ,tim@x.com,, erik@x.com ")).toEqual([
      "tucker@x.com",
      "tim@x.com",
      "erik@x.com",
    ]);
  });

  it("dedupes case-insensitively", () => {
    expect(parseProspectAuditRecipients("a@x.com, A@X.com")).toEqual(["a@x.com"]);
  });

  it("returns [] for undefined, null, empty, or all-whitespace input", () => {
    expect(parseProspectAuditRecipients(undefined)).toEqual([]);
    expect(parseProspectAuditRecipients(null)).toEqual([]);
    expect(parseProspectAuditRecipients("")).toEqual([]);
    expect(parseProspectAuditRecipients("   ,  ,")).toEqual([]);
  });
});

describe("sendAuditEmail", () => {
  it("returns {sent:false} with no recipients, and never touches the client", async () => {
    const { client, sent } = captureResend();
    const res = await sendAuditEmail(result(), { link: null, recipients: [], client });
    expect(res).toEqual({
      sent: false,
      reason: "no recipients configured (PROSPECT_AUDIT_RECIPIENTS is unset or empty)",
    });
    expect(sent).toHaveLength(0);
  });

  it("sends from the reports FROM_ADDRESS, to the given recipients, with the built subject/html", async () => {
    const { client, sent } = captureResend();
    const r = result();
    const res = await sendAuditEmail(r, {
      link: "https://dash.example/r/tok123",
      recipients: ["tucker@reddoorla.com", "tim@reddoorla.com"],
      client,
    });
    expect(res.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.from).toBe("Reddoor Reports <reports@reddoorla.com>");
    expect(sent[0]!.to).toEqual(["tucker@reddoorla.com", "tim@reddoorla.com"]);
    expect(sent[0]!.subject).toContain("Acme Roofing");
    expect(sent[0]!.html).toContain("https://dash.example/r/tok123");
  });

  it("attaches the FULL real rendered report as a base64 .html file", async () => {
    const { client, sent } = captureResend();
    const r = result();
    await sendAuditEmail(r, { link: null, recipients: ["tucker@reddoorla.com"], client });
    const attachments = sent[0]!.attachments;
    expect(attachments).toHaveLength(1);
    const attachment = attachments![0]!;
    expect(attachment.filename).toMatch(/\.html$/);
    expect(attachment.contentType).toBe("text/html");
    const decoded = Buffer.from(attachment.content, "base64").toString("utf-8");
    expect(decoded).toBe(renderProspectReport(r));
  });

  it("derives the idempotency key from the audit id when given", async () => {
    const { client, sent } = captureResend();
    await sendAuditEmail(result(), {
      link: null,
      recipients: ["tucker@reddoorla.com"],
      client,
      auditId: "pa_abc123",
    });
    expect(sent[0]!.idempotencyKey).toBe("prospect-audit:pa_abc123");
  });

  it("falls back to url+generatedAt for the idempotency key when there's no audit id", async () => {
    const { client, sent } = captureResend();
    const r = result();
    await sendAuditEmail(r, { link: null, recipients: ["tucker@reddoorla.com"], client });
    expect(sent[0]!.idempotencyKey).toBe(`prospect-audit:${r.url}#${r.generatedAt}`);
  });

  it("honors a renderReport override for the attachment only, without changing the sheet body", async () => {
    const { client, sent } = captureResend();
    const r = result();
    await sendAuditEmail(r, {
      link: null,
      recipients: ["tucker@reddoorla.com"],
      client,
      renderReport: () => "<html>stub report</html>",
    });
    const attachment = sent[0]!.attachments![0]!;
    expect(Buffer.from(attachment.content, "base64").toString("utf-8")).toBe(
      "<html>stub report</html>",
    );
    expect(sent[0]!.html).toContain("Acme Roofing");
  });

  it("propagates a throwing client rather than swallowing it", async () => {
    const client: ResendClient = {
      async send() {
        throw new Error("simulated resend outage");
      },
    };
    await expect(
      sendAuditEmail(result(), { link: null, recipients: ["tucker@reddoorla.com"], client }),
    ).rejects.toThrow("simulated resend outage");
  });
});

describe("buildAuditEmail — internal framing", () => {
  it("labels the sheet as internal and points at the attachment", () => {
    const { html } = buildAuditEmail(result(), {
      link: "https://dash.test/r/AAAAAAAAAAAAAAAAAAAAAA",
    });
    // The body carries the real reasons a stage failed, which are useful to us
    // and wrong in front of a prospect — so it must say which artefact is the
    // shareable one, or the natural thing to do with a useful email is forward it.
    expect(html).toMatch(/internal sheet/i);
    expect(html).toMatch(/attached/i);
  });
});
