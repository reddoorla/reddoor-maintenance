import { describe, it, expect } from "vitest";
import { chromium } from "@playwright/test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { freezeSite } from "../../../src/blux/freeze/index.js";

// E2E: needs the real the-pointe export + a browser. Opt in with FREEZE_E2E=1.
const EXPORT = join(homedir(), "Desktop", "thePointe", "index.html");
const run = !!process.env.FREEZE_E2E && existsSync(EXPORT);

describe.skipIf(!run)("freeze golden — the-pointe", () => {
  it(
    "produces a faithful template: 56 images, 14+ sections, renders 15333px",
    async () => {
      const res = await freezeSite({ indexHtmlPath: EXPORT, site: "the-pointe" });
      const images = res.manifest.slots.filter((s) => s.kind === "image");
      const texts = res.manifest.slots.filter((s) => s.kind === "text");
      const sections = new Set(
        res.manifest.slots.map((s) => s.section).filter((s) => s.startsWith("s")),
      );

      // 56 data-* backgrounds + a handful of src/href/poster media (video…).
      expect(images.length).toBeGreaterThanOrEqual(56);
      expect(texts.length).toBeGreaterThan(30);
      expect(sections.size).toBeGreaterThanOrEqual(14);
      expect(res.templateHtml).not.toContain("<script");
      expect(res.templateHtml).not.toContain("cloudfront"); // all image urls tokenized
      expect(res.manifest.fontLinks.join(" ")).toContain("fonts.googleapis.com");

      // Substitute tokens back, inject fonts + style, render, measure.
      const byKey = new Map(res.manifest.slots.map((s) => [s.key, s]));
      const html = res.templateHtml
        .replace(/⟦t:([^⟧]+)⟧/g, (_, k) => byKey.get(k)?.text ?? "")
        .replace(/url\(⟦i:([^⟧]+)⟧\)/g, (_, k) => `url('${byKey.get(k)?.url ?? ""}')`)
        .replace(/⟦i:([^⟧]+)⟧/g, (_, k) => byKey.get(k)?.url ?? "");
      const links = res.manifest.fontLinks
        .map((h) => `<link rel="stylesheet" href="${h}">`)
        .join("");
      const doc = `<!doctype html><html><head><meta charset="utf-8">${links}<style>${res.styleCss}</style></head><body>${html}</body></html>`;
      const p = join(mkdtempSync(join(tmpdir(), "frz-")), "out.html");
      writeFileSync(p, doc);

      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.goto("file://" + p, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(2500);
      const height = await page.evaluate(() => document.body.scrollHeight);
      const bg = await page.evaluate(
        () =>
          [...document.querySelectorAll("*")].filter((e) =>
            getComputedStyle(e).backgroundImage.includes("http"),
          ).length,
      );
      const rawTokens = await page.evaluate(() => document.body.innerHTML.includes("⟦"));
      await browser.close();

      expect(height).toBeGreaterThan(15100);
      expect(height).toBeLessThan(15600);
      expect(bg).toBeGreaterThanOrEqual(50);
      expect(rawTokens).toBe(false);
    },
    120000,
  );
});
