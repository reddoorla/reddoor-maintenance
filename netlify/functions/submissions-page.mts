import type { Context, Config } from "@netlify/functions";
import { siteSlug } from "../../src/reports/airtable/websites.js";
import { listSites } from "../../src/db/fleet-state.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  listSubmissionsFiltered,
  countSubmissionsFiltered,
  listSpamReasonsFiltered,
  markFilteredAsRead,
} from "../../src/db/submissions.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import {
  requireOperator,
  denialResponse,
  renderSubmissionsPageHtml,
  parseSubmissionsQuery,
  buildSubmissionsPageModel,
  PAGE_SIZE,
} from "../../src/dashboard/index.js";
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
  // No Airtable guard: this page is a Turso read that imports one pure string
  // helper from the Airtable module, so the check could only refuse a page it
  // does not need. Same removal as form-ingest and fleet-homepage.
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[submissions-page] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }

  try {
    // DB is a hard dependency here — submissions ARE the page, so an open failure
    // must fall through to handlerError (502) rather than degrade to an empty page.
    const db = await openDb(readDbConfig());
    // POST carries the ACTIVE filter as form fields (same names as the GET query),
    // so parseSubmissionsQuery re-derives the identical SubmissionFilter server-side
    // — the bulk action flips exactly the bucket the operator was looking at.
    const params =
      req.method === "POST" ? new URLSearchParams(await req.text()) : new URL(req.url).searchParams;
    const { filter, rawFilter, siteSlug: slugParam, page } = parseSubmissionsQuery(params);

    // Phase 2 (#539): the fleet list is a Turso read — this page no longer
    // touches Airtable at all.
    const websites = await listSites(db);
    if (slugParam) {
      const match = websites.find((w) => siteSlug(w.name) === slugParam);
      // A non-matching ?site= slug previously fell through and returned the WHOLE
      // fleet (filter.siteId stayed unset) — misleading. 404 like site-dashboard.
      if (!match) return plainText(`No site found for slug '${slugParam}'.`, 404);
      filter.siteId = match.id;
    }

    if (req.method === "POST") {
      // Bulk mark-read (2026-07-16). markFilteredAsRead's status='new' guard is the
      // real safety: spam/archived/operator-touched rows are never flipped, whatever
      // the posted filter says.
      if (params.get("action") !== "mark-read") return plainText("Unknown action.", 400);
      const marked = await markFilteredAsRead(db, filter);
      console.log(`[submissions-page] bulk mark-read flipped ${marked} row(s)`);
      // 303: the browser re-GETs the same filtered view, so a refresh can't repost.
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(rawFilter)) if (v) qs.set(k, v);
      const query = qs.toString();
      return new Response(null, {
        status: 303,
        headers: { location: query ? `/submissions?${query}` : "/submissions" },
      });
    }

    // Facet reasons cover the WHOLE filtered bucket (the renderer's facet line sits
    // under the full-bucket total, so a page-scoped tally misreads a multi-page
    // bucket). Only fetched on the spam views where the facet line renders.
    const wantFacets = filter.status === "spam_auto" || filter.status === "spam";
    const [rows, total, facetReasons, newOnlyCount] = await Promise.all([
      listSubmissionsFiltered(db, filter, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      countSubmissionsFiltered(db, filter),
      wantFacets ? listSpamReasonsFiltered(db, filter) : Promise.resolve([]),
      // Bulk mark-read button count — the still-'new' subset of the CURRENT bucket.
      // A status='new' view reuses `total`; any other explicit status can't contain
      // 'new' rows (0, button hidden); only the mixed view needs its own count.
      filter.status === undefined
        ? countSubmissionsFiltered(db, { ...filter, status: "new" })
        : Promise.resolve(0),
    ]);

    const model = buildSubmissionsPageModel({
      rows,
      total,
      sites: websites.map((w) => ({ id: w.id, name: w.name })),
      filter,
      rawFilter,
      page,
      facetReasons,
      markableNewCount: filter.status === "new" ? total : newOnlyCount,
    });
    return html(renderSubmissionsPageHtml(model, auth.email), 200);
  } catch (err) {
    return handlerError("submissions-page", err);
  }
};
