import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { addMailchimpMember } from "../../src/forms/mailchimp.js";

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
