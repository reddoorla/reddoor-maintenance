import { manifestUrl, sourceOf, videoKey } from "./key.js";
import type { VideoClass } from "./key.js";

export type ManifestFiles = {
  mp4: string;
  mobileMp4?: string;
  webm?: string;
  poster: string;
  captions?: string;
}; // file names relative to the key's directory

export type VideoManifest = {
  version: 1;
  source: string;
  class: VideoClass;
  key: string;
  encodedAt: string;
  files: ManifestFiles;
};

const FILE_NAME = /^[a-z0-9][a-z0-9.-]*$/;
const CLASSES: readonly string[] = ["background", "player"];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFileName = (v: unknown): v is string => typeof v === "string" && FILE_NAME.test(v);

/** Strict: version === 1, strings where required, class valid, every file name matches /^[a-z0-9][a-z0-9.-]*$/ (no slashes), else null. */
export function parseManifest(json: unknown): VideoManifest | null {
  if (!isObject(json) || json.version !== 1) return null;
  const { source, class: cls, key, encodedAt, files } = json;
  if (typeof source !== "string" || typeof key !== "string" || typeof encodedAt !== "string") {
    return null;
  }
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
};

/** Absolute URLs `${base}/${m.key}/${file}`, onR2: true. */
export function renditionsFrom(m: VideoManifest, mediaBase: string): Renditions {
  const at = (file: string) => `${mediaBase.replace(/\/+$/, "")}/${m.key}/${file}`;
  const opt = (file: string | undefined) => (file === undefined ? null : at(file));
  return {
    mp4: at(m.files.mp4),
    mobileMp4: opt(m.files.mobileMp4),
    webm: opt(m.files.webm),
    poster: at(m.files.poster),
    captions: opt(m.files.captions),
    onR2: true,
  };
}

/** Prismic's own URL, with nothing on R2. */
export function prismicOnly(url: string): Renditions {
  return { mp4: url, mobileMp4: null, webm: null, poster: null, captions: null, onR2: false };
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
    return renditionsFrom(manifest, mediaBase);
  } catch {
    return prismicOnly(url);
  }
}

/** Never throws. No mediaBase, no key, a non-200, a network error, or an invalid manifest → prismicOnly(url). A manifest whose `source` differs from the URL's pathname is treated as invalid. */
export function resolveVideo(url: string, opts: ResolveOptions): Promise<Renditions> {
  if (!opts.cache) return load(url, opts);
  let pending = opts.cache.get(url);
  if (pending === undefined) {
    pending = load(url, opts);
    opts.cache.set(url, pending);
  }
  return pending;
}
