import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { listWebsites, siteSlug } from "../../src/reports/airtable/websites.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { listSubmissionsFiltered, countSubmissionsFiltered } from "../../src/db/submissions.js";
import {
  verifyBasicAuth,
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
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[submissions-page] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return plainText("Airtable env missing", 500);
  }
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[submissions-page] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[submissions-page] DASHBOARD_PASSWORD missing");
    return plainText(
      "Submissions page is unconfigured. Set DASHBOARD_PASSWORD in the Netlify site env.",
      503,
    );
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return plainText("Authentication required.", 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  try {
    const base = openBase({ apiKey, baseId });
    // DB is a hard dependency here — submissions ARE the page, so an open failure
    // must fall through to handlerError (502) rather than degrade to an empty page.
    const db = await openDb(readDbConfig());
    const {
      filter,
      rawFilter,
      siteSlug: slugParam,
      page,
    } = parseSubmissionsQuery(new URL(req.url).searchParams);

    const websites = await listWebsites(base);
    if (slugParam) {
      const match = websites.find((w) => siteSlug(w.name) === slugParam);
      if (match) filter.siteId = match.id;
    }

    const [rows, total] = await Promise.all([
      listSubmissionsFiltered(db, filter, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      countSubmissionsFiltered(db, filter),
    ]);

    const model = buildSubmissionsPageModel({
      rows,
      total,
      sites: websites.map((w) => ({ id: w.id, name: w.name })),
      filter,
      rawFilter,
      page,
    });
    return html(renderSubmissionsPageHtml(model), 200);
  } catch (err) {
    return handlerError("submissions-page", err);
  }
};
