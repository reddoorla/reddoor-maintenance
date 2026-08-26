import { describe, it, expect, vi } from "vitest";
import { ingestSubmission, type IngestDeps } from "../../src/forms/ingest.js";
import { classifySpam } from "../../src/forms/spam-classifier.js";
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

describe("ingestSubmission — spam handling is off for sites in development", () => {
  const inDev = makeWebsiteRow({ id: "recSITE", status: "building" });
  const live = makeWebsiteRow({ id: "recSITE", status: "maintained" });
  const priorOnAnotherSite = [
    { id: "recOTHER", siteId: "recDIFFERENT", email: "a@b.co", status: "new" as const },
  ];

  // ingest gates notify on `row.status` — the status coming BACK from
  // createSubmission — so a fixed mock row silently decides the notify assertion
  // instead of the code under test. Echo the status the way the real persist does.
  const echoCreate = () =>
    vi
      .fn()
      .mockImplementation((i: { status: string; spamScore: number; spamReason: string | null }) =>
        Promise.resolve(
          makeSubmissionRow({
            id: "recSUB",
            status: i.status as never,
            spamScore: i.spamScore,
            spamReason: i.spamReason,
          }),
        ),
      );

  it("keeps a submission the classifier calls spam", async () => {
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(inDev),
      createSubmission: echoCreate(),
      classifySpam: () => ({ score: 999, reasons: ["links:9"] }),
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "buy now" });
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamScore: 0, spamReason: null }),
    );
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  // The exact failure from 2026-08-17: the operator tested three sites from one
  // address and their own submission landed as spam_auto with notify skipped.
  it("does not trip the cross-site repeat-sender rule, and retro-buckets nothing", async () => {
    const retroBucket = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(inDev),
      listRecentSubmissionsForEmail: vi.fn().mockResolvedValue(priorOnAnotherSite),
      retroBucket,
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" });
    expect(r.status).toBe("accepted");
    expect(d.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ status: "new" }));
    expect(d.listRecentSubmissionsForEmail).not.toHaveBeenCalled();
    expect(retroBucket).not.toHaveBeenCalled();
  });

  // CONTROL. Identical inputs, only `status` differs. Without this the two tests
  // above would pass just as happily against a gate that is always on, which is
  // not evidence of anything.
  it("CONTROL: the same submission on a `maintenance` site IS bucketed", async () => {
    const retroBucket = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(live),
      createSubmission: echoCreate(),
      listRecentSubmissionsForEmail: vi.fn().mockResolvedValue(priorOnAnotherSite),
      retroBucket,
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" });
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("skipped");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "repeat-sender" }),
    );
    expect(retroBucket).toHaveBeenCalledWith(["recOTHER"], "retro:repeat-sender");
  });

  it("does not escalate a required-Turnstile miss", async () => {
    const d = deps({
      getWebsiteBySlug: vi
        .fn()
        .mockResolvedValue(makeWebsiteRow({ status: "building", requireTurnstile: true })),
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" }, "absent");
    expect(d.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ status: "new" }));
    expect(r.status).toBe("accepted");
  });

  it("CONTROL: a required-Turnstile miss on a `maintenance` site IS bucketed", async () => {
    const d = deps({
      getWebsiteBySlug: vi
        .fn()
        .mockResolvedValue(makeWebsiteRow({ status: "maintained", requireTurnstile: true })),
    });
    await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" }, "absent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "turnstile-required-absent" }),
    );
  });
});

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

  // Wired to the REAL classifier, not a stub verdict. Every other test in this
  // block injects the score it wants, so none of them can show that a given
  // ADDRESS reaches spam_auto — which is the whole claim of the blocked-domain
  // tier, and the reason 10 of these messages were emailed to the operator.
  it("a blocked sender domain reaches spam_auto through the real classifier, with notify suppressed", async () => {
    const d = deps({
      // Echo the status back, the way the real writer does. The default mock
      // returns a fixed `new` row, and ingest reads `isSpam` off what was
      // RETURNED — so a fixed mock reports notify=sent no matter the verdict.
      createSubmission: vi.fn((input) =>
        Promise.resolve(makeSubmissionRow({ ...input, id: "recSUB" })),
      ),
      classifySpam: (n, turnstile) =>
        classifySpam({
          name: n.name,
          email: n.email,
          ...(n.message !== undefined ? { message: n.message } : {}),
          formType: n.formType,
          extraFields: n.extraFields,
          turnstile,
        }),
    });
    const r = await ingestSubmission(
      d,
      "acme",
      // A message with NO spam signal of its own — the domain is doing all the work.
      { email: "raymond.abbott@jmailservice.com", name: "Raymond Abbott", message: "Hello there." },
      "unverifiable",
    );
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("skipped");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "blocked-domain" }),
    );
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("the same message from an unlisted domain is delivered — the domain is the only difference", async () => {
    // Positive control for the test above. Without it, that assertion would pass
    // just as well if the real classifier had started bucketing everything.
    const d = deps({
      // Echo the status back, the way the real writer does. The default mock
      // returns a fixed `new` row, and ingest reads `isSpam` off what was
      // RETURNED — so a fixed mock reports notify=sent no matter the verdict.
      createSubmission: vi.fn((input) =>
        Promise.resolve(makeSubmissionRow({ ...input, id: "recSUB" })),
      ),
      classifySpam: (n, turnstile) =>
        classifySpam({
          name: n.name,
          email: n.email,
          ...(n.message !== undefined ? { message: n.message } : {}),
          formType: n.formType,
          extraFields: n.extraFields,
          turnstile,
        }),
    });
    const r = await ingestSubmission(
      d,
      "acme",
      { email: "raymond.abbott@example.com", name: "Raymond Abbott", message: "Hello there." },
      "unverifiable",
    );
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamScore: 0 }),
    );
    expect(d.notify).toHaveBeenCalledTimes(1);
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

  it("runs the lookup for RETRO even when the row is already spam_auto — but never re-flags", async () => {
    // Reversal of the original short-circuit: once the classifier/turnstile catch
    // whole spray families, an already-bucketed copy skipping the scan meant the
    // retro cleanup NEVER fired for exactly the sprays it was built for. The scan
    // now always runs; the incoming row's status/reason are untouched, and prior
    // still-'new' copies get retro-bucketed.
    const site = makeWebsiteRow({ id: "recSITE", requireTurnstile: true });
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const findRecentDuplicates = vi.fn().mockResolvedValue({
      exact: [{ id: "recP1", status: "new", siteId: "recOTHER", email: "spray@x.com" }],
      similar: [],
    });
    const retroBucket = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates,
      retroBucket,
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "absent");
    expect(r.status).toBe("accepted");
    expect(findRecentDuplicates).toHaveBeenCalledTimes(1);
    // reason stays the turnstile one — no duplicate-body appended to the incoming row
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "turnstile-required-absent" }),
    );
    // …but the prior still-'new' spray copy IS retro-cleaned
    expect(retroBucket).toHaveBeenCalledWith(["recP1"], "retro:duplicate-body");
  });

  it("exempts a genuine same-sender resubmission on the same site (no bucket, no retro)", async () => {
    // A real visitor double-submitting / resending after silence produces an exact
    // match from the SAME email on the SAME site — that is not spray evidence.
    // Without this exemption the resend was silently bucketed AND the delivered
    // original was retro-flipped: an active lead vanished with no signal.
    const findRecentDuplicates = vi.fn().mockResolvedValue({
      exact: [{ id: "recORIG", status: "new", siteId: "recSITE", email: "A@B.co " }],
      similar: [],
    });
    const retroBucket = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates,
      retroBucket,
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamReason: null }),
    );
    expect(retroBucket).not.toHaveBeenCalled();

    // The same body from a DIFFERENT sender on the same site is still spray evidence.
    const findRecentDuplicates2 = vi.fn().mockResolvedValue({
      exact: [{ id: "recORIG", status: "new", siteId: "recSITE", email: "other@x.com" }],
      similar: [],
    });
    const d2 = deps({
      createSubmission: vi
        .fn()
        .mockResolvedValue(makeSubmissionRow({ id: "recSUB", status: "spam_auto" })),
      classifySpam: () => ({ score: 0, reasons: [] }),
      findRecentDuplicates: findRecentDuplicates2,
    });
    await ingestSubmission(d2, "acme", { email: "a@b.co", message: body }, "unverifiable");
    expect(d2.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "duplicate-body" }),
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

  it("runs the lookup for RETRO even when already spam_auto from Turnstile — status/reason untouched", async () => {
    // Reversal of the original skip: the scan must run so a bot-bucketed copy still
    // retro-cleans the same sender's prior cross-site rows sitting in 'new'.
    const site = makeWebsiteRow({ id: "recSITE", requireTurnstile: true });
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const listRecentSubmissionsForEmail = vi
      .fn()
      .mockResolvedValue([{ id: "recP1", siteId: "recOTHER", status: "new" }]);
    const retroBucket = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
      listRecentSubmissionsForEmail,
      retroBucket,
    });
    await ingestSubmission(d, "acme", { email: "a@b.co", message: body }, "absent");
    expect(listRecentSubmissionsForEmail).toHaveBeenCalledTimes(1);
    expect(retroBucket).toHaveBeenCalledWith(["recP1"], "retro:repeat-sender");
    // the incoming row keeps its turnstile reason — repeat-sender is NOT appended
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "turnstile-required-absent" }),
    );
  });

  it("a repeat-sender hit no longer suppresses the body lookup — both scans run (both retro paths live)", async () => {
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
    // repeat-sender escalates first and owns the reason…
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ spamReason: "repeat-sender" }),
    );
    // …but the body scan still runs so identical-body copies from OTHER senders
    // can be retro-cleaned too.
    expect(findRecentDuplicates).toHaveBeenCalledTimes(1);
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

import { hostsMatch, turnstileHostnameAcceptable } from "../../src/forms/ingest.js";

describe("hostsMatch / turnstileHostnameAcceptable", () => {
  it("matches equal hosts, subdomains both ways, case-insensitively", () => {
    expect(hostsMatch("reddoorla.com", "reddoorla.com")).toBe(true);
    expect(hostsMatch("www.reddoorla.com", "reddoorla.com")).toBe(true);
    expect(hostsMatch("reddoorla.com", "www.reddoorla.com")).toBe(true);
    expect(hostsMatch("WWW.RedDoorLA.com", "reddoorla.COM")).toBe(true);
    expect(hostsMatch("attacker.example", "reddoorla.com")).toBe(false);
    // suffix WITHOUT a dot boundary must not match (evilreddoorla.com is not a subdomain)
    expect(hostsMatch("evilreddoorla.com", "reddoorla.com")).toBe(false);
    expect(hostsMatch("", "reddoorla.com")).toBe(false);
  });

  it("turnstileHostnameAcceptable fails open on an unparseable/hostless site url", () => {
    expect(turnstileHostnameAcceptable("anything.example", "not a url")).toBe(true);
    expect(turnstileHostnameAcceptable("anything.example", "")).toBe(true);
    expect(turnstileHostnameAcceptable("www.acme.example", "https://acme.example/contact")).toBe(
      true,
    );
    expect(turnstileHostnameAcceptable("other.example", "https://acme.example")).toBe(false);
  });
});

describe("ingestSubmission — turnstile solved-hostname gate", () => {
  const gated = () =>
    makeWebsiteRow({ id: "recSITE", url: "https://acme.example", requireTurnstile: true });

  it("forces spam_auto with 'turnstile-required-hostname' when a passing token was solved on a foreign host", async () => {
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(gated()),
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
    });
    const r = await ingestSubmission(
      d,
      "acme",
      { email: "a@b.co", message: "hello there" },
      { outcome: "pass", hostname: "token-farm.example" },
    );
    expect(r.status).toBe("accepted");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "spam_auto", spamReason: "turnstile-required-hostname" }),
    );
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("a matching or subdomain hostname on a gated site stays clean", async () => {
    for (const hostname of ["acme.example", "www.acme.example"]) {
      const d = deps({
        getWebsiteBySlug: vi.fn().mockResolvedValue(gated()),
        classifySpam: () => ({ score: 0, reasons: [] }),
      });
      const r = await ingestSubmission(
        d,
        "acme",
        { email: "a@b.co", message: "hello there" },
        { outcome: "pass", hostname },
      );
      expect(r.status).toBe("accepted");
      expect(d.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ status: "new" }));
    }
  });

  it("never escalates on: null hostname, a NON-gated site, or an unparseable site url (fail-open)", async () => {
    // null hostname (older data / non-pass outcomes)
    const d1 = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(gated()),
      classifySpam: () => ({ score: 0, reasons: [] }),
    });
    await ingestSubmission(d1, "acme", { email: "a@b.co" }, { outcome: "pass", hostname: null });
    expect(d1.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ status: "new" }));

    // foreign hostname but requireTurnstile OFF
    const d2 = deps({
      getWebsiteBySlug: vi
        .fn()
        .mockResolvedValue(makeWebsiteRow({ id: "recSITE", url: "https://acme.example" })),
      classifySpam: () => ({ score: 0, reasons: [] }),
    });
    await ingestSubmission(
      d2,
      "acme",
      { email: "a@b.co" },
      { outcome: "pass", hostname: "elsewhere.example" },
    );
    expect(d2.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ status: "new" }));

    // gated but unparseable site url
    const d3 = deps({
      getWebsiteBySlug: vi
        .fn()
        .mockResolvedValue(
          makeWebsiteRow({ id: "recSITE", url: "not a url", requireTurnstile: true }),
        ),
      classifySpam: () => ({ score: 0, reasons: [] }),
    });
    await ingestSubmission(
      d3,
      "acme",
      { email: "a@b.co" },
      { outcome: "pass", hostname: "elsewhere.example" },
    );
    expect(d3.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ status: "new" }));
  });

  it("a bare-string 4th argument still works (back-compat) and never trips the hostname gate", async () => {
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(gated()),
      classifySpam: () => ({ score: 0, reasons: [] }),
    });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" }, "pass");
    expect(r.status).toBe("accepted");
    expect(d.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ status: "new" }));
  });
});

// The fan-out results used to be console.error-only: a rotated Mailchimp key or an
// outage stopped signups reaching the audience while the row still read
// notify=sent, and nothing the operator can see recorded it. stampFanout is the
// trace. Every case below pins BOTH that the lead is still accepted (best-effort
// stays best-effort) and what was written.
describe("ingestSubmission — newsletter fan-out provenance", () => {
  const newsletterSite = (over: Record<string, unknown> = {}) =>
    makeWebsiteRow({
      id: "recSITE",
      newsletterWebhook: "https://hooks.zapier.com/x",
      mailchimpApiKey: "abc123-us21",
      mailchimpAudienceId: "aud1",
      ...over,
    });

  function fanoutDeps(over: Partial<IngestDeps> = {}, site = newsletterSite()) {
    const stampFanout = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi
        .fn()
        .mockResolvedValue(makeSubmissionRow({ id: "recSUB", formType: "newsletter" })),
      forwardNewsletter: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      addToMailchimp: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      stampFanout,
      ...over,
    });
    return { d, stampFanout };
  }

  const send = (d: IngestDeps) =>
    ingestSubmission(d, "acme", { formType: "newsletter", email: "a@b.co" });

  it("records every destination that succeeded", async () => {
    const { d, stampFanout } = fanoutDeps();
    expect((await send(d)).status).toBe("accepted");
    expect(stampFanout).toHaveBeenCalledWith("recSUB", "webhook:ok,mailchimp:ok");
  });

  it("records the HTTP status when Mailchimp rejects the member (the rotated-key case)", async () => {
    const { d, stampFanout } = fanoutDeps({
      addToMailchimp: vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    });
    expect((await send(d)).status).toBe("accepted");
    expect(stampFanout).toHaveBeenCalledWith("recSUB", "webhook:ok,mailchimp:401");
  });

  it("records a thrown destination as :threw", async () => {
    const { d, stampFanout } = fanoutDeps({
      forwardNewsletter: vi.fn().mockRejectedValue(new Error("network down")),
      addToMailchimp: vi.fn().mockRejectedValue(new Error("mailchimp down")),
    });
    expect((await send(d)).status).toBe("accepted");
    expect(stampFanout).toHaveBeenCalledWith("recSUB", "webhook:threw,mailchimp:threw");
  });

  it("records only the destinations that are configured", async () => {
    const { d, stampFanout } = fanoutDeps({}, newsletterSite({ newsletterWebhook: null }));
    expect((await send(d)).status).toBe("accepted");
    expect(stampFanout).toHaveBeenCalledWith("recSUB", "mailchimp:ok");
  });

  it("records a member added but not tagged, so a silent tag failure is still visible", async () => {
    const { d, stampFanout } = fanoutDeps({
      addToMailchimp: vi.fn().mockResolvedValue({ ok: true, status: 200, tagged: false }),
    });
    expect((await send(d)).status).toBe("accepted");
    expect(stampFanout).toHaveBeenCalledWith(
      "recSUB",
      "webhook:ok,mailchimp:ok,mailchimp-tags:failed",
    );
  });

  it("stamps nothing when the site has no destination configured", async () => {
    const { d, stampFanout } = fanoutDeps(
      {},
      newsletterSite({ newsletterWebhook: null, mailchimpApiKey: null, mailchimpAudienceId: null }),
    );
    expect((await send(d)).status).toBe("accepted");
    expect(stampFanout).not.toHaveBeenCalled();
  });

  it("stamps nothing for a non-newsletter form", async () => {
    const { d, stampFanout } = fanoutDeps();
    const r = await ingestSubmission(d, "acme", { formType: "contact", email: "a@b.co" });
    expect(r.status).toBe("accepted");
    expect(stampFanout).not.toHaveBeenCalled();
  });

  it("stamps nothing for a spam signup (the fan-out never ran)", async () => {
    const { d, stampFanout } = fanoutDeps({
      createSubmission: vi
        .fn()
        .mockResolvedValue(
          makeSubmissionRow({ id: "recSUB", formType: "newsletter", status: "spam_auto" }),
        ),
      classifySpam: () => ({ score: 130, reasons: ["links:3"] }),
    });
    expect((await send(d)).status).toBe("accepted");
    expect(stampFanout).not.toHaveBeenCalled();
  });

  it("swallows a stampFanout failure — a provenance write must never cost the lead", async () => {
    const { d } = fanoutDeps({
      stampFanout: vi.fn().mockRejectedValue(new Error("turso down")),
    });
    expect((await send(d)).status).toBe("accepted");
  });

  it("still fans out when no stampFanout dep is injected (older callers)", async () => {
    const addToMailchimp = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(newsletterSite()),
      createSubmission: vi
        .fn()
        .mockResolvedValue(makeSubmissionRow({ id: "recSUB", formType: "newsletter" })),
      forwardNewsletter: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      addToMailchimp,
    });
    expect(d.stampFanout).toBeUndefined();
    expect((await send(d)).status).toBe("accepted");
    expect(addToMailchimp).toHaveBeenCalledTimes(1);
  });
});

describe("ingestSubmission deferred tail", () => {
  /** Collects the deferred work the way a platform's waitUntil would. */
  function deferrer() {
    const work: Promise<unknown>[] = [];
    return {
      defer: (p: Promise<unknown>) => void work.push(p),
      settle: () => Promise.all(work),
      count: () => work.length,
    };
  }

  it("returns as soon as the lead is durable, without waiting for the tail", async () => {
    // The tail STARTS synchronously (the notify call is issued before the first
    // await) — what must not happen is the response WAITING on it. Pinned with a
    // notify that never settles on its own: if the tail is ever awaited inline
    // again, this test hangs instead of quietly passing.
    const d = deferrer();
    let release: ((v: { status: "sent"; messageId: string }) => void) | undefined;
    const notify = vi.fn(
      () => new Promise<{ status: "sent"; messageId: string }>((res) => (release = res)),
    );
    const dep = deps({ defer: d.defer, notify });

    const r = await ingestSubmission(dep, "acme", { email: "a@b.co", message: "hi" });

    // The row is written on the critical path — that is what makes the lead safe.
    expect(dep.createSubmission).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ status: "accepted", submissionId: "recSUB", notifyStatus: "deferred" });
    // …and the response is out while notify is still in flight.
    expect(dep.stampNotified).not.toHaveBeenCalled();
    expect(d.count()).toBe(1);

    expect(release).toBeDefined();
    release?.({ status: "sent", messageId: "msg_1" });
    await d.settle();
    expect(dep.stampNotified).toHaveBeenCalledWith("recSUB", "sent", "msg_1");
  });

  it("runs the tail inline when no defer is wired (unchanged default)", async () => {
    const dep = deps();
    const r = await ingestSubmission(dep, "acme", { email: "a@b.co" });
    expect(r).toEqual({ status: "accepted", submissionId: "recSUB", notifyStatus: "sent" });
    expect(dep.notify).toHaveBeenCalledTimes(1);
    expect(dep.stampNotified).toHaveBeenCalledTimes(1);
  });

  it("never rejects the deferred promise when the tail throws", async () => {
    // An unhandled rejection inside waitUntil is the platform's problem, not the
    // lead's — the row is already durable by then.
    const d = deferrer();
    const dep = deps({
      defer: d.defer,
      notify: vi.fn().mockRejectedValue(new Error("resend down")),
      stampNotified: vi.fn().mockRejectedValue(new Error("turso down")),
    });
    const r = await ingestSubmission(dep, "acme", { email: "a@b.co" });
    expect(r.status).toBe("accepted");
    expect(d.count()).toBe(1);
    await expect(d.settle()).resolves.toBeDefined();
    expect(dep.stampNotified).toHaveBeenCalledWith("recSUB", "failed", null);
  });

  it("defers the newsletter fan-out too", async () => {
    const d = deferrer();
    const forwardNewsletter = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const stampFanout = vi.fn().mockResolvedValue(undefined);
    const dep = deps({
      defer: d.defer,
      getWebsiteBySlug: vi
        .fn()
        .mockResolvedValue(
          makeWebsiteRow({ id: "recSITE", newsletterWebhook: "https://hook.example.com/x" }),
        ),
      createSubmission: vi
        .fn()
        .mockResolvedValue(makeSubmissionRow({ id: "recSUB", formType: "newsletter" })),
      forwardNewsletter,
      stampFanout,
    });
    const r = await ingestSubmission(dep, "acme", { email: "a@b.co", formType: "newsletter" });
    expect(r.status).toBe("accepted");
    expect(forwardNewsletter).not.toHaveBeenCalled();

    await d.settle();
    expect(forwardNewsletter).toHaveBeenCalledTimes(1);
    expect(stampFanout).toHaveBeenCalledWith("recSUB", "webhook:ok");
  });

  it("keeps a screened-out spam row off the tail entirely", async () => {
    // spam_auto already skips notify; deferring must not resurrect it.
    const d = deferrer();
    const dep = deps({
      defer: d.defer,
      createSubmission: vi
        .fn()
        .mockResolvedValue(makeSubmissionRow({ id: "recSUB", status: "spam_auto" })),
    });
    const r = await ingestSubmission(dep, "acme", { email: "a@b.co" });
    expect(r.status).toBe("accepted");
    expect(d.count()).toBe(1);
    await d.settle();
    expect(dep.notify).not.toHaveBeenCalled();
    expect(dep.stampNotified).toHaveBeenCalledWith("recSUB", "skipped", null);
  });
});

describe("ingestSubmission — persist before enrich (#539 Phase 0)", () => {
  // The 2026-08-17 failure shape: getWebsiteBySlug reads Airtable, whose quota
  // outage made it THROW — while the submissions store (which the dead-letter
  // shares) was healthy the whole time. Before this branch existed the throw
  // propagated to the handler's 502 and the lead vanished unrecorded.
  const outage = () => vi.fn().mockRejectedValue(new Error("airtable 429 quota"));

  it("dead-letters the lead and accepts when the site lookup throws", async () => {
    const deadLetter = vi.fn().mockResolvedValue({ id: "dl_1" });
    const d = deps({ getWebsiteBySlug: outage(), deadLetter });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" }, "pass");
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") {
      expect(r.submissionId).toBe("dl_1");
      expect(r.notifyStatus).toBe("skipped");
    }
    // The whole lead survives: raw payload + slug + the verification computed at
    // receipt (tokens expire in 300s — replay can never re-verify) + the error.
    expect(deadLetter).toHaveBeenCalledWith({
      siteSlug: "acme",
      payload: { email: "a@b.co", message: "hi" },
      turnstile: { outcome: "pass", hostname: null },
      error: expect.stringContaining("airtable 429"),
      receivedAt: new Date("2026-06-14T12:00:00Z"),
    });
    // Nothing downstream of the lookup ran — no row, no notify.
    expect(d.createSubmission).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("still throws when deadLetter is not wired — non-wired callers are unchanged", async () => {
    const d = deps({ getWebsiteBySlug: outage() });
    await expect(ingestSubmission(d, "acme", { email: "a@b.co" })).rejects.toThrow(/quota/);
  });

  it("still throws for a testMode probe — the outage must red the form-e2e audit", async () => {
    // A probe persists nothing by design, so there is nothing to save — and
    // swallowing the outage would green the synthetic check at exactly the moment
    // central ingest is degraded.
    const deadLetter = vi.fn().mockResolvedValue({ id: "dl_x" });
    const d = deps({ getWebsiteBySlug: outage(), deadLetter });
    await expect(ingestSubmission(d, "acme", { email: "a@b.co", testMode: true })).rejects.toThrow(
      /quota/,
    );
    expect(deadLetter).not.toHaveBeenCalled();
  });

  it("a lookup that RESOLVES null is still unknown-site, never dead-lettered", async () => {
    // The store answered; a junk slug is a rejection, not a lead to save.
    const deadLetter = vi.fn();
    const d = deps({ getWebsiteBySlug: vi.fn().mockResolvedValue(null), deadLetter });
    const r = await ingestSubmission(d, "nope", { email: "a@b.co" });
    expect(r.status).toBe("unknown-site");
    expect(deadLetter).not.toHaveBeenCalled();
  });

  it("propagates when the dead-letter write ALSO fails — both stores down, 502 is honest", async () => {
    const d = deps({
      getWebsiteBySlug: outage(),
      deadLetter: vi.fn().mockRejectedValue(new Error("turso down too")),
    });
    await expect(ingestSubmission(d, "acme", { email: "a@b.co" })).rejects.toThrow(
      /turso down too/,
    );
  });

  it("an invalid payload is rejected BEFORE the lookup can dead-letter it", async () => {
    // Garbage in an outage is still garbage — nothing worth saving.
    const deadLetter = vi.fn();
    const d = deps({ getWebsiteBySlug: outage(), deadLetter });
    const r = await ingestSubmission(d, "acme", { nope: true }, "pass");
    expect(r.status).toBe("rejected");
    expect(deadLetter).not.toHaveBeenCalled();
  });
});
