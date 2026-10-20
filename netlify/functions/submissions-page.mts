import type { Context, Config } from "@netlify/functions";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import {
  requireOperator,
  denialResponse,
  renderSubmissionsPageHtml,
} from "../../src/dashboard/index.js";
import { loadSubmissionsPage, markSubmissionsRead } from "../../src/dashboard/page-data.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

export const config: Config = {
  path: ["/submissions", "/.netlify/functions/submissions-page"],
  rateLimit: { windowSize: 60, windowLimit: 60, aggregateBy: ["ip"] },
};

function plainText(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extra },
  });
}

function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== "GET" && req.method !== "POST") {
    return plainText("Method not allowed.", 405);
  }
  // POST = the bulk mark-read state change: CSRF gate first, matching
  // submission-status.mts (the browser replays Basic auth cross-site).
  if (req.method === "POST" && !isCsrfAllowed(req)) {
    return plainText("Cross-site request rejected.", 403);
  }
  // Authenticate BEFORE the Turso env guard so an unauthenticated probe can't
  // tell which backend env is unset (a differentiated 500 leaks config state).
  // Only the password check — unavoidable, since auth needs it — precedes.
  const auth = requireOperator(req, { wants: "redirect" });
  if (!auth.ok) return denialResponse(auth.denial);
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[submissions-page] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }

  try {
    // DB is a hard dependency here — submissions ARE the page, so an open failure
    // must fall through to handlerError (502) rather than degrade to an empty page.
    const db = await openDb(readDbConfig());
    // POST carries the ACTIVE filter as form fields (same names as the GET query),
    // so the loader re-derives the identical SubmissionFilter server-side — the
    // bulk action flips exactly the bucket the operator was looking at.
    if (req.method === "POST") {
      const result = await markSubmissionsRead(db, new URLSearchParams(await req.text()));
      // A non-matching ?site= slug previously fell through to the WHOLE fleet —
      // misleading. 404 like site-dashboard.
      if (result.kind === "no-site") {
        return plainText(`No site found for slug '${result.slug}'.`, 404);
      }
      if (result.kind === "unknown-action") return plainText("Unknown action.", 400);
      console.log(`[submissions-page] bulk mark-read flipped ${result.count} row(s)`);
      // 303: the browser re-GETs the same filtered view, so a refresh can't repost.
      return new Response(null, { status: 303, headers: { location: result.location } });
    }

    const loaded = await loadSubmissionsPage(db, new URL(req.url).searchParams);
    if (loaded.kind === "no-site") {
      return plainText(`No site found for slug '${loaded.slug}'.`, 404);
    }
    const model = loaded.model;
    return html(renderSubmissionsPageHtml(model, auth.email), 200);
  } catch (err) {
    return handlerError("submissions-page", err);
  }
};
