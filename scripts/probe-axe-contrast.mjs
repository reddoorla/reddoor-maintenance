#!/usr/bin/env node
/**
 * Re-prove the #888 contrast detection against REAL axe output.
 *
 * The mechanism has been got wrong twice, in opposite directions. The issue
 * said axe "throws, files an error-occurred check, and skips the rule for the
 * whole page"; the first correction said that never happens, because a probe
 * with the colour directly behind the text found a PER-NODE `incomplete` entry
 * with messageKey "colorParse" instead. Both happen. Which one depends on
 * where the colour sits under the text:
 *
 *   - first opaque background behind the text -> per node, "colorParse",
 *     the rule runs on elsewhere (reported as contrast-unmeasured);
 *   - beneath an opaque background (a white CTA or card inside the coloured
 *     band: the starter's Hero) -> the rule THROWS, `incomplete[].error` is
 *     set, and color-contrast is skipped for the whole page (reported as
 *     rule-errored).
 *
 * Unit tests on a hand-built artifact could not tell any of this apart,
 * because they asserted the shape their author believed in. So this runs the
 * detection the generated spec injects (readAxeResults over axe's raw report,
 * then unparseableContrastNodes and the crashes it sets apart; both serialized
 * into the spec with toString()) against axe in a real browser, in both
 * directions. The same shapes, run through the real audit,
 * are held in CI by tests/audits/a11y-live-spec.test.ts; this is the quick
 * check to run after any change to that detection or any axe-core bump:
 *
 *     node --import tsx scripts/probe-axe-contrast.mjs
 *
 * Expected, axe-core 4.13.0 + Chromium:
 *     BAD  one band            -> UNMEASURED, 1 node(s)
 *     BAD  colour on body      -> UNMEASURED, 2 node(s)
 *     BAD  white CTA in band   -> RULE THREW: color-contrast: Unable to parse color ...
 *     BAD  text in the colour  -> UNMEASURED, 1 node(s)
 *     BAD  text-shadow         -> RULE THREW: color-contrast: ...
 *     BAD  link border         -> RULE THREW: link-in-text-block: ...
 *     GOOD healthy control     -> nothing reported
 *     GOOD text on a gradient  -> nothing reported
 *     GOOD no text at all      -> nothing reported
 *     GOOD explicit hue        -> nothing reported
 *
 * Note the text in each fixture is a full sentence on purpose. axe reports ONE
 * reason per node and checks text length first, so single-character paragraphs
 * come back as "shortTextContent" and never reach the colour at all — which is
 * itself worth knowing before reading any result from this rule.
 */
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { unparseableContrastNodes } from "../src/audits/util/contrast-unmeasured.ts";
import { readAxeResults } from "../src/audits/util/axe-results.ts";

const T = "A sentence long enough that axe will actually judge its contrast.";
const PAGES = {
  "BAD  one band (the colour directly behind the text)": `<style>.b{background-color:oklch(0.205 0 none);color:#3a3a3a}</style><main><p class="b">${T}</p><p>${T} Plain.</p></main>`,
  "BAD  colour on body (page-wide)": `<style>body{background-color:oklch(0.205 0 none);color:#3a3a3a}</style><main><p>${T}</p><p>${T} Again.</p></main>`,
  "BAD  white CTA in the band (the starter Hero, and #888 as reported)": `<style>section{background-color:oklch(0.205 0 none);color:#fff;position:relative;isolation:isolate;padding:20px}a{display:inline-block;background:#fff;color:#000;padding:8px}</style><main><p>${T}</p><section><p>${T}</p><a href="#x">Explore</a></section></main>`,
  "BAD  text coloured with the colour (text-neutral-*)": `<main><p style="color:oklch(0.4 0 none)">${T}</p></main>`,
  "BAD  a text-shadow in the colour (color-contrast throws)": `<main><p style="text-shadow:0 0 2px oklch(0.2 0 none)">${T}</p></main>`,
  "BAD  a link in a text block, bordered in the colour (link-in-text-block throws)": `<main><p>${T} <a href="#x" style="color:#111;text-decoration:none;border-bottom:1px solid oklch(0.87 0 none)">a link</a> inside it.</p></main>`,
  "GOOD healthy control": `<style>body{background:#fff;color:#111}</style><main><p>${T}</p></main>`,
  "GOOD text on a gradient": `<style>.g{background-image:linear-gradient(#000,#333);color:#eee}</style><main><p class="g">${T}</p></main>`,
  "GOOD no text at all": `<main><div style="width:9px;height:9px"></div></main>`,
  "GOOD explicit hue (the fix)": `<style>.b{background-color:oklch(0.205 0 0);color:#fff}</style><main><p class="b">${T}</p></main>`,
};

const browser = await chromium.launch();
// AxeBuilder refuses a page opened straight off the browser.
const context = await browser.newContext();
let bad = 0;
for (const [label, body] of Object.entries(PAGES)) {
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`,
  );
  // The same builder, options (preload off and the raw report, set before the
  // tags, #52 and #916) and tags
  // the audit's own spec uses, so this measures the shipped path rather than a
  // lookalike.
  const results = readAxeResults(
    await new AxeBuilder({ page })
      .options({ preload: false, reporter: "raw" })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze(),
  );
  await page.close();
  const found = unparseableContrastNodes(results);
  // The spec's other finding: every crash readAxeResults sets apart.
  const threw = results.crashes;
  const reported = found.length > 0 || threw.length > 0;
  const expected = label.startsWith("BAD");
  if (reported !== expected) bad += 1;
  const said = [
    ...(found.length > 0 ? [`UNMEASURED, ${found.length} node(s)`] : []),
    ...threw.map((c) => `RULE THREW: ${c.rule}: ${c.message}`),
  ];
  console.log(
    `${label}\n   -> ${reported ? said.join("; ") : "nothing reported"}${
      reported === expected ? "" : "   <-- UNEXPECTED"
    }`,
  );
}
await browser.close();
process.exit(bad === 0 ? 0 : 1);
