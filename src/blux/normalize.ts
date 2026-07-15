import { visibleText, type BluxBlock, type BluxRaw, type BluxTextStyle } from "./parse.js";
import { archetype } from "./archetype.js";
import type { FontLoad, PageIR, SectionIR, TextStyleIR, ThemeIR, Diagnostic } from "./ir.js";

/** The styles.text role ("text5") a block's _title/_body class points at. */
function textRole(style: BluxTextStyle | undefined): string | undefined {
  const cls = typeof style === "object" && style !== null ? style.class : style;
  if (typeof cls !== "string") return undefined;
  return cls.split(/\s+/).find((c) => /^text\d+$/.test(c));
}

const str = (x: unknown): string =>
  typeof x === "string" ? x : typeof x === "number" ? String(x) : "";

/** A cleaned CSS value, or "" when the export left a malformed one. Blux emits
 * degenerate placeholders — "" and "px" for unset lengths, "0.px" for a zeroed
 * one — which would poison a Tailwind custom property (an invalid `var()` value
 * collapses the whole declaration). Those are always single tokens, so the
 * numeric-prefix guard runs only on a lone length; multi-value shorthands
 * ("10px 40px 10px 40px"), colors, "0", and keywords all pass through. */
export function cleanCssValue(x: unknown): string {
  const s = str(x).trim();
  if (s === "" || s === "px") return "";
  if (!/\s/.test(s) && /px$/.test(s) && !/^-?(\d+(\.\d+)?|\.\d+)px$/.test(s)) return "";
  return s;
}

/** Per-element inline style overrides on a _title/_body element (color,
 * font-size, margin, …) minus the `class` token, cleaned. undefined when none
 * survive — e.g. a hero title's `{ class: "text0", color: "#fff" }` white
 * override that a role reference alone would lose. */
function inlineStyle(style: BluxTextStyle | undefined): Record<string, string> | undefined {
  if (typeof style !== "object" || style === null) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(style)) {
    if (k === "class") continue;
    const cleaned = cleanCssValue(v);
    if (cleaned) out[k] = cleaned;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Parse `settings.fonts.google` ("Scope+One:regular|Montserrat:300,500,regular")
 * into families + numeric weights ("regular" → "400"). */
function parseGoogleFonts(google: string): FontLoad[] {
  if (!google.trim()) return [];
  return google
    .split("|")
    .map((spec) => {
      const [rawFamily = "", rawWeights = ""] = spec.split(":");
      const family = rawFamily.replace(/\+/g, " ").trim();
      const weights = rawWeights
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean)
        .map((w) => (w === "regular" ? "400" : w));
      return { family, weights: weights.length ? weights : ["400"] };
    })
    .filter((f) => f.family);
}

/** The real font-family for a text style. A Typekit `font-ident`
 * (`T:Family:variant:obfuscated`) carries the true family in segment 2 while
 * `font-family` holds the obfuscated id (e.g. `ysxc`); Google idents (`G:…`) and
 * missing idents already have the true family in `font-family`. */
function fontFamilyFromStyle(m: Record<string, unknown>): string {
  const ident = str(m["font-ident"]);
  if (ident.startsWith("T:")) {
    const fam = ident.split(":")[1]?.trim();
    if (fam) return fam;
  }
  return str(m["font-family"]).replace(/['"]/g, "");
}

/** Typekit fonts to preload, parsed from the comma-separated `settings.fonts.string`
 * idents (`T:Montserrat:n6:ysxc`). `fonts.google` omits Typekit faces, so the page's
 * Montserrat 600 would otherwise never be requested. Variant `nN`/`iN` → weight N×100. */
function typekitFontLoads(fontString: string): FontLoad[] {
  const byFamily = new Map<string, string[]>();
  for (const ident of fontString.split(",").map((s) => s.trim())) {
    if (!ident.startsWith("T:")) continue;
    const [, family = "", variant = ""] = ident.split(":");
    const fam = family.trim();
    if (!fam) continue;
    const v = variant.trim();
    const digit = /^[ni](\d)$/.exec(v);
    const weight = digit ? `${Number(digit[1]) * 100}` : v === "regular" ? "400" : v;
    if (!weight) continue;
    const ws = byFamily.get(fam) ?? [];
    if (!ws.includes(weight)) ws.push(weight);
    byFamily.set(fam, ws);
  }
  return [...byFamily].map(([family, weights]) => ({ family, weights }));
}

/** Union `extra` font-loads into `base`, preserving `base` order and folding new
 * weights into an existing family (so Montserrat gains 600 instead of duplicating). */
function mergeFontLoads(base: FontLoad[], extra: FontLoad[]): FontLoad[] {
  const out = base.map((f) => ({ family: f.family, weights: [...f.weights] }));
  for (const e of extra) {
    const existing = out.find((f) => f.family === e.family);
    if (existing) {
      for (const w of e.weights) if (!existing.weights.includes(w)) existing.weights.push(w);
    } else {
      out.push({ family: e.family, weights: [...e.weights] });
    }
  }
  return out;
}

const CONFIDENCE_MIN = 0.5;

function sectionFromBlock(b: BluxBlock, pageUid: string, diagnostics: Diagnostic[]): SectionIR {
  const a = archetype(b);
  if (a.confidence < CONFIDENCE_MIN) {
    diagnostics.push({
      kind: "low-confidence-block",
      where: pageUid,
      message: `block mapped to ${a.sliceType} at ${a.confidence}`,
    });
  }
  const heading = visibleText(b.title, b._title);
  const body = visibleText(b.body, b._body);
  const headingRole = heading !== undefined ? textRole(b._title) : undefined;
  const bodyRole = body !== undefined ? textRole(b._body) : undefined;
  const headingStyle = heading !== undefined ? inlineStyle(b._title) : undefined;
  const bodyStyle = body !== undefined ? inlineStyle(b._body) : undefined;
  // Route every value through cleanCssValue (as inlineStyle does) so numeric
  // block styles (a JSON `"z-index": 10`) are kept, not silently dropped.
  const block: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.styles ?? {})) {
    const cleaned = cleanCssValue(v);
    if (cleaned) block[k] = cleaned;
  }
  const presentation = {
    ...(headingRole ? { headingRole } : {}),
    ...(bodyRole ? { bodyRole } : {}),
    ...(headingStyle ? { headingStyle } : {}),
    ...(bodyStyle ? { bodyStyle } : {}),
    ...(Object.keys(block).length ? { block } : {}),
  };
  const section: SectionIR = {
    sliceType: a.sliceType,
    variation: a.variation,
    confidence: a.confidence,
    fields: {
      ...(heading !== undefined ? { heading } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(b.media?.media ? { media: b.media.media } : {}),
      ...(b.backgroundMedia?.media ? { backgroundMedia: b.backgroundMedia.media } : {}),
      ...(b.ratio ? { ratio: String(b.ratio) } : {}),
      ...(b.loadEffect ? { anim: String(b.loadEffect) } : {}),
    },
    ...(Object.keys(presentation).length ? { presentation } : {}),
  };
  if (Array.isArray(b.items) && b.items.length > 0) {
    section.children = b.items.map((child) => sectionFromBlock(child, pageUid, diagnostics));
  }
  return section;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "page"
  );
}

export function normalizePages(raw: BluxRaw): { pages: PageIR[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const pages = raw.pages.map((p) => {
    const uid = slugify(String(p.title ?? ""));
    return {
      uid,
      title: String(p.title ?? ""),
      description: String(p.description ?? ""),
      sections: (p.items ?? []).map((b) => sectionFromBlock(b, uid, diagnostics)),
    };
  });
  return { pages, diagnostics };
}

export function normalizeTheme(raw: BluxRaw): ThemeIR {
  const colors = Object.entries(raw.styles.colors ?? {}).map(([role, value]) => ({
    role,
    value: String(value),
  }));
  // styles.text is a position-stable array whose slots are { _label,
  // ".textN": { css props incl font-ident } }. A deleted style leaves a
  // { removed: true } tombstone with no ".textN" key — the role name comes
  // from that inner key (not the array index), so tombstones drop out and
  // roles never renumber if the array is ever compacted.
  const textStyles: TextStyleIR[] = [];
  for (const v of Object.values(raw.styles.text ?? {})) {
    const entry = (v ?? {}) as Record<string, unknown>;
    const innerKey = Object.keys(entry).find((k) => /^\.text\d+$/.test(k));
    if (!innerKey) continue;
    const m = (entry[innerKey] ?? {}) as Record<string, unknown>;
    const transform = cleanCssValue(m["text-transform"]);
    const tracking = cleanCssValue(m["letter-spacing"]);
    // The style's block margin carries Blux's stack rhythm (e.g. "10px 0" on
    // Grid Titles / Caption Body). An explicit "0" matches the render default,
    // so only real values ride the IR.
    const margin = cleanCssValue(m["margin"]);
    const mobileSize = cleanCssValue(m["__media_mobile_font-size"]);
    const mobileLineHeight = cleanCssValue(m["__media_mobile_line-height"]);
    textStyles.push({
      role: innerKey.slice(1), // ".text11" -> "text11"
      label: str(entry._label),
      fontFamily: fontFamilyFromStyle(m),
      size: cleanCssValue(m["font-size"]) || "16px",
      weight:
        typeof m["font-weight"] === "number" ? m["font-weight"] : str(m["font-weight"]) || 400,
      lineHeight: cleanCssValue(m["line-height"]) || "1.5",
      ...(transform && transform !== "none" ? { transform } : {}),
      ...(tracking ? { letterSpacing: tracking } : {}),
      ...(margin && margin !== "0" ? { margin } : {}),
      ...(mobileSize ? { mobileSize } : {}),
      ...(mobileLineHeight ? { mobileLineHeight } : {}),
    });
  }
  // Fonts: explicit settings win; otherwise Blux's own default roles —
  // text0 "Title (Default)" and text1 "Body (Default)".
  const fonts = (raw.settings.fonts ?? {}) as Record<string, unknown>;
  const roleFont = (r: string) => textStyles.find((t) => t.role === r)?.fontFamily ?? "";
  return {
    colors,
    fonts: {
      heading: str(fonts.heading) || roleFont("text0"),
      body: str(fonts.body) || roleFont("text1"),
    },
    fontLoad: mergeFontLoads(
      parseGoogleFonts(str(fonts.google)),
      typekitFontLoads(str(fonts.string)),
    ),
    textStyles,
  };
}
