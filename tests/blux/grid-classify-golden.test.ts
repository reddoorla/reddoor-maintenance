import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGridBands } from "../../src/blux/grid/index.js";
import { classifyBands } from "../../src/blux/grid/classify-band.js";
import type { SliceSpec } from "../../src/blux/grid/slice-spec.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/the-pointe-page-content.html", import.meta.url));

/** One compact, human-readable line per slice. */
function summary(s: SliceSpec): string {
  const bg = s.background ? "(bg)" : "";
  switch (s.slice) {
    case "Hero":
      return `${s.index}${bg} Hero heading=${JSON.stringify(s.heading ?? "")}`;
    case "TitleBand":
      return `${s.index}${bg} TitleBand heading=${JSON.stringify(s.heading)}`;
    case "SplitFeature":
      return `${s.index}${bg} SplitFeature ${s.mediaSide} r${s.ratio}`;
    case "Gallery":
      return `${s.index}${bg} Gallery n=${s.media.length}`;
    case "Carousel":
      return `${s.index}${bg} Carousel(${s.slides.length}${s.columns ? `,cols:${s.columns}` : ""})`;
    case "MediaFull":
      return `${s.index}${bg} MediaFull ${s.media.kind}`;
    case "RichText":
      return `${s.index}${bg} RichText`;
    case "VideoFeature":
      return `${s.index}${bg} VideoFeature`;
    case "LocationMap":
      return `${s.index}${bg} LocationMap`;
    case "Grid":
      return `${s.index}${bg} Grid`;
  }
}

describe("classify golden (the-pointe)", () => {
  it("classifies the 16 bands to a stable set of slices", () => {
    const bands = parseGridBands(readFileSync(FIXTURE, "utf-8"));
    const lines = classifyBands(bands).map(summary);
    expect(lines).toMatchSnapshot();
  });
});
