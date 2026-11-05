// P1-90 desktop-width overflow census (temporary; this branch is never merged).
// reddoorla/reddoor-maintenance#1876. The 11-01 census stopped at 1024px; Williamson
// (to ~1320) and Reddoor (1440) overflowed above that. This run measures 1100-1920
// with the published `measure()` (@reddoorla/maintenance/smoke, 0.113.0, from #1939),
// after the sites' hydration wait (history.scrollRestoration === "manual", then two frames).
// Usage: node overflow.mjs <label> <baseUrl> [widths,comma,separated] [inject]
import { chromium } from "playwright";
import { measure } from "@reddoorla/maintenance/smoke";
const [label, base, widthArg, inject] = process.argv.slice(2);
const WIDTHS = (widthArg || "1100,1280,1440,1920").split(",").map(Number);
const MAX_ROUTES = 16;

async function text(url) {
  try { const r = await fetch(url, { redirect: "follow" }); return r.ok ? await r.text() : ""; } catch { return ""; }
}
async function sitemapPaths() {
  const seen = new Set(); const queue = [new URL("/sitemap.xml", base).href]; const paths = [];
  while (queue.length && seen.size < 10) {
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    const xml = await text(u);
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const loc = m[1];
      if (/sitemap[^/]*\.xml$/i.test(loc)) queue.push(loc); else { try { paths.push(new URL(loc).pathname); } catch {} }
    }
  }
  return paths;
}
function pick(paths) {
  const out = ["/"], per = new Map();
  for (const p of [...new Set(paths)]) {
    if (p === "/" || out.length >= MAX_ROUTES) continue;
    const seg = p.split("/")[1] || ""; const n = per.get(seg) || 0;
    if (n >= 3) continue; per.set(seg, n + 1); out.push(p);
  }
  return out;
}
async function homeLinks(page) {
  await page.goto(base, { waitUntil: "load", timeout: 45000 });
  return page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => new URL(a.href, location.href)).filter((u) => u.origin === location.origin).map((u) => u.pathname));
}
async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  // SvelteKit sets scrollRestoration = "manual" only after hydrate; a non-SvelteKit page never does.
  const hydrated = await page.waitForFunction(() => history.scrollRestoration === "manual", null, { timeout: 15000 }).then(() => true, () => false);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return hydrated;
}
// What widens the page: hide each element past the edge in turn, deepest first,
// and keep those whose removal alone brings scrollWidth back to the screen.
function culprits(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth; const out = [];
    const els = [...document.body.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > vw + 1).reverse().slice(0, 400);
    for (const el of els) {
      const prev = el.style.display; el.style.display = "none";
      const fixed = document.documentElement.scrollWidth <= vw; el.style.display = prev;
      if (!fixed) continue;
      if (out.some((o) => o.el.contains(el) || el.contains(o.el))) continue;
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 5).join(".") : "";
      out.push({ el, s: `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} right=${Math.round(el.getBoundingClientRect().right)} "${(el.textContent || "").trim().slice(0, 40)}"` });
      if (out.length >= 3) break;
    }
    return out.map((o) => o.s);
  });
}
const browser = await chromium.launch();
let routes = pick(await sitemapPaths()); let source = "sitemap";
if (routes.length <= 1) {
  const p = await (await browser.newContext()).newPage();
  try { routes = pick(await homeLinks(p)); source = "home-links"; } catch (e) { console.log(`P190 ${label} ERROR home ${e.message.split("\n")[0]}`); }
}
if (inject) routes = routes.slice(0, 2);
console.log(`P190 ${label} ROUTES ${source} ${routes.length} ${routes.join(" ")}`);
let hits = 0, errors = 0;
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  for (const path of routes) {
    try {
      const res = await page.goto(new URL(path, base).href, { waitUntil: "load", timeout: 45000 });
      const hydrated = await settle(page);
      if (inject) await page.evaluate(() => { const p = document.createElement("p"); p.textContent = "P190 positive control: an unbreakable line wider than any screen ".repeat(3); p.style.cssText = "white-space:nowrap;width:max-content;font-size:24px"; document.body.appendChild(p); });
      const { scrollWidth, clientWidth, cut } = await measure(page);
      const scroll = scrollWidth > clientWidth; const bad = scroll || cut.length > 0;
      if (bad) hits++;
      const kind = scroll && cut.length ? "HIT-scroll+cut" : scroll ? "HIT-scroll" : cut.length ? "HIT-cut" : "ok";
      const who = scroll ? await culprits(page) : [];
      console.log(`P190 ${label} ${kind} ${width} ${path} status=${res?.status()} hydrated=${hydrated} scroll=${scrollWidth} client=${clientWidth} cut=${cut.length}` +
        (who.length ? ` culprits=${JSON.stringify(who)}` : "") + (cut.length ? ` cuttext=${JSON.stringify(cut.slice(0, 3))}` : ""));
    } catch (e) { errors++; console.log(`P190 ${label} ERROR ${width} ${path} ${e.message.split("\n")[0]}`); }
  }
  await ctx.close();
}
await browser.close();
console.log(`P190 ${label} SUMMARY hits=${hits} errors=${errors} routes=${routes.length} widths=${WIDTHS.join(",")}`);
