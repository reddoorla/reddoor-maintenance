import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import {
  CANVAS,
  SCREEN,
  DOMAIN,
  PAPER,
  HEADLINE,
  HEADLINE_BAND,
  HEADLINE_INK,
} from "./geometry.js";

export type ComposeInput = {
  /** The bundled 2400x3200 plate. */
  plate: Uint8Array;
  /** A homepage screenshot, any size. Cropped to fill the screen rect. */
  screenshot: Uint8Array;
  /** The site's public domain, drawn bottom-left (e.g. "gallerysonder.com"). */
  domain: string;
};

/** JPEG quality. The hand-made headers are ~2.4MB; 88 lands near 0.7MB with no
 *  visible difference at the 600px the email actually renders. */
const JPEG_QUALITY = 88;

/** Escape the five XML metacharacters. The domain is interpolated into an SVG,
 *  and a bare `&` yields invalid XML that sharp rejects outright. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * The domain line as a transparent SVG overlay the size of the full canvas, so
 * it can be composited at 0,0 and positioned by its own coordinates.
 *
 * ⚠️ FONT AVAILABILITY IS ENVIRONMENT-DEPENDENT. sharp renders SVG through
 * librsvg + fontconfig, so the family below resolves against INSTALLED fonts.
 * On macOS it resolves to real Helvetica Neue, which reproduces the hand-made
 * reference exactly (verified: ink box dx=0 dy=0 dw=0 dh=0). A stock
 * ubuntu-latest runner has none of Helvetica Neue / Helvetica / Arial, so it
 * falls through to `sans-serif` — typically DejaVu Sans, which is wider and
 * would render a visibly different domain line.
 *
 * This matters because report drafting (which regenerates the header) runs on
 * ubuntu-latest in `.github/workflows/daily-reports.yml`. That workflow now
 * installs `fonts-urw-base35`, which provides Nimbus Sans — metrically
 * equivalent to Helvetica and third in the stack below — so a CI-generated
 * header's domain line matches a locally-generated one. Any OTHER environment
 * that runs this code still needs a Helvetica-metric font installed.
 */
function domainSvg(domain: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}">
       <text x="${DOMAIN.x}" y="${DOMAIN.baseline}"
             font-family="Helvetica Neue, Helvetica, Nimbus Sans, Arial, sans-serif"
             font-size="${DOMAIN.size}" font-weight="${DOMAIN.weight}"
             fill="${DOMAIN.color}">${escapeXml(domain)}</text>
     </svg>`,
    "utf-8",
  );
}

/**
 * Composite one site's header image: paste its homepage screenshot into the
 * plate's laptop screen and draw its domain underneath.
 *
 * PURE — no browser, no network, no filesystem. Fidelity lives here, so it must
 * be verifiable in a unit test.
 *
 * The screenshot is cropped to FILL the 16:10 screen from the top: a taller
 * homepage loses its fold rather than being squashed, which would be obvious
 * and wrong. `flatten` guards against a transparent source punching a hole in
 * the plate.
 */
export async function composeHeaderImage(input: ComposeInput): Promise<Uint8Array> {
  const screen = await sharp(Buffer.from(input.screenshot))
    .resize(SCREEN.w, SCREEN.h, { fit: "cover", position: "top" })
    .flatten({ background: PAPER })
    .toBuffer();

  const layers: OverlayOptions[] = [{ input: screen, left: SCREEN.x, top: SCREEN.y }];
  if (input.domain.trim().length > 0) {
    layers.push({ input: domainSvg(input.domain), left: 0, top: 0 });
  }

  const out = await sharp(Buffer.from(input.plate))
    .composite(layers)
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return new Uint8Array(out);
}

/**
 * Count headline-red pixels already present in the headline band.
 *
 * A header composed on the clean plate has EXACTLY ZERO (measured), because the
 * band sits between the logo and the laptop and nothing else paints there. A
 * header built on the old baked plate has ~62,000 — its headline is part of the
 * image. That gap is what lets {@link stampHeadline}'s caller refuse to print a
 * second headline over the first. PURE.
 */
export async function headlineInkCount(header: Uint8Array): Promise<number> {
  const { data, info } = await sharp(Buffer.from(header))
    .extract({
      left: HEADLINE_BAND.x,
      top: HEADLINE_BAND.y,
      width: HEADLINE_BAND.w,
      height: HEADLINE_BAND.h,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    // Generous band around the brand red rather than an exact match: the stored
    // header is a JPEG, so its ink has been through lossy re-encoding.
    if (r > HEADLINE_INK.r - 60 && g < HEADLINE_INK.g + 60 && b < HEADLINE_INK.b + 60) n++;
  }
  return n;
}

/**
 * Stamp a report-type headline overlay onto a finished (clean-plate) header at
 * the measured HEADLINE origin. PURE and strict: the header must be exactly
 * CANVAS-sized — a legacy hand-made header at other dimensions would misplace
 * the text, so the caller (applyReportTypeHeadline) size-guards and skips
 * instead of calling in. One extra JPEG generation at quality 88 is invisible
 * at the email's 600px display size.
 */
export async function stampHeadline(header: Uint8Array, headline: Uint8Array): Promise<Uint8Array> {
  const meta = await sharp(Buffer.from(header)).metadata();
  if (meta.width !== CANVAS.width || meta.height !== CANVAS.height) {
    throw new Error(
      `stampHeadline: header is ${meta.width}x${meta.height}, expected ${CANVAS.width}x${CANVAS.height}`,
    );
  }
  const out = await sharp(Buffer.from(header))
    .composite([{ input: Buffer.from(headline), left: HEADLINE.x, top: HEADLINE.y }])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return new Uint8Array(out);
}
