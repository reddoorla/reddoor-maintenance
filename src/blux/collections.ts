import type { BluxFeed, BluxRaw } from "./parse.js";
import type { CollectionIR, FieldDef, RecordIR } from "./ir.js";

function singularSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return slug.replace(/s$/, "") || "item";
}

const RICHTEXT_KEYS = new Set(["body", "description"]);

function fieldType(key: string, value: unknown): FieldDef["type"] {
  if (RICHTEXT_KEYS.has(key)) return "richtext";
  if (value && typeof value === "object" && "media" in (value as object)) return "image";
  if (Array.isArray(value)) return "group";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (key === "date") return "date";
  if (/^(url|link)/.test(key)) return "link";
  return "text";
}

function deriveFields(feed: BluxFeed): FieldDef[] {
  const seen = new Map<string, FieldDef["type"]>();
  // Declared custom fields first (Blux feed.fields), then observed item keys.
  for (const d of feed.fields ?? []) {
    if (d.field) seen.set(d.field, "text");
  }
  for (const item of feed.items ?? []) {
    for (const [key, value] of Object.entries(item)) {
      if (!seen.has(key) || seen.get(key) === "text") seen.set(key, fieldType(key, value));
    }
  }
  return [...seen.entries()].map(([key, type]) => ({ key, type }));
}

function recordUid(values: Record<string, unknown>, i: number): string {
  const title = typeof values.title === "string" ? values.title : "";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `item-${i}`;
}

export function modelCollections(raw: BluxRaw): CollectionIR[] {
  const out: CollectionIR[] = [];
  for (const feed of Object.values(raw.feeds)) {
    const label = String(feed.name ?? "");
    const items = feed.items ?? [];
    const records: RecordIR[] = items.map((item, i) => {
      const mediaRefs: string[] = [];
      for (const value of Object.values(item)) {
        if (
          value &&
          typeof value === "object" &&
          typeof (value as { media?: string }).media === "string"
        ) {
          mediaRefs.push((value as { media: string }).media);
        }
      }
      return { uid: recordUid(item, i), values: item, mediaRefs };
    });
    out.push({
      apiId: singularSlug(label),
      label,
      publishRoute: feed.publish ? String(feed.publish) : null,
      fields: deriveFields(feed),
      records,
    });
  }
  return out;
}
