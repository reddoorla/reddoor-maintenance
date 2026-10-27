import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { prepareHeaderImage } from "../../src/reports/maintenance-email/header-image.js";

/** A large, noisy (incompressible) JPEG so resize meaningfully cuts bytes. */
async function bigJpeg(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
      noise: { type: "gaussian", mean: 128, sigma: 40 },
    },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
  return new Uint8Array(buf);
}

describe("prepareHeaderImage", () => {
  it("downscales an oversized header and reports display dims with source aspect preserved", async () => {
    const original = await bigJpeg(2400, 3200); // ERP-shaped 3:4 portrait
    const out = await prepareHeaderImage(original, { displayWidth: 600 });

    // Bytes shrink substantially (16x fewer pixels at the same quality).
    expect(out.bytes.length).toBeLessThan(original.length);

    // Display dims: 600 wide, aspect preserved -> 800 tall.
    expect(out.displayWidth).toBe(600);
    expect(out.displayHeight).toBe(800);
    expect(out.contentType).toBe("image/jpeg");

    // Encoded source is capped at 2x display (1200px) for retina, aspect kept.
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(1600);
  });

  it("returns a valid hex placeholder color", async () => {
    const out = await prepareHeaderImage(await bigJpeg(1200, 800), { displayWidth: 600 });
    expect(out.placeholderColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("never upscales a source smaller than the target", async () => {
    const small = await bigJpeg(300, 400);
    const out = await prepareHeaderImage(small, { displayWidth: 600 });

    // Display width clamps to the source width; aspect preserved.
    expect(out.displayWidth).toBe(300);
    expect(out.displayHeight).toBe(400);

    // Source is not enlarged beyond its original width.
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.width).toBe(300);
  });

  it("defaults displayWidth to 600 when not provided", async () => {
    const out = await prepareHeaderImage(await bigJpeg(2400, 3200));
    expect(out.displayWidth).toBe(600);
    expect(out.displayHeight).toBe(800);
  });
});
