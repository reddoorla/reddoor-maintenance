/**
 * scripts/webflow-capture/lib.mjs — the pure half of the Webflow reference
 * capture: what a captured page, stylesheet, script or Lottie file REFERENCES,
 * where each reference lives on disk, and which references are deliberately not
 * vendored.
 *
 * Shared by capture.mjs (network: crawl and download) and check.mjs (offline:
 * re-derive every reference from the captured bytes and prove each one is on
 * disk). The check never trusts the capture's own file list: it re-reads the
 * captured HTML/CSS/JS/JSON with these same extractors, so a file the capture
 * failed to queue is as visible to it as one that was deleted afterwards.
 *
 * Why this exists (spec D11, docs/webflow-conversions-2026-10.md §5.1): the
 * references and their cdn.prod.website-files.com assets die with the Webflow
 * workspace on 2026-10-19, and Beachfront showed that a dead reference cannot be
 * re-captured. No dependencies, so a copy runs in any site repo with plain node.
 */
import { createHash } from "node:crypto";

/** A path ending in one of these is a file a page loads, not a page to crawl. */
export const ASSET_EXT =
  /\.(?:css|js|mjs|json|jpe?g|png|gif|svg|webp|avif|ico|bmp|tiff?|mp4|webm|mov|m4v|ogv|mp3|wav|pdf|docx?|xlsx?|zip|woff2?|ttf|otf|eot|txt|xml|webmanifest)$/i;

/** `<link rel>` values whose href is a file the page loads. preconnect,
 *  dns-prefetch, canonical and alternate name hosts or pages, not files. */
const LINK_RELS = new Set([
  "stylesheet",
  "icon",
  "shortcut",
  "apple-touch-icon",
  "apple-touch-icon-precomposed",
  "mask-icon",
  "preload",
  "modulepreload",
  "prefetch",
  "manifest",
]);

/**
 * References that are deliberately NOT vendored. Each is a live service or a
 * licensed file, not a Webflow asset, and survives the Webflow cancellation on
 * its own. The check counts them as excluded, never as present, and prints the
 * reason beside each one so an exclusion is a visible decision, not a gap.
 */
export const EXCLUDE = [
  {
    test: (u) => /^https:\/\/www\.(?:google|gstatic)\.com\/recaptcha\//.test(u),
    reason:
      "reCAPTCHA is a live Google service, not a file: a copy would not run, and Google serves it independently of Webflow",
  },
  {
    test: (u) => /^https:\/\/challenges\.cloudflare\.com\/turnstile\//.test(u),
    reason:
      "Cloudflare Turnstile is a live service that webflow.js loads for the form backend, not a file: a copy would not run, and the rebuild uses the fleet's own Turnstile widget",
  },
  {
    test: (u) =>
      /^https:\/\/(?:cdn\.embedly\.com|player\.vimeo\.com|www\.youtube(?:-nocookie)?\.com)\//.test(
        u,
      ),
    reason:
      "a video-platform embed: the video is hosted by the platform (the embed URL names it), not by Webflow, so it survives the cancellation",
  },
  {
    test: (u) => /^https:\/\/(?:use|p)\.typekit\.net\/(?:af|p\.gif|p\.css)/.test(u),
    reason:
      "Adobe Fonts binaries are licensed to the kit owner and served only to the kit's allow-listed domains; they are not redistributable in a repo, and Adobe serves them independently of Webflow (plan D8). The kit's CSS is captured, so the family, weight and style list survives",
  },
];

export function exclusionFor(url) {
  return EXCLUDE.find((e) => e.test(url))?.reason ?? null;
}

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** Resolve `raw` against `base`; null for anything that is not a fetchable http(s) URL. */
export function resolve(raw, base) {
  const v = decodeEntities(String(raw).trim());
  if (!v || /^(?:data|mailto|tel|javascript|blob|about):/i.test(v) || v.startsWith("#"))
    return null;
  try {
    const u = new URL(v, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

const isAssetUrl = (href) => {
  try {
    return ASSET_EXT.test(decodeURIComponent(new URL(href).pathname));
  } catch {
    return false;
  }
};

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/** Every srcset candidate URL: comma-separated, each "url [descriptor]". */
export function srcsetUrls(value) {
  return value
    .split(/,\s+|,(?=https?:|\/)/)
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/**
 * The stylesheet webfont.js requests at runtime for `WebFont.load({google:{families:[…]}})`.
 * No `<link>` names it, so a capture that only reads tags never sees these fonts:
 * webfont.js 1.6.26 builds `https://fonts.googleapis.com/css?family=` + families
 * joined with `%7C`, spaces as `+`.
 */
export function webfontGoogleCssUrls(text) {
  const out = [];
  for (const m of text.matchAll(
    /WebFont\.load\(\s*\{[\s\S]*?google\s*:\s*\{[\s\S]*?families\s*:\s*\[([\s\S]*?)\]/g,
  )) {
    const families = [...m[1].matchAll(/"([^"]+)"|'([^']+)'/g)].map((f) =>
      (f[1] ?? f[2]).replace(/ /g, "+"),
    );
    if (families.length)
      out.push(`https://fonts.googleapis.com/css?family=${families.join("%7C")}`);
  }
  return out;
}

/** Absolute http(s) URLs anywhere in `text` whose path ends in an asset extension. */
export function absoluteAssetUrls(text, base) {
  const out = [];
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>()\\,`]+/g)) {
    const raw = m[0].replace(/[.;:]+$/, "");
    const u = resolve(raw, base);
    if (u && isAssetUrl(u)) out.push(u);
  }
  return out;
}

/** url() and @import targets in a stylesheet (or a style attribute / <style> block). */
export function extractFromCss(css, base) {
  const out = [];
  // Three alternatives, not one optional-quote class: a QUOTED url whose
  // filename contains a parenthesis ("Untitled design (16).png") dies at the
  // `(` under the obvious single-class regex. Measured on 29 Navy's stylesheet.
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g)) {
    const u = resolve(m[1] ?? m[2] ?? m[3] ?? "", base);
    if (u) out.push({ url: u, kind: "css-url" });
  }
  for (const m of css.matchAll(/@import\s+(?:"([^"]+)"|'([^']+)')/g)) {
    const u = resolve(m[1] ?? m[2], base);
    if (u) out.push({ url: u, kind: "css-import" });
  }
  return out;
}

/** Absolute asset URLs a script names (e.g. a `$.getScript` of a vendored file). */
export function extractFromJs(js, base) {
  const out = absoluteAssetUrls(js, base).map((url) => ({ url, kind: "js-url" }));
  // An Adobe Fonts kit names each face as a URI template
  // ("https://use.typekit.net/af/442215/…/27/{format}{?primer,…}"), which no
  // extension test matches. Emit the template's fixed part so every face is
  // listed, and excluded by name, rather than silently absent.
  for (const m of js.matchAll(/"(https:\/\/use\.typekit\.net\/af\/[^"{]+)\{/g))
    out.push({ url: m[1], kind: "typekit-face" });
  return out;
}

/** Images a Lottie file loads from outside itself (`assets[].u + p`, not embedded). */
export function extractFromLottie(text, base) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const out = [];
  for (const a of Array.isArray(doc?.assets) ? doc.assets : []) {
    if (typeof a?.p !== "string" || a.e === 1 || a.p.startsWith("data:")) continue;
    const u = resolve(`${a.u ?? ""}${a.p}`, base);
    if (u) out.push({ url: u, kind: "lottie-image" });
  }
  return out;
}

/** Every file a captured HTML page references, with where it was found. */
export function extractFromHtml(html, pageUrl) {
  const out = [];
  const push = (raw, kind) => {
    const u = resolve(raw, pageUrl);
    if (u) out.push({ url: u, kind });
  };

  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rels = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attr(tag, "href");
    if (!href || !rels.some((r) => LINK_RELS.has(r))) continue;
    // A prefetch of another PAGE (Webflow emits one per collection item) is
    // navigation, and the crawl owns pages; only a stylesheet or a real file counts.
    const u = resolve(href, pageUrl);
    if (u && (rels.includes("stylesheet") || isAssetUrl(u)))
      out.push({ url: u, kind: `link:${rels.join("+")}` });
  }
  for (const [tag] of html.matchAll(
    /<(?:script|img|source|video|audio|track|embed|input)\b[^>]*>/gi,
  )) {
    const src = attr(tag, "src");
    if (src) push(src, "src");
    const poster = attr(tag, "poster");
    if (poster) push(poster, "poster");
  }
  for (const [tag] of html.matchAll(/<iframe\b[^>]*>/gi)) {
    const src = attr(tag, "src");
    if (src) push(src, "iframe");
  }
  for (const m of html.matchAll(/\ssrcset\s*=\s*"([^"]*)"/gi))
    for (const u of srcsetUrls(decodeEntities(m[1]))) push(u, "srcset");
  // Webflow background video: both transcodes in one comma-separated attribute.
  for (const m of html.matchAll(/\sdata-video-urls\s*=\s*"([^"]*)"/gi))
    for (const u of decodeEntities(m[1]).split(",")) push(u, "data-video-urls");
  for (const m of html.matchAll(/\sdata-poster-url\s*=\s*"([^"]*)"/gi))
    push(m[1], "data-poster-url");
  // Lottie (data-animation-type="lottie") and any other lazy data-src.
  for (const m of html.matchAll(/\sdata-src\s*=\s*"([^"]*)"/gi)) push(m[1], "data-src");
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const c = attr(tag, "content");
    const u = c ? resolve(c, pageUrl) : null;
    if (u && /^https?:\/\//i.test(c.trim()) && isAssetUrl(u)) out.push({ url: u, kind: "meta" });
  }
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], "href");
    const u = href ? resolve(href, pageUrl) : null;
    if (u && isAssetUrl(u)) out.push({ url: u, kind: "a-file" });
  }
  for (const m of html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi))
    out.push(
      ...extractFromCss(decodeEntities(m[1]), pageUrl).map((r) => ({ ...r, kind: "style-attr" })),
    );
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    out.push(...extractFromCss(m[1], pageUrl).map((r) => ({ ...r, kind: "style-block" })));
  // Inline scripts: a runtime load names its file only inside code
  // ($.getScript("https://raw.githack.com/…/countersAnim.js")).
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const u of absoluteAssetUrls(m[1], pageUrl)) out.push({ url: u, kind: "inline-script" });
    for (const u of webfontGoogleCssUrls(m[1])) out.push({ url: u, kind: "webfont-google" });
  }
  return dedupe(out);
}

/** Same-origin page links (the crawl frontier): no files, no fragments, no queries. */
export function extractPageLinks(html, pageUrl) {
  const origin = new URL(pageUrl).origin;
  const out = new Set();
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], "href");
    const u = href ? resolve(href, pageUrl) : null;
    if (!u) continue;
    const url = new URL(u);
    if (url.origin !== origin || isAssetUrl(u)) continue;
    out.add(normalizePagePath(url.pathname));
  }
  return [...out].sort();
}

export function normalizePagePath(pathname) {
  const p = pathname.replace(/\/{2,}/g, "/");
  return p.length > 1 ? p.replace(/\/$/, "") : "/";
}

/** Which extractor a captured file gets, by its URL. */
export function extractFromFile(url, text) {
  const path = decodeURIComponent(new URL(url).pathname).toLowerCase();
  const host = new URL(url).host;
  if (path.endsWith(".css") || host === "fonts.googleapis.com") return extractFromCss(text, url);
  if (path.endsWith(".js") || path.endsWith(".mjs")) return extractFromJs(text, url);
  if (path.endsWith(".json")) return extractFromLottie(text, url);
  return [];
}

export const isTextFile = (url) => {
  const path = decodeURIComponent(new URL(url).pathname).toLowerCase();
  return /\.(?:css|js|mjs|json)$/.test(path) || new URL(url).host === "fonts.googleapis.com";
};

function dedupe(refs) {
  const seen = new Set();
  return refs.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
}

const UNSAFE = /[<>:"|?*\\\u0000-\u001f]/g;

/**
 * Where a URL's bytes live inside a capture: `files/<host>/<decoded path>`.
 * Deterministic from the URL alone, so the offline check can find a file
 * without trusting any list the capture wrote. A query string is folded into
 * the name as `.q<sha8>` before the extension (jQuery's `?site=` and every
 * Google Fonts request carry one), and a Google Fonts stylesheet gets `.css`.
 */
export function urlToLocal(href) {
  const u = new URL(href);
  let path = decodeURIComponent(u.pathname);
  if (path.endsWith("/") || path === "") path += "index";
  const segs = path
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(UNSAFE, "_"));
  let name = segs.pop() ?? "index";
  if (u.search) {
    const q = createHash("sha256").update(u.search).digest("hex").slice(0, 8);
    const dot = name.lastIndexOf(".");
    name = dot > 0 ? `${name.slice(0, dot)}.q${q}${name.slice(dot)}` : `${name}.q${q}`;
  }
  if (u.host === "fonts.googleapis.com" && !name.endsWith(".css")) name += ".css";
  return ["files", u.host.replace(UNSAFE, "_"), ...segs, name].join("/");
}

/** Where a crawled page's HTML lives: `/` → pages/index.html, `/a/b` → pages/a/b/index.html. */
export function pageToLocal(pagePath) {
  const p = normalizePagePath(pagePath);
  if (p === "/") return "pages/index.html";
  return `pages${p
    .split("/")
    .map((s) => decodeURIComponent(s).replace(UNSAFE, "_"))
    .join("/")}/index.html`;
}

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
