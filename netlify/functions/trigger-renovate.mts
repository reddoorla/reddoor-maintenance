import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { getWebsiteBySlug } from "../../src/reports/airtable/websites.js";
import { verifyBasicAuth, triggerRenovateForSite } from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";
import { makeGitHubRest } from "../../src/github/gh-rest.js";
import { RENOVATE_WORKFLOW_FILE } from "../../src/github/renovate-dispatch.js";

// Path-route /api/sites/:slug/trigger-renovate on the function itself (same reason
// as report-checklist.mts / site-dashboard.mts: a netlify.toml 200 rewrite would
// hand the function the original URL, leaving ctx.params empty). The slug arrives
// in ctx.params.slug.
export const config: Config = {
  path: ["/api/sites/:slug/trigger-renovate", "/.netlify/functions/trigger-renovate"],
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  // GET health check — presence-only, mirrors the other dashboard endpoints.
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-trigger-renovate",
        env: {
          AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
          AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
          RENOVATE_TOKEN:
            typeof process.env.RENOVATE_TOKEN === "string" ||
            typeof process.env.GH_TOKEN === "string",
        },
      },
      { status: 200 },
    );
  }

  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  // CSRF defense before auth — same posture as the other state-changing endpoints.
  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[trigger-renovate] DASHBOARD_PASSWORD missing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return json({ ok: false, error: "unauthorized" }, 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  // The dashboard's first request-path GitHub write needs a token with
  // actions:write. Absent → degrade cleanly (button shows "not configured").
  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) return json({ ok: false, error: "not-configured" }, 503);

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[trigger-renovate] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return json({ ok: false, error: "airtable-env-missing" }, 500);
  }

  const slug = ctx.params?.slug;
  if (!slug) return json({ ok: false, error: "missing-slug" }, 400);

  try {
    const base = openBase({ apiKey, baseId });
    // REST (fetch) client, not the gh-CLI client: this runs in the Netlify
    // (Lambda) runtime, which has no `gh` binary — shelling out throws ENOENT.
    const gh = makeGitHubRest({ token });
    const result = await triggerRenovateForSite(
      {
        getSite: (s) => getWebsiteBySlug(base, s),
        dispatch: async (repo) => {
          const ref = await gh.defaultBranch(repo);
          await gh.dispatchWorkflow(repo, RENOVATE_WORKFLOW_FILE, ref);
        },
      },
      slug,
    );
    if (result.status === "not-found") return json({ ok: false, error: "not-found" }, 404);
    if (result.status === "no-repo") return json({ ok: false, error: "no-repo" }, 400);
    if (result.status === "failed")
      return json({ ok: false, error: "dispatch-failed", detail: result.error }, 502);
    return json({ ok: true, repo: result.repo }, 200);
  } catch (err) {
    return handlerError("trigger-renovate", err);
  }
};
