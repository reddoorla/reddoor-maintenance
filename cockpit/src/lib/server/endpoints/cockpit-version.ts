import { requireOperator, denialResponse } from "../../../../../src/dashboard/index.js";
import { openDb, readDbConfig } from "../../../../../src/db/client.js";
import { readCockpitVersion } from "../../../../../src/db/cockpit-version.js";
import { handlerError } from "../../../../../src/dashboard/handler-helpers.js";

// The cockpit's "has anything changed?" check: the store's change counter
// (migration 0048), one row by primary key. The open cockpit asks it on focus and
// about once a minute while visible, and reads its whole snapshot again only when
// the answer differs from the version that snapshot was read with.

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Never a cached answer: a stale "unchanged" is the one thing it must not say.
      "cache-control": "private, no-store",
    },
  });
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return json({ ok: false, error: "method-not-allowed" }, 405);

  // Fetched by the page's script, so JSON: a sign-in redirect inside fetch() would
  // hand it Google's HTML. A denial tells the page its session ended.
  const auth = requireOperator(req, { wants: "json" });
  if (!auth.ok) return denialResponse(auth.denial);

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[cockpit-version] TURSO_DATABASE_URL missing");
    return json({ ok: false, error: "db-env-missing" }, 500);
  }

  try {
    const db = await openDb(readDbConfig());
    return json({ ok: true, version: await readCockpitVersion(db) }, 200);
  } catch (err) {
    return handlerError("cockpit-version", err);
  }
};
