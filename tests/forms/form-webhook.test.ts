import { describe, it, expect, vi } from "vitest";
import { ingestSubmission, formWebhookWants, type IngestDeps } from "../../src/forms/ingest.js";
import {
  buildFormWebhookBody,
  buildNewsletterWebhookBody,
  forwardFormToWebhook,
} from "../../src/forms/webhook.js";
import type { SubmissionInput } from "../../src/reports/submission-row.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

// Gallery Sonder (2026-11-09): every opted-in form type goes to ONE client
// webhook with the full submission. These pin the opt-in, the spam guard, the
// body, and that a newsletter-only site's fan-out is exactly what it was.

const HOOK = "https://hooks.zapier.com/hooks/catch/1/abc";
const NEWSLETTER_HOOK = "https://hooks.zapier.com/hooks/catch/9/old";

/** A createSubmission that echoes what ingest decided, the way the real persist
 *  does, so the spam status reaching the fan-out is the code under test's own. */
function echoCreate() {
  return vi.fn().mockImplementation((i: SubmissionInput) =>
    Promise.resolve(
      makeSubmissionRow({
        id: "recSUB",
        formType: i.formType,
        name: i.name,
        email: i.email,
        phone: i.phone ?? null,
        message: i.message ?? null,
        extraFields: JSON.stringify(i.extraFields),
        sourceUrl: i.sourceUrl ?? null,
        utm: i.utm ?? null,
        status: i.status ?? "new",
      }),
    ),
  );
}

function deps(site: WebsiteRow, over: Partial<IngestDeps> = {}): IngestDeps {
  return {
    getWebsiteBySlug: vi.fn().mockResolvedValue(site),
    createSubmission: echoCreate(),
    notify: vi.fn().mockResolvedValue({ status: "sent", messageId: "msg_1" }),
    stampNotified: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-11-09T12:00:00Z"),
    forwardForm: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    forwardNewsletter: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    stampFanout: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

/** One payload per Sonder form, shaped as gallerysonder's submitForm posts them
 *  (site-specific fields at the top level; ingest bundles them into extra). */
const SONDER_PAYLOADS: Record<string, Record<string, unknown>> = {
  inquiry: {
    formType: "inquiry",
    name: "Ada Collector",
    email: "ada@example.com",
    phone: "310-555-0100",
    message: "Is this piece still available?",
    piece: "Blue Hour",
    artist: "R. Ortiz",
    role: "Collector",
    sourceUrl: "https://gallerysonder.com/artists/r-ortiz",
    utm: "utm_source=newsletter&utm_campaign=fall",
  },
  rsvp: {
    formType: "rsvp",
    name: "Ben Guest",
    email: "ben@example.com",
    event: "Opening Night",
    guests: "2",
  },
  newsletter: { formType: "newsletter", email: "cy@example.com" },
  contact: {
    formType: "contact",
    name: "Di Planner",
    email: "di@example.com",
    message: "Private viewing please",
    company: "Planner LLC",
    appointment_date: "2026-11-20",
    appointment_time: "14:00",
  },
};

describe("form webhook — opt-in", () => {
  for (const [type, payload] of Object.entries(SONDER_PAYLOADS)) {
    it(`forwards a ${type} submission when the site opted in with no type list`, async () => {
      const site = makeWebsiteRow({ formWebhook: HOOK, formWebhookTypes: [] });
      const d = deps(site);
      await ingestSubmission(d, "gallerysonder", payload);
      expect(d.forwardForm).toHaveBeenCalledTimes(1);
      const [url, row, s] = (d.forwardForm as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe(HOOK);
      expect(row.formType).toBe(type);
      expect(s).toBe(site);
      expect(d.stampFanout).toHaveBeenCalledWith(
        "recSUB",
        expect.stringContaining("form-webhook:ok"),
      );
    });
  }

  it("forwards only the listed types when a type list is set", async () => {
    const site = makeWebsiteRow({ formWebhook: HOOK, formWebhookTypes: ["inquiry", "rsvp"] });
    const listed = deps(site);
    await ingestSubmission(listed, "gallerysonder", SONDER_PAYLOADS.inquiry);
    expect(listed.forwardForm).toHaveBeenCalledTimes(1);

    const unlisted = deps(site);
    await ingestSubmission(unlisted, "gallerysonder", SONDER_PAYLOADS.contact);
    expect(unlisted.forwardForm).not.toHaveBeenCalled();
    expect(unlisted.stampFanout).not.toHaveBeenCalled();
  });

  it("forwards nothing when the site has no form webhook", async () => {
    const site = makeWebsiteRow({ formWebhook: null, formWebhookTypes: [] });
    for (const payload of Object.values(SONDER_PAYLOADS)) {
      const d = deps(site);
      await ingestSubmission(d, "acme", payload);
      expect(d.forwardForm).not.toHaveBeenCalled();
      expect(d.stampFanout).not.toHaveBeenCalled();
    }
  });

  it("never forwards spam", async () => {
    const site = makeWebsiteRow({ formWebhook: HOOK, formWebhookTypes: [] });
    for (const payload of Object.values(SONDER_PAYLOADS)) {
      const d = deps(site, { classifySpam: () => ({ score: 100, reasons: ["test-spam"] }) });
      await ingestSubmission(d, "gallerysonder", payload);
      expect(d.createSubmission).toHaveBeenCalledWith(
        expect.objectContaining({ status: "spam_auto" }),
      );
      expect(d.forwardForm).not.toHaveBeenCalled();
    }
  });

  it("records a failed forward on the row and still accepts the lead", async () => {
    const site = makeWebsiteRow({ formWebhook: HOOK, formWebhookTypes: [] });
    const failing = deps(site, {
      forwardForm: vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    });
    const r = await ingestSubmission(failing, "gallerysonder", SONDER_PAYLOADS.inquiry);
    expect(r.status).toBe("accepted");
    expect(failing.stampFanout).toHaveBeenCalledWith("recSUB", "form-webhook:503");

    const throwing = deps(site, { forwardForm: vi.fn().mockRejectedValue(new Error("down")) });
    const r2 = await ingestSubmission(throwing, "gallerysonder", SONDER_PAYLOADS.rsvp);
    expect(r2.status).toBe("accepted");
    expect(throwing.stampFanout).toHaveBeenCalledWith("recSUB", "form-webhook:threw");
  });

  it("formWebhookWants: empty list is every type, else membership", () => {
    expect(formWebhookWants([], "rsvp")).toBe(true);
    expect(formWebhookWants(["inquiry"], "inquiry")).toBe(true);
    expect(formWebhookWants(["inquiry"], "rsvp")).toBe(false);
  });
});

describe("form webhook — an existing newsletter-only site is unchanged", () => {
  const site = makeWebsiteRow({ newsletterWebhook: NEWSLETTER_HOOK });

  it("still forwards only newsletter, to the newsletter webhook, and stamps webhook:ok", async () => {
    const d = deps(site);
    await ingestSubmission(d, "acme", SONDER_PAYLOADS.newsletter);
    expect(d.forwardNewsletter).toHaveBeenCalledTimes(1);
    expect((d.forwardNewsletter as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      NEWSLETTER_HOOK,
    );
    expect(d.forwardForm).not.toHaveBeenCalled();
    expect(d.stampFanout).toHaveBeenCalledWith("recSUB", "webhook:ok");

    for (const type of ["inquiry", "rsvp", "contact"]) {
      const other = deps(site);
      await ingestSubmission(other, "acme", SONDER_PAYLOADS[type]);
      expect(other.forwardNewsletter).not.toHaveBeenCalled();
      expect(other.forwardForm).not.toHaveBeenCalled();
      expect(other.stampFanout).not.toHaveBeenCalled();
    }
  });

  it("the newsletter body keeps exactly its seven keys", () => {
    const row = makeSubmissionRow({
      formType: "newsletter",
      phone: "310-555-0100",
      extraFields: JSON.stringify({ piece: "x" }),
    });
    expect(Object.keys(buildNewsletterWebhookBody(row, site)).sort()).toEqual(
      ["email", "formType", "name", "site", "sourceUrl", "submittedAt", "utm"].sort(),
    );
  });

  it("a site with both webhooks fires both on a newsletter, newsletter's token first", async () => {
    const both = makeWebsiteRow({
      newsletterWebhook: NEWSLETTER_HOOK,
      formWebhook: HOOK,
      formWebhookTypes: [],
    });
    const d = deps(both);
    await ingestSubmission(d, "acme", SONDER_PAYLOADS.newsletter);
    expect(d.forwardNewsletter).toHaveBeenCalledTimes(1);
    expect(d.forwardForm).toHaveBeenCalledTimes(1);
    expect(d.stampFanout).toHaveBeenCalledWith("recSUB", "webhook:ok,form-webhook:ok");
  });
});

describe("form webhook — the body carries the full submission", () => {
  const site = makeWebsiteRow({ name: "Gallery Sonder", formWebhook: HOOK });

  /** Run a payload through the REAL ingest + the REAL forwarder, capturing the
   *  JSON that would be POSTed. */
  async function bodyFor(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const d = deps(site, {
      forwardForm: (url, row, s) =>
        forwardFormToWebhook(url, row, s, fetchImpl as unknown as typeof fetch),
    });
    await ingestSubmission(d, "gallerysonder", payload);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    return JSON.parse(init.body as string) as Record<string, unknown>;
  }

  it("an inquiry carries contact, message, artwork, artist, role, page, time and UTMs", async () => {
    const body = await bodyFor(SONDER_PAYLOADS.inquiry!);
    expect(body).toMatchObject({
      id: "recSUB",
      formType: "inquiry",
      site: "Gallery Sonder",
      name: "Ada Collector",
      email: "ada@example.com",
      phone: "310-555-0100",
      message: "Is this piece still available?",
      sourceUrl: "https://gallerysonder.com/artists/r-ortiz",
      utm: "utm_source=newsletter&utm_campaign=fall",
      utm_source: "newsletter",
      utm_campaign: "fall",
      utm_medium: null,
      submittedAt: expect.any(String),
    });
    expect(body.fields).toMatchObject({
      piece: "Blue Hour",
      artist: "R. Ortiz",
      role: "Collector",
    });
  });

  it("an RSVP carries the event and guest count", async () => {
    const body = await bodyFor(SONDER_PAYLOADS.rsvp!);
    expect(body.formType).toBe("rsvp");
    expect(body.fields).toMatchObject({ event: "Opening Night", guests: "2" });
  });

  it("an appointment carries the company and requested date and time", async () => {
    const body = await bodyFor(SONDER_PAYLOADS.contact!);
    expect(body.formType).toBe("contact");
    expect(body.message).toBe("Private viewing please");
    expect(body.fields).toMatchObject({
      company: "Planner LLC",
      appointment_date: "2026-11-20",
      appointment_time: "14:00",
    });
  });

  it("absent values are null, not missing, so a hook sees a stable shape", () => {
    const body = buildFormWebhookBody(
      makeSubmissionRow({ formType: "newsletter", message: null, utm: null, extraFields: null }),
      site,
    );
    expect(body).toMatchObject({ phone: null, message: null, utm: null, utm_source: null });
    expect(body.fields).toEqual({});
  });

  it("fields leave out ingest's own bookkeeping, keeping the visitor's data", () => {
    const body = buildFormWebhookBody(
      makeSubmissionRow({
        extraFields: JSON.stringify({
          piece: "Blue Hour",
          _reply: { subject: "Thanks for your inquiry" },
          composedMessage: true,
          visitorText: "typed twice",
        }),
      }),
      site,
    );
    expect(body.fields).toEqual({ piece: "Blue Hour" });
  });

  it("a malformed extra_fields cell still forwards, with empty fields", () => {
    const body = buildFormWebhookBody(makeSubmissionRow({ extraFields: "{not json" }), site);
    expect(body.fields).toEqual({});
  });
});

describe("forwardFormToWebhook — the SSRF guard stays", () => {
  it("refuses http and private hosts without calling fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    for (const url of ["http://hooks.zapier.com/x", "https://127.0.0.1/x", "https://10.0.0.1/x"]) {
      const res = await forwardFormToWebhook(
        url,
        makeSubmissionRow(),
        makeWebsiteRow(),
        fetchImpl as unknown as typeof fetch,
      );
      expect(res).toEqual({ ok: false, status: 0 });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to follow a redirect, recording its status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 307 });
    const res = await forwardFormToWebhook(
      HOOK,
      makeSubmissionRow(),
      makeWebsiteRow(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(res).toEqual({ ok: false, status: 307 });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
  });

  it("never throws on a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const res = await forwardFormToWebhook(
      HOOK,
      makeSubmissionRow(),
      makeWebsiteRow(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(res).toEqual({ ok: false, status: 0 });
  });
});
