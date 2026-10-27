// Hand-written types for lib.mjs. The module stays plain JS so a copy runs with plain
// node in any site repo; this file is only so `tsc --noEmit` can type the tests' import.

export type Ref = { url: string; kind: string };

export const ASSET_EXT: RegExp;
export const EXCLUDE: ReadonlyArray<{ test: (url: string) => boolean; reason: string }>;
export function exclusionFor(url: string): string | null;
export function resolve(raw: string, base: string): string | null;
export function srcsetUrls(value: string): string[];
export function webfontGoogleCssUrls(text: string): string[];
export function absoluteAssetUrls(text: string, base: string): string[];
export function extractFromCss(css: string, base: string): Ref[];
export function extractFromJs(js: string, base: string): Ref[];
export function extractFromLottie(text: string, base: string): Ref[];
export function extractFromHtml(html: string, pageUrl: string): Ref[];
export function extractPageLinks(html: string, pageUrl: string): string[];
export function paginationLinks(html: string, pageUrl: string): string[];
export function markupOnly(html: string): string;
export function safeDecode(s: string): string;
export function normalizePagePath(pathname: string): string;
export function extractFromFile(url: string, text: string): Ref[];
export function isTextFile(url: string): boolean;
export function urlToLocal(href: string): string;
export function pageToLocal(pagePath: string): string;
export function pathConflict(
  claimed: Map<string, string>,
  file: string,
  url: string,
): string | null;
export function sha256(buf: string | Uint8Array): string;
