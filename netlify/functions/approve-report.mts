import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import {
  getReportById as getReportByIdAirtable,
  approveReportRow,
} from "../../src/reports/airtable/reports.js";
import { approveReport, verifyBasicAuth } from "../../src/dashboard/index.js";

// Path-route the customer-facing /api/reports/:id/approve on the function
// itself (same reason as site-dashboard.mts: a netlify.toml [[redirects]] 200
// rewrite hands the function the ORIGINAL request URL, not the rewritten one —
// so ctx.params would be empty for every request). With function-level path
// routing the record id arrives in ctx.params.id.
export const config: Config = {
  path: ["/api/reports/:id/approve", "/.netlify/functions/approve-report"],
};

function plainText(
  body: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extraHeaders },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  // GET health check — presence-only, mirrors resend-webhook.mts and
  // site-dashboard.mts so an operator can curl after wiring env vars.
  // Never reports env values.
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-approve-report",
        env: {
          AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
          AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
        },
      },
      { status: 200 },
    );
  }

  if (req.method !== "POST") return plainText("Method not allowed", 405);

  // CSRF defense: this is a state-changing endpoint reachable with the ambient
  // Basic-auth creds the browser replays cross-site. Conservative same-origin
  // guard — if Sec-Fetch-Site is PRESENT it must be "same-origin" or "none"
  // (the legit inline fetch from /s/:slug and address-bar/bookmark loads send
  // those); anything else ("cross-site"/"same-site") is rejected. If the header
  // is ABSENT (older browsers, non-browser clients) we proceed and fall back to
  // Basic auth. Placed before auth so a forged cross-site POST is cut early.
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return plainText("Cross-site request rejected", 403);
  }

  // Auth BEFORE any Airtable read, same realm as site-dashboard.mts so the
  // browser reuses creds when the inline fetch fires from /s/:slug.
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[approve-report] DASHBOARD_PASSWORD missing");
    return plainText("Approve endpoint is unconfigured. Set DASHBOARD_PASSWORD.", 503);
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return plainText("Authentication required.", 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[approve-report] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return plainText("Airtable env missing", 500);
  }

  const id = ctx.params?.id;
  if (!id) return plainText("Missing report id", 400);

  const base = openBase({ apiKey, baseId });
  const result = await approveReport(
    {
      getReportById: (rid) => getReportByIdAirtable(base, rid),
      approveReportRow: (rid, at, by) => approveReportRow(base, rid, at, by),
      now: () => new Date(),
    },
    id,
  );

  if (result.status === "not-found") {
    return Response.json(result, { status: 404 });
  }
  return Response.json(result, { status: 200 });
};
