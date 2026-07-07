import { visibleText, type BluxBlock, type BluxRaw } from "./parse.js";
import { archetype } from "./archetype.js";
import type { PageIR, SectionIR, ThemeIR, Diagnostic } from "./ir.js";

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
  const textStyles = Object.entries(raw.styles.text ?? {}).map(([role, v]) => {
    const t = (v ?? {}) as { size?: string; weight?: number; lineHeight?: number };
    return {
      role,
      size: String(t.size ?? "16px"),
      weight: Number(t.weight ?? 400),
      lineHeight: Number(t.lineHeight ?? 1.5),
    };
  });
  return {
    colors,
    fonts: {
      heading: String(raw.settings.fonts?.heading ?? ""),
      body: String(raw.settings.fonts?.body ?? ""),
    },
    textStyles,
  };
}
