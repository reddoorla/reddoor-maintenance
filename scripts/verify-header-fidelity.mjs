#!/usr/bin/env node
// Fidelity acceptance for the generated report header image.
//
// Regenerates a site's header from its LIVE homepage and diffs it against a
// hand-made original. Everything OUTSIDE the laptop screen and the domain text
// band must match — that is what proves the plate asset and the measured
// geometry are faithful. If the domain wipe bled onto the paper, or the screen
// rect were a few pixels off, the difference lands outside the exclusion bands
// and this fails.
//
// This is a script and not a unit test because it needs a real browser and the
// network.
//
// ---------------------------------------------------------------------------
// WHICH ORIGINALS ARE VALID REFERENCES  (census, 2026-07-31, all 10 Airtable
// headers; do not re-derive this)
//
// The plate is built by scripts/build-header-plate.mjs from the LIVE Figma
// frame export (node-id=158-10) — verified byte-identical to that export
// everywhere outside the domain wipe rect. It is NOT derived from any site's
// header, so a reference that agrees with it is independent evidence.
//
// The hand-made headers span TWO TEMPLATE GENERATIONS. The stationery is
// identical in all ten (headline and logo bands match the plate exactly, mean
// abs diff 0.56 and 1.51 across the board) — only the laptop mockup moved:
//
//   Generation A — laptop at the plate's placement (best offset dy=0 dx=0):
//     CalTex, DataDynamiq, ERPfunds          ← THE VALID REFERENCES
//   Generation B — laptop 28px higher, 3px right (best offset dy=-28 dx=3):
//     Espada, LAHomeless, MSOT, Reddoor, Revogen, Sonder, Vineyard
//
// Generation A files were hand-made at different times for different clients
// and all three agree with the plate at dy=0, so they cross-validate the
// geometry rather than confirming it circularly. Generation B files CANNOT
// pass and are not evidence of a broken plate — see the FAIL hint below.
// ---------------------------------------------------------------------------
//
// Usage: node scripts/verify-header-fidelity.mjs <original.jpg> <url> [--out <path>]

import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { generateHeaderImage } from "../dist/index.js";

const USAGE = "usage: verify-header-fidelity.mjs <original.jpg> <url> [--out <path>]";

// Positional <original> <url>, plus an optional `--out <path>` to dump the
// generated image for eyeballing (invaluable when this fails).
function parseArgs(argv) {
  const positional = [];
  let out;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      out = argv[++i];
      if (!out) throw new Error(`--out needs a path\n${USAGE}`);
    } else {
      positional.push(argv[i]);
    }
  }
  const [original, url] = positional;
  if (!original || !url) throw new Error(USAGE);
  return { original, url, out };
}

const { original, url, out } = parseArgs(process.argv.slice(2));

// Mirrors src/reports/header-image/geometry.ts. The domain band is deliberately
// wider and taller than the printed text: the hand-made originals used a
// slightly different rasteriser, so the glyph edges never match byte-for-byte
// and the band must clear their full ink extent.
const SCREEN = { x: 302, y: 1913, w: 1349, h: 844 };
const DOMAIN_BAND = { x0: 250, x1: 1300, y0: 2920, y1: 3080 };

// Per-pixel tolerance (channel-sum) and the share of pixels allowed to exceed
// it. Both were measured, not guessed — a tolerance sweep of the plate's own
// JPEG against the untouched generation-A references:
//
//   tolerance      12       24       36       48       64
//   gen-A       1.545%   0.688%   0.341%   0.154%   0.052%   (worst delta 135)
//   gen-B       6.104%   4.268%   3.773%   3.579%   3.434%   (worst delta 753)
//
// At tolerance 48 the encoder noise on the antialiased stationery text floors
// at 0.154% while a one-generation laptop displacement sits at 3.1–3.6%, so a
// 0.5% area gate clears the noise by 3.2x and catches a real geometry error by
// 6x. At tolerance 24 the two populations are only 6x apart and the gate needs
// an artificial re-encode of the reference to pass at all.
const TOLERANCE = 48;
const MAX_DIFFERING_PCT = 0.5;

console.log(`original:  ${original}`);
console.log(`url:       ${url}`);

const gen = await generateHeaderImage({ url });
if (out) {
  await writeFile(out, Buffer.from(gen.bytes));
  console.log(`wrote generated image → ${out}`);
}

// The reference is decoded straight from disk — NOT re-encoded first. Pushing
// it through an extra JPEG pass matches our own encoder's quantisation and so
// hides real difference; comparing the pipeline's output against the untouched
// reference is the honest test.
const rawFile = async (p) => sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const rawBytes = async (b) =>
  sharp(Buffer.from(b)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const a = await rawFile(original);
const c = await rawBytes(gen.bytes);

// Both guards below protect the same thing: the comparison indexes both buffers
// with ONE flat offset, so any disagreement in shape silently compares
// misaligned pixels and reports a meaningless number. Fail loudly instead.
if (a.info.width !== c.info.width || a.info.height !== c.info.height) {
  throw new Error(
    `dimension mismatch — original is ${a.info.width}x${a.info.height}, ` +
      `generated is ${c.info.width}x${c.info.height}. The comparison is only ` +
      `meaningful at identical size; check the plate asset and the capture size.`,
  );
}
if (a.info.channels !== c.info.channels) {
  throw new Error(
    `channel mismatch — original has ${a.info.channels} channels, ` +
      `generated has ${c.info.channels}. Both must be RGB after removeAlpha().`,
  );
}

const inScreen = (x, y) =>
  x >= SCREEN.x && x < SCREEN.x + SCREEN.w && y >= SCREEN.y && y < SCREEN.y + SCREEN.h;
const inDomain = (x, y) =>
  x >= DOMAIN_BAND.x0 && x <= DOMAIN_BAND.x1 && y >= DOMAIN_BAND.y0 && y <= DOMAIN_BAND.y1;

let compared = 0;
let differing = 0;
let worst = 0;
// Bounding box of the differing pixels. A bare percentage is not actionable —
// WHERE the differences sit names the broken layer: hugging the screen edge
// means the screen rect is off by a few px; scattered across the paper means the
// plate itself is wrong.
let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;

for (let y = 0; y < a.info.height; y++) {
  for (let x = 0; x < a.info.width; x++) {
    if (inScreen(x, y) || inDomain(x, y)) continue;
    const i = (y * a.info.width + x) * a.info.channels;
    const d =
      Math.abs(a.data[i] - c.data[i]) +
      Math.abs(a.data[i + 1] - c.data[i + 1]) +
      Math.abs(a.data[i + 2] - c.data[i + 2]);
    compared++;
    if (d > worst) worst = d;
    if (d > TOLERANCE) {
      differing++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

const pct = (100 * differing) / compared;
console.log(`compared ${compared} px outside screen + domain`);
console.log(`differing: ${differing} (${pct.toFixed(3)}%)  worst channel-sum delta: ${worst}`);
if (differing > 0) {
  console.log(
    `differing bbox: x ${minX}..${maxX} (w ${maxX - minX + 1}), ` +
      `y ${minY}..${maxY} (h ${maxY - minY + 1})`,
  );
  console.log(
    `  screen rect is x ${SCREEN.x}..${SCREEN.x + SCREEN.w - 1}, ` +
      `y ${SCREEN.y}..${SCREEN.y + SCREEN.h - 1} — differences hugging it mean the rect is off; ` +
      `differences elsewhere mean the plate itself is wrong.`,
  );
}
const pass = pct < MAX_DIFFERING_PCT;
console.log(pass ? "PASS — plate is faithful" : "FAIL — plate or geometry is off");

// A caller who reached for a generation-B header sees a FAIL that looks like a
// broken plate but is not one. That failure has a distinctive shape: the whole
// laptop is displaced, so the differing pixels span most of the canvas, and the
// magnitude lands in a narrow band well above the noise floor and well below a
// wholesale mismatch. Name the likely cause rather than sending someone off to
// re-measure a plate that is fine. The exit code is unchanged — this reference
// genuinely cannot pass, and silence would be worse.
const spansCanvas = maxX - minX + 1 >= a.info.width * 0.5 && maxY - minY + 1 >= a.info.height * 0.5;
if (!pass && spansCanvas && pct >= 2.5 && pct <= 5) {
  console.log("");
  console.log("  HINT — this looks like the OLDER TEMPLATE GENERATION, not a broken plate.");
  console.log("  The hand-made headers span two generations with identical stationery but a");
  console.log("  laptop mockup placed 28px higher and 3px right in the older one. Diffing");
  console.log("  against one of those can never pass, and says nothing about the plate.");
  console.log("  Generation B (cannot be used as a reference):");
  console.log("    Espada, LAHomeless, MSOT, Reddoor, Revogen, Sonder, Vineyard");
  console.log("  Re-run against a generation-A reference instead:");
  console.log("    CalTex, DataDynamiq, ERPfunds");
  console.log("  If one of THOSE fails, the plate or the geometry really is off.");
}

process.exit(pass ? 0 : 1);
