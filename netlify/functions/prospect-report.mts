import type { Context, Config } from "@netlify/functions";
import { isValidToken } from "../../src/db/prospect-audits.js";
import { reportUrl } from "../../src/prospect/report-url.js";

// The report used to be rendered here. It now lives at reddoorla.com/audit/
// {token} — a real, branded page on our own domain rather than generated HTML
// on the ops app's.
//
// This route stays as a permanent redirect and is NOT deleted. Links already
// sent are in prospects' inboxes and will be opened months from now; keeping
// them working is the entire point of a 301. It is also why the redirect is
// built from the same token: the destination is the same document, and the
// person following the link should not be able to tell anything moved.
//
// Still deliberately unauthenticated, for the reason it always was: the
// 128-bit token IS the credential.
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

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "GET") return plainText("Method not allowed.", 405);

  const token = ctx.params?.token;
  // Shape-check before redirecting. Without it this route would happily bounce
  // an arbitrary path segment onto reddoorla.com — an open redirect wearing our
  // own domain. Anything that is not a token is a scanner, not a prospect.
  if (!token || !isValidToken(token)) return plainText("Not found.", 404);

  return new Response(null, {
    status: 301,
    headers: {
      location: reportUrl(token),
      // The destination is noindex too, but a redirect that is itself indexable
      // publishes the token in a search result. Belt and braces.
      "x-robots-tag": "noindex",
      "cache-control": "private, no-store",
    },
  });
};
