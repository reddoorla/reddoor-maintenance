import type { Context, Config } from "@netlify/functions";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { listRecentProspectAudits } from "../../src/db/prospect-audits.js";
import {
  requireOperator,
  denialResponse,
  triggerProspectAudit,
  respondToProspectAuditTrigger,
  resolveRequestedBy,
  prospectAuditRecipientsLabel,
  makeWorkflowDispatchDispatcher,
  DEFAULT_PROSPECT_AUDIT_WORKFLOW_FILE,
} from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// This endpoint dispatches a `workflow_dispatch` in a PRIVATE repo, never this
// one — reddoor-maintenance's own Actions logs are world-readable, and a
// prospect URL landing there would publish the sales pipeline. The target repo
// is therefore always read from env (PROSPECT_AUDIT_DISPATCH_REPO), never
// hardcoded — see prospect-audit-trigger.ts for the injectable dispatcher.
export const config: Config = {
  path: ["/api/prospect-audit/run", "/.netlify/functions/prospect-audit-run"],
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  // GET health check — presence-only, mirrors trigger-renovate.mts.
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-prospect-audit-run",
        env: {
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
          PROSPECT_AUDIT_DISPATCH_REPO:
            typeof process.env.PROSPECT_AUDIT_DISPATCH_REPO === "string",
          RENOVATE_TOKEN:
            typeof process.env.RENOVATE_TOKEN === "string" ||
            typeof process.env.GH_TOKEN === "string",
          TURSO_DATABASE_URL: typeof process.env.TURSO_DATABASE_URL === "string",
        },
      },
      { status: 200 },
    );
  }

  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  // CSRF defense before auth — this is a state-changing endpoint reachable
  // with the ambient Basic-auth creds a browser replays cross-site, same
  // posture as every other trigger in this module.
  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  // Fired by fetch() from the /audits page, so JSON — a redirect to Google
  // inside fetch() would hand the script Google's HTML, not a status it can act
  // on.
  const auth = requireOperator(req, { wants: "json" });
  if (!auth.ok) return denialResponse(auth.denial);

  // The dispatch target is configurable, never hardcoded (see the module
  // comment above) — absent, this endpoint has nowhere safe to send a run.
  const repo = process.env.PROSPECT_AUDIT_DISPATCH_REPO?.trim();
  if (!repo) {
    console.error("[prospect-audit-run] PROSPECT_AUDIT_DISPATCH_REPO missing");
    return json(
      {
        ok: false,
        error: "unconfigured",
        message: "Prospect audits are unconfigured — no dispatch repo is set.",
      },
      503,
    );
  }
  const workflowFile =
    process.env.PROSPECT_AUDIT_WORKFLOW_FILE?.trim() || DEFAULT_PROSPECT_AUDIT_WORKFLOW_FILE;

  // Same token the dashboard's Renovate trigger uses — reused here rather than
  // adding a second secret, per the design doc's deploy-time note.
  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) {
    console.error("[prospect-audit-run] no RENOVATE_TOKEN/GH_TOKEN configured");
    return json({ ok: false, error: "not-configured" }, 503);
  }

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[prospect-audit-run] TURSO_DATABASE_URL missing");
    return json({ ok: false, error: "db-env-missing" }, 500);
  }

  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = await req.json();
    if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
  } catch {
    // Malformed/absent JSON body — url falls through as "" below, which
    // triggerProspectAudit reports as the same "invalid-url" the empty-string
    // case gets. One error path, not two.
  }
  const url = typeof payload.url === "string" ? payload.url : "";
  const business =
    typeof payload.business === "string" && payload.business.trim() ? payload.business : null;
  const requestedBy = resolveRequestedBy(auth.email);

  try {
    const db = await openDb(readDbConfig());
    const result = await triggerProspectAudit(
      {
        listRecent: (limit) => listRecentProspectAudits(db, limit),
        dispatch: makeWorkflowDispatchDispatcher({ token }),
      },
      { repo, workflowFile },
      { url, business, requestedBy },
    );
    const recipientsLabel = prospectAuditRecipientsLabel(process.env.PROSPECT_AUDIT_RECIPIENTS);
    const { status, body } = respondToProspectAuditTrigger(result, { recipientsLabel });
    return json(body, status);
  } catch (err) {
    return handlerError("prospect-audit-run", err);
  }
};
