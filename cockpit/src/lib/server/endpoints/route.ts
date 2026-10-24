import type { RequestHandler } from "@sveltejs/kit";
import type { Context } from "@netlify/functions";
import { requireOperator } from "../../../../../src/dashboard/index.js";
import { openDb, readDbConfig } from "../../../../../src/db/client.js";
import { readCockpitVersion } from "../../../../../src/db/cockpit-version.js";
import { VERSION_AFTER_HEADER, VERSION_BEFORE_HEADER } from "../../freshness.js";

/**
 * The dashboard's `/api/*` and `/auth/*` endpoints were Netlify functions, one
 * per file, until they moved into this app so the whole dashboard is one
 * function with one rate-limit budget (the Pro plan honours 5 code-based rules
 * per project, and 18 meant none applied: maintenance#1642). Each handler kept
 * its Netlify signature and answers every method itself (405s included), so a
 * route only hands it the request and the path params, the one part of the
 * Netlify context any of them reads.
 */
export type NetlifyHandler = (req: Request, ctx: Context) => Promise<Response>;

export function endpoint(handler: NetlifyHandler): RequestHandler {
  return ({ request, params }) =>
    withVersionHeaders(request, () => handler(request, { params } as unknown as Context));
}

/**
 * An operator's POST under `/api/` answers with the store's change counter just
 * before and just after its handler ran (#1700, the operator's answer (a) in
 * workspace decisions/2026-10-24-1508). The open cockpit takes the after-value
 * as its own, so its own change does not raise "Newer data is available"; a
 * write by anyone else outside the handler's own run still does. Only on a 2xx
 * answer, only for a request that passes `requireOperator`, and never at the
 * cost of the post: a counter that cannot be read leaves the headers off.
 */
export async function withVersionHeaders(
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  if (request.method !== "POST" || !new URL(request.url).pathname.startsWith("/api/")) {
    return run();
  }
  if (!requireOperator(request, { wants: "json" }).ok) return run();
  const before = await readVersion();
  const res = await run();
  if (before === null || !res.ok) return res;
  const after = await readVersion();
  if (after === null) return res;
  const headers = new Headers(res.headers);
  headers.set(VERSION_BEFORE_HEADER, String(before));
  headers.set(VERSION_AFTER_HEADER, String(after));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function readVersion(): Promise<number | null> {
  if (!process.env.TURSO_DATABASE_URL) return null;
  try {
    return await readCockpitVersion(await openDb(readDbConfig()));
  } catch {
    return null;
  }
}
