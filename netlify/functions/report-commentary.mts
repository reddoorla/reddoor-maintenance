import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { updateReportCommentary } from "../../src/reports/airtable/reports.js";
import { getReportById, mirrorReportPatch } from "../../src/db/fleet-state.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { mirrorWrite } from "../../src/db/freeze.js";
import { requireOperator, denialResponse, setReportCommentary } from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

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

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[report-commentary] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return json({ ok: false, error: "airtable-env-missing" }, 500);
  }

  const id = ctx.params?.id;
  // Airtable rec ids only — anything else is a probe, not a report.
  if (!id || !/^rec[A-Za-z0-9]+$/.test(id)) return json({ ok: false, error: "not-found" }, 404);

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
    const base = openBase({ apiKey, baseId });
    // Read from Turso, WRITE to Airtable (still the source of truth until the
    // Phase 5 freeze), then mirror so the page re-render right after the save
    // shows the new text instead of the old one for up to an hour. A mirror
    // failure is non-fatal — the hourly sync converges it.
    const db = await openDb(readDbConfig());
    const result = await setReportCommentary(
      {
        getReportById: (rid) => getReportById(db, rid),
        updateCommentary: async (rid, value) => {
          await updateReportCommentary(base, rid, value);
          await mirrorWrite(`report-commentary ${rid}`, () =>
            mirrorReportPatch(db, rid, { commentary: value === "" ? null : value }),
          );
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
