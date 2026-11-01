// P1-90 overflow census (temporary; this branch is never merged).
// The measurement is medical-solutions-of-texas tests/smoke/mobile-overflow.spec.ts
// (reddoorla/medical-solutions-of-texas#100, #106) verbatim: a plain desktop
// context at each width (no mobile emulation, which zooms out and hides overflow),
// wait for load and fonts, then fail on scrollWidth > clientWidth or any text
// node whose box runs past the right edge.
// Usage: node overflow.mjs <label> <baseUrl>
import { chromium } from "playwright";
const [label, base] = process.argv.slice(2);
const WIDTHS = [320, 390, 768, 820, 1024];
const MAX_ROUTES = 16;

async function text(url) {
  try { const r = await fetch(url, { redirect: "follow" }); return r.ok ? await r.text() : ""; } catch { return ""; }
}
async function sitemapPaths() {
  const seen = new Set();
  const queue = [new URL("/sitemap.xml", base).href];
  const paths = [];
  while (queue.length && seen.size < 10) {
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    const xml = await text(u);
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const loc = m[1];
      if (/sitemap[^/]*\.xml$/i.test(loc)) queue.push(loc);
      else { try { paths.push(new URL(loc).pathname); } catch {} }
    }
  }
  return paths;
}
function pick(paths) {
  // "/" first, then up to 3 routes per first path segment, so templates are covered.
  const out = ["/"], per = new Map();
  for (const p of [...new Set(paths)]) {
    if (p === "/" || out.length >= MAX_ROUTES) continue;
    const seg = p.split("/")[1] || "";
    const n = per.get(seg) || 0;
    if (n >= 3) continue;
    per.set(seg, n + 1); out.push(p);
  }
  return out;
}
async function homeLinks(page) {
  await page.goto(base, { waitUntil: "load", timeout: 45000 });
  return page.evaluate(() => [...document.querySelectorAll("a[href]")]
    .map((a) => new URL(a.href, location.href)).filter((u) => u.origin === location.origin).map((u) => u.pathname));
}
function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    // MSOT's two checks, with its "text past the edge" split in two: text that
    // straddles the edge is cut off where a visitor can see it (MSOT's w-80);
    // text wholly past the edge is a carousel slide or an off-canvas menu.
    const straddle = [], offscreen = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      const el = n.parentElement;
      if (el && el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.right > vw + 1);
      if (!rects.length) continue;
      const label = `<${el?.tagName.toLowerCase()}> "${n.textContent.trim().slice(0, 40)}"`;
      (rects.some((r) => r.left < vw - 1) ? straddle : offscreen).push(label);
    }
    // The outermost elements past the right edge: what makes the page scroll.
    const culprits = [];
    const sw = document.documentElement.scrollWidth;
    if (sw > vw) {
      for (const el of document.body.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= vw + 1) continue;
        const p = el.parentElement?.getBoundingClientRect();
        if (p && p.right > vw + 1) continue;
        const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 4).join(".") : "";
        culprits.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""} right=${Math.round(r.right)}`);
        if (culprits.length >= 4) break;
      }
    }
    return { scrollWidth: sw, clientWidth: vw, straddle, offscreen, culprits };
  });
}
const browser = await chromium.launch();
let routes = pick(await sitemapPaths());
let source = "sitemap";
if (routes.length <= 1) {
  const p = await (await browser.newContext()).newPage();
  try { routes = pick(await homeLinks(p)); source = "home-links"; } catch (e) { console.log(`P190 ${label} ERROR home ${e.message.split("\n")[0]}`); }
}
console.log(`P190 ${label} ROUTES ${source} ${routes.length} ${routes.join(" ")}`);
let hits = 0, errors = 0;
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  for (const path of routes) {
    try {
      const res = await page.goto(new URL(path, base).href, { waitUntil: "load", timeout: 45000 });
      await page.evaluate(() => document.fonts.ready);
      const { scrollWidth, clientWidth, straddle, offscreen, culprits } = await measure(page);
      const scroll = scrollWidth > clientWidth;
      const bad = scroll || straddle.length > 0;
      if (bad) hits++;
      const kind = scroll && straddle.length ? "HIT-scroll+cut" : scroll ? "HIT-scroll" : straddle.length ? "HIT-cut" : offscreen.length ? "ok-offscreen" : "ok";
      console.log(`P190 ${label} ${kind} ${width} ${path} status=${res?.status()} scroll=${scrollWidth} client=${clientWidth} cut=${straddle.length} off=${offscreen.length}` +
        (culprits.length ? ` culprits=${JSON.stringify(culprits)}` : "") + (straddle.length ? ` cuttext=${JSON.stringify(straddle.slice(0, 3))}` : ""));
    } catch (e) {
      errors++;
      console.log(`P190 ${label} ERROR ${width} ${path} ${e.message.split("\n")[0]}`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`P190 ${label} SUMMARY hits=${hits} errors=${errors} routes=${routes.length} widths=${WIDTHS.length}`);
