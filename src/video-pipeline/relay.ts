import { isPrismicFileUrl, videoKey } from "./key.js";
import { dispatchEncode } from "./dispatch.js";
import { findVideos, mergeFound } from "./classify.js";
import type { DocLike, VideoRules } from "./classify.js";
import { needsEncode, resolveVideo } from "./manifest.js";
import type { Renditions } from "./manifest.js";
import { parsePrismicWebhook, verifyPrismicSecret } from "./webhook.js";

export type RelayConfig = {
  secret: string | undefined;
  site: string;
  repo: string;
  dispatchToken: string | undefined;
  mediaBase: string | undefined;
  rules: VideoRules;
  getDocuments: (ids: string[]) => Promise<DocLike[]>;
  fetch: typeof fetch;
};
export type RelayResult = { status: number; body: string };

/**
 * The only characters a dispatched URL may carry, after WHATWG normalisation. Anything else (a `$`, `(`,
 * `'`, `;`, `!` or `*` in a path, say) is refused rather than handed to a workflow that might interpolate it.
 */
const SAFE_URL = /^[A-Za-z0-9\-._~:/?=&%+#@]+$/;

const json = (status: number, value: unknown): RelayResult => ({
  status,
  body: JSON.stringify(value),
});

/** Order: method, JSON, secret, dispatch token, then the webhook's type and documents, then dispatch. */
export async function handlePrismicWebhook(
  req: { method: string; body: string },
  cfg: RelayConfig,
): Promise<RelayResult> {
  if (req.method !== "POST") return { status: 405, body: "method not allowed" };
  let body: unknown;
  try {
    body = JSON.parse(req.body);
  } catch {
    return { status: 400, body: "bad json" };
  }
  if (!verifyPrismicSecret(body, cfg.secret)) return { status: 401, body: "bad secret" };
  if (!cfg.dispatchToken) return { status: 500, body: "VIDEO_DISPATCH_TOKEN is not set" };
  if (!cfg.mediaBase) return { status: 500, body: "VIDEO_MEDIA_BASE is not set" };

  const hook = parsePrismicWebhook(body);
  if (hook.type !== "api-update" || hook.documents.length === 0) {
    return json(200, { ignored: hook.type });
  }

  const docs = await cfg.getDocuments(hook.documents);
  const found = mergeFound(docs.flatMap((d) => findVideos(d, cfg.rules)));
  const cache = new Map<string, Promise<Renditions>>();
  const dispatched: string[] = [];
  const skipped: string[] = [];
  const refused: string[] = [];
  const failed: string[] = [];
  for (const video of found) {
    if (!isPrismicFileUrl(video.url)) {
      refused.push(video.url);
      continue;
    }
    const href = new URL(video.url).href;
    if (!SAFE_URL.test(href)) {
      refused.push(video.url);
      continue;
    }
    const key = videoKey(cfg.site, href);
    if (key === null) continue;
    const r = await resolveVideo(href, {
      site: cfg.site,
      mediaBase: cfg.mediaBase,
      fetch: cfg.fetch,
      cache,
    });
    if (!needsEncode(video, r)) {
      skipped.push(key);
      continue;
    }
    try {
      await dispatchEncode(
        { url: href, class: video.class, key },
        { repo: cfg.repo, token: cfg.dispatchToken, fetch: cfg.fetch },
      );
      dispatched.push(key);
    } catch (err) {
      failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (failed.length > 0) return json(502, { dispatched, skipped, refused, failed });
  return json(200, { dispatched, skipped, refused });
}
