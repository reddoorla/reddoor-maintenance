import { visibleText, type BluxBlock, type BluxRaw, type BluxTextStyle } from "./parse.js";
import { archetype } from "./archetype.js";
import type { PageIR, SectionIR, TextStyleIR, ThemeIR, Diagnostic } from "./ir.js";

/** The styles.text role ("text5") a block's _title/_body class points at. */
function textRole(style: BluxTextStyle | undefined): string | undefined {
  const cls = typeof style === "object" && style !== null ? style.class : style;
  if (typeof cls !== "string") return undefined;
  return cls.split(/\s+/).find((c) => /^text\d+$/.test(c));
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
  const block = Object.fromEntries(
    Object.entries(b.styles ?? {}).filter(
      ([, v]) => typeof v === "string" && v !== "" && v !== "px",
    ),
  ) as Record<string, string>;
  const presentation = {
    ...(headingRole ? { headingRole } : {}),
    ...(bodyRole ? { bodyRole } : {}),
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
  // A styles.text entry is { _label, ".textN": { css props incl font-ident } }.
  const textStyles: TextStyleIR[] = Object.entries(raw.styles.text ?? {}).map(([key, v]) => {
    const entry = (v ?? {}) as Record<string, unknown>;
    const inner = (entry[`.text${key}`] ??
      Object.values(entry).find((x) => x && typeof x === "object")) as
      | Record<string, unknown>
      | undefined;
    const m = inner ?? {};
    const str = (x: unknown) =>
      typeof x === "string" ? x : typeof x === "number" ? String(x) : "";
    const transform = str(m["text-transform"]);
    const tracking = str(m["letter-spacing"]);
    return {
      role: `text${key}`,
      label: str(entry._label),
      fontFamily: str(m["font-family"]).replace(/['"]/g, ""),
      size: str(m["font-size"]) || "16px",
      weight:
        typeof m["font-weight"] === "number" ? m["font-weight"] : str(m["font-weight"]) || 400,
      lineHeight: str(m["line-height"]) || "1.5",
      ...(transform && transform !== "none" ? { transform } : {}),
      ...(tracking ? { letterSpacing: tracking } : {}),
    };
  });
  // Fonts: explicit settings win; otherwise Blux's own default roles —
  // text0 "Title (Default)" and text1 "Body (Default)".
  const roleFont = (r: string) => textStyles.find((t) => t.role === r)?.fontFamily ?? "";
  return {
    colors,
    fonts: {
      heading: String(raw.settings.fonts?.heading ?? "") || roleFont("text0"),
      body: String(raw.settings.fonts?.body ?? "") || roleFont("text1"),
    },
    textStyles,
  };
}
