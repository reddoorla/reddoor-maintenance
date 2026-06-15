import { describe, it, expect, vi } from "vitest";
import { forwardNewsletterToWebhook } from "../../src/forms/webhook.js";
import type { SubmissionRow } from "../../src/reports/airtable/submissions.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

const submission = {
  email: "subscriber@example.com",
  name: "Jane Doe",
  formType: "newsletter",
  sourceUrl: "https://acme.example.com/?utm_source=x",
  utm: "utm_source=x",
  submittedAt: "2026-06-14T12:00:00.000Z",
} as unknown as SubmissionRow;

const site = { name: "Acme Co" } as unknown as WebsiteRow;

describe("forwardNewsletterToWebhook", () => {
  it("POSTs the newsletter body to an https URL and returns ok on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const res = await forwardNewsletterToWebhook(
      "https://hooks.zapier.com/abc",
      submission,
      site,
      fetchImpl as unknown as typeof fetch,
    );
    expect(res).toEqual({ ok: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.zapier.com/abc");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "subscriber@example.com",
      name: "Jane Doe",
      formType: "newsletter",
      site: "Acme Co",
      sourceUrl: "https://acme.example.com/?utm_source=x",
      utm: "utm_source=x",
      submittedAt: "2026-06-14T12:00:00.000Z",
    });
  });

  it("refuses a non-https URL without calling fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const res = await forwardNewsletterToWebhook(
      "http://hooks.zapier.com/abc",
      submission,
      site,
      fetchImpl as unknown as typeof fetch,
    );
    expect(res).toEqual({ ok: false, status: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns ok:false with the status when fetch resolves non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const res = await forwardNewsletterToWebhook(
      "https://hooks.zapier.com/abc",
      submission,
      site,
      fetchImpl as unknown as typeof fetch,
    );
    expect(res).toEqual({ ok: false, status: 500 });
  });

  it("swallows a network error and returns ok:false status:0", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await forwardNewsletterToWebhook(
      "https://hooks.zapier.com/abc",
      submission,
      site,
      fetchImpl as unknown as typeof fetch,
    );
    expect(res).toEqual({ ok: false, status: 0 });
  });
});
