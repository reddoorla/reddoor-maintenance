import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import { CANVAS, SCREEN, DOMAIN, PAPER } from "./geometry.js";

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

/** The domain line as a transparent SVG overlay the size of the full canvas, so
 *  it can be composited at 0,0 and positioned by its own coordinates. */
function domainSvg(domain: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}">
       <text x="${DOMAIN.x}" y="${DOMAIN.baseline}"
             font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
             font-size="${DOMAIN.size}" font-weight="300"
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
