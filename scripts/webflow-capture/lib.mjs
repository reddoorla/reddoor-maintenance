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
  /\.(?:css|js|mjs|json|jpe?g|png|gif|svg|webp|avif|ico|bmp|tiff?|mp4|webm|mov|m4v|ogv|mp3|wav|pdf|lottie|docx?|xlsx?|zip|woff2?|ttf|otf|eot|txt|xml|webmanifest)$/i;

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
    test: (u) => /^https:\/\/(?:use|p)\.typekit\.net\/(?:af\/|p\.gif|p\.css)/.test(u),
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
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

/** decodeURIComponent that keeps a bare `%` (e.g. `50%off.jpg`) instead of throwing. */
export function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/%([0-9a-f]{2})/gi, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  }
}

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
    return ASSET_EXT.test(safeDecode(new URL(href).pathname));
  } catch {
    return false;
  }
};

/** Tags whose attribute values may contain `>` (an `alt="a > b"`): a quote-aware
 *  scan, because `<img[^>]*>` ends inside the alt and never reads the src. */
const tags = (html, names) =>
  html.matchAll(new RegExp(`<(?:${names})\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, "gi"));

/** A tag's attributes in order, first one of each name winning as in HTML: a
 *  raw search for ` src=` would land inside another attribute's value
 *  (`alt="see src=x.png"`) and never read the real one (review round 3). */
function attr(tag, name) {
  const body = tag.replace(/^<[^\s>/]*/, "");
  for (const m of body.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
    if (m[1].toLowerCase() === name) return m[2] ?? m[3] ?? m[4] ?? null;
  return null;
}

/** Every srcset candidate URL: comma-separated, each "url [descriptor]". */
export function srcsetUrls(value) {
  // The HTML spec's own parse, not a split: a candidate's URL is a run of
  // non-space (so a comma INSIDE it is kept), trailing commas end it, and its
  // descriptors run to the next comma ("a/r1.jpg 1x,a/r2.jpg 2x").
  const out = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i])) i++;
    let j = i;
    while (j < value.length && !/\s/.test(value[j])) j++;
    let url = value.slice(i, j);
    i = j;
    if (url.endsWith(",")) url = url.replace(/,+$/, "");
    else {
      let depth = 0;
      while (i < value.length && (value[i] !== "," || depth > 0)) {
        if (value[i] === "(") depth++;
        else if (value[i] === ")") depth--;
        i++;
      }
    }
    if (url) out.push(url);
  }
  return out;
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
  // JSON escapes its slashes ("https:\/\/…"). Parentheses and commas are legal
  // in a Webflow filename ("Untitled design (16).png"), so they are admitted and
  // then trimmed back: a comma only where a second URL starts, a `)` only while
  // it is unbalanced (the close of a surrounding call or url()).
  // then cut back: each run starting at "http" gives the LONGEST prefix, ending
  // at a `)`, `(`, `,` or `;` boundary, that has balanced parentheses and an
  // asset extension. So `url(…/a.png),url(…/b.png)` yields both files and
  // `load(…/a.js);init()` yields a.js.
  // A protocol-relative load ("//cdn.x.com/a.js") counts only inside a quoted
  // string, so a `// comment` naming a host is never read as one.
  const balanced = (s) => s.split("(").length === s.split(")").length;
  for (const m of text
    .replace(/\\\//g, "/")
    .matchAll(
      /https?:\/\/[^\s"'<>\\`]+|(?<=["'])\/\/[\w-]+(?:\.[\w-]+)+(?::\d+)?\/[^\s"'<>\\`]*/g,
    )) {
    for (const seg of m[0].split(/(?=https?:\/\/)/)) {
      const cuts = [seg.length];
      for (let k = seg.length - 1; k > 0; k--) if ("(),;".includes(seg[k])) cuts.push(k);
      for (const k of cuts) {
        const raw = seg.slice(0, k).replace(/[.;:,]+$/, "");
        if (!balanced(raw)) continue;
        const u = resolve(raw, base);
        if (u && isAssetUrl(u)) {
          out.push(u);
          break;
        }
      }
    }
  }
  return out;
}

/** url() and @import targets in a stylesheet (or a style attribute / <style> block). */
export function extractFromCss(css, base) {
  const out = [];
  // Three alternatives, not one optional-quote class: a QUOTED url whose
  // filename contains a parenthesis ("Untitled design (16).png") dies at the
  // `(` under the obvious single-class regex. Measured on 29 Navy's stylesheet.
  // CSS function names are case-insensitive: `URL(a.png)` loads.
  const urlFn = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
  for (const m of css.matchAll(urlFn)) {
    const u = resolve(m[1] ?? m[2] ?? m[3] ?? "", base);
    if (u) out.push({ url: u, kind: "css-url" });
  }
  // image-set() also takes a bare string per candidate ("hero.png" 1x).
  for (const m of css.matchAll(/(?:-webkit-)?image-set\(/gi)) {
    let depth = 1;
    let k = m.index + m[0].length;
    const start = k;
    for (; k < css.length && depth > 0; k++) {
      if (css[k] === "(") depth++;
      else if (css[k] === ")") depth--;
    }
    for (const q of css
      .slice(start, k - 1)
      .replace(urlFn, "")
      .matchAll(/"([^"]*)"|'([^']*)'/g)) {
      const u = resolve(q[1] ?? q[2], base);
      if (u) out.push({ url: u, kind: "css-image-set" });
    }
  }
  for (const m of css.matchAll(/@import\s+(?:"([^"]+)"|'([^']+)')/gi)) {
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
/**
 * The page with every inline script's body and every comment blanked. The tag
 * scans run over this, never the raw page: a `<` in script code
 * (`i<a.length`) starts a false tag, and an apostrophe in a comment after it
 * (`// don't`) then makes the quote-aware scan swallow the page up to the next
 * apostrophe, hiding every real tag in between (review round 2). Script BODIES
 * are read separately, by the inline-script pass.
 */
export function markupOnly(html) {
  // One pass, whichever comes first: a `<!--` inside script code is not a
  // comment, and blanking comments first ran one from a script string to the
  // next real `-->`, erasing every tag between (review round 3).
  return html.replace(
    /<!--[\s\S]*?-->|(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi,
    (_, open, close) => (open ? open + close : ""),
  );
}

export function extractFromHtml(rawHtml, pageUrl) {
  const html = markupOnly(rawHtml);
  const out = [];
  const push = (raw, kind) => {
    const u = resolve(raw, pageUrl);
    if (u) out.push({ url: u, kind });
  };

  for (const [tag] of tags(html, "link")) {
    const rels = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attr(tag, "href");
    if (!href || !rels.some((r) => LINK_RELS.has(r))) continue;
    // A prefetch of another PAGE (Webflow emits one per collection item) is
    // navigation, and the crawl owns pages; only a stylesheet or a real file counts.
    const u = resolve(href, pageUrl);
    if (u && (rels.includes("stylesheet") || isAssetUrl(u)))
      out.push({ url: u, kind: `link:${rels.join("+")}` });
  }
  for (const [tag] of tags(html, "script|img|source|video|audio|track|embed|input|iframe")) {
    const src = attr(tag, "src");
    if (src) push(src, tag.slice(1, 7).toLowerCase() === "iframe" ? "iframe" : "src");
    const poster = attr(tag, "poster");
    if (poster) push(poster, "poster");
  }
  for (const [tag] of tags(html, "image")) {
    const href = attr(tag, "href") ?? attr(tag, "xlink:href");
    if (href) push(href, "svg-image");
  }
  for (const [tag] of tags(html, "object")) {
    const data = attr(tag, "data");
    if (data) push(data, "object");
  }
  for (const [tag] of tags(html, "meta")) {
    const c = attr(tag, "content");
    const u = c ? resolve(c, pageUrl) : null;
    if (u && /^(?:https?:)?\/|^[\w.-]+\//i.test(c.trim()) && isAssetUrl(u))
      out.push({ url: u, kind: "meta" });
  }
  for (const [tag] of tags(html, "a")) {
    const href = attr(tag, "href");
    const u = href ? resolve(href, pageUrl) : null;
    if (u && isAssetUrl(u)) out.push({ url: u, kind: "a-file" });
  }
  // Attributes any element may carry, in either quote style.
  for (const [tag] of tags(html, "[a-z][\\w:-]*")) {
    for (const name of ["srcset", "imagesrcset"]) {
      const v = attr(tag, name);
      if (v) for (const u of srcsetUrls(decodeEntities(v))) push(u, "srcset");
    }
    // Webflow background video: both transcodes in one comma-separated attribute.
    const videos = attr(tag, "data-video-urls");
    if (videos) for (const u of decodeEntities(videos).split(",")) push(u, "data-video-urls");
    const poster = attr(tag, "data-poster-url");
    if (poster) push(poster, "data-poster-url");
    // Lottie (data-animation-type="lottie") and any other lazy data-src.
    const dataSrc = attr(tag, "data-src");
    if (dataSrc) push(dataSrc, "data-src");
    const style = attr(tag, "style");
    if (style)
      out.push(
        ...extractFromCss(decodeEntities(style), pageUrl).map((r) => ({
          ...r,
          kind: "style-attr",
        })),
      );
  }
  for (const m of rawHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    out.push(...extractFromCss(m[1], pageUrl).map((r) => ({ ...r, kind: "style-block" })));
  // Inline scripts: a runtime load names its file only inside code
  // ($.getScript("https://raw.githack.com/…/countersAnim.js")).
  for (const m of rawHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const u of absoluteAssetUrls(m[1], pageUrl)) out.push({ url: u, kind: "inline-script" });
    for (const u of webfontGoogleCssUrls(m[1])) out.push({ url: u, kind: "webfont-google" });
  }
  return dedupe(out);
}

/** Same-origin page links (the crawl frontier): no files, no fragments, no queries. */
const siteHost = (host) => host.replace(/^www\./, "");

/** Same-site page links (the crawl frontier): no files, no fragments. The apex
 *  and `www` count as one site, so an absolute link to either is a page to have. */
export function extractPageLinks(rawHtml, pageUrl) {
  const html = markupOnly(rawHtml);
  const host = siteHost(new URL(pageUrl).host);
  const out = new Set();
  for (const [tag] of tags(html, "a")) {
    const href = attr(tag, "href");
    const u = href ? resolve(href, pageUrl) : null;
    if (!u) continue;
    const url = new URL(u);
    if (siteHost(url.host) !== host || isAssetUrl(u)) continue;
    out.add(normalizePagePath(url.pathname));
  }
  return [...out].sort();
}

/**
 * Webflow collection pagination (`?<id>_page=2`). The capture stores pages by
 * path only, so page 2 of a list would be silently absent: these are reported
 * so that capture and check can refuse, rather than pass a partial list.
 */
export function paginationLinks(rawHtml, pageUrl) {
  const host = siteHost(new URL(pageUrl).host);
  const out = new Set();
  for (const [tag] of tags(markupOnly(rawHtml), "a")) {
    const href = attr(tag, "href");
    const u = href ? resolve(href, pageUrl) : null;
    if (u && siteHost(new URL(u).host) === host && /[?&][\w-]*_page=\d/.test(new URL(u).search))
      out.add(u);
  }
  return [...out].sort();
}

export function normalizePagePath(pathname) {
  const p = pathname.replace(/\/{2,}/g, "/");
  return p.length > 1 ? p.replace(/\/$/, "") : "/";
}

/** Which extractor a captured file gets, by its URL. */
export function extractFromFile(url, text) {
  const path = safeDecode(new URL(url).pathname).toLowerCase();
  const host = new URL(url).host;
  if (path.endsWith(".css") || host === "fonts.googleapis.com") return extractFromCss(text, url);
  if (path.endsWith(".js") || path.endsWith(".mjs")) return extractFromJs(text, url);
  if (path.endsWith(".json")) return extractFromLottie(text, url);
  return [];
}

export const isTextFile = (url) => {
  const path = safeDecode(new URL(url).pathname).toLowerCase();
  return /\.(?:css|js|mjs|json)$/.test(path) || new URL(url).host === "fonts.googleapis.com";
};

function dedupe(refs) {
  const seen = new Set();
  return refs.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
}

const UNSAFE = /[<>:"|?*\\\p{Cc}]/gu;

/** One decoded path segment as a file name: a decoded `/` (from `%2F`) stays
 *  inside the name, and `.` or `..` never reach the filesystem as themselves,
 *  so no URL can place a file outside its host's directory (review round 3). */
const segment = (raw) => {
  const s = safeDecode(raw).replace(UNSAFE, "_").replace(/\//g, "_");
  return s === "." || s === ".." ? `_${s}` : s;
};

/**
 * Whether `file` can be written beside every path already in `claimed`
 * (file → URL): null when it can, else the URL that holds the clashing path.
 * Two paths clash when they are equal without being the same URL (an http and
 * an https reference to one file are one file), when one would be a directory
 * of the other (`img` and `img/x.png`), or when they differ only by case, which
 * a case-insensitive filesystem (macOS) stores as one. A clash found here is a
 * failure to record: writing it would overwrite a file or throw.
 */
export function pathConflict(claimed, file, url) {
  const sameFile = (a, b) => a.replace(/^http:/, "https:") === b.replace(/^http:/, "https:");
  const key = file.toLowerCase();
  for (const [f, u] of claimed) {
    const k = f.toLowerCase();
    if (
      k === key
        ? f !== file || !sameFile(u, url)
        : k.startsWith(`${key}/`) || key.startsWith(`${k}/`)
    )
      return u;
  }
  claimed.set(file, url);
  return null;
}

/**
 * Where a URL's bytes live inside a capture: `files/<host>/<decoded path>`.
 * Deterministic from the URL alone, so the offline check can find a file
 * without trusting any list the capture wrote. A query string is folded into
 * the name as `.q<sha8>` before the extension (jQuery's `?site=` and every
 * Google Fonts request carry one), and a Google Fonts stylesheet gets `.css`.
 */
export function urlToLocal(href) {
  const u = new URL(href);
  let path = u.pathname;
  if (path.endsWith("/") || path === "") path += "index";
  const segs = path.split("/").filter(Boolean).map(segment);
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
    .map((s) => (s ? segment(s) : s))
    .join("/")}/index.html`;
}

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
