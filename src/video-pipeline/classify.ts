import { VIDEO_EXT, fileNameOf } from "./key.js";
import type { VideoClass } from "./key.js";

export type ClassRule = VideoClass | { flag: string; whenTrue: VideoClass; whenFalse: VideoClass };
/** slice_type → rules. The key "$document" applies its rules to doc.data's own fields (no slices). */
export type VideoRules = Record<string, { field: string; class: ClassRule }[]>;
export type FoundVideo = {
  url: string;
  class: VideoClass;
  documentId: string;
  sliceType: string;
  field: string;
  publishedAt: string | null;
};
export type DocLike = {
  id: string;
  last_publication_date?: string | null;
  data?: Record<string, unknown>;
};

const DOCUMENT_RULES = "$document";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validates a parsed rules file: an object whose every value is an array of
 * { field: string, class: "background" | "player" | { flag, whenTrue, whenFalse } }.
 * Returns the rules, or a string saying what is wrong (the message names the slice type and index).
 */
export function parseVideoRules(json: unknown): VideoRules | string {
  if (!isObject(json)) return "must be a JSON object of slice_type to rule arrays";
  const classOk = (c: unknown): boolean => {
    if (c === "background" || c === "player") return true;
    return (
      isObject(c) &&
      typeof c.flag === "string" &&
      (c.whenTrue === "background" || c.whenTrue === "player") &&
      (c.whenFalse === "background" || c.whenFalse === "player")
    );
  };
  for (const [sliceType, rules] of Object.entries(json)) {
    if (!Array.isArray(rules)) return `${sliceType}: must be an array of rules`;
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i];
      const where = `${sliceType}[${i}]`;
      if (!isObject(rule)) return `${where}: must be an object with field and class`;
      if (typeof rule.field !== "string") return `${where}.field: must be a string`;
      if (!classOk(rule.class)) {
        return `${where}.class: must be "background", "player" or { flag, whenTrue, whenFalse }`;
      }
    }
  }
  return json as VideoRules;
}

/** link_type === "Media", url is https, kind !== "image", name or url (pathname) matches VIDEO_EXT. */
export function isVideoLink(value: unknown): value is { url: string } {
  if (!isObject(value) || value.link_type !== "Media") return false;
  if (typeof value.url !== "string") return false;
  if (value.kind === "image") return false;
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // The URL's own file name decides, the same rule key.ts uses to compute the key: a link the key cannot be built for is not a video.
  return VIDEO_EXT.test(fileNameOf(value.url) ?? "");
}

/** Every object inside an array, recursively, starting from a candidate's array values. */
function nestedObjects(candidate: Record<string, unknown>, out: Record<string, unknown>[]): void {
  for (const value of Object.values(candidate)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!isObject(item)) continue;
      out.push(item);
      nestedObjects(item, out);
    }
  }
}

function candidatesOf(slice: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (isObject(slice.primary)) {
    out.push(slice.primary);
    nestedObjects(slice.primary, out);
  }
  if (Array.isArray(slice.items)) {
    for (const item of slice.items) {
      if (!isObject(item)) continue;
      out.push(item);
      nestedObjects(item, out);
    }
  }
  return out;
}

function classOf(rule: { class: ClassRule }, candidate: Record<string, unknown>): VideoClass {
  if (typeof rule.class === "string") return rule.class;
  return candidate[rule.class.flag] === true ? rule.class.whenTrue : rule.class.whenFalse;
}

function emit(
  found: FoundVideo[],
  doc: DocLike,
  rules: { field: string; class: ClassRule }[],
  candidate: Record<string, unknown>,
  sliceType: string,
): void {
  for (const rule of rules) {
    const link = candidate[rule.field];
    if (!isVideoLink(link)) continue;
    found.push({
      url: link.url,
      class: classOf(rule, candidate),
      documentId: doc.id,
      sliceType,
      field: rule.field,
      publishedAt: doc.last_publication_date ?? null,
    });
  }
}

export function findVideos(doc: DocLike, rules: VideoRules): FoundVideo[] {
  const found: FoundVideo[] = [];
  const data = isObject(doc.data) ? doc.data : {};
  const documentRules = rules[DOCUMENT_RULES];
  if (documentRules) emit(found, doc, documentRules, data, DOCUMENT_RULES);
  for (const value of Object.values(data)) {
    if (!Array.isArray(value)) continue;
    for (const slice of value) {
      if (!isObject(slice) || typeof slice.slice_type !== "string") continue;
      const sliceRules = rules[slice.slice_type];
      if (!sliceRules) continue;
      for (const candidate of candidatesOf(slice)) {
        emit(found, doc, sliceRules, candidate, slice.slice_type);
      }
    }
  }
  return mergeFound(found);
}

/** Dedupe by url; if one url is found as both classes, the result is "player"; keep the first otherwise; preserve first-seen order. */
export function mergeFound(list: FoundVideo[]): FoundVideo[] {
  const byUrl = new Map<string, FoundVideo>();
  for (const v of list) {
    const prior = byUrl.get(v.url);
    if (prior === undefined) {
      byUrl.set(v.url, { ...v });
    } else if (v.class === "player" && prior.class !== "player") {
      prior.class = "player";
    }
  }
  return [...byUrl.values()];
}
