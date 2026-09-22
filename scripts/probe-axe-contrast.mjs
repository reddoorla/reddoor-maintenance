#!/usr/bin/env node
/**
 * Re-prove the #888 contrast detection against REAL axe output.
 *
 * This exists because the first attempt at #888 shipped a guard built on a
 * mechanism that does not occur. The issue said axe "throws, files an
 * error-occurred check, and skips the rule for the whole page". It does not:
 * an unparseable colour is caught PER NODE and recorded as an incomplete entry
 * whose check carries messageKey "colorParse", while the rule keeps running
 * everywhere else. Unit tests on a hand-built artifact could not tell the
 * difference, because they asserted the shape the author believed in.
 *
 * So this lifts the detection VERBATIM out of the generated spec and runs it
 * against axe in a real browser, in both directions. Run it after any change
 * to that detection:
 *
 *     node --import tsx scripts/probe-axe-contrast.mjs
 *
 * Expected, axe-core 4.13.0 + Chromium:
 *     BAD  one band            -> VIOLATION, 1 node(s)
 *     BAD  colour on body      -> VIOLATION, 2 node(s)
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
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { a11yAudit } from "../src/audits/a11y.ts";

const site = mkdtempSync(join(tmpdir(), "probe-axe-"));
for (const f of ["a11y-fixtures", "animate-in"]) {
  mkdirSync(join(site, "src", "routes", "dev", f), { recursive: true });
}
writeFileSync(join(site, "package.json"), JSON.stringify({ name: "probe" }));

let spec = "";
await a11yAudit({
  site: { path: site },
  spawn: async (_cmd, args, opts) => {
    spec = readFileSync(args[args.length - 1], "utf-8");
    mkdirSync(join(opts.cwd, ".reddoor-a11y"), { recursive: true });
    writeFileSync(
      join(opts.cwd, ".reddoor-a11y", "results.json"),
      JSON.stringify({ totalViolations: 0, byImpact: {} }),
    );
    return { code: 0, stdout: "", stderr: "" };
  },
});

const lifted = spec.match(/const contrastIncomplete = [\s\S]*?\n {6}: \[\];\n/);
if (!lifted) {
  console.error("could not lift the detection out of the generated spec — has it been renamed?");
  process.exit(2);
}
const detect = new Function("results", `${lifted[0]}; return unparseable;`);

const T = "A sentence long enough that axe will actually judge its contrast.";
const PAGES = {
  "BAD  one band (the incident shape)": `<style>.b{background-color:oklch(0.205 0 none);color:#3a3a3a}</style><main><p class="b">${T}</p><p>${T} Plain.</p></main>`,
  "BAD  colour on body (page-wide)": `<style>body{background-color:oklch(0.205 0 none);color:#3a3a3a}</style><main><p>${T}</p><p>${T} Again.</p></main>`,
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
  // The same builder and tags the audit's own spec uses, so this measures the
  // shipped path rather than a lookalike.
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  await page.close();
  const found = detect(results);
  const reported = found.length > 0;
  const expected = label.startsWith("BAD");
  if (reported !== expected) bad += 1;
  console.log(
    `${label}\n   -> ${reported ? `VIOLATION, ${found.length} node(s)` : "nothing reported"}${
      reported === expected ? "" : "   <-- UNEXPECTED"
    }`,
  );
}
await browser.close();
process.exit(bad === 0 ? 0 : 1);
