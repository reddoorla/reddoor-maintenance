import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { getWebsiteBySlug, updateSiteField } from "../../src/reports/airtable/websites.js";
import { verifyBasicAuth, setSiteDetail } from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// Path-route /api/sites/:slug/details on the function itself (same reason as the
// other dashboard endpoints: a netlify.toml 200 rewrite would leave ctx.params
// empty). The slug arrives in ctx.params.slug; { field, value } in the JSON body.
export const config: Config = {
  path: ["/api/sites/:slug/details", "/.netlify/functions/site-details"],
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-site-details",
        env: {
          AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
          AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
        },
      },
      { status: 200 },
    );
  }

  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[site-details] DASHBOARD_PASSWORD missing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return json({ ok: false, error: "unauthorized" }, 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[site-details] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return json({ ok: false, error: "airtable-env-missing" }, 500);
  }

  const slug = ctx.params?.slug;
  if (!slug) return json({ ok: false, error: "missing-slug" }, 400);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid-json" }, 400);
  }
  const b = (body as { field?: unknown; value?: unknown } | null) ?? {};
  const field = typeof b.field === "string" ? b.field : "";
  const value = typeof b.value === "string" ? b.value : "";

  try {
    const base = openBase({ apiKey, baseId });
    const result = await setSiteDetail(
      {
        getSite: (s) => getWebsiteBySlug(base, s),
        updateField: (id, col, val) => updateSiteField(base, id, col, val),
      },
      slug,
      field,
      value,
    );
    if (result.status === "bad-field") return json({ ok: false, error: "bad-field" }, 400);
    if (result.status === "invalid") return json({ ok: false, error: "invalid", field }, 400);
    if (result.status === "not-found") return json({ ok: false, error: "not-found" }, 404);
    return json({ ok: true }, 200);
  } catch (err) {
    return handlerError("site-details", err);
  }
};
