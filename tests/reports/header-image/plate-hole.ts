import sharp from "sharp";
import { loadPlate } from "../../../src/reports/header-image/assets/index.js";

/**
 * Measure the laptop screen hole in the bundled plate, from the bundled bytes.
 *
 * Shared by the geometry guard (does SCREEN match the asset?) and the compose
 * leak test (is every pixel of the hole painted over?). Both need the hole
 * measured INDEPENDENTLY OF SCREEN — that is the whole point. A leak test that
 * sweeps SCREEN only ever asserts that the rect it painted is painted, which is
 * vacuously true for any SCREEN, correct or not.
 */

/** A pixel is bezel when it is flat black. The bezel is a solid 0-luminance
 *  frame in the export; the tolerance only absorbs PNG-level rounding. */
const BLACK_TOLERANCE = 8;

/** Consecutive black pixels required to call an edge. A RUN of 1 would stop on
 *  the first dark pixel of the screenshot itself — the plate's baked-in Alamo
 *  Anatomy nav is a dark green, and a site with a black header would end the
 *  walk immediately — so the walk demands a run only the bezel can supply. */
const BLACK_RUN = 6;

/** A point inside the laptop screen, written as a literal rather than derived
 *  from SCREEN. Deriving it would make the measurement depend on the very
 *  constant under test, and a wrong SCREEN would move the probe with it. */
export const PROBE = { x: 982, y: 2307 } as const;

export type Rect = { x: number; y: number; w: number; h: number };

export type Raster = {
  at(x: number, y: number): [number, number, number];
  width: number;
  height: number;
};

export async function readRaster(bytes: Uint8Array): Promise<Raster> {
  const { data, info } = await sharp(Buffer.from(bytes))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * info.width + x) * info.channels;
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
  };
  return { at, width: info.width, height: info.height };
}

export function isBezel(r: Raster, x: number, y: number): boolean {
  const [red, g, b] = r.at(x, y);
  return red <= BLACK_TOLERANCE && g <= BLACK_TOLERANCE && b <= BLACK_TOLERANCE;
}

/**
 * Walk from PROBE outward along one axis and return the last coordinate that
 * still carries content — the pixel just before the bezel's black run begins.
 * Content INCLUDES the anti-aliased blend pixel at the boundary, which is
 * exactly what the paste has to cover: that pixel is part baked screenshot, so
 * leaving it uncovered leaves a tinted line of the other site.
 */
function edge(r: Raster, dx: number, dy: number): number {
  let x = PROBE.x;
  let y = PROBE.y;
  for (let step = 0; step < 1200; step++) {
    let black = 0;
    for (let k = 0; k < BLACK_RUN; k++) {
      if (isBezel(r, x + dx * k, y + dy * k)) black++;
      else break;
    }
    if (black === BLACK_RUN) return dx !== 0 ? x - dx : y - dy;
    x += dx;
    y += dy;
  }
  throw new Error(`edge walk from (${PROBE.x},${PROBE.y}) along (${dx},${dy}) never reached bezel`);
}

/** The screen hole in the bundled plate, measured fresh from its bytes. */
export async function measurePlateHole(): Promise<Rect> {
  const plate = await readRaster(await loadPlate());
  if (isBezel(plate, PROBE.x, PROBE.y)) {
    throw new Error(
      `probe (${PROBE.x},${PROBE.y}) landed on bezel — the plate moved; re-site the probe inside the screen before trusting any measurement`,
    );
  }
  const left = edge(plate, -1, 0);
  const right = edge(plate, 1, 0);
  const top = edge(plate, 0, -1);
  const bottom = edge(plate, 0, 1);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}
