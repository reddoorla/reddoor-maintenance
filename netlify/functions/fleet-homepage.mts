import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { listWebsites } from "../../src/reports/airtable/websites.js";
import { verifyBasicAuth, renderFleetHomeHtml } from "../../src/dashboard/index.js";

// Owns the root path. The per-site dashboard function continues to own
// /s/:slug; the resend-webhook function continues to own its own path.
// Phase 2 decision was Netlify site-level password — implemented here as
// HTTP Basic Auth against DASHBOARD_PASSWORD env var rather than via
// Netlify dashboard settings, so the gate ships with the code.
export const config: Config = {
  path: ["/"],
};

function plainText(body: string, status: number, extraHeaders: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extraHeaders },
  });
}

function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const password = process.env.DASHBOARD_PASSWORD;

  if (!apiKey || !baseId) {
    console.error("[fleet-homepage] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return plainText("Airtable env missing", 500);
  }

  if (!password) {
    // Distinguishable from a wrong-password 401 because it carries a
    // setup hint instead of a WWW-Authenticate challenge. Operator sees
    // this exactly once after deploy; clear next step.
    console.error("[fleet-homepage] DASHBOARD_PASSWORD missing");
    return plainText(
      "Fleet homepage is unconfigured. Set DASHBOARD_PASSWORD in the Netlify site env.",
      503,
    );
  }

  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return plainText("Authentication required.", 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  const base = openBase({ apiKey, baseId });
  const websites = await listWebsites(base);
  // Stable display order: alphabetical by name. Matches what someone
  // would naturally scan for a known site. Operator can re-sort by
  // clicking column headers in a later phase.
  const sorted = [...websites].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  return html(renderFleetHomeHtml(sorted), 200);
};
