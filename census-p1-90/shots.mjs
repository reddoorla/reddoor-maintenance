// P1-90 confirmation screenshots (temporary; never merged). Each shot names site, route, width.
import { chromium } from "playwright";
import { measure } from "@reddoorla/maintenance/smoke";
const shots = [
  // [label, url, width, js, selector-or-null (element to crop/locate), find-text]
  ["dd-1100", "https://www.datadynamiq.com/", 1100, true, null, "Effectively manage digital evidence"],
  ["dd-1920", "https://www.datadynamiq.com/", 1920, true, null, "lead with innovation"],
  ["vineyard-about-1280", "https://www.vineyardconstruction.com/about", 1280, true, null, null],
  ["vineyard-about-1279", "https://www.vineyardconstruction.com/about", 1279, true, null, null],
  ["vineyard-about-1300", "https://www.vineyardconstruction.com/about", 1300, true, null, null],
  ["bf-fv-1920", "https://www.beachfrontdentistry.com/your-first-visit", 1920, true, null, "Enrique joined our dental team"],
  ["sonder-767", "https://gallerysonder.com/", 767, true, "nav", null],
  ["sonder-768", "https://gallerysonder.com/", 768, true, "nav", null],
  ["sonder-769", "https://gallerysonder.com/", 769, true, "nav", null],
  ["vineyard-nojs-320", "https://www.vineyardconstruction.com/", 320, false, null, null],
  ["vineyard-nojs-390", "https://www.vineyardconstruction.com/", 390, false, null, null],
];
const browser = await chromium.launch();
for (const [label, url, width, js, sel, find] of shots) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: js });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    if (js) await page.waitForFunction(() => history.scrollRestoration === "manual", null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const m = await measure(page).catch((e) => ({ err: e.message }));
    let info = "";
    if (find) {
      info = await page.evaluate((t) => {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.includes(t)) {
          const el = n.parentElement; el.scrollIntoView({ block: "center" });
          const r = el.getBoundingClientRect(); const chain = [];
          for (let a = el; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); chain.push(`${a.tagName.toLowerCase()}.${(a.className?.baseVal ?? a.className ?? "").toString().trim().split(/\s+/).slice(0,4).join(".")} ov=${cs.overflowX} inert=${a.inert} aria-hidden=${a.getAttribute("aria-hidden")} r=${Math.round(a.getBoundingClientRect().left)}-${Math.round(a.getBoundingClientRect().right)}`); if (chain.length > 8) break; }
          return `text box ${Math.round(r.left)}-${Math.round(r.right)} of ${innerWidth}; chain: ${chain.join(" < ")}`;
        }
        return "text not found";
      }, find);
      await page.waitForTimeout(600);
    }
    if (label.startsWith("vineyard-about")) {
      info = await page.evaluate(() => { const vw = document.documentElement.clientWidth; const out = [];
        for (const el of document.body.querySelectorAll("*")) { const r = el.getBoundingClientRect(); if (r.right > vw + 0.5 && r.width > 0) { const prev = el.style.display; el.style.display = "none"; const ok = document.documentElement.scrollWidth <= vw; el.style.display = prev; if (ok) out.push(`${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0,6).join(".")} ${r.left.toFixed(1)}-${r.right.toFixed(1)}`); } }
        return out.slice(-4).join(" | "); });
    }
    if (sel) {
      info = await page.evaluate(() => [...document.querySelectorAll('img[alt="sonder logo"]')].map((i) => { const r = i.getBoundingClientRect(); const cs = getComputedStyle(i); return `${i.getAttribute("src").split("/").pop()} display=${cs.display} vis=${r.width > 0 && cs.display !== "none" && cs.opacity !== "0"} box=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`; }).slice(0, 4).join(" | "));
      await page.screenshot({ path: `out/${label}.png`, clip: { x: 0, y: 0, width, height: 80 } });
    } else await page.screenshot({ path: `out/${label}.png`, fullPage: !find });
    console.log(`SHOT ${label} scroll=${m.scrollWidth} client=${m.clientWidth} cut=${JSON.stringify(m.cut?.slice(0, 3))} ${info}`);
  } catch (e) { console.log(`SHOT ${label} ERROR ${e.message.split("\n")[0]}`); }
  await ctx.close();
}
await browser.close();
