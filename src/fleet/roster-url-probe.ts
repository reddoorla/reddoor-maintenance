/**
 * Does a roster `url` resolve to a deployed site? (#912, P1-3)
 *
 * One GET, redirects followed, 15 s budget. Only a final 2xx passes: a 401/403
 * from a password-protected build is a `fail` too, and accepting it is the
 * surface's job, not the probe's. A blank url is no verdict at all (`null` /
 * `no url`) — nothing was claimed, so nothing failed.
 *
 * Netlify answers an unclaimed `*.netlify.app` host with its own
 * site-not-found page (404, `server: Netlify`, a text/plain body linking
 * `utm_content=site-not-found-text`). That gets its own status so the verdict
 * says "nothing is deployed here" rather than "some page is missing": a
 * deployed site's own 404 is `server: Netlify` too, but HTML with no
 * `site-not-found` in it. The body is 206 bytes only because the request ID is
 * fixed-length, so the length is never matched on.
 */
import { isHttpUrl } from "../util/url.js";

export type UrlFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type UrlProbe = {
  resolves: "pass" | "fail" | null;
  status: string;
};

export const NETLIFY_SITE_NOT_FOUND = "404 netlify-site-not-found";

export const PROBE_TIMEOUT_MS = 15_000;

export async function probeRosterUrl(
  raw: string,
  fetcher: UrlFetch = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<UrlProbe> {
  const url = raw.trim();
  if (url === "") return { resolves: null, status: "no url" };
  if (!isHttpUrl(url)) return { resolves: "fail", status: "not an http(s) url" };
  try {
    const res = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 200 && res.status < 300) {
      await discard(res);
      return { resolves: "pass", status: String(res.status) };
    }
    if (
      res.status === 404 &&
      (res.headers.get("server") ?? "").trim().toLowerCase() === "netlify"
    ) {
      const body = await res.text().catch(() => "");
      if (body.includes("site-not-found"))
        return { resolves: "fail", status: NETLIFY_SITE_NOT_FOUND };
      return { resolves: "fail", status: "404" };
    }
    await discard(res);
    return { resolves: "fail", status: String(res.status) };
  } catch (e) {
    return { resolves: "fail", status: `error: ${errorCode(e)}` };
  }
}

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

function errorCode(e: unknown): string {
  const err = (e ?? {}) as { name?: unknown; code?: unknown; cause?: { code?: unknown } };
  const code = err.cause?.code ?? err.code;
  if (typeof code === "string" && code !== "") return code;
  return typeof err.name === "string" && err.name !== "" ? err.name : "unknown";
}
