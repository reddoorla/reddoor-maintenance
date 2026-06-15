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
});
