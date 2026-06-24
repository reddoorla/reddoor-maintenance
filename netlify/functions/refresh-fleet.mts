import type { Context, Config } from "@netlify/functions";
import { verifyBasicAuth, refreshFleetState } from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";
import { makeGitHubRest } from "../../src/github/gh-rest.js";

// Fleet-level refresh: dispatch the nightly state sweeps on demand. No slug — it
// targets the CENTRAL repo (where fleet-security.yml / fleet-lighthouse.yml live),
// not a per-site repo. Path-routed on the function like the other endpoints.
export const config: Config = {
  path: ["/api/fleet/refresh", "/.netlify/functions/refresh-fleet"],
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};

// The repo whose Actions run the fleet sweeps. Defaults to the dashboard's own
// repo; GITHUB_REPOSITORY (Actions' "owner/repo" var) overrides so a fork/rename
// doesn't hardcode-break it.
const CENTRAL_REPO = process.env.GITHUB_REPOSITORY?.trim() || "reddoorla/reddoor-maintenance";

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  // GET health check — presence-only, mirrors the other dashboard endpoints.
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-refresh-fleet",
        env: {
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
    console.error("[refresh-fleet] DASHBOARD_PASSWORD missing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return json({ ok: false, error: "unauthorized" }, 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  // The dispatch is a request-path GitHub write — needs a token with actions:write.
  // Absent → degrade cleanly (button shows "not configured").
  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) return json({ ok: false, error: "not-configured" }, 503);

  try {
    const gh = makeGitHubRest({ token });
    // Resolve the central repo's default branch once; dispatch each workflow on it.
    const ref = await gh.defaultBranch(CENTRAL_REPO);
    const result = await refreshFleetState({
      dispatch: (workflow) => gh.dispatchWorkflow(CENTRAL_REPO, workflow, ref),
    });
    // Every dispatch failed → 502 (nothing kicked off). Otherwise 200 with the
    // partial breakdown (the UI names any sweep that didn't start).
    if (result.dispatched.length === 0) {
      return json({ ok: false, error: "dispatch-failed", failed: result.failed }, 502);
    }
    return json({ ok: true, dispatched: result.dispatched, failed: result.failed }, 200);
  } catch (err) {
    return handlerError("refresh-fleet", err);
  }
};
