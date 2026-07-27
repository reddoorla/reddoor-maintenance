import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitFrozen } from "../../../src/blux/freeze/index.js";
import type { FrozenResult } from "../../../src/blux/freeze/types.js";

// emitFrozen's frozen/ dir is site-repo-ready: uid-keyed filenames matching
// the starter's artifact globs (frozen/<uid>.{html,style.css,fonts.json}
// [+ .map.json]), while the slots manifest stays site-keyed for migrate-frozen.
const base: FrozenResult = {
  manifest: {
    site: "the-pointe",
    uid: "home",
    title: "T",
    fontLinks: ["https://fonts.googleapis.com/css?family=X"],
    slots: [],
  },
  templateHtml: `<div id="burbank_map"></div>`,
  styleCss: ".x{}",
};

describe("emitFrozen", () => {
  it("emits uid-keyed template/style/fonts + site-keyed slots manifest", async () => {
    const out = mkdtempSync(join(tmpdir(), "emit-"));
    const paths = await emitFrozen(out, base);

    expect(paths.template).toBe(join(out, "frozen", "home.html"));
    expect(paths.style).toBe(join(out, "frozen", "home.style.css"));
    expect(paths.fonts).toBe(join(out, "frozen", "home.fonts.json"));
    expect(paths.manifest).toBe(join(out, "the-pointe.slots.json"));
    expect(paths.map).toBeUndefined();

    // fonts.json is the starter's expected shape: a plain array of hrefs.
    expect(JSON.parse(readFileSync(paths.fonts, "utf-8"))).toEqual(base.manifest.fontLinks);
    expect(existsSync(join(out, "frozen", "home.map.json"))).toBe(false);
  });

  it("emits <uid>.map.json when the freeze carried a map config", async () => {
    const out = mkdtempSync(join(tmpdir(), "emit-"));
    const mapConfig = {
      mountId: "burbank_map",
      mid: "1KwcmcAbc-9",
      layers: [{ name: "Hotels", lid: "L1", initiallyVisible: true, preserveViewport: false }],
      toggles: [],
      styles: [],
    };
    const paths = await emitFrozen(out, { ...base, mapConfig });

    expect(paths.map).toBe(join(out, "frozen", "home.map.json"));
    expect(JSON.parse(readFileSync(paths.map!, "utf-8"))).toEqual(mapConfig);
  });
});
