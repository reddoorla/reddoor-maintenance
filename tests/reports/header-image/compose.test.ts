import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { composeHeaderImage, stampHeadline } from "../../../src/reports/header-image/compose.js";
import { loadPlate, loadHeadline } from "../../../src/reports/header-image/assets/index.js";
import { SCREEN, CANVAS, HEADLINE } from "../../../src/reports/header-image/geometry.js";

/** A solid-colour stand-in for a homepage screenshot. */
async function fakeShot(color: string, w = 1600, h = 1000): Promise<Uint8Array> {
  const png = await sharp({
    create: { width: w, height: h, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

/** Read one pixel as [r, g, b]. Coordinates are floored so callers can pass a
 *  midpoint expression (e.g. `SCREEN.w / 2`, which is fractional since
 *  SCREEN.w is odd) without landing on a non-integer, silently-`undefined`
 *  typed-array index. */
async function rgb(bytes: Uint8Array, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(Buffer.from(bytes))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const i = (yi * info.width + xi) * info.channels;
  const byte = (offset: number): number => {
    const v = data[i + offset];
    if (v === undefined) {
      throw new Error(`pixel read out of bounds at x=${xi} y=${yi} (offset ${offset})`);
    }
    return v;
  };
  return [byte(0), byte(1), byte(2)];
}

/**
 * Assert the pixel at (x, y) is within `tolerance` levels per channel of a
 * #rrggbb color.
 *
 * The compose output is always JPEG (asserted separately), and JPEG's DCT
 * quantization nudges even a solid fill by a level or two on re-encode —
 * confirmed empirically against the real plate (e.g. a painted "#ff0000"
 * comes back "#fe0000"). A strict string/equality check is therefore too
 * tight for anything read off a JPEG; it would fail on lossy rounding noise
 * that has nothing to do with correctness. A real defect — the wrong region
 * painted, a leak, a missed composite — moves a channel by tens or hundreds
 * of levels, far outside this tolerance.
 */
async function expectColorNear(
  bytes: Uint8Array,
  x: number,
  y: number,
  hex: string,
  tolerance = 6,
): Promise<void> {
  const [gotR, gotG, gotB] = await rgb(bytes, x, y);
  const wantR = parseInt(hex.slice(1, 3), 16);
  const wantG = parseInt(hex.slice(3, 5), 16);
  const wantB = parseInt(hex.slice(5, 7), 16);
  expect(Math.abs(gotR - wantR)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(gotG - wantG)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(gotB - wantB)).toBeLessThanOrEqual(tolerance);
}

describe("reports/header-image compose", () => {
  it("returns a JPEG at the plate's dimensions", async () => {
    const out = await composeHeaderImage({
      plate: await loadPlate(),
      screenshot: await fakeShot("#ff0000"),
      domain: "acme.com",
    });
    const meta = await sharp(Buffer.from(out)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(CANVAS.width);
    expect(meta.height).toBe(CANVAS.height);
  });

  it("paints the screenshot into the screen rect", async () => {
    const out = await composeHeaderImage({
      plate: await loadPlate(),
      screenshot: await fakeShot("#ff0000"),
      domain: "acme.com",
    });
    await expectColorNear(out, SCREEN.x + SCREEN.w / 2, SCREEN.y + SCREEN.h / 2, "#ff0000");
  });

  it("leaves the plate outside the screen rect untouched", async () => {
    const plate = await loadPlate();
    const out = await composeHeaderImage({
      plate,
      screenshot: await fakeShot("#ff0000"),
      domain: "acme.com",
    });
    // 40px left of the screen is laptop chassis / paper — never the screenshot.
    // Compare against the source PNG's own value at that point (not a fixed
    // hex) since compositing must not touch it at all, whatever it is.
    const before = await rgb(plate, SCREEN.x - 40, SCREEN.y + 100);
    const beforeHex = "#" + before.map((v) => v.toString(16).padStart(2, "0")).join("");
    await expectColorNear(out, SCREEN.x - 40, SCREEN.y + 100, beforeHex);
  });

  it("crops a tall screenshot from the top rather than distorting it", async () => {
    // A 1600x4000 shot: cover-from-top keeps the header band, drops the fold.
    const tall = await sharp({
      create: { width: 1600, height: 4000, channels: 3, background: "#0000ff" },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 1600, height: 200, channels: 3, background: "#00ff00" },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const out = await composeHeaderImage({
      plate: await loadPlate(),
      screenshot: new Uint8Array(tall),
      domain: "acme.com",
    });
    // The green top band must survive at the top of the screen rect.
    await expectColorNear(out, SCREEN.x + SCREEN.w / 2, SCREEN.y + 10, "#00ff00");
  });

  it("draws the domain text", async () => {
    const plain = await composeHeaderImage({
      plate: await loadPlate(),
      screenshot: await fakeShot("#ff0000"),
      domain: "",
    });
    const withText = await composeHeaderImage({
      plate: await loadPlate(),
      screenshot: await fakeShot("#ff0000"),
      domain: "averylongdomainname.com",
    });
    expect(Buffer.from(withText).equals(Buffer.from(plain))).toBe(false);
  });

  it("composes on the CLEAN plate — no headline ink before stamping", async () => {
    const out = await composeHeaderImage({
      plate: await loadPlate(),
      screenshot: await fakeShot("#00ff00"),
      domain: "acme.com",
    });
    expect(await headlineInk(out)).toBe(0);
  });

  it("escapes XML metacharacters in the domain", async () => {
    // The domain is interpolated into an SVG; a raw & would produce invalid XML
    // and sharp would throw.
    await expect(
      composeHeaderImage({
        plate: await loadPlate(),
        screenshot: await fakeShot("#ff0000"),
        domain: 'a&b<c>"d".com',
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});

/** Count headline-red pixels inside the HEADLINE ink box (asset is 1328x660).
 *  Measured on the references: 0 on the clean plate, ~62k on the baked
 *  maintenance plate — a stamping defect (missing, misplaced, wrong layer
 *  order) moves this by tens of thousands, far outside JPEG noise. */
async function headlineInk(bytes: Uint8Array): Promise<number> {
  const { data, info } = await sharp(Buffer.from(bytes))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let y = HEADLINE.y; y < HEADLINE.y + 660; y++) {
    for (let x = HEADLINE.x; x < HEADLINE.x + 1328; x++) {
      const i = (y * info.width + x) * info.channels;
      const [r, g, b] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      if (r > 160 && g < 90 && b < 100) n++;
    }
  }
  return n;
}

describe("reports/header-image stampHeadline", () => {
  it("paints the maintenance headline into the measured box", async () => {
    const clean = await composeHeaderImage({
      plate: await loadPlate(),
      screenshot: await fakeShot("#00ff00"),
      domain: "acme.com",
    });
    const stamped = await stampHeadline(clean, await loadHeadline("Maintenance"));
    expect(await headlineInk(stamped)).toBeGreaterThan(40_000);
    // Stamping must not disturb the screen rect below it.
    await expectColorNear(stamped, SCREEN.x + SCREEN.w / 2, SCREEN.y + SCREEN.h / 2, "#00ff00");
  });

  it("rejects a header that is not canvas-sized (legacy hand-made headers)", async () => {
    const small = await sharp({
      create: { width: 600, height: 800, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();
    await expect(
      stampHeadline(new Uint8Array(small), await loadHeadline("Maintenance")),
    ).rejects.toThrow(/600x800/);
  });
});
