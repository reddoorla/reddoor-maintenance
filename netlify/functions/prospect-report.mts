import type { Context, Config } from "@netlify/functions";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { getProspectAuditByToken, isValidToken } from "../../src/db/prospect-audits.js";
import { renderProspectReport } from "../../src/prospect/render.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";
import type { ProspectAuditResult } from "../../src/prospect/types.js";

// The only public route on this site: a prospect opens it from a cold email, so
// there is no operator to authenticate. The 128-bit token IS the credential —
// hence noindex, a tight rate limit, and no directory listing anywhere.
export const config: Config = {
  path: ["/r/:token"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 60,
    aggregateBy: ["ip"],
  },
};

function plainText(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
  });
}

// handlerError (src/dashboard/handler-helpers.ts) is shared with authenticated
// dashboard routes and does not set x-robots-tag itself — this is the only
// public route on the site, so its unexpected-failure path still must never
// be indexable. Wrap rather than edit the shared helper.
function unexpectedFailure(service: string, err: unknown): Response {
  const res = handlerError(service, err);
  const headers = new Headers(res.headers);
  headers.set("x-robots-tag", "noindex");
  return new Response(res.body, { status: res.status, headers });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "GET") return plainText("Method not allowed.", 405);

  const token = ctx.params?.token;
  // Shape-check before the database: anything else is a scanner, not a prospect.
  if (!token || !isValidToken(token)) return plainText("Not found.", 404);

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[prospect-report] TURSO_DATABASE_URL missing");
    return plainText("Report storage is unconfigured.", 503);
  }

  try {
    const db = await openDb(readDbConfig());
    const row = await getProspectAuditByToken(db, token);
    if (!row) return plainText("Not found.", 404);

    const result = JSON.parse(row.result_json) as ProspectAuditResult;
    return new Response(renderProspectReport(result), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-robots-tag": "noindex, nofollow",
        "cache-control": "public, max-age=300",
      },
    });
  } catch (err) {
    return unexpectedFailure("prospect-report", err);
  }
};
