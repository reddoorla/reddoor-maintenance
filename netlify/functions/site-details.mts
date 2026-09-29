import type { Context, Config } from "@netlify/functions";
import { getSiteBySlug, mirrorSiteField } from "../../src/db/fleet-state.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { mirrorWrite } from "../../src/db/mirror-write.js";
import { requireOperator, denialResponse, setSiteDetail } from "../../src/dashboard/index.js";
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
          TURSO_DATABASE_URL: typeof process.env.TURSO_DATABASE_URL === "string",
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
        },
      },
      { status: 200 },
    );
  }

  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const auth = requireOperator(req, { wants: "json" });
  if (!auth.ok) return denialResponse(auth.denial);

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
    // #539: read from Turso, and write it strictly — `sites` is the store this
    // page re-reads. mirrorWrite decides those error semantics: a failure
    // rethrows and this request 502s, because nothing else converges it.
    const db = await openDb(readDbConfig());
    const result = await setSiteDetail(
      {
        getSite: (s) => getSiteBySlug(db, s),
        updateField: async (id, col, val) => {
          await mirrorWrite(`site-details ${col}`, () => mirrorSiteField(db, id, col, val));
        },
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
