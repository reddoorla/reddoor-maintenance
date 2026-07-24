// Frozen-page freeze: shared types + token contract. A frozen site keeps the
// Blux export's own markup as the layout (byte-faithful) and exposes only the
// editable leaves — text runs and image urls — as Prismic slots. The template
// carries a placeholder token per slot; the render substitutes current Prismic
// values back in. See docs/superpowers/specs/2026-07-24-blux-frozen-page-design.md.

export type SlotKind = "text" | "image";

export interface Slot {
  /** Stable, document-order key `s{section}.{t|i}{n}` (see `slotKey`). */
  key: string;
  kind: SlotKind;
  /** Present when kind === "text": the original text-node value. */
  text?: string;
  /** Present when kind === "image": the assembled (cloudfront) image url. */
  url?: string;
  /** Grouping label for editor sanity — the owning section key. */
  section: string;
}

export interface FrozenManifest {
  site: string;
  uid: string;
  title: string;
  metaTitle?: string | undefined;
  metaImageUrl?: string | undefined;
  /** External stylesheet hrefs from the export <head> (e.g. Google Fonts) that
   *  the render must re-inject — font metrics are load-bearing for layout. */
  fontLinks: string[];
  slots: Slot[];
}

/** The emitted freeze artifact: the manifest plus the two repo files' bodies. */
export interface FrozenResult {
  manifest: FrozenManifest;
  /** Tokenized `<body>` innerHTML — the repo template. */
  templateHtml: string;
  /** The extracted `<style>` block text — the repo style file. */
  styleCss: string;
}

/** The placeholder a slot's value is substituted for at render time.
 *  Text: replaces the whole text node. Image: sits inside `url(...)`. */
export function tokenFor(kind: SlotKind, key: string): string {
  return `⟦${kind === "text" ? "t" : "i"}:${key}⟧`;
}

/** Build a slot key. `section` is the nearest-ancestor <section> index (or
 *  "h" for chrome above the first section); `n` is a per-kind counter. */
export function slotKey(section: string, kind: SlotKind, n: number): string {
  return `${section}.${kind === "text" ? "t" : "i"}${n}`;
}

/** Matches any slot token; group 1 = "t"|"i", group 2 = key. Global — callers
 *  that reuse it across `.test()`/`.replace()` should construct a fresh copy or
 *  reset `lastIndex`. Use `TOKEN_RE()` to get a fresh instance. */
export const TOKEN_RE = (): RegExp => /⟦([ti]):([^⟧]+)⟧/g;
