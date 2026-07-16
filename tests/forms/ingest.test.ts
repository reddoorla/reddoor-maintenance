import { describe, it, expect, vi } from "vitest";
import { ingestSubmission, type IngestDeps } from "../../src/forms/ingest.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

function deps(over: Partial<IngestDeps> = {}): IngestDeps {
  return {
    getWebsiteBySlug: vi.fn().mockResolvedValue(makeWebsiteRow({ id: "recSITE" })),
    createSubmission: vi.fn().mockResolvedValue(makeSubmissionRow({ id: "recSUB" })),
    notify: vi.fn().mockResolvedValue({ status: "sent", messageId: "msg_1" }),
    stampNotified: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-06-14T12:00:00Z"),
    ...over,
  };
}

describe("ingestSubmission", () => {
  it("rejects an invalid payload before touching Airtable", async () => {
    const d = deps();
    const r = await ingestSubmission(d, "acme", { name: "no contact info" });
    expect(r.status).toBe("rejected");
    expect(d.createSubmission).not.toHaveBeenCalled();
  });

  it("returns unknown-site when the slug doesn't resolve", async () => {
    const d = deps({ getWebsiteBySlug: vi.fn().mockResolvedValue(null) });
    const r = await ingestSubmission(d, "nope", { email: "a@b.co" });
    expect(r).toEqual({ status: "unknown-site", slug: "nope" });
    expect(d.createSubmission).not.toHaveBeenCalled();
  });

  it("persists, notifies, stamps, and accepts on the happy path", async () => {
    const d = deps();
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" });
    expect(r).toEqual({ status: "accepted", submissionId: "recSUB", notifyStatus: "sent" });
    expect(d.createSubmission).toHaveBeenCalledTimes(1);
    // Pin the field mapping: siteId from the resolved site, submittedAt from now(),
    // defined optional fields present, undefined ones omitted.
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: "recSITE",
        email: "a@b.co",
        message: "hi",
        submittedAt: new Date("2026-06-14T12:00:00Z"),
      }),
    );
    // undefined optional fields are omitted, not passed as undefined
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.not.objectContaining({ phone: expect.anything() }),
    );
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "sent", "msg_1");
  });

  it("still accepts (notifyStatus=failed) when notify throws — the lead is already saved", async () => {
    const d = deps({ notify: vi.fn().mockRejectedValue(new Error("boom")) });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co" });
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("failed");
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "failed", null);
  });

  it("forwards a newsletter submission to the site webhook when configured", async () => {
    const site = makeWebsiteRow({ id: "recSITE", newsletterWebhook: "https://hooks.zapier.com/x" });
    const row = makeSubmissionRow({ id: "recSUB", formType: "newsletter" });
    const forwardNewsletter = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi.fn().mockResolvedValue(row),
      forwardNewsletter,
    });
    const r = await ingestSubmission(d, "acme", { formType: "newsletter", email: "a@b.co" });
    expect(r.status).toBe("accepted");
    expect(forwardNewsletter).toHaveBeenCalledTimes(1);
    expect(forwardNewsletter).toHaveBeenCalledWith("https://hooks.zapier.com/x", row, site);
  });

  it("does not forward a non-newsletter submission even when a webhook is set", async () => {
    const site = makeWebsiteRow({ id: "recSITE", newsletterWebhook: "https://hooks.zapier.com/x" });
    const forwardNewsletter = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      forwardNewsletter,
    });
    const r = await ingestSubmission(d, "acme", { formType: "contact", email: "a@b.co" });
    expect(r.status).toBe("accepted");
    expect(forwardNewsletter).not.toHaveBeenCalled();
  });

  it("does not forward a newsletter submission when the site has no webhook", async () => {
    const site = makeWebsiteRow({ id: "recSITE", newsletterWebhook: null });
    const forwardNewsletter = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      forwardNewsletter,
    });
    const r = await ingestSubmission(d, "acme", { formType: "newsletter", email: "a@b.co" });
    expect(r.status).toBe("accepted");
    expect(forwardNewsletter).not.toHaveBeenCalled();
  });

  it("swallows a webhook forward failure — the lead is still accepted", async () => {
    const site = makeWebsiteRow({ id: "recSITE", newsletterWebhook: "https://hooks.zapier.com/x" });
    const forwardNewsletter = vi.fn().mockRejectedValue(new Error("network down"));
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      forwardNewsletter,
    });
    const r = await ingestSubmission(d, "acme", { formType: "newsletter", email: "a@b.co" });
    expect(r.status).toBe("accepted");
    expect(forwardNewsletter).toHaveBeenCalledTimes(1);
  });

  it("adds a newsletter submitter to Mailchimp when both fields are set", async () => {
    const site = makeWebsiteRow({
      id: "recSITE",
      mailchimpApiKey: "abc123-us21",
      mailchimpAudienceId: "aud1",
    });
    const row = makeSubmissionRow({ id: "recSUB", formType: "newsletter" });
    const addToMailchimp = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi.fn().mockResolvedValue(row),
      addToMailchimp,
    });
    const r = await ingestSubmission(d, "acme", { formType: "newsletter", email: "a@b.co" });
    expect(r.status).toBe("accepted");
    expect(addToMailchimp).toHaveBeenCalledTimes(1);
    expect(addToMailchimp).toHaveBeenCalledWith(site, row);
  });

  it("does not add a non-newsletter submission to Mailchimp even when configured", async () => {
    const site = makeWebsiteRow({
      id: "recSITE",
      mailchimpApiKey: "abc123-us21",
      mailchimpAudienceId: "aud1",
    });
    const addToMailchimp = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const d = deps({ getWebsiteBySlug: vi.fn().mockResolvedValue(site), addToMailchimp });
    const r = await ingestSubmission(d, "acme", { formType: "contact", email: "a@b.co" });
    expect(r.status).toBe("accepted");
    expect(addToMailchimp).not.toHaveBeenCalled();
  });

  it("does not add to Mailchimp when only one of the two fields is set", async () => {
    const site = makeWebsiteRow({
      id: "recSITE",
      mailchimpApiKey: null,
      mailchimpAudienceId: "aud1",
    });
    const addToMailchimp = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const d = deps({ getWebsiteBySlug: vi.fn().mockResolvedValue(site), addToMailchimp });
    const r = await ingestSubmission(d, "acme", { formType: "newsletter", email: "a@b.co" });
    expect(r.status).toBe("accepted");
    expect(addToMailchimp).not.toHaveBeenCalled();
  });

  it("swallows a Mailchimp add failure — the lead is still accepted", async () => {
    const site = makeWebsiteRow({
      id: "recSITE",
      mailchimpApiKey: "abc123-us21",
      mailchimpAudienceId: "aud1",
    });
    const addToMailchimp = vi.fn().mockRejectedValue(new Error("mailchimp down"));
    const d = deps({ getWebsiteBySlug: vi.fn().mockResolvedValue(site), addToMailchimp });
    const r = await ingestSubmission(d, "acme", { formType: "newsletter", email: "a@b.co" });
    expect(r.status).toBe("accepted");
    expect(addToMailchimp).toHaveBeenCalledTimes(1);
  });

  it("fires BOTH the webhook and Mailchimp when both are configured", async () => {
    const site = makeWebsiteRow({
      id: "recSITE",
      newsletterWebhook: "https://hooks.zapier.com/x",
      mailchimpApiKey: "abc123-us21",
      mailchimpAudienceId: "aud1",
    });
    const row = makeSubmissionRow({ id: "recSUB", formType: "newsletter" });
    const forwardNewsletter = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const addToMailchimp = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi.fn().mockResolvedValue(row),
      forwardNewsletter,
      addToMailchimp,
    });
    const r = await ingestSubmission(d, "acme", { formType: "newsletter", email: "a@b.co" });
    expect(r.status).toBe("accepted");
    expect(forwardNewsletter).toHaveBeenCalledWith("https://hooks.zapier.com/x", row, site);
    expect(addToMailchimp).toHaveBeenCalledWith(site, row);
  });

  it("testMode: suppresses ALL routing — no row, no notify, no fan-out — and accepts", async () => {
    const forwardNewsletter = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const addToMailchimp = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const d = deps({ forwardNewsletter, addToMailchimp });
    const r = await ingestSubmission(d, "acme", {
      email: "monitor+e2e@reddoorla.com",
      message: "hi",
      testMode: true,
    });
    expect(r).toEqual({ status: "accepted", submissionId: "test-mode", notifyStatus: "skipped" });
    expect(d.createSubmission).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.stampNotified).not.toHaveBeenCalled();
    expect(forwardNewsletter).not.toHaveBeenCalled();
    expect(addToMailchimp).not.toHaveBeenCalled();
  });

  it("testMode: bypasses Turnstile enforcement even on a requireTurnstile site with a fail token", async () => {
    const d = deps({
      getWebsiteBySlug: vi
        .fn()
        .mockResolvedValue(makeWebsiteRow({ id: "recSITE", requireTurnstile: true })),
    });
    // 4th arg "fail" would auto-spam a normal submission; testMode routes away entirely.
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", testMode: true }, "fail");
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("skipped");
    expect(d.createSubmission).not.toHaveBeenCalled();
  });

  it("testMode: still validates the payload first (a junk body is rejected, not smuggled through)", async () => {
    const d = deps();
    const r = await ingestSubmission(d, "acme", { testMode: true });
    expect(r.status).toBe("rejected");
    expect(d.createSubmission).not.toHaveBeenCalled();
  });

  it("testMode: an unknown site still returns unknown-site (marker grants no bypass of resolution)", async () => {
    const d = deps({ getWebsiteBySlug: vi.fn().mockResolvedValue(null) });
    const r = await ingestSubmission(d, "nope", { email: "a@b.co", testMode: true });
    expect(r).toEqual({ status: "unknown-site", slug: "nope" });
  });

  it("a normal submission (no testMode) is unaffected — still persists + notifies", async () => {
    const d = deps();
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" });
    expect(r.status).toBe("accepted");
    expect(d.createSubmission).toHaveBeenCalledTimes(1);
  });
});

describe("ingestSubmission — spam decision", () => {
  it("stores spam_auto + score + reason, suppresses notify and newsletter fan-out on a spam verdict", async () => {
    const site = makeWebsiteRow({ id: "recSITE", newsletterWebhook: "https://hooks.zapier.com/x" });
    const row = makeSubmissionRow({ id: "recSUB", formType: "newsletter", status: "spam_auto" });
    const forwardNewsletter = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi.fn().mockResolvedValue(row),
      forwardNewsletter,
      classifySpam: () => ({ score: 130, reasons: ["links:3", "keywords:1"] }),
    });
    const r = await ingestSubmission(
      d,
      "acme",
      { formType: "newsletter", email: "a@b.co", message: "buy now http://x http://y http://z" },
      "unverifiable",
    );
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("skipped");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "spam_auto",
        spamScore: 130,
        spamReason: "links:3,keywords:1",
      }),
    );
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "skipped", null);
    expect(forwardNewsletter).not.toHaveBeenCalled();
  });

  it("takes the normal notify + stamp path on a clean verdict", async () => {
    const d = deps({ classifySpam: () => ({ score: 0, reasons: [] }) });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" });
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamScore: 0, spamReason: null }),
    );
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "sent", "msg_1");
  });

  it("fails open to score 0 when classifySpam throws — the lead is still accepted as new", async () => {
    const d = deps({
      classifySpam: () => {
        throw new Error("boom");
      },
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" });
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamScore: 0, spamReason: null }),
    );
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it("forces spam_auto on a requireTurnstile site when Turnstile fails, even at score 0", async () => {
    const site = makeWebsiteRow({ id: "recSITE", requireTurnstile: true });
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
    });
    const r = await ingestSubmission(
      d,
      "acme",
      { email: "a@b.co", message: "totally normal enquiry" },
      "fail",
    );
    expect(r.status).toBe("accepted");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "spam_auto",
        spamScore: 0,
        spamReason: "turnstile-required-failed",
      }),
    );
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "skipped", null);
  });

  it("stays fail-open on a requireTurnstile site when Turnstile is 'unverifiable' (outage / JS-off / expired)", async () => {
    // Guardrail: only a definite "fail" or an "absent" token may force spam_auto on a
    // gated site. A Cloudflare outage or an EXPIRED/duplicate token ("unverifiable" —
    // a real browser DID render the widget) must never spam-bucket an otherwise-clean
    // lead — pin it against a future `!== "pass"` over-tightening.
    const site = makeWebsiteRow({ id: "recSITE", requireTurnstile: true });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      classifySpam: () => ({ score: 0, reasons: [] }),
    });
    const r = await ingestSubmission(
      d,
      "acme",
      { email: "a@b.co", message: "totally normal enquiry" },
      "unverifiable",
    );
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamScore: 0, spamReason: null }),
    );
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "sent", "msg_1");
  });

  it("forces spam_auto with 'turnstile-required-absent' on a requireTurnstile site when the token is ABSENT", async () => {
    // The direct-POST-bot signature: a configured site whose widget was never
    // rendered (no token forwarded). Distinct reason from a forged-token "fail".
    const site = makeWebsiteRow({ id: "recSITE", requireTurnstile: true });
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
    });
    const r = await ingestSubmission(
      d,
      "acme",
      { email: "a@b.co", message: "totally normal enquiry" },
      "absent",
    );
    expect(r.status).toBe("accepted");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "spam_auto",
        spamScore: 0,
        spamReason: "turnstile-required-absent",
      }),
    );
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "skipped", null);
  });

  it("leaves an 'absent' token NEUTRAL on a site that has NOT opted into requireTurnstile", async () => {
    // Only opted-in sites escalate absent tokens; every other site (the fleet
    // default) must keep fail-open behavior so a widget-less form still delivers.
    const site = makeWebsiteRow({ id: "recSITE", requireTurnstile: false });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      classifySpam: () => ({ score: 0, reasons: [] }),
    });
    const r = await ingestSubmission(
      d,
      "acme",
      { email: "a@b.co", message: "totally normal enquiry" },
      "absent",
    );
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamScore: 0, spamReason: null }),
    );
    expect(d.notify).toHaveBeenCalledTimes(1);
  });
});

describe("ingestSubmission — velocity / duplicate-body signal", () => {
  const body = "I represent an SEO agency and can get you to page one within 24 hours guaranteed.";
  const noDupes = { exact: [], similar: [] };

  it("marks spam_auto + 'duplicate-body' when an identical body was already seen", async () => {
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const findRecentDuplicates = vi
      .fn()
      .mockResolvedValue({ exact: [{ id: "recPRIOR", status: "spam_auto" }], similar: [] });
    const d = deps({
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates,
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    expect(findRecentDuplicates).toHaveBeenCalledWith(body, expect.any(Date));
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "duplicate-body" }),
    );
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "skipped", null);
  });

  it("marks spam_auto + 'similar-body' on a near-duplicate with no exact match", async () => {
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const findRecentDuplicates = vi
      .fn()
      .mockResolvedValue({ exact: [], similar: [{ id: "recPRIOR", status: "spam_auto" }] });
    const d = deps({
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates,
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "similar-body" }),
    );
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("prefers 'duplicate-body' when BOTH exact and similar matches exist", async () => {
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const d = deps({
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates: vi.fn().mockResolvedValue({
        exact: [{ id: "recP1", status: "spam_auto" }],
        similar: [{ id: "recP2", status: "spam_auto" }],
      }),
    });
    await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ spamReason: "duplicate-body" }),
    );
  });

  it("retro-buckets prior still-'new' copies (exact + similar) with 'retro:duplicate-body'", async () => {
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const retroBucket = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates: vi.fn().mockResolvedValue({
        exact: [
          { id: "recP1", status: "new" },
          { id: "recP2", status: "spam_auto" },
        ],
        similar: [
          { id: "recP3", status: "new" },
          { id: "recP4", status: "read" },
        ],
      }),
      retroBucket,
    });
    await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    // Only the still-'new' prior rows — never ones the operator already handled.
    expect(retroBucket).toHaveBeenCalledExactlyOnceWith(["recP1", "recP3"], "retro:duplicate-body");
  });

  it("does not call retroBucket when no prior copy is still 'new'", async () => {
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const retroBucket = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates: vi
        .fn()
        .mockResolvedValue({ exact: [{ id: "recP1", status: "spam_auto" }], similar: [] }),
      retroBucket,
    });
    await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(retroBucket).not.toHaveBeenCalled();
  });

  it("still buckets the incoming row when the retroBucket dep is absent", async () => {
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const d = deps({
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates: vi
        .fn()
        .mockResolvedValue({ exact: [{ id: "recP1", status: "new" }], similar: [] }),
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "duplicate-body" }),
    );
  });

  it("swallows a retroBucket failure — the incoming row is still bucketed", async () => {
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const retroBucket = vi.fn().mockRejectedValue(new Error("db down"));
    const d = deps({
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates: vi
        .fn()
        .mockResolvedValue({ exact: [{ id: "recP1", status: "new" }], similar: [] }),
      retroBucket,
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "duplicate-body" }),
    );
  });

  it("passes a 30-day lookback window derived from now()", async () => {
    const findRecentDuplicates = vi.fn().mockResolvedValue(noDupes);
    const d = deps({
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates,
    });
    await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    const since = findRecentDuplicates.mock.calls[0]![1] as Date;
    // now() is 2026-06-14T12:00:00Z → 30 days earlier.
    expect(since.toISOString()).toBe("2026-05-15T12:00:00.000Z");
  });

  it("stays clean (new) when no duplicate exists", async () => {
    const findRecentDuplicates = vi.fn().mockResolvedValue(noDupes);
    const d = deps({
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates,
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamReason: null }),
    );
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it("never runs the lookup for a newsletter form (legit repeat 'subscribe' bodies)", async () => {
    const findRecentDuplicates = vi
      .fn()
      .mockResolvedValue({ exact: [{ id: "recP1", status: "new" }], similar: [] });
    const d = deps({
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates,
    });
    const r = await ingestSubmission(
      d,
      "acme",
      { formType: "newsletter", email: "a@b.co", message: body },
      "unverifiable",
    );
    expect(r.status).toBe("accepted");
    expect(findRecentDuplicates).not.toHaveBeenCalled();
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamReason: null }),
    );
  });

  it("does not run the lookup (or re-flag) when the row is ALREADY spam_auto from Turnstile", async () => {
    // Short-circuit: an absent-token gated site already bucketed this row; the
    // velocity lookup is wasted work and would append a redundant reason.
    const site = makeWebsiteRow({ id: "recSITE", requireTurnstile: true });
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const findRecentDuplicates = vi
      .fn()
      .mockResolvedValue({ exact: [{ id: "recP1", status: "new" }], similar: [] });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates,
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "absent");
    expect(r.status).toBe("accepted");
    expect(findRecentDuplicates).not.toHaveBeenCalled();
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "turnstile-required-absent" }),
    );
  });

  it("swallows a findRecentDuplicates failure — the lead is still accepted as new", async () => {
    const findRecentDuplicates = vi.fn().mockRejectedValue(new Error("db down"));
    const d = deps({
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates,
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamReason: null }),
    );
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the findRecentDuplicates dep is absent (fail-open clean)", async () => {
    const d = deps({ classifySpam: () => ({ score: 0, reasons: [] }) });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ status: "new" }));
  });
});

describe("ingestSubmission — cross-site repeat-sender signal", () => {
  const body = "Hello, I would love to discuss a partnership opportunity with your business.";

  it("marks spam_auto + 'repeat-sender' when the email already contacted a DIFFERENT site", async () => {
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const listRecentSubmissionsForEmail = vi
      .fn()
      .mockResolvedValue([{ id: "recP1", siteId: "recOTHER", status: "read" }]);
    const d = deps({
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      listRecentSubmissionsForEmail,
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    expect(listRecentSubmissionsForEmail).toHaveBeenCalledWith("a@b.co", expect.any(Date));
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "repeat-sender" }),
    );
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "skipped", null);
  });

  it("does NOT trigger on same-site repeats (genuine follow-ups)", async () => {
    const retroBucket = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      classifySpam: () => ({ score: 0, reasons: [] }),
      listRecentSubmissionsForEmail: vi.fn().mockResolvedValue([
        { id: "recP1", siteId: "recSITE", status: "new" },
        { id: "recP2", siteId: "recSITE", status: "read" },
      ]),
      retroBucket,
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamReason: null }),
    );
    expect(retroBucket).not.toHaveBeenCalled();
  });

  it("retro-buckets prior still-'new' rows on OTHER sites with 'retro:repeat-sender'", async () => {
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const retroBucket = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      listRecentSubmissionsForEmail: vi.fn().mockResolvedValue([
        { id: "recP1", siteId: "recOTHER", status: "new" },
        { id: "recP2", siteId: "recOTHER", status: "read" }, // operator handled — untouched
        { id: "recP3", siteId: "recSITE", status: "new" }, // same site — untouched
      ]),
      retroBucket,
    });
    await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(retroBucket).toHaveBeenCalledExactlyOnceWith(["recP1"], "retro:repeat-sender");
  });

  it("still buckets the incoming row when the retroBucket dep is absent", async () => {
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const d = deps({
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      listRecentSubmissionsForEmail: vi
        .fn()
        .mockResolvedValue([{ id: "recP1", siteId: "recOTHER", status: "new" }]),
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "repeat-sender" }),
    );
  });

  it("never runs the lookup for a newsletter form (subscribing on two sites is legitimate)", async () => {
    const listRecentSubmissionsForEmail = vi
      .fn()
      .mockResolvedValue([{ id: "recP1", siteId: "recOTHER", status: "new" }]);
    const d = deps({
      classifySpam: () => ({ score: 0, reasons: [] }),
      listRecentSubmissionsForEmail,
    });
    const r = await ingestSubmission(
      d,
      "acme",
      { formType: "newsletter", email: "a@b.co" },
      "unverifiable",
    );
    expect(r.status).toBe("accepted");
    expect(listRecentSubmissionsForEmail).not.toHaveBeenCalled();
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamReason: null }),
    );
  });

  it("does not run the lookup when the row is ALREADY spam_auto from Turnstile", async () => {
    const site = makeWebsiteRow({ id: "recSITE", requireTurnstile: true });
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const listRecentSubmissionsForEmail = vi
      .fn()
      .mockResolvedValue([{ id: "recP1", siteId: "recOTHER", status: "new" }]);
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      listRecentSubmissionsForEmail,
    });
    await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "absent");
    expect(listRecentSubmissionsForEmail).not.toHaveBeenCalled();
  });

  it("fires BEFORE the duplicate check — a repeat-sender hit skips the body lookup", async () => {
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const findRecentDuplicates = vi.fn().mockResolvedValue({ exact: [], similar: [] });
    const d = deps({
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      listRecentSubmissionsForEmail: vi
        .fn()
        .mockResolvedValue([{ id: "recP1", siteId: "recOTHER", status: "read" }]),
      findRecentDuplicates,
    });
    await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(findRecentDuplicates).not.toHaveBeenCalled();
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ spamReason: "repeat-sender" }),
    );
  });

  it("swallows a lookup failure — the lead is still accepted as new", async () => {
    const d = deps({
      classifySpam: () => ({ score: 0, reasons: [] }),
      listRecentSubmissionsForEmail: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamReason: null }),
    );
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the listRecentSubmissionsForEmail dep is absent (fail-open clean)", async () => {
    const d = deps({ classifySpam: () => ({ score: 0, reasons: [] }) });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ status: "new" }));
  });
});
