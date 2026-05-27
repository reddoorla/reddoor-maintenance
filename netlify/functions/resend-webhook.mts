import type { Context } from "@netlify/functions";
import { Webhook } from "svix";
import Airtable from "airtable";

type ResendEvent = {
  type: string;
  data: {
    email_id?: string;
    [k: string]: unknown;
  };
};

const STATUS_MAP: Record<string, "delivered" | "bounced" | "complained"> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const airtablePat = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!secret) return new Response("RESEND_WEBHOOK_SECRET missing", { status: 500 });
  if (!airtablePat || !baseId) return new Response("Airtable env missing", { status: 500 });

  const raw = await req.text();
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  let event: ResendEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(raw, headers) as ResendEvent;
  } catch (e) {
    return new Response(`signature verification failed: ${(e as Error).message}`, { status: 400 });
  }

  const newStatus = STATUS_MAP[event.type];
  if (!newStatus) return new Response("OK (event ignored)", { status: 200 });

  const messageId = event.data.email_id;
  if (typeof messageId !== "string") {
    return new Response("event missing data.email_id", { status: 200 });
  }

  const base = new Airtable({ apiKey: airtablePat }).base(baseId);
  const found: Array<{ id: string }> = [];
  await base("Reports")
    .select({ filterByFormula: `{Resend message ID} = "${messageId}"`, maxRecords: 1 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) found.push({ id: rec.id });
      fetchNextPage();
    });

  if (found.length === 0) {
    return new Response("OK (no matching report)", { status: 200 });
  }

  await base("Reports").update([{ id: found[0]!.id, fields: { "Delivery status": newStatus } }]);
  return new Response("OK", { status: 200 });
};
