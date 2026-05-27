import { Resend } from "resend";

export type ResendSendInput = {
  from: string;
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64
    contentType?: string;
    /** Setting this attaches the file as inline; reference it from HTML as `src="cid:<id>"`. */
    inlineContentId?: string;
  }>;
  /**
   * Stable key forwarded as the `Idempotency-Key` header. Resend dedupes calls
   * with the same key for 24 hours, returning the original message id. Use a
   * key that's stable across retries of the same logical send (e.g. the
   * Reports row id), so a network blip during stamping doesn't cause a
   * duplicate email to the client.
   */
  idempotencyKey?: string;
};

export type ResendSendResult = {
  messageId: string;
};

export type ResendClient = {
  send: (input: ResendSendInput) => Promise<ResendSendResult>;
};

export function defaultResendClient(): ResendClient {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw Object.assign(new Error("RESEND_API_KEY not set"), { exitCode: 2 });
  const resend = new Resend(key);
  return {
    async send(input) {
      const payload: Parameters<typeof resend.emails.send>[0] = {
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      };
      if (input.cc) payload.cc = input.cc;
      if (input.replyTo) payload.replyTo = input.replyTo;
      if (input.attachments) payload.attachments = input.attachments;
      const options: Parameters<typeof resend.emails.send>[1] = {};
      if (input.idempotencyKey) options.idempotencyKey = input.idempotencyKey;
      const { data, error } = await resend.emails.send(payload, options);
      if (error) throw new Error(`Resend error: ${error.message}`);
      if (!data?.id) throw new Error("Resend returned no message id");
      return { messageId: data.id };
    },
  };
}
