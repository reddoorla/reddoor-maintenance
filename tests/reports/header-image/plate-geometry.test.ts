import { describe, it, expect } from "vitest";
import { measurePlateHole, readRaster } from "./plate-hole.js";
import { loadPlate } from "../../../src/reports/header-image/assets/index.js";
import { CANVAS, SCREEN } from "../../../src/reports/header-image/geometry.js";

/**
 * SCREEN vs the asset it describes.
 *
 * geometry.ts's numbers are a property of plate-clean.png, not of the code, and
 * that is exactly how they went wrong: #476 measured them against plate.png,
 * #570 re-exported the Figma frame as plate-clean.png with the laptop 7px right
 * and 26px up, and nothing re-measured. Every header generated between those two
 * PRs left rows 1887..1912 and columns 1651..1655 of the plate unpainted, so the
 * Alamo Anatomy homepage baked into the export — a green nav with a "Contact Us"
 * pill — showed across the top of all 13 maintained sites' header images, inside
 * client-facing maintenance reports.
 *
 * The old guard was a sentence in a comment naming a cross-check pixel ("the
 * photo-to-flat-black transition lands at y=2756"). A comment cannot fail, and
 * that one went on being quoted while being false of the shipped asset — it is
 * true of plate.png and 29 rows into the bezel on plate-clean.png. This test
 * re-derives the hole from the bundled bytes on every run, so replacing the
 * plate without re-measuring SCREEN is a red build rather than a silent leak
 * into a client's inbox.
 */
describe("reports/header-image plate geometry", () => {
  it("SCREEN is exactly the screen hole in the bundled plate", async () => {
    expect(await measurePlateHole()).toEqual({
      x: SCREEN.x,
      y: SCREEN.y,
      w: SCREEN.w,
      h: SCREEN.h,
    });
  });

  it("the plate is the canvas size the geometry assumes", async () => {
    const plate = await readRaster(await loadPlate());
    expect({ width: plate.width, height: plate.height }).toEqual({
      width: CANVAS.width,
      height: CANVAS.height,
    });
  });
});
