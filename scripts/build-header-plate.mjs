// scripts/build-header-plate.mjs
//
// One-time, offline. Turns the Figma full-frame export into the bundled plate.
//
// The export carries a site's screenshot and domain text baked in. The screen
// region needs no cleanup — compose.ts paints over it every run. The DOMAIN TEXT
// does: it is per-site, sits on textured paper, and a flat fill would read as a
// visible patch. So we copy a clean strip of paper from the right of the canvas
// (which is empty at that height) across the text.
//
// Usage: node scripts/build-header-plate.mjs <figma-export.png>
import sharp from "sharp";

const src = process.argv[2];
if (!src) throw new Error("usage: build-header-plate.mjs <figma-export.png>");
const OUT = "src/reports/header-image/assets/plate.png";

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
