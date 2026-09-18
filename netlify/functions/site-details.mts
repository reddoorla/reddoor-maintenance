import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { updateSiteField } from "../../src/reports/airtable/websites.js";
import { getSiteBySlug, mirrorSiteField } from "../../src/db/fleet-state.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { mirrorWrite } from "../../src/db/freeze.js";
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

  const auth = requireOperator(req, { wants: "json" });
  if (!auth.ok) return denialResponse(auth.denial);

  // No Airtable env gate (#646) — the same drop #855 made in `resend-webhook`
  // and #868 in `report-commentary`. The site READ is Turso, and since the #643
  // freeze so is the write the page re-render actually reads back; Airtable is
  // only the rollback-window shadow, handled below — and for a minted
  // `site_<ULID>` id `updateSiteField` skips that shadow itself
  // (`skipsAirtableShadow`). A gate here would 500 every detail edit on the day
  // the env vars are pulled, for a store this request no longer depends on —
  // and this editor is the ONLY way left to correct a site's own `url` since
  // the freeze retired Airtable hand-editing.
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;

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
    // #539: read from Turso, and write it FIRST and strictly — since the #643
    // freeze `sites` is the store this page re-reads and the store that must
    // succeed. mirrorWrite decides those error semantics: post-freeze a failure
    // rethrows and this request 502s, because no sync converges it any more.
    const db = await openDb(readDbConfig());
    const result = await setSiteDetail(
      {
        getSite: (s) => getSiteBySlug(db, s),
        updateField: async (id, col, val) => {
          await mirrorWrite(`site-details ${col}`, () => mirrorSiteField(db, id, col, val));
          // The Airtable SHADOW. Written while Airtable is configured, and still
          // allowed to fail the request — the rollback-window contract in
          // src/db/freeze.ts (`TURSO_IS_AUTHORITATIVE`): a shadow you might roll
          // back to is one you keep trustworthy. Turso has already landed by
          // then, so an Airtable outage costs only the shadow, and the
          // operator's re-save re-applies both writes until it catches up.
          //
          // With the Airtable env ABSENT the shadow is skipped, not failed: that
          // is the deliberate unplug Phase 6 ends in, the authoritative write
          // has landed, and a 500 would only lose the operator's edit over a
          // config problem no retry can fix. It is logged on a greppable line —
          // carrying the COLUMN as well as the record, because that is what a
          // rollback would have to re-apply by hand — so an accidental unplug
          // during the rollback window is visible; Turso holds the value. A
          // half-configured env (one var of two) is treated the same way, under
          // its own reason.
          if (apiKey && baseId) {
            await updateSiteField(openBase({ apiKey, baseId }), id, col, val);
          } else {
            const reason = apiKey || baseId ? "env-partial" : "env-absent";
            console.warn(
              `[site-details] AIRTABLE_SHADOW skipped=${reason} record=${id} column=${col}`,
            );
          }
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
