import { parse } from "node-html-parser";

// Reveal effects hide content until the Blux runtime adds `block-effects-applied`
// on scroll. With the runtime stripped, force the end-state so everything is
// visible without JS. (`.block-effects{opacity:0}` is the initial rule.)
export const REVEAL_FORCE_CSS =
  ".block-effects{opacity:1!important;transform:none!important;animation:none!important;visibility:visible!important}";

export interface Finalized {
  /** `<body>` inner HTML wrapped so the body's own class/style survive. */
  templateHtml: string;
  /** All page `<style>` blocks + the reveal-force override. */
  styleCss: string;
  title: string;
  metaTitle?: string | undefined;
  metaImageUrl?: string | undefined;
  /** External stylesheet hrefs (Google Fonts) to re-inject at render. */
  fontLinks: string[];
}

/**
 * Turn a tokenized settled document into the two repo artifacts: strip all
 * `<script>`, extract every `<style>` block (+ reveal-force) into a stylesheet,
 * and wrap the body's inner HTML in a `.frozen-root` div that carries the
 * body's own class/style (which `body.innerHTML` would otherwise drop).
 */
export function finalize(html: string): Finalized {
  const root = parse(html);
  const title = root.querySelector("title")?.text?.trim() ?? "";
  const metaOf = (prop: string): string | undefined =>
    root.querySelector(`meta[property="${prop}"]`)?.getAttribute("content") ?? undefined;
  const metaTitle = metaOf("og:title") ?? (title || undefined);
  const metaImageUrl = metaOf("og:image");

  const fontLinks = root
    .querySelectorAll('link[rel="stylesheet"]')
    .map((l) => l.getAttribute("href"))
    .filter((h): h is string => !!h);

  const styles: string[] = [];
  for (const s of root.querySelectorAll("style")) {
    styles.push(s.innerHTML);
    s.remove();
  }
  for (const sc of root.querySelectorAll("script")) sc.remove();
  // Remove the Blux runtime's lazy media spans: they carry raw cloudfront urls
  // for whichever images were on-screen at snapshot (the rest unloaded), and the
  // deterministic baked token on the parent media div is what renders instead.
  for (const holder of root.querySelectorAll(".load-media-holder, .load-media-element")) {
    holder.remove();
  }

  const body = root.querySelector("body");
  const inner = body ? body.innerHTML : root.toString();
  const bodyClass = body?.getAttribute("class") ?? "";
  const bodyStyle = body?.getAttribute("style") ?? "";
  const cls = `frozen-root ${bodyClass}`.trim();
  const styleAttr = bodyStyle ? ` style="${bodyStyle}"` : "";
  const templateHtml = `<div class="${cls}"${styleAttr}>${inner}</div>`;

  const styleCss = [...styles, REVEAL_FORCE_CSS].join("\n");
  return { templateHtml, styleCss, title, metaTitle, metaImageUrl, fontLinks };
}
