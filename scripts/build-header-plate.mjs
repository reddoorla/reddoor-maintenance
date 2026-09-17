// scripts/build-header-plate.mjs
//
// One-time, offline. Turns the Figma full-frame export into the bundled plate.
//
// The export carries a site's screenshot and domain text baked in. The DOMAIN
// TEXT needs cleanup here: it is per-site, sits on textured paper, and a flat
// fill would read as a visible patch. So we copy a clean strip of paper from the
// right of the canvas (which is empty at that height) across the text.
//
// ⚠️ THE SCREEN REGION IS LEFT AS-IS, AND THAT IS ONLY SAFE WHILE SCREEN IS
// CORRECT. compose.ts paints the site's screenshot over it every run — but only
// over SCREEN, and SCREEN is measured off the asset. This comment used to say
// the screen region "needs no cleanup", flatly, and that sentence was quoted as
// reassurance while it was false: #570 re-exported the frame with the laptop
// 26px higher, nobody re-measured SCREEN, and the export's baked-in Alamo
// Anatomy homepage showed across the top of every site's header for three weeks.
//
// SO: AFTER RUNNING THIS, RE-MEASURE SCREEN AND RUN THE GUARD.
//   pnpm vitest run tests/reports/header-image/plate-geometry.test.ts
// It derives the hole from the asset you just wrote and fails if geometry.ts
// disagrees. Do not skip it because the plate "looks the same".
//
// Usage: node scripts/build-header-plate.mjs <figma-export.png>
import sharp from "sharp";

const src = process.argv[2];
if (!src) throw new Error("usage: build-header-plate.mjs <figma-export.png>");
// The bundled asset is plate-clean.png — the name changed in #570 when the
// headline came out of the plate, and this script kept writing plate.png, a file
// nothing loads. Anyone who ran it saw "wrote ..." and no change in the output.
const OUT = "src/reports/header-image/assets/plate-clean.png";

// Text ink measured at x=283..~1200, y=2963..3037. Cover generously.
const WIPE = { left: 260, top: 2930, width: 1000, height: 140 };
// Clean paper at the same height, right of any ink.
const CLEAN_LEFT = 1340;

const img = sharp(src);
const { width, height } = await img.metadata();
if (width !== 2400 || height !== 3200) {
  throw new Error(`expected a 2400x3200 export, got ${width}x${height}`);
}

const patch = await sharp(src)
  .extract({ left: CLEAN_LEFT, top: WIPE.top, width: WIPE.width, height: WIPE.height })
  .toBuffer();

await sharp(src)
  .composite([{ input: patch, left: WIPE.left, top: WIPE.top }])
  .png()
  .toFile(OUT);

console.log(`wrote ${OUT}`);
