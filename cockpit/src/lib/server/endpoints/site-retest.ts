import type { Context } from "@netlify/functions";
import { openDb, readDbConfig } from "../../../../../src/db/client.js";
import { getSiteBySlug } from "../../../../../src/db/fleet-state.js";
import { requireOperator, denialResponse } from "../../../../../src/dashboard/auth/require.js";
import { triggerSiteRetest } from "../../../../../src/dashboard/site-retest-trigger.js";
import { isCsrfAllowed } from "../../../../../src/dashboard/csrf.js";
import { handlerError } from "../../../../../src/dashboard/handler-helpers.js";
import { makeGitHubRest } from "../../../../../src/github/gh-rest.js";
import { SITE_RETEST_WORKFLOW } from "../../../../../src/retest/site-retest.js";

// P1-88: POST /api/sites/:slug/retest dispatches site-retest.yml on the central repo
// for this one site. The slug arrives in ctx.params.slug.

// The repo whose Actions run the re-test: the dashboard's own, as in refresh-fleet.
const CENTRAL_REPO = process.env.GITHUB_REPOSITORY?.trim() || "reddoorla/reddoor-maintenance";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-site-retest",
        env: {
          TURSO_DATABASE_URL: typeof process.env.TURSO_DATABASE_URL === "string",
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
          GH_TOKEN: typeof process.env.GH_TOKEN === "string",
        },
      },
      { status: 200 },
    );
  }

  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  // CSRF defense before auth, as on every state-changing endpoint.
  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const auth = requireOperator(req, { wants: "json" });
  if (!auth.ok) return denialResponse(auth.denial);

  const token = process.env.GH_TOKEN?.trim();
  if (!token) return json({ ok: false, error: "not-configured" }, 503);

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[site-retest] TURSO_DATABASE_URL missing");
    return json({ ok: false, error: "db-env-missing" }, 500);
  }

  const slug = ctx.params?.slug;
  if (!slug) return json({ ok: false, error: "missing-slug" }, 400);

  try {
    const db = await openDb(readDbConfig());
    const gh = makeGitHubRest({ token });
    const result = await triggerSiteRetest(
      {
        getSite: (s) => getSiteBySlug(db, s),
        dispatch: async (workflow, inputs) => {
          const ref = await gh.defaultBranch(CENTRAL_REPO);
          await gh.dispatchWorkflow(CENTRAL_REPO, workflow, ref, inputs);
        },
      },
      slug,
    );
    if (result.status === "bad-slug") return json({ ok: false, error: "bad-slug" }, 400);
    if (result.status === "not-found") return json({ ok: false, error: "not-found" }, 404);
    if (result.status === "nothing-to-retest")
      return json({ ok: false, error: "nothing-to-retest" }, 409);
    if (result.status === "failed")
      return json({ ok: false, error: "dispatch-failed", detail: result.error }, 502);
    return json(
      {
        ok: true,
        runsUrl: `https://github.com/${CENTRAL_REPO}/actions/workflows/${SITE_RETEST_WORKFLOW}`,
      },
      200,
    );
  } catch (err) {
    return handlerError("site-retest", err);
  }
};
