import type { Context, Config } from "@netlify/functions";
import {
  verifyBasicAuth,
  refreshFleetState,
  summarizeFleetRunStatus,
  FLEET_REFRESH_WORKFLOWS,
} from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";
import { makeGitHubRest } from "../../src/github/gh-rest.js";

// Fleet-level refresh: dispatch the nightly state sweeps on demand. No slug — it
// targets the CENTRAL repo (where fleet-security.yml / fleet-lighthouse.yml live),
// not a per-site repo. Path-routed on the function like the other endpoints.
export const config: Config = {
  path: ["/api/fleet/refresh", "/api/fleet/refresh/status", "/.netlify/functions/refresh-fleet"],
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};

// The repo whose Actions run the fleet sweeps. Defaults to the dashboard's own
// repo; GITHUB_REPOSITORY (Actions' "owner/repo" var) overrides so a fork/rename
// doesn't hardcode-break it.
const CENTRAL_REPO = process.env.GITHUB_REPOSITORY?.trim() || "reddoorla/reddoor-maintenance";

// Canonical path for the live-status poll. Matched exactly (not via endsWith) so a
// future route that merely ends in "/status" can never fall into the poll branch.
const STATUS_PATH = "/api/fleet/refresh/status";

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

/** Shared auth gate: returns a token on success, or a Response to return on failure. */
function gateAuth(req: Request): { token: string } | { fail: Response } {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[refresh-fleet] DASHBOARD_PASSWORD missing");
    return { fail: json({ ok: false, error: "unconfigured" }, 503) };
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return {
      fail: json({ ok: false, error: "unauthorized" }, 401, {
        "www-authenticate": 'Basic realm="Reddoor fleet"',
      }),
    };
  }
  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) return { fail: json({ ok: false, error: "not-configured" }, 503) };
  return { token };
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const url = new URL(req.url);

  // GET health check — presence-only, mirrors the other dashboard endpoints.
  // Skips STATUS_PATH so the live-status poll below handles it instead.
  if (req.method === "GET" && url.pathname !== STATUS_PATH) {
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

  // Live status poll: re-find the dispatched runs by timestamp and summarize them.
  if (req.method === "GET" && url.pathname === STATUS_PATH) {
    const since = url.searchParams.get("since") ?? "";
    if (!since || Number.isNaN(new Date(since).getTime())) {
      return json({ ok: false, error: "bad-since" }, 400);
    }
    const gated = gateAuth(req);
    if ("fail" in gated) return gated.fail;
    try {
      const gh = makeGitHubRest({ token: gated.token });
      // All-or-nothing per poll: if either workflow's run lookup throws we 502 and the
      // client's 10s retry loop self-heals on the next tick (vs partial results).
      const runsByWorkflow = await Promise.all(
        FLEET_REFRESH_WORKFLOWS.map(async (workflow) => ({
          workflow,
          runs: await gh.listWorkflowRuns(CENTRAL_REPO, workflow, {
            since,
            event: "workflow_dispatch",
            perPage: 1,
          }),
        })),
      );
      const summary = summarizeFleetRunStatus(runsByWorkflow);
      // Enrich in-progress workflows with the current build step (one extra jobs call
      // each, only while running). Best-effort: a jobs hiccup must NOT sink the poll,
      // so any failure → step stays null.
      const perWorkflow = await Promise.all(
        summary.perWorkflow.map(async (w) => {
          if (w.state !== "in_progress") return w;
          const run = runsByWorkflow.find((r) => r.workflow === w.workflow)?.runs[0];
          if (!run) return w;
          try {
            return { ...w, step: await gh.currentRunStep(CENTRAL_REPO, run.id) };
          } catch {
            return w;
          }
        }),
      );
      return json({ ok: true, status: { ...summary, perWorkflow } }, 200);
    } catch (err) {
      return handlerError("refresh-fleet-status", err);
    }
  }

  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  // CSRF defense before auth — state-changing endpoint.
  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const gated = gateAuth(req);
  if ("fail" in gated) return gated.fail;

  try {
    const gh = makeGitHubRest({ token: gated.token });
    const ref = await gh.defaultBranch(CENTRAL_REPO);
    // Capture the instant just before dispatch; the client polls /status?since=<this>.
    const since = new Date().toISOString();
    const result = await refreshFleetState({
      dispatch: (workflow) => gh.dispatchWorkflow(CENTRAL_REPO, workflow, ref),
    });
    if (result.dispatched.length === 0) {
      return json({ ok: false, error: "dispatch-failed", failed: result.failed }, 502);
    }
    return json({ ok: true, dispatched: result.dispatched, failed: result.failed, since }, 200);
  } catch (err) {
    return handlerError("refresh-fleet", err);
  }
};
