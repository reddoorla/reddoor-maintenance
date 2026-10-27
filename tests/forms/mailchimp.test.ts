import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { addMailchimpMember, mailchimpTagsFor } from "../../src/forms/mailchimp.js";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

describe("addMailchimpMember", () => {
  it("PUTs an idempotent upsert and returns ok on 200 (full body + url + auth)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const res = await addMailchimpMember({
      apiKey: "abc123-us21",
      audienceId: "aud1",
      email: "Jane@Example.com",
      name: "Jane Doe",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://us21.api.mailchimp.com/3.0/lists/aud1/members/${md5("jane@example.com")}`,
    );
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.authorization).toMatch(/^Basic /);
    expect(JSON.parse(init.body as string)).toEqual({
      email_address: "Jane@Example.com",
      status_if_new: "subscribed",
      merge_fields: { FNAME: "Jane", LNAME: "Doe" },
    });
  });

  it("maps a single-word name to FNAME only (no LNAME)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      name: "Jane",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).merge_fields).toEqual({ FNAME: "Jane" });
  });

  it("omits merge_fields entirely for an empty/missing name", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      name: "   ",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("merge_fields");

    const fetchImpl2 = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      fetch: fetchImpl2 as unknown as typeof fetch,
    });
    const [, init2] = fetchImpl2.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init2.body as string)).not.toHaveProperty("merge_fields");
  });

  it("honors status:'pending' as status_if_new", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      status: "pending",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).status_if_new).toBe("pending");
  });

  it("returns ok:false status:0 and never calls fetch when the apiKey has no datacenter", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const res = await addMailchimpMember({
      apiKey: "nodatacenter",
      audienceId: "aud1",
      email: "a@b.co",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: false, status: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns ok:false with the status when fetch resolves non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    const res = await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: false, status: 400 });
  });

  it("swallows a network error and returns ok:false status:0", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: false, status: 0 });
  });
});

// Tagging (2026-07-31): the audit asked to tell form signups apart from imported or
// manually-added members — before this every member arrived untagged with
// source "API - Generic", indistinguishable from any other API write. Mailchimp
// silently IGNORES `tags` in the PUT body for an ALREADY-EXISTING member, which is
// the common case for a repeat signup, so the dedicated tags endpoint is what
// actually makes tagging reliable; the PUT body still carries them so a brand-new
// member is tagged even if the second call never lands.
describe("addMailchimpMember — source tags", () => {
  const okRes = { ok: true, status: 200 };

  it("sends the tags in the PUT body and then applies them via the tags endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okRes);
    const res = await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      tags: ["Online Form", "form:newsletter"],
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: true, status: 200, tagged: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const [putUrl, putInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(putInit.method).toBe("PUT");
    expect(JSON.parse(putInit.body as string).tags).toEqual(["Online Form", "form:newsletter"]);

    const [tagUrl, tagInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(tagUrl).toBe(`${putUrl}/tags`);
    expect(tagInit.method).toBe("POST");
    expect((tagInit.headers as Record<string, string>).authorization).toMatch(/^Basic /);
    expect(JSON.parse(tagInit.body as string)).toEqual({
      tags: [
        { name: "Online Form", status: "active" },
        { name: "form:newsletter", status: "active" },
      ],
    });
  });

  it("reports tagged:false when the tags call fails but keeps the member add ok", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okRes)
      .mockResolvedValueOnce({ ok: false, status: 403 });
    const res = await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      tags: ["Online Form"],
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: true, status: 200, tagged: false });
  });

  it("reports tagged:false when the tags call throws (and never rethrows)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okRes)
      .mockRejectedValueOnce(new Error("ECONNRESET"));
    const res = await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      tags: ["Online Form"],
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: true, status: 200, tagged: false });
  });

  it("skips the tags call entirely when the member add failed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const res = await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      tags: ["Online Form"],
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: false, status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("makes no tags call and reports no `tagged` field when no tags are asked for", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okRes);
    const res = await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string),
    ).not.toHaveProperty("tags");
  });

  it("ignores blank tag names and treats an all-blank list as no tags", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okRes);
    await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      tags: ["  ", "Online Form", ""],
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string).tags).toEqual([
      "Online Form",
    ]);

    const fetchImpl2 = vi.fn().mockResolvedValue(okRes);
    const res2 = await addMailchimpMember({
      apiKey: "k-us1",
      audienceId: "aud1",
      email: "a@b.co",
      tags: ["", "   "],
      fetch: fetchImpl2 as unknown as typeof fetch,
    });
    expect(res2).toEqual({ ok: true, status: 200 });
    expect(fetchImpl2).toHaveBeenCalledTimes(1);
  });
});

describe("mailchimpTagsFor", () => {
  it("marks the member as a website form signup and names the form", () => {
    expect(mailchimpTagsFor("newsletter")).toEqual(["Online Form", "form:newsletter"]);
    expect(mailchimpTagsFor("rsvp")).toEqual(["Online Form", "form:rsvp"]);
  });
});
