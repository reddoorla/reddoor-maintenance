import { manifestUrl, sourceOf, videoKey } from "./key.js";
import type { VideoClass } from "./key.js";

export type ManifestFiles = {
  mp4: string;
  mobileMp4?: string;
  webm?: string;
  poster: string;
  captions?: string;
}; // file names relative to the version directory

export type VideoManifest = {
  version: 1;
  source: string;
  class: VideoClass;
  key: string;
  /**
   * The version directory under the key: `${class}-${YYYYMMDDTHHMMSSZ}-${mmm}`, where mmm is the milliseconds of
   * the encode (e.g. `player-20261110T000000Z-500`). The `-mmm` suffix is optional when parsing. Files never change in place.
   */
  dir: string;
  encodedAt: string;
  files: ManifestFiles;
};

const FILE_NAME = /^[a-z0-9][a-z0-9.-]*$/;
const DIR = /^(background|player)-\d{8}T\d{6}Z(-\d{3})?$/;
const CLASSES: readonly string[] = ["background", "player"];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFileName = (v: unknown): v is string => typeof v === "string" && FILE_NAME.test(v);

/** Strict: version === 1, strings where required, class valid, dir matches DIR, every file name matches /^[a-z0-9][a-z0-9.-]*$/ (no slashes), else null. */
export function parseManifest(json: unknown): VideoManifest | null {
  if (!isObject(json) || json.version !== 1) return null;
  const { source, class: cls, key, dir, encodedAt, files } = json;
  if (typeof source !== "string" || typeof key !== "string" || typeof encodedAt !== "string") {
    return null;
  }
  if (typeof dir !== "string" || !DIR.test(dir)) return null;
  if (typeof cls !== "string" || !CLASSES.includes(cls)) return null;
  if (!isObject(files) || !isFileName(files.mp4) || !isFileName(files.poster)) return null;
  const optional = (v: unknown): string | undefined | null => {
    if (v === undefined) return undefined;
    return isFileName(v) ? v : null;
  };
  const mobileMp4 = optional(files.mobileMp4);
  const webm = optional(files.webm);
  const captions = optional(files.captions);
  if (mobileMp4 === null || webm === null || captions === null) return null;
  const out: ManifestFiles = { mp4: files.mp4, poster: files.poster };
  if (mobileMp4 !== undefined) out.mobileMp4 = mobileMp4;
  if (webm !== undefined) out.webm = webm;
  if (captions !== undefined) out.captions = captions;
  return {
    version: 1,
    source,
    class: cls as VideoClass,
    key,
    dir,
    encodedAt,
    files: out,
  };
}

export type Renditions = {
  mp4: string;
  mobileMp4: string | null;
  webm: string | null;
  poster: string | null;
  captions: string | null;
  onR2: boolean;
  /** The class of the manifest that produced these URLs; null for prismicOnly. */
  class: VideoClass | null;
};

/** Absolute URLs `${base}/${m.key}/${m.dir}/${file}`, onR2: true, class: m.class. */
export function renditionsFrom(m: VideoManifest, mediaBase: string): Renditions {
  const at = (file: string) => `${mediaBase.replace(/\/+$/, "")}/${m.key}/${m.dir}/${file}`;
  const opt = (file: string | undefined) => (file === undefined ? null : at(file));
  return {
    mp4: at(m.files.mp4),
    mobileMp4: opt(m.files.mobileMp4),
    webm: opt(m.files.webm),
    poster: at(m.files.poster),
    captions: opt(m.files.captions),
    onR2: true,
    class: m.class,
  };
}

/** Prismic's own URL, with nothing on R2. */
export function prismicOnly(url: string): Renditions {
  return {
    mp4: url,
    mobileMp4: null,
    webm: null,
    poster: null,
    captions: null,
    onR2: false,
    class: null,
  };
}

/**
 * True when a video needs an encode: nothing on R2, or the document asks for a player and the R2
 * copy is a background. A background on R2 never needs upgrading for a background request.
 */
export function needsEncode(found: { class: VideoClass }, r: Renditions): boolean {
  if (!r.onR2) return true;
  return found.class === "player" && r.class !== "player";
}

export type ResolveOptions = {
  site: string;
  mediaBase: string | null | undefined;
  fetch: typeof fetch;
  cache?: Map<string, Promise<Renditions>>;
};

async function load(url: string, opts: ResolveOptions): Promise<Renditions> {
  try {
    const mediaBase = opts.mediaBase;
    if (!mediaBase) return prismicOnly(url);
    const key = videoKey(opts.site, url);
    if (key === null) return prismicOnly(url);
    const res = await opts.fetch(manifestUrl(mediaBase, key));
    if (res.status !== 200) return prismicOnly(url);
    const manifest = parseManifest(await res.json());
    if (manifest === null) return prismicOnly(url);
    if (manifest.source !== sourceOf(url)) return prismicOnly(url);
    if (manifest.key !== key) return prismicOnly(url);
    return renditionsFrom(manifest, mediaBase);
  } catch {
    return prismicOnly(url);
  }
}

/** Never throws. No mediaBase, no key, a non-200, a network error, or an invalid manifest → prismicOnly(url). A manifest whose `source` differs from the URL's pathname, or whose `key` differs from videoKey(site, url), is invalid. */
export function resolveVideo(url: string, opts: ResolveOptions): Promise<Renditions> {
  if (!opts.cache) return load(url, opts);
  let pending = opts.cache.get(url);
  if (pending === undefined) {
    pending = load(url, opts);
    opts.cache.set(url, pending);
  }
  return pending;
}
