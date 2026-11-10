// Pure helpers for the video pipeline's keys and URLs. This file is part of the
// light `@reddoorla/maintenance/video-pipeline` subpath: it imports nothing but
// its own siblings, so a Netlify function or a SvelteKit server can load it.

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

/** `${slugify(site)}/${slugify(name without extension)}`, or null when the URL is not https, its file name does not match VIDEO_EXT, or either slug is empty. */
export function videoKey(site: string, url: string): string | null {
  const name = fileNameOf(url);
  if (name === null || !VIDEO_EXT.test(name)) return null;
  const siteSlug = slugify(site);
  const stemSlug = slugify(name.replace(VIDEO_EXT, ""));
  if (siteSlug === "" || stemSlug === "") return null;
  return `${siteSlug}/${stemSlug}`;
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
