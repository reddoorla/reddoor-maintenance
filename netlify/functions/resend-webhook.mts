import type { Context, Config } from "@netlify/functions";
import { Webhook } from "svix";
import Airtable from "airtable";
import {
  STATUS_MAP,
  isStatusDowngrade,
  classifyUnmatchedEvent,
} from "../../src/reports/webhook-events.js";
import { findReportByMessageId, setDeliveryStatus } from "../../src/reports/airtable/reports.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { markNotifyBouncedByMessageId } from "../../src/db/submissions.js";

// Modest per-IP cap. The legitimate caller is svix (Resend) at low volume; this
// only blunts a flood of forged/unsigned POSTs before signature verification.
export const config: Config = {
  rateLimit: {
    windowSize: 60,
    windowLimit: 60,
    aggregateBy: ["ip"],
  },
};

type ResendEvent = {
  type: string;
  created_at?: string;
  data: {
    email_id?: string;
    [k: string]: unknown;
  };
};

// ORPHAN_RETRY_WINDOW_MS + the aging decision (classifyUnmatchedEvent) live in
// src/reports/webhook-events.ts so the race-window logic is unit-tested without
// booting this handler.

export default async (req: Request, _ctx: Context): Promise<Response> => {
  // Health check — lets an operator curl the deployed URL right after wiring
  // env vars and confirm (a) the function is reachable and (b) the deploy-wide
  // env made it through. Netlify env vars are site-wide, so this also surfaces
  // `TURSO_DATABASE_URL` — whose absence 500s the whole dashboard + forms
  // surface (the #1 fresh-deploy failure), even though THIS function doesn't use
  // it. Reports presence-only, never values; operators may share the output.
  if (req.method === "GET") {
    const body = {
      status: "ok",
      service: "reddoor-resend-webhook",
      env: {
        RESEND_WEBHOOK_SECRET: typeof process.env.RESEND_WEBHOOK_SECRET === "string",
        AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
        AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
        TURSO_DATABASE_URL: typeof process.env.TURSO_DATABASE_URL === "string",
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

  // A bounce/complaint may belong to a form-notification email, not a report:
  // ingest stamps the lead's `resend_message_id` (stampNotified), and its
  // notifyStatus "sent" only means Resend ACCEPTED the email — the Espada failure
  // mode was 4 of 8 lead notifications bouncing with nothing alarming (2026-07-16).
  // Check submissions FIRST: the id spaces are disjoint (a report id is never a
  // submission id), a match skips the pointless Airtable lookup + orphan retries,
  // and a miss falls through to the report path untouched. Both bounce AND
  // complaint mark the lead 'bounced' — either way it didn't reach the client.
  // Fail-open: a Turso blip must not stop a REPORT bounce from being recorded.
  if (newStatus === "bounced" || newStatus === "complained") {
    try {
      const db = await openDb(readDbConfig());
      if (await markNotifyBouncedByMessageId(db, messageId)) {
        console.log(
          `[resend-webhook] submission notify bounced (messageId=${messageId} type=${event.type})`,
        );
        return new Response("OK (submission notify bounced)", { status: 200 });
      }
    } catch (e) {
      console.error(
        `[resend-webhook] submissions bounce lookup failed for messageId=${messageId}: ${(e as Error).message}`,
      );
    }
  }

  const base = new Airtable({ apiKey: airtablePat }).base(baseId);
  let report: Awaited<ReturnType<typeof findReportByMessageId>>;
  try {
    report = await findReportByMessageId(base, messageId);
  } catch (e) {
    // Don't echo raw Airtable/internal error text to the caller; log it instead.
    console.error(
      `[resend-webhook] Airtable lookup failed for messageId=${messageId}: ${(e as Error).message}`,
    );
    return new Response("internal error", { status: 500 });
  }

  if (!report) {
    // Within ORPHAN_RETRY_WINDOW_MS of the event's creation this is almost
    // certainly the stampSent race (delivery beat the orchestrator's Airtable
    // write) → 500 so svix retries and a later attempt succeeds. Past the window
    // the race has resolved, so this is a genuine orphan and retrying is futile →
    // 200 to stop svix retrying for hours. A missing/unparseable created_at can't
    // be aged, so we conservatively keep the retry behaviour.
    const { decision, ageMs } = classifyUnmatchedEvent(event.created_at, Date.now());
    if (decision === "orphan") {
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

  // Monotonic write: a retried or out-of-order webhook (e.g. a `delivered`
  // arriving after a `bounced`/`complained`) must never clobber a terminal
  // failure the cockpit/digest rely on. We already hold the row's current
  // status, so skip the write here rather than read-modify-write in Airtable.
  if (isStatusDowngrade(report.deliveryStatus, newStatus)) {
    console.log(
      `[resend-webhook] skipping downgrade record=${report.id} ${report.deliveryStatus} → ${newStatus} (messageId=${messageId})`,
    );
    return new Response("OK (no downgrade)", { status: 200 });
  }

  try {
    await setDeliveryStatus(base, report.id, newStatus);
    console.log(
      `[resend-webhook] updated record=${report.id} → ${newStatus} (messageId=${messageId})`,
    );
  } catch (e) {
    // Don't echo raw Airtable/internal error text to the caller; log it instead.
    console.error(
      `[resend-webhook] Airtable update failed for record=${report.id}: ${(e as Error).message}`,
    );
    return new Response("internal error", { status: 500 });
  }
  return new Response("OK", { status: 200 });
};
