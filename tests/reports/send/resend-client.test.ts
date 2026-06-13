import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the `resend` SDK so the real client wrapper (defaultResendClient) is
// exercised — field forwarding, messageId extraction, and error-wrapping —
// without any network. The constructor records its key; `emails.send` is a
// vi.fn we drive per-test. `vi.hoisted` makes the mocks reachable from the
// hoisted `vi.mock` factory (which runs before normal top-level statements).
const { sendMock, ResendCtor } = vi.hoisted(() => {
  const send = vi.fn();
  const ctor = vi.fn(function (this: { emails: { send: typeof send } }, _key: string) {
    this.emails = { send };
  });
  return { sendMock: send, ResendCtor: ctor };
});
vi.mock("resend", () => ({ Resend: ResendCtor }));

import { defaultResendClient } from "../../../src/reports/send/resend.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  sendMock.mockReset();
  ResendCtor.mockClear();
  process.env.RESEND_API_KEY = "re_test_key";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("defaultResendClient", () => {
  it("throws (exitCode 2) when RESEND_API_KEY is not set", () => {
    delete process.env.RESEND_API_KEY;
    try {
      defaultResendClient();
      throw new Error("expected defaultResendClient to throw");
    } catch (e) {
      expect((e as Error).message).toMatch(/RESEND_API_KEY not set/);
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
  });

  it("constructs the SDK with the env key", () => {
    defaultResendClient();
    expect(ResendCtor).toHaveBeenCalledWith("re_test_key");
  });

  it("forwards from/to/subject/html and the idempotencyKey, returning the messageId", async () => {
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null });
    const client = defaultResendClient();

    const result = await client.send({
      from: "a@reddoor.test",
      to: ["client@example.com"],
      cc: ["cc@example.com"],
      replyTo: "reply@reddoor.test",
      subject: "Monthly report",
      html: "<p>hi</p>",
      attachments: [{ filename: "x.png", content: "AAAA" }],
      idempotencyKey: "recABC",
    });

    expect(result).toEqual({ messageId: "msg_123" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload, options] = sendMock.mock.calls[0]!;
    expect(payload).toMatchObject({
      from: "a@reddoor.test",
      to: ["client@example.com"],
      cc: ["cc@example.com"],
      replyTo: "reply@reddoor.test",
      subject: "Monthly report",
      html: "<p>hi</p>",
      attachments: [{ filename: "x.png", content: "AAAA" }],
    });
    // idempotencyKey rides in the SECOND arg (the send options), as the
    // `Idempotency-Key` header — not in the payload.
    expect(options).toEqual({ idempotencyKey: "recABC" });
  });

  it("omits optional fields and passes empty options when no idempotencyKey is given", async () => {
    sendMock.mockResolvedValue({ data: { id: "msg_456" }, error: null });
    const client = defaultResendClient();

    await client.send({
      from: "a@reddoor.test",
      to: ["client@example.com"],
      subject: "s",
      html: "<p>h</p>",
    });

    const [payload, options] = sendMock.mock.calls[0]!;
    expect(payload).not.toHaveProperty("cc");
    expect(payload).not.toHaveProperty("replyTo");
    expect(payload).not.toHaveProperty("attachments");
    expect(options).toEqual({});
  });

  it("wraps an SDK error as `Resend error: <message>` (the prefix downstream depends on)", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "An email with this idempotency key already exists", name: "rate_limit" },
    });
    const client = defaultResendClient();

    await expect(
      client.send({ from: "a@b", to: ["c@d"], subject: "s", html: "<p>h</p>" }),
    ).rejects.toThrow(/^Resend error: An email with this idempotency key already exists$/);
  });

  it("throws when the SDK returns success but no message id", async () => {
    sendMock.mockResolvedValue({ data: {}, error: null });
    const client = defaultResendClient();

    await expect(
      client.send({ from: "a@b", to: ["c@d"], subject: "s", html: "<p>h</p>" }),
    ).rejects.toThrow(/Resend returned no message id/);
  });
});
