import type { Context, Config } from "@netlify/functions";
import { requireOperator, denialResponse } from "../../src/dashboard/index.js";
import { triggerReportRerender } from "../../src/dashboard/trigger-rerender.js";
import { getReportById } from "../../src/db/fleet-state.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { makeGitHubRest } from "../../src/github/gh-rest.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// "Refresh preview" for one report (#539 Phase 4). Dispatches
// report-rerender.yml on THIS repo — the render needs sharp, which no function
// bundles, so it runs where the real send renders.
const SELF_REPO = "reddoorla/reddoor-maintenance";
const RERENDER_WORKFLOW_FILE = "report-rerender.yml";

export const config: Config = {
  path: ["/api/reports/:id/rerender", "/.netlify/functions/report-rerender"],
  rateLimit: { windowSize: 60, windowLimit: 20, aggregateBy: ["ip"] },
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

  const token = process.env.GH_TOKEN?.trim();
  if (!token) return json({ ok: false, error: "not-configured" }, 503);
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[report-rerender] TURSO_DATABASE_URL missing");
    return json({ ok: false, error: "db-env-missing" }, 500);
  }

  const id = ctx.params?.id;
  if (!id || !/^rec[A-Za-z0-9]+$/.test(id)) return json({ ok: false, error: "not-found" }, 404);

  try {
    const db = await openDb(readDbConfig());
    // REST (fetch) client, not the gh-CLI client: the Netlify (Lambda) runtime
    // has no `gh` binary, so shelling out throws ENOENT.
    const gh = makeGitHubRest({ token });
    const result = await triggerReportRerender(
      {
        getReport: (rid) => getReportById(db, rid),
        dispatch: async (inputs) => {
          const ref = await gh.defaultBranch(SELF_REPO);
          await gh.dispatchWorkflow(SELF_REPO, RERENDER_WORKFLOW_FILE, ref, inputs);
        },
      },
      id,
    );
    if (result.status === "not-found") return json({ ok: false, error: "not-found" }, 404);
    // 409, not 400: well-formed request, refused by the report's state.
    if (result.status === "already-sent") return json({ ok: false, error: "already-sent" }, 409);
    if (result.status === "failed")
      return json({ ok: false, error: "dispatch-failed", detail: result.error }, 502);
    return json({ ok: true }, 200);
  } catch (err) {
    return handlerError("report-rerender", err);
  }
};
