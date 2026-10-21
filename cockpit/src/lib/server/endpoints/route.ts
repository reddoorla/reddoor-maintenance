import type { RequestHandler } from "@sveltejs/kit";
import type { Context } from "@netlify/functions";

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
  return ({ request, params }) => handler(request, { params } as unknown as Context);
}
