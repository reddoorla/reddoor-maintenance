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
    content_type?: string;
    content_id?: string; // for CID inline reference
  }>;
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
      const { data, error } = await resend.emails.send(payload);
      if (error) throw new Error(`Resend error: ${error.message}`);
      if (!data?.id) throw new Error("Resend returned no message id");
      return { messageId: data.id };
    },
  };
}
