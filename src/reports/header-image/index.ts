import sharp from "sharp";
import { captureHomepage, type Shooter } from "./capture.js";
import { composeHeaderImage } from "./compose.js";
import { loadPlate } from "./assets/index.js";

export type GenerateInput = {
  /** The site's production URL. */
  url: string;
  /** Airtable site slug; drives the attachment filename. */
  slug?: string;
  /** Injected browser IO (tests). */
  shooter?: Shooter;
  /** Per-site settle override for animation-heavy or consent-gated homepages. */
  settleMs?: number;
};

export type GeneratedHeaderImage = {
  bytes: Uint8Array;
  /** The domain as printed on the plate. */
  domain: string;
  filename: string;
  contentType: "image/jpeg";
};

/** Strip scheme, leading www and any path — the plate prints a bare domain. */
export function domainFromUrl(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

/**
 * A capture is "blank" when it is almost entirely near-white — a consent gate,
 * a failed render (blank canvas), or a shot fired before first paint. The
 * operator reviews the rendered email before sending, so this is a backstop
 * rather than the only gate; its job is to stop an obviously broken shot from
 * replacing a good stored header.
 *
 * Uniformity alone is NOT the signal: a homepage with a large solid-colour
 * hero (any brand colour) is legitimately uniform but not blank. Only
 * near-white uniformity is flagged, since every real failure mode here
 * (consent overlay, unrendered canvas, pre-paint flash) lands on a white
 * background.
 */
async function assertNotBlank(shot: Uint8Array): Promise<void> {
  const { data, info } = await sharp(Buffer.from(shot))
    .resize(64, 40, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const total = info.width * info.height;
  const at = (i: number): number => data[i] ?? 0;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    sumR += at(i);
    sumG += at(i + 1);
    sumB += at(i + 2);
  }
  const meanR = sumR / total;
  const meanG = sumG / total;
  const meanB = sumB / total;

  let near = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (
      Math.abs(at(i) - meanR) < 8 &&
      Math.abs(at(i + 1) - meanG) < 8 &&
      Math.abs(at(i + 2) - meanB) < 8
    ) {
      near++;
    }
  }

  const uniform = near / total > 0.95;
  const nearWhite = meanR > 240 && meanG > 240 && meanB > 240;
  if (uniform && nearWhite) {
    throw new Error(
      "header-image: capture looks blank (near-white, >95% one colour) — keeping the existing header",
    );
  }
}

/** Capture a site's homepage and composite its header image. */
export async function generateHeaderImage(input: GenerateInput): Promise<GeneratedHeaderImage> {
  const screenshot = await captureHomepage(input.url, {
    ...(input.shooter !== undefined ? { shooter: input.shooter } : {}),
    ...(input.settleMs !== undefined ? { settleMs: input.settleMs } : {}),
  });
  await assertNotBlank(screenshot);

  const domain = domainFromUrl(input.url);
  const bytes = await composeHeaderImage({
    plate: await loadPlate(),
    screenshot,
    domain,
  });
  const base = input.slug ?? domain.split(".")[0];
  return { bytes, domain, filename: `${base}Header.jpg`, contentType: "image/jpeg" };
}
