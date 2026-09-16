import type { Context, Config } from "@netlify/functions";
import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  getSubmissionById,
  setSubmissionStatusRow,
  ackNotifyBounce,
} from "../../src/db/submissions.js";
import {
  setSubmissionStatus,
  acknowledgeNotifyBounce,
  requireOperator,
  denialResponse,
} from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// Operator-only state change: same posture as approve-report.mts (CSRF + Basic
// auth + tighter 30/min). Path-routed on the function for the same ctx.params
// reason.
export const config: Config = {
  path: ["/api/submissions/:id/status", "/.netlify/functions/submission-status"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 30,
    aggregateBy: ["ip"],
  },
};

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-submission-status",
        env: {
          TURSO_DATABASE_URL: typeof process.env.TURSO_DATABASE_URL === "string",
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
        },
      },
      { status: 200 },
    );
  }
  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const auth = requireOperator(req, { wants: "json" });
  if (!auth.ok) return denialResponse(auth.denial);

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[submission-status] TURSO_DATABASE_URL missing");
    return json({ ok: false, error: "db-env-missing" }, 500);
  }

  const id = ctx.params?.id;
  if (!id) return json({ ok: false, error: "missing-id" }, 400);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid-json" }, 400);
  }
  const parsed = (body as { status?: unknown; ack?: unknown } | null) ?? {};
  const requested = parsed.status;
  const ack = parsed.ack;

  try {
    const db = await openDb(readDbConfig());
    const deps = {
      getSubmissionById: (sid: string) => getSubmissionById(db, sid),
      setSubmissionStatusRow: (sid: string, status: Parameters<typeof setSubmissionStatusRow>[2]) =>
        setSubmissionStatusRow(db, sid, status),
      ackNotifyBounce: (sid: string) => ackNotifyBounce(db, sid, new Date()),
    };
    // #783. The acknowledge gesture rides this endpoint rather than a new one:
    // same auth, same CSRF gate, same rate limit, and the page's single inline
    // script already posts here. An `ack` body names it explicitly, so it can
    // never be confused with a status transition.
    if (ack !== undefined) {
      if (ack !== "notify-bounce") return json({ ok: false, error: "invalid-ack", ack }, 400);
      const acked = await acknowledgeNotifyBounce(deps, id);
      if (acked.status === "not-found") return json(acked, 404);
      return json(acked, 200);
    }
    const result = await setSubmissionStatus(deps, id, requested);
    if (result.status === "not-found") return json(result, 404);
    if (result.status === "invalid") return json(result, 400);
    return json(result, 200);
  } catch (err) {
    return handlerError("submission-status", err);
  }
};
