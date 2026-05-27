import { describe, it, expect } from "vitest";
import type { ResendClient, ResendSendInput } from "../../../src/reports/send/resend.js";

describe("ResendClient input contract", () => {
  it("a fake client captures the exact input shape used by orchestrate", async () => {
    const captured: ResendSendInput[] = [];
    const fake: ResendClient = {
      async send(input) {
        captured.push(input);
        return { messageId: "msg_test_1" };
      },
    };
    await fake.send({
      from: "a@example.com",
      to: ["b@example.com"],
      subject: "s",
      html: "<p>hi</p>",
      attachments: [
        { filename: "x.jpg", content: "AAAA", content_type: "image/jpeg", content_id: "x-header" },
      ],
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.attachments?.[0]?.content_id).toBe("x-header");
  });
});
