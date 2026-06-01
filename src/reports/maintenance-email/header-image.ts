import sharp from "sharp";

export type PreparedHeaderImage = {
  /** Resized JPEG bytes to attach inline (CID) in place of the Airtable original. */
  bytes: Uint8Array;
  /** Always "image/jpeg" — we re-encode for predictable size and a flat white background. */
  contentType: string;
  /** CSS display width in px (≤ requested, never wider than the source has pixels for). */
  displayWidth: number;
  /** CSS display height in px, source aspect ratio preserved (no distortion). */
  displayHeight: number;
  /** Dominant-color hex (e.g. "#cfc3a8"), used as the loading/blocked placeholder box. */
  placeholderColor: string;
};

export type PrepareHeaderImageOptions = {
  /** Intended CSS display width. The email body is 600px, so that's the default. */
  displayWidth?: number;
};

const DEFAULT_DISPLAY_WIDTH = 600;
/** Encode the source at 2× display width so it stays crisp on retina screens. */
const RETINA_SCALE = 2;
/** Quality is for *resized* pixels — at 1200px the texture/text read as sharp; bytes are tiny. */
const JPEG_QUALITY = 82;

function channelToHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

/**
 * Downscale an oversized header image for email: 2× the display width (retina) at most,
 * never upscaled, re-encoded as JPEG on a flat white background. Also reports the display
 * dimensions (so the template can reserve the box and stop reflow) and a dominant color
 * (so the reserved box shows a matched placeholder while the image loads).
 *
 * Root cause this addresses: Airtable headers can be multi-MB / 2400px+ while the email
 * renders them at ~600px — shipping ~16× more pixels than the display can use.
 */
export async function prepareHeaderImage(
  bytes: Uint8Array,
  options: PrepareHeaderImageOptions = {},
): Promise<PreparedHeaderImage> {
  const requestedDisplayWidth = options.displayWidth ?? DEFAULT_DISPLAY_WIDTH;
  const input = Buffer.from(bytes);

  const meta = await sharp(input).metadata();
  const origWidth = meta.width;
  const origHeight = meta.height;
  if (!origWidth || !origHeight) {
    throw new Error("prepareHeaderImage: could not read source image dimensions");
  }

  // Never claim a wider display than the source can fill at 1×.
  const displayWidth = Math.min(requestedDisplayWidth, origWidth);
  const displayHeight = Math.round((displayWidth * origHeight) / origWidth);

  // Encode at 2× display for retina, but never enlarge a smaller original.
  const targetSourceWidth = Math.min(origWidth, displayWidth * RETINA_SCALE);

  const out = await sharp(input)
    .resize({ width: targetSourceWidth, withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const { dominant } = await sharp(out).stats();
  const placeholderColor = `#${channelToHex(dominant.r)}${channelToHex(dominant.g)}${channelToHex(dominant.b)}`;

  return {
    bytes: new Uint8Array(out),
    contentType: "image/jpeg",
    displayWidth,
    displayHeight,
    placeholderColor,
  };
}
