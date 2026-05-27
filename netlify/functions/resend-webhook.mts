import type { Context } from "@netlify/functions";
import { Webhook } from "svix";
import Airtable from "airtable";
import { STATUS_MAP } from "../../src/reports/webhook-events.js";
import { findReportByMessageId, setDeliveryStatus } from "../../src/reports/airtable/reports.js";

type ResendEvent = {
  type: string;
  data: {
    email_id?: string;
    [k: string]: unknown;
  };
};

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const airtablePat = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!secret) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET missing");
    return new Response("RESEND_WEBHOOK_SECRET missing", { status: 500 });
  }
  if (!airtablePat || !baseId) {
    console.error("[resend-webhook] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return new Response("Airtable env missing", { status: 500 });
  }

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
    console.warn(`[resend-webhook] signature verification failed: ${(e as Error).message}`);
    return new Response(`signature verification failed: ${(e as Error).message}`, { status: 400 });
  }

  const newStatus = STATUS_MAP[event.type];
  if (!newStatus) {
    console.log(
      `[resend-webhook] event ignored: type=${event.type} email_id=${event.data.email_id ?? "?"}`,
    );
    return new Response("OK (event ignored)", { status: 200 });
  }

  const messageId = event.data.email_id;
  if (typeof messageId !== "string") {
    console.warn(`[resend-webhook] event missing data.email_id: type=${event.type}`);
    return new Response("event missing data.email_id", { status: 200 });
  }

  const base = new Airtable({ apiKey: airtablePat }).base(baseId);
  let report: Awaited<ReturnType<typeof findReportByMessageId>>;
  try {
    report = await findReportByMessageId(base, messageId);
  } catch (e) {
    console.error(
      `[resend-webhook] Airtable lookup failed for messageId=${messageId}: ${(e as Error).message}`,
    );
    return new Response(`Airtable lookup failed: ${(e as Error).message}`, { status: 500 });
  }

  if (!report) {
    // Return 500 so svix retries — this usually means stampSent hasn't run yet (delivery
    // raced ahead of the orchestrator's Airtable write). A retry will normally succeed.
    console.warn(
      `[resend-webhook] no matching Reports row for messageId=${messageId} type=${event.type} — returning 500 so svix retries`,
    );
    return new Response("no matching report (will retry)", { status: 500 });
  }

  try {
    await setDeliveryStatus(base, report.id, newStatus);
    console.log(
      `[resend-webhook] updated record=${report.id} → ${newStatus} (messageId=${messageId})`,
    );
  } catch (e) {
    console.error(
      `[resend-webhook] Airtable update failed for record=${report.id}: ${(e as Error).message}`,
    );
    return new Response(`Airtable update failed: ${(e as Error).message}`, { status: 500 });
  }
  return new Response("OK", { status: 200 });
};
