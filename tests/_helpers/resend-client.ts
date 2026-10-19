import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";

/**
 * A ResendClient that records every send in `captured` and succeeds. The
 * returned id is `messageId` when given, else `msg_<n>` for the n-th send.
 */
export function captureClient(messageId?: string): {
  client: ResendClient;
  captured: ResendSendInput[];
} {
  const captured: ResendSendInput[] = [];
  const client: ResendClient = {
    async send(input) {
      captured.push(input);
      return { messageId: messageId ?? `msg_${captured.length}` };
    },
  };
  return { client, captured };
}
