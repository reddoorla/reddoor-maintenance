import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { updateReportCommentary } from "../../src/reports/airtable/reports.js";
import { getReportById, mirrorReportPatch } from "../../src/db/fleet-state.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { mirrorWrite } from "../../src/db/freeze.js";
import { requireOperator, denialResponse, setReportCommentary } from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";
import { isReportId } from "../../src/fleet/report-id.js";

// #539 Phase 4 report review. Path-routed on the function itself for the same
// reason as every other dashboard endpoint: a netlify.toml 200 rewrite leaves
// ctx.params empty. The report rec id arrives in ctx.params.id; { text } in the
// JSON body.
export const config: Config = {
  path: ["/api/reports/:id/commentary", "/.netlify/functions/report-commentary"],
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);
  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const auth = requireOperator(req, { wants: "json" });
  if (!auth.ok) return denialResponse(auth.denial);

  // No Airtable env gate (#646, the same drop step 2 made in resend-webhook.mts).
  // The report READ and the authoritative write are Turso; Airtable is only the
  // rollback-window shadow, handled below — and for a minted `report_<ULID>` id
  // that shadow skips itself anyway (#865). A gate here would 500 every
  // commentary edit on the day the env vars are pulled, for a store this
  // request no longer depends on.
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;

  const id = ctx.params?.id;
  // Both report id shapes — `rec…` (Airtable-minted, pre-#646) and a minted
  // `report_<ULID>` — and nothing else: anything else is a probe, not a report.
  if (!id || !isReportId(id)) return json({ ok: false, error: "not-found" }, 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid-json" }, 400);
  }
  const text =
    typeof (body as { text?: unknown } | null)?.text === "string"
      ? (body as { text: string }).text
      : "";

  try {
    // Read from Turso, and write it FIRST and strictly: since the #643 freeze
    // Turso is the store the page re-render reads and the store that must
    // succeed. mirrorWrite decides those error semantics — post-freeze a
    // failure rethrows and this request 502s, because no sync converges it any
    // more.
    const db = await openDb(readDbConfig());
    const result = await setReportCommentary(
      {
        getReportById: (rid) => getReportById(db, rid),
        updateCommentary: async (rid, value) => {
          await mirrorWrite(`report-commentary ${rid}`, () =>
            mirrorReportPatch(db, rid, { commentary: value === "" ? null : value }),
          );
          // The Airtable SHADOW. Written while Airtable is configured, and
          // still allowed to fail the request — the rollback-window contract in
          // src/db/freeze.ts (`TURSO_IS_AUTHORITATIVE`): a shadow you might roll
          // back to is one you keep trustworthy. Turso has already landed by
          // then, so an Airtable outage costs only the shadow, and the
          // operator's re-save re-applies both writes until it catches up.
          //
          // With the Airtable env ABSENT the shadow is skipped, not failed:
          // that is the deliberate unplug Phase 6 ends in, the authoritative
          // write has landed, and a 500 would only lose the operator's edit
          // over a config problem no retry can fix. It is logged on a greppable
          // line so an accidental unplug during the rollback window is visible
          // (a rollback would then need that commentary re-applied to Airtable;
          // Turso holds it). A half-configured env (one var of two) is treated
          // the same way, under its own reason.
          if (apiKey && baseId) {
            await updateReportCommentary(openBase({ apiKey, baseId }), rid, value);
          } else {
            const reason = apiKey || baseId ? "env-partial" : "env-absent";
            console.warn(`[report-commentary] AIRTABLE_SHADOW skipped=${reason} record=${rid}`);
          }
        },
      },
      id,
      text,
    );
    if (result.status === "not-found") return json({ ok: false, error: "not-found" }, 404);
    // 409, not 400: the request was well-formed, the report's state refuses it.
    if (result.status === "locked") return json({ ok: false, error: "already-sent" }, 409);
    if (result.status === "invalid") return json({ ok: false, error: "too-long" }, 400);
    return json({ ok: true }, 200);
  } catch (err) {
    return handlerError("report-commentary", err);
  }
};
