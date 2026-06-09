import type { Context } from "@netlify/functions";
import { Webhook } from "svix";
import Airtable from "airtable";
import { STATUS_MAP } from "../../src/reports/webhook-events.js";
import { findReportByMessageId, setDeliveryStatus } from "../../src/reports/airtable/reports.js";

type ResendEvent = {
  type: string;
  created_at?: string;
  data: {
    email_id?: string;
    [k: string]: unknown;
  };
};

// How long after an event was created we keep retrying an unmatched lookup.
// Inside this window an unmatched event is almost always the stampSent race
// (delivery beat the orchestrator's Airtable write) so we 500 → svix retries.
// Past it the race has long resolved, so an unmatched event is a genuine orphan
// (email sent outside this pipeline, or a deleted Reports row) and retrying is
// futile — we 200 to stop svix hammering the function for hours/days.
const ORPHAN_RETRY_WINDOW_MS = 10 * 60 * 1000;

export default async (req: Request, _ctx: Context): Promise<Response> => {
  // Health check — lets an operator curl the deployed URL right after
  // wiring env vars and confirm (a) the function is reachable and (b) the
  // three required env vars made it through. Reports presence-only, never
  // values; operators may share this output in a support ticket.
  if (req.method === "GET") {
    const body = {
      status: "ok",
      service: "reddoor-resend-webhook",
      env: {
        RESEND_WEBHOOK_SECRET: typeof process.env.RESEND_WEBHOOK_SECRET === "string",
        AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
        AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
      },
    };
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

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
    // Within ORPHAN_RETRY_WINDOW_MS of the event's creation this is almost
    // certainly the stampSent race (delivery beat the orchestrator's Airtable
    // write) → 500 so svix retries and a later attempt succeeds. Past the window
    // the race has resolved, so this is a genuine orphan and retrying is futile →
    // 200 to stop svix retrying for hours. A missing/unparseable created_at can't
    // be aged, so we conservatively keep the retry behaviour.
    const createdMs = event.created_at ? Date.parse(event.created_at) : NaN;
    const ageMs = Number.isNaN(createdMs) ? 0 : Date.now() - createdMs;
    if (ageMs > ORPHAN_RETRY_WINDOW_MS) {
      console.warn(
        `[resend-webhook] orphan event (no Reports row, age=${Math.round(ageMs / 1000)}s) for messageId=${messageId} type=${event.type} — returning 200, not retrying`,
      );
      return new Response("no matching report (orphan, not retrying)", { status: 200 });
    }
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
