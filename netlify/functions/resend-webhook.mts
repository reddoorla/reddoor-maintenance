import type { Context, Config } from "@netlify/functions";
import { Webhook } from "svix";
import Airtable from "airtable";
import {
  STATUS_MAP,
  isStatusDowngrade,
  classifyUnmatchedEvent,
  parseBounceDetail,
} from "../../src/reports/webhook-events.js";
import { setDeliveryStatus } from "../../src/reports/airtable/reports.js";
import { findReportByMessageId, mirrorReportPatch } from "../../src/db/fleet-state.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { mirrorWrite } from "../../src/db/freeze.js";
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
  // surface (the #1 fresh-deploy failure), and, since #646 step 2, this
  // function's report lookup too. The AIRTABLE_* lines stay until Phase 6 step 7:
  // they now report whether the shadow write will run, not whether the function
  // can. Reports presence-only, never values; operators may share the output.
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
  if (!secret) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET missing");
    return new Response("RESEND_WEBHOOK_SECRET missing", { status: 500 });
  }
  // No Airtable env gate (#646 step 2). The report lookup and the authoritative
  // write are Turso; Airtable is only the rollback-window shadow, handled below.
  // A gate here would 500 every delivery event on the day the env vars are
  // pulled, for a store this function no longer reads.
  const airtablePat = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;

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
  // submission id), a match skips the pointless report lookup + orphan retries,
  // and a miss falls through to the report path untouched. Both bounce AND
  // complaint mark the lead 'bounced' — either way it didn't reach the client.
  // Fail-open: a Turso blip must not stop a REPORT bounce from being recorded.
  if (newStatus === "bounced" || newStatus === "complained") {
    try {
      const db = await openDb(readDbConfig());
      // #783: keep Resend's classification instead of discarding it. Without it
      // a Permanent bounce on a dead mailbox and a Transient/ContentRejected
      // refusal by the CLIENT's spam filter were the same stored state, and the
      // alarm accused the point-of-contact address in both cases. A complaint
      // carries no bounce object, so it parses to null and stores nothing.
      const bounce = parseBounceDetail(event.data);
      if (await markNotifyBouncedByMessageId(db, messageId, bounce)) {
        console.log(
          `[resend-webhook] submission notify bounced (messageId=${messageId} type=${event.type} ` +
            `bounceType=${bounce?.type ?? "none"} bounceSubType=${bounce?.subType ?? "none"})`,
        );
        return new Response("OK (submission notify bounced)", { status: 200 });
      }
    } catch (e) {
      console.error(
        `[resend-webhook] submissions bounce lookup failed for messageId=${messageId}: ${(e as Error).message}`,
      );
    }
  }

  let report: Awaited<ReturnType<typeof findReportByMessageId>>;
  try {
    const db = await openDb(readDbConfig());
    report = await findReportByMessageId(db, messageId);
  } catch (e) {
    // Don't echo raw libSQL/internal error text to the caller; log it instead.
    // A 500 makes svix redeliver, which is right for a store blip.
    console.error(
      `[resend-webhook] Turso report lookup failed for messageId=${messageId}: ${(e as Error).message}`,
    );
    return new Response("internal error", { status: 500 });
  }

  if (!report) {
    // Within ORPHAN_RETRY_WINDOW_MS of the event's creation this is almost
    // certainly the stampSent race (delivery beat the send run's stamp, which
    // reaches Turso through reportSentMirror right after the Airtable stamp)
    // → 500 so svix retries and a later attempt succeeds. Past the window
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
  // status (read from Turso, the authoritative store), so skip the write here.
  if (isStatusDowngrade(report.deliveryStatus, newStatus)) {
    console.log(
      `[resend-webhook] skipping downgrade record=${report.id} ${report.deliveryStatus} → ${newStatus} (messageId=${messageId})`,
    );
    return new Response("OK (no downgrade)", { status: 200 });
  }

  try {
    // #539/#643: Turso is authoritative, so its write goes FIRST and is fatal —
    // mirrorWrite rethrows into the catch below and the 500 makes svix
    // redeliver (the monotonic guard keeps the retry idempotent: same-rank is
    // not a downgrade). The row count is handed through (#647): a status for a
    // row Turso never held is `missed`, not a green no-op.
    await mirrorWrite(`resend-webhook ${report.id}`, async () => {
      const db = await openDb(readDbConfig());
      return mirrorReportPatch(db, report.id, { delivery_status: newStatus });
    });
    // The Airtable SHADOW (#646 step 2). Written while Airtable is configured,
    // and still allowed to fail the request — the rollback-window contract in
    // src/db/freeze.ts (`TURSO_IS_AUTHORITATIVE`): a shadow you might roll back
    // to is one you keep trustworthy. Turso has already landed by now, so an
    // Airtable outage costs only the shadow, and svix's redelivery re-applies
    // both writes until the shadow catches up.
    //
    // With the Airtable env ABSENT the shadow is skipped, not failed: that is
    // the deliberate unplug Phase 6 ends in, the authoritative write has
    // landed, and a 500 would only buy hours of svix retries that no retry can
    // fix. It is logged on a greppable line so an accidental unplug during the
    // rollback window is visible (a rollback would then need that status
    // re-applied to Airtable; Turso holds it). A half-configured env (one var
    // of two) is treated the same way, under its own reason.
    if (airtablePat && baseId) {
      const base = new Airtable({ apiKey: airtablePat }).base(baseId);
      await setDeliveryStatus(base, report.id, newStatus);
    } else {
      const reason = airtablePat || baseId ? "env-partial" : "env-absent";
      console.warn(
        `[resend-webhook] AIRTABLE_SHADOW skipped=${reason} record=${report.id} status=${newStatus}`,
      );
    }
    console.log(
      `[resend-webhook] updated record=${report.id} → ${newStatus} (messageId=${messageId})`,
    );
  } catch (e) {
    // Don't echo raw internal error text to the caller; log it instead. Names
    // both stores: the Turso write is the authoritative one, and the Airtable
    // shadow can still fail the request during the rollback window.
    console.error(
      `[resend-webhook] update failed (Turso or the Airtable shadow) for record=${report.id}: ${(e as Error).message}`,
    );
    return new Response("internal error", { status: 500 });
  }
  return new Response("OK", { status: 200 });
};
