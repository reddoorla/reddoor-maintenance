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
      if (error)
        throw Object.assign(new Error(`Resend error: ${error.message}`), {
          resendErrorName: error.name,
        });
      if (!data?.id) throw new Error("Resend returned no message id");
      return { messageId: data.id };
    },
  };
}

/** #1262: the SDK names an error `application_error` when the request never got
 *  a parseable answer (a network failure, an unparseable 5xx), and Resend itself
 *  answers `internal_server_error` for its own failures. The email may have gone
 *  out in either case. The two idempotency 409s mean a send under the same key
 *  is in flight or already went out. Every other named error is Resend refusing
 *  the send. */
const AMBIGUOUS_RESEND_ERRORS = new Set([
  "application_error",
  "internal_server_error",
  "concurrent_idempotent_requests",
  "invalid_idempotent_request",
]);

/** True only when Resend answered and refused the send, so no email went out. */
export function isDefiniteRejection(err: unknown): boolean {
  const name = (err as { resendErrorName?: unknown } | null)?.resendErrorName;
  return typeof name === "string" && !AMBIGUOUS_RESEND_ERRORS.has(name);
}
