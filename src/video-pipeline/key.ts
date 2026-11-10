// Pure helpers for the video pipeline's keys and URLs. This file is part of the
// light `@reddoorla/maintenance/video-pipeline` subpath: it imports nothing but
// its own siblings, so a Netlify function or a SvelteKit server can load it.
import { createHash } from "node:crypto";

export type VideoClass = "background" | "player";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i;

function parseHttps(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** The decoded last path segment of an https URL, without query/hash; null for a non-https or unparsable URL. */
export function fileNameOf(url: string): string | null {
  const u = parseHttps(url);
  if (u === null) return null;
  const last = u.pathname.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return null;
  }
}

/** True for an https URL whose host ends in `.prismic.io` (the apex itself does not count). The one host check the pipeline uses. */
export function isPrismicFileUrl(url: string): boolean {
  const u = parseHttps(url);
  return u !== null && u.hostname.endsWith(".prismic.io");
}

/**
 * `${slugify(site)}/${stem}-${h}`: stem = slugify(name without extension), or "video" when that slug is
 * empty; h = the first 10 hex of sha256(sourceOf(url)), so two files whose names slugify alike never share
 * a key. Null when the URL is not https, its file name does not match VIDEO_EXT, or the site slug is empty.
 */
export function videoKey(site: string, url: string): string | null {
  const name = fileNameOf(url);
  if (name === null || !VIDEO_EXT.test(name)) return null;
  const siteSlug = slugify(site);
  if (siteSlug === "") return null;
  const source = sourceOf(url);
  if (source === null) return null;
  const stemSlug = slugify(name.replace(VIDEO_EXT, "")) || "video";
  const h = createHash("sha256").update(source, "utf8").digest("hex").slice(0, 10);
  return `${siteSlug}/${stemSlug}-${h}`;
}

/** The last segment of a key: the file-name stem used for renditions. */
export function keyStem(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

export function manifestUrl(mediaBase: string, key: string): string {
  return `${mediaBase.replace(/\/+$/, "")}/${key}/manifest.json`;
}

/** The URL's pathname (still percent-encoded), without host, query or hash; null for a non-https or unparsable URL. */
export function sourceOf(url: string): string | null {
  const u = parseHttps(url);
  return u === null ? null : u.pathname;
}

/** A site name as the pipeline takes it: a letter, then letters, digits or hyphens. Checked after the CLI has made every option a string. */
export const SITE_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * The only characters a dispatched URL may carry, after WHATWG normalisation. Anything else (a `$`, `(`,
 * `'`, `;`, `!` or `*` in a path, say) is refused rather than handed to a workflow that might interpolate it.
 */
const SAFE_URL = /^[A-Za-z0-9\-._~:/?=&%+#@]+$/;

export const RELAY_REFUSAL_REASON =
  "refused by the relay (unsafe characters; rename the file in Prismic and republish, or run video-encode by hand)";

/** The reason the relay refuses this URL, or null when it may be dispatched. Shared by the relay and the stuck check. */
export function relayRefusal(url: string): string | null {
  let href: string;
  try {
    href = new URL(url).href;
  } catch {
    return RELAY_REFUSAL_REASON;
  }
  return SAFE_URL.test(href) ? null : RELAY_REFUSAL_REASON;
}
