# Blux Grid — Plan 4: extract-map + real isMapMount + LocationMap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The map leg of the faithful-grid pipeline: deterministically extract the Google Maps config from a Blux export's rendered `index.html` (`extract-map.ts`), supply the real `isMapMount` predicate to the plan-2 classifier, and render the map in the-pointe (`LocationMap.svelte` + `location_map` slice).

**Architecture:** Part A (this repo, `src/blux/grid/`): `extractMapConfig(html) → MapConfig | null` parses the inline `initMap` script (mount id, My-Maps `mid`, 8 `KmlLayer` entries with visibility flags, muted-greyscale `styles` JSON, center/zoom) plus the toggle-chip labels and the `clickMap` group script; `makeIsMapMount(config)` turns the mount id into the classifier predicate; the `blux grid` CLI action additionally writes `map-config.json`. Part B (the-pointe clone): `BandPresentation` gains an optional `map` payload; `LocationMap.svelte` loads the Maps JS API with `VITE_GOOGLE_MAPS_KEY`, recreates the layers/toggles with the original clickMap semantics (radio chips; the portfolio layer never turns off; initial framing comes from the KML bounds because the initially-visible layer has `preserveViewport` false); a thin `location_map` slice anchors it. Plan 5's emit writes the `map` payload into the manifest — the render contract defined here is authoritative.

**Tech Stack:** Part A: TypeScript (NodeNext, `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — guard `arr[i]`/regex groups, conditional-spread optional fields), vitest under `tests/blux/`, fixtures under `tests/blux/fixtures/` (already `.prettierignore`d via `tests/blux/fixtures/*.html`). Gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:dist`. Part B: Svelte 5 + vitest/@testing-library, gate `pnpm lint` / `check` / `test` / `build`.

**Verified source facts (from `~/Desktop/thePointe/index.html`; sanitized fixture `tests/blux/fixtures/the-pointe-map-band.html` is ALREADY COMMITTED with this plan — do not re-derive it):**

- The map band is `page-block-14` → `<div id="custom-element0" data-exec="…"><div id="burbank_map" style="height:600px">map loading...</div>` + 4 `map_icon` chips (`map_icon_text` labels: "The Burbank Portfolio", "Studio And Offices", "Retail And Dining", "Hotel And Services") + the inline `initMap` `<script>` — all inside the band.
- `initMap` creates `google.maps.Map(document.getElementById("burbank_map"), { center:{lat:-34.397,lng:150.644}, zoom:8, styles:[…28 style rules…] })` (center/zoom are Google-boilerplate placeholders).
- `mapLayers` = 8 named `KmlLayer`s sharing `mid=1KwcmcCf1kd-8jN7lLt36kQ9lFjLab0bz`: Hotels `8rJ0fKhImbs`, Food_And_Drink `dqcWdasb9-8`, Retail `58NHVxQwLlc`, Services `Sv_E02Q8vjc`, Entertainment `5Exqy6xPvW4`, Office_Tenants `Xf3l8pFzy4s`, Studios `avheVKZTvpo` — all `preserveViewport:true, map:null` — and The_Burbank_Portfolio `lq--xeECBoM` with `map:map` and NO preserveViewport (defaults false → the map frames itself to this layer's KML bounds; this resolves the spec's placeholder-center risk).
- The toggle logic lives in a separate site script: `clickMap={0:…portfolio (its "off" still keeps it on the map)…,1:Studios+Office_Tenants,2:Food_And_Drink+Retail+Entertainment,3:Hotels+Services}`, driven radio-style (`clickMap[lastIndex]("off"); clickMap[i]("on")`). The fixture appends this assignment as its own `<script>`.
- The Google API key appears ONLY in the separate loader URL (`maps.googleapis.com/maps/api/js?key=…&callback=initMap`) — it is NOT in the fixture and must never be committed. the-pointe already has `VITE_GOOGLE_MAPS_KEY` on Netlify (all contexts).
- The committed page-content fixture (`the-pointe-page-content.html`) retains the band-14 mount markup (`custom-element0` + `burbank_map`, scripts stripped) — the classifier integration test works against it unchanged.
- Parser reality: map mounts parse to `{ kind: "raw", html }` nodes (types.ts:9-11); `ClassifyOptions.isMapMount?: (node: Node) => boolean` is applied via `rewriteMapMounts` (whole-node replacement with `{kind:"widget",widget:{type:"map"}}`); a band whose sole significant node is a map widget classifies as `LocationMapSpec` (`{ slice: "LocationMap"; index; background? }`).

---

## Part A — reddoor-maintenance (worktree `feat/blux-extract-map`, already created, deps installed, fixture committed with this plan doc)

### File structure

- Create: `src/blux/grid/extract-map.ts` (+ export from `src/blux/grid/index.ts`)
- Modify: `src/cli/commands/blux.ts` (grid action writes `map-config.json`)
- Test: `tests/blux/grid-extract-map.test.ts`, extend `tests/blux/grid-classify-golden.test.ts` area with a new `tests/blux/grid-classify-map.test.ts`
- Changeset: `.changeset/<name>.md` (minor, package `reddoor-maintenance` — copy the shape of any recent changeset)

### Task A1: `extractMapConfig`

- [ ] **Step 1: failing test** `tests/blux/grid-extract-map.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractMapConfig } from "../../src/blux/grid/extract-map.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/the-pointe-map-band.html", import.meta.url));
const html = readFileSync(FIXTURE, "utf-8");

describe("extractMapConfig", () => {
  it("returns null for HTML without an initMap script", () => {
    expect(extractMapConfig("<html><body><p>hi</p></body></html>")).toBeNull();
  });

  it("extracts mount, mid, layers, styles, center and zoom from the-pointe band", () => {
    const cfg = extractMapConfig(html);
    expect(cfg).not.toBeNull();
    expect(cfg?.mountId).toBe("burbank_map");
    expect(cfg?.mid).toBe("1KwcmcCf1kd-8jN7lLt36kQ9lFjLab0bz");
    expect(cfg?.layers).toHaveLength(8);
    expect(cfg?.layers.map((l) => l.name)).toEqual([
      "Hotels",
      "Food_And_Drink",
      "Retail",
      "Services",
      "Entertainment",
      "Office_Tenants",
      "Studios",
      "The_Burbank_Portfolio",
    ]);
    const portfolio = cfg?.layers.find((l) => l.name === "The_Burbank_Portfolio");
    expect(portfolio?.lid).toBe("lq--xeECBoM");
    expect(portfolio?.initiallyVisible).toBe(true);
    expect(portfolio?.preserveViewport).toBe(false);
    const hotels = cfg?.layers.find((l) => l.name === "Hotels");
    expect(hotels?.lid).toBe("8rJ0fKhImbs");
    expect(hotels?.initiallyVisible).toBe(false);
    expect(hotels?.preserveViewport).toBe(true);
    expect(Array.isArray(cfg?.styles)).toBe(true);
    expect((cfg?.styles as unknown[]).length).toBeGreaterThan(20);
    expect(cfg?.center).toEqual({ lat: -34.397, lng: 150.644 });
    expect(cfg?.zoom).toBe(8);
  });

  it("extracts the four toggle groups pairing chip labels with clickMap layer sets", () => {
    const cfg = extractMapConfig(html);
    expect(cfg?.toggles).toEqual([
      { label: "The Burbank Portfolio", layers: ["The_Burbank_Portfolio"] },
      { label: "Studio And Offices", layers: ["Studios", "Office_Tenants"] },
      { label: "Retail And Dining", layers: ["Food_And_Drink", "Retail", "Entertainment"] },
      { label: "Hotel And Services", layers: ["Hotels", "Services"] },
    ]);
  });

  it("degrades: toggles [] when clickMap script is absent; null when layers missing", () => {
    const noClick = html.replace(/<script>clickMap=[\s\S]*?<\/script>/, "");
    expect(extractMapConfig(noClick)?.toggles).toEqual([]);
    const noLayers = html.replace(/new google\.maps\.KmlLayer/g, "KML_GONE");
    expect(extractMapConfig(noLayers)).toBeNull();
  });
});
```

- [ ] **Step 2: run → FAIL** (`pnpm exec vitest run tests/blux/grid-extract-map.test.ts` — module not found).
- [ ] **Step 3: implement** `src/blux/grid/extract-map.ts`:

```ts
// Plan 4 of docs/superpowers/specs/2026-07-08-blux-faithful-grid-slices-design.md:
// deterministic extraction of the Blux map widget's config from the rendered
// index.html. The initMap script carries mount/styles/layers; the toggle-chip
// labels live in the band markup and the group logic in the site's clickMap
// script. The Google API key lives only in the separate loader URL and is
// deliberately NOT extracted — render uses VITE_GOOGLE_MAPS_KEY.

export type MapKmlLayer = {
  /** mapLayers key in the source script, e.g. "Hotels". */
  name: string;
  lid: string;
  /** Constructed with `map: map` — visible before any toggle. */
  initiallyVisible: boolean;
  /** Absent in source = false = layer fits the viewport to its KML bounds. */
  preserveViewport: boolean;
};

export type MapToggleGroup = { label: string; layers: string[] };

export type MapConfig = {
  mountId: string;
  mid: string;
  layers: MapKmlLayer[];
  toggles: MapToggleGroup[];
  /** Google Maps style rules, verbatim JSON. */
  styles: unknown[];
  center?: { lat: number; lng: number };
  zoom?: number;
};

const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/g;

function findScript(html: string, marker: RegExp): string | null {
  for (const m of html.matchAll(SCRIPT_RE)) {
    const body = m[1];
    if (body !== undefined && marker.test(body)) return body;
  }
  return null;
}

/** Balanced-bracket slice of the JSON array starting at `styles:[`. */
function extractStyles(script: string): unknown[] {
  const at = script.indexOf("styles:[");
  if (at === -1) return [];
  const start = at + "styles:".length;
  let depth = 0;
  for (let i = start; i < script.length; i++) {
    const ch = script[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          // The Blux styles literal uses unquoted keys — quote them for JSON.parse.
          const raw = script.slice(start, i + 1);
          const jsonish = raw.replace(/([{,])\s*([A-Za-z_][A-Za-z0-9_.]*)\s*:/g, '$1"$2":');
          const parsed: unknown = JSON.parse(jsonish);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

const LAYER_RE = /(\w+)\s*:\s*new google\.maps\.KmlLayer\(\{([^}]*)\}\)/g;

export function extractMapConfig(html: string): MapConfig | null {
  const init = findScript(html, /function initMap\(\)[\s\S]*new google\.maps\.Map/);
  if (!init) return null;

  const mountId = /getElementById\(\s*["']([^"']+)["']\s*\)/.exec(init)?.[1];
  if (!mountId) return null;

  const layers: MapKmlLayer[] = [];
  let mid: string | undefined;
  for (const m of init.matchAll(LAYER_RE)) {
    const name = m[1];
    const args = m[2];
    if (!name || args === undefined) continue;
    const layerMid = /[?&]mid=([^&"']+)/.exec(args)?.[1];
    const lid = /[?&]lid=([^&"']+)/.exec(args)?.[1];
    if (!layerMid || !lid) continue;
    mid ??= layerMid;
    layers.push({
      name,
      lid,
      initiallyVisible: /map\s*:\s*map\b/.test(args),
      preserveViewport: /preserveViewport\s*:\s*true/.test(args),
    });
  }
  if (!mid || layers.length === 0) return null;

  const centerM = /center\s*:\s*\{\s*lat\s*:\s*(-?[\d.]+)\s*,\s*lng\s*:\s*(-?[\d.]+)\s*\}/.exec(
    init,
  );
  const zoomM = /zoom\s*:\s*(\d+)/.exec(init);

  return {
    mountId,
    mid,
    layers,
    toggles: extractToggles(html),
    styles: extractStyles(init),
    ...(centerM?.[1] && centerM[2]
      ? { center: { lat: Number(centerM[1]), lng: Number(centerM[2]) } }
      : {}),
    ...(zoomM?.[1] ? { zoom: Number(zoomM[1]) } : {}),
  };
}

/** Pairs the band's map_icon chip labels (DOM order) with the clickMap
 * groups (index order). Either side missing → no toggles (map still renders
 * its initially-visible layers). */
function extractToggles(html: string): MapToggleGroup[] {
  const labels = [...html.matchAll(/map_icon_text">([^<]*)</g)]
    .map((m) => m[1])
    .filter((l): l is string => l !== undefined);
  const click = findScript(html, /clickMap\s*=\s*\{\s*0\s*:/);
  if (!click || labels.length === 0) return [];
  const bodyM = /clickMap\s*=\s*(\{[\s\S]*?\}\})\s*;/.exec(click);
  if (!bodyM?.[1]) return [];
  const groups: MapToggleGroup[] = [];
  for (const g of bodyM[1].matchAll(/(\d+)\s*:\s*function\s*\(onoff\)\s*\{([^}]*)\}/g)) {
    const idx = Number(g[1]);
    const body = g[2] ?? "";
    const layerNames = [
      ...new Set(
        [...body.matchAll(/mapLayers\.(\w+)\./g)]
          .map((m) => m[1])
          .filter((n): n is string => n !== undefined),
      ),
    ];
    const label = labels[idx];
    if (label === undefined) return [];
    groups[idx] = { label, layers: layerNames };
  }
  return groups.length === labels.length ? groups : [];
}
```

- [ ] **Step 4: run → PASS.** Note: verify the styles round-trip really parses (the test's `length > 20` catches silent `[]`).
- [ ] **Step 5: export from the barrel** `src/blux/grid/index.ts`: `export type { MapConfig, MapKmlLayer, MapToggleGroup } from "./extract-map.js"; export { extractMapConfig, makeIsMapMount } from "./extract-map.js";` (makeIsMapMount lands in A2 — add both exports there if you prefer strict TDD ordering).
- [ ] **Step 6: commit** — `git add src/blux tests/blux && git commit -m "feat(blux): extract-map — map config from the rendered initMap script"`

### Task A2: `makeIsMapMount` + classifier integration

- [ ] **Step 1: failing test** `tests/blux/grid-classify-map.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGridBands } from "../../src/blux/grid/parse-grid.js";
import { classifyBands } from "../../src/blux/grid/classify-band.js";
import { extractMapConfig, makeIsMapMount } from "../../src/blux/grid/extract-map.js";

const page = readFileSync(
  fileURLToPath(new URL("./fixtures/the-pointe-page-content.html", import.meta.url)),
  "utf-8",
);
const band = readFileSync(
  fileURLToPath(new URL("./fixtures/the-pointe-map-band.html", import.meta.url)),
  "utf-8",
);

describe("makeIsMapMount + classifier", () => {
  it("turns exactly the map band into LocationMap, leaving the rest unchanged", () => {
    const cfg = extractMapConfig(band);
    expect(cfg).not.toBeNull();
    const bands = parseGridBands(page);
    const without = classifyBands(bands);
    const withMap = classifyBands(bands, { isMapMount: makeIsMapMount(cfg!) });
    const mapSlices = withMap.filter((s) => s.slice === "LocationMap");
    expect(mapSlices).toHaveLength(1);
    expect(mapSlices[0]?.index).toBe(14);
    // every other band classifies identically
    const others = (a: typeof withMap) => a.filter((s) => s.index !== 14).map((s) => s.slice);
    expect(others(withMap)).toEqual(others(without));
  });
});
```

- [ ] **Step 2: run → FAIL** (makeIsMapMount not exported).
- [ ] **Step 3: implement** in `extract-map.ts` (import `type { Node } from "./types.js"`):

```ts
/** The classifier predicate (plan-2 `ClassifyOptions.isMapMount`): matches the
 * raw node carrying the map mount element. Mounts parse to `raw` nodes; the
 * mount id survives verbatim in the serialized html. */
export function makeIsMapMount(config: MapConfig): (node: Node) => boolean {
  const marker = `id="${config.mountId}"`;
  return (node) => node.kind === "raw" && node.html.includes(marker);
}
```

If the assertion `index === 14` fails, inspect what band 14's root actually looks like (`console.dir` in a scratch run) — the predicate may need to match the `custom-element0`/`data-exec` wrapper instead; adjust the marker to whatever the parsed raw node really contains and note the deviation.

- [ ] **Step 4: run → PASS** (plus `pnpm exec vitest run tests/blux/` — golden snapshots must be untouched).
- [ ] **Step 5: commit** — `feat(blux): makeIsMapMount — real classifier predicate from extracted config`

### Task A3: CLI wiring + changeset + gate

- [ ] **Step 1: failing test** — extend the existing blux-command test file (`tests/cli/blux-command.test.ts`, follow its harness conventions) with: `blux grid <dir>` on a temp export dir whose `index.html` is the map-band fixture content wrapped in a minimal page (must include `#page-content` with one band so parseGridBands succeeds — reuse whatever minimal HTML the existing grid-action test uses) writes `blux-out/map-config.json` with `mountId: "burbank_map"`; and on an export without initMap writes NO map-config.json (and still succeeds).
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** in `src/cli/commands/blux.ts` grid action, after `grid-tree.json` is written:

```ts
const mapConfig = extractMapConfig(html);
if (mapConfig) {
  await writeFile(
    join(outDir, "map-config.json"),
    JSON.stringify(mapConfig, null, 2) + "\n",
    "utf-8",
  );
}
```

and append to the action's output line (e.g. `parsed N bands` → `parsed N bands, map config extracted` when present). Import from the barrel.

- [ ] **Step 4: run → PASS.**
- [ ] **Step 5: changeset** — `.changeset/blux-extract-map.md`, minor: `feat(blux): extract-map stage — map config + real isMapMount classifier predicate; blux grid writes map-config.json`.
- [ ] **Step 6: full gate** — `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`.
- [ ] **Step 7: commit** — `feat(cli): blux grid writes map-config.json when a map is found`

---

## Part B — the-pointe (fresh branch `feat/location-map` off updated origin/main in the existing clone at `<scratchpad>/the-pointe`; run `git fetch origin && git checkout -B feat/location-map origin/main` first — plan 3 merged as 5e7d0d3)

### File structure

- Modify: `src/lib/blux/presentation.ts` (additive `map` payload types), `src/lib/slices/index.js`, `src/routes/dev/a11y-fixtures/+page.svelte`
- Create: `src/lib/blux/LocationMap.svelte` (+ `LocationMap.test.ts`), `src/lib/slices/LocationMap/{model.json,index.svelte,LocationMap.test.ts}`

### Task B1: `map` payload on the render contract

- [ ] **Step 1: failing test** — extend `src/lib/blux/presentation.test.ts`: a `Presentation` literal with `bands: { "14": { map: { mid: "M", layers: [{ name: "A", lid: "L", initiallyVisible: true, preserveViewport: false }], toggles: [{ label: "All", layers: ["A"] }], styles: [] } } }` typechecks and `bandFor(p, 14)?.map?.mid === "M"`.
- [ ] **Step 2: FAIL** (type error → test file fails to compile).
- [ ] **Step 3: implement** in `presentation.ts` (mirror of Part A's config minus `mountId` — emit strips it):

```ts
export type MapLayer = {
  name: string;
  lid: string;
  initiallyVisible: boolean;
  preserveViewport: boolean;
};
export type MapToggle = { label: string; layers: string[] };
export type MapRenderConfig = {
  mid: string;
  layers: MapLayer[];
  toggles: MapToggle[];
  styles: unknown[];
  center?: { lat: number; lng: number };
  zoom?: number;
};
```

and `map?: MapRenderConfig;` on `BandPresentation` (doc comment: `/** LocationMap payload (plan 4). */`).

- [ ] **Step 4: PASS → commit** `feat(blux): map payload on the presentation contract`

### Task B2: `LocationMap.svelte`

Behavior contract (from the original site): container div fills width, map div height 600px; chips under the map, radio-style — exactly one active (default index 0); activating group i calls `setMap(map)` on its layers and `setMap(null)` on the previous group's layers EXCEPT group 0's layers, which are never removed (the original's "off" handler for the portfolio keeps it on the map). Layers with `initiallyVisible` start on the map. KML url: `https://www.google.com/maps/d/u/0/kml?forcekmz=1&mid=${mid}&lid=${lid}` (https — original used http). Maps JS API loaded once per page via injected script `https://maps.googleapis.com/maps/api/js?key=${key}&callback=<unique global>` guarded by a module-level promise; key = `import.meta.env.VITE_GOOGLE_MAPS_KEY`. **No key (dev/test/jsdom) → render a `data-map-placeholder` div (same height) and never inject the script** — this is also what unit tests exercise; the google objects are typed via a minimal local `declare` block (no @types/google.maps dependency, no `any` — use narrow structural types for the 3 calls we make: `new Map(el, opts)`, `new KmlLayer(opts)`, `layer.setMap(m)`).

- [ ] **Step 1: failing test** `src/lib/blux/LocationMap.test.ts` (matchMedia mock not needed; no video): renders placeholder div + no injected `script[src*="maps.googleapis"]` when no key; renders one chip `<button>` per toggle with the labels; first chip has `aria-pressed="true"`, others false; clicking chip 2 flips it to pressed and chip 1 to unpressed (state logic must not require google to exist — guard all map calls).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: implement.** Suggested skeleton:

```svelte
<script lang="ts">
  import type { MapRenderConfig } from "./presentation";

  type GLayer = { setMap: (m: unknown) => void };
  type GMapsNS = {
    Map: new (el: HTMLElement, opts: Record<string, unknown>) => unknown;
    KmlLayer: new (opts: Record<string, unknown>) => GLayer;
  };

  type Props = { map: MapRenderConfig };
  let { map: config }: Props = $props();

  const key: string | undefined = import.meta.env.VITE_GOOGLE_MAPS_KEY;
  let mountEl: HTMLDivElement | undefined = $state();
  let active = $state(0);
  let gmap: unknown;
  const layerObjs: Record<string, GLayer> = {};

  function applyToggle(next: number, prev: number) {
    const off = config.toggles[prev];
    const on = config.toggles[next];
    if (prev !== 0) off?.layers.forEach((n) => layerObjs[n]?.setMap(null));
    on?.layers.forEach((n) => layerObjs[n]?.setMap(gmap));
  }

  function select(i: number) {
    const prev = active;
    active = i;
    if (gmap) applyToggle(i, prev);
  }

  $effect(() => {
    if (!key || !mountEl) return;
    let cancelled = false;
    loadMapsApi(key).then((g: GMapsNS) => {
      if (cancelled || !mountEl) return;
      gmap = new g.Map(mountEl, {
        ...(config.center ? { center: config.center } : {}),
        ...(config.zoom !== undefined ? { zoom: config.zoom } : {}),
        styles: config.styles,
      });
      for (const l of config.layers) {
        layerObjs[l.name] = new g.KmlLayer({
          url: `https://www.google.com/maps/d/u/0/kml?forcekmz=1&mid=${config.mid}&lid=${l.lid}`,
          preserveViewport: l.preserveViewport,
          map: l.initiallyVisible ? gmap : null,
        });
      }
    });
    return () => { cancelled = true; };
  });
</script>
```

with `loadMapsApi` as a small module-level once-guard (module scope in the same file or a sibling `maps-loader.ts`; script injection + `callback` global that resolves the shared promise; reject on script error), and markup:

```svelte
<div class="w-full">
  {#if key}
    <div bind:this={mountEl} style:height="600px" class="w-full"></div>
  {:else}
    <!-- No Maps key in this environment (dev/test): keep the layout, skip the API. -->
    <div data-map-placeholder style:height="600px" class="w-full bg-neutral-100"></div>
  {/if}
  {#if config.toggles.length > 0}
    <div class="mt-6 flex flex-wrap gap-3">
      {#each config.toggles as t, i (i)}
        <button
          type="button"
          aria-pressed={active === i}
          class="border px-3 py-1 text-sm"
          onclick={() => select(i)}
        >{t.label}</button>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 4: PASS → commit** `feat(blux): LocationMap — Maps JS + KML layers with original toggle semantics`

### Task B3: `location_map` slice + registry + fixture + gate

- [ ] **Step 1: failing test** `src/lib/slices/LocationMap/LocationMap.test.ts` (mirror MediaFull's test shape): with a manifest `map` payload (no key in jsdom) renders `[data-map-placeholder]` inside a `section[data-slice-type="location_map"]`; renders nothing without the payload; tolerates `context: {}`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: implement** — `model.json` envelope `"id": "location_map"`, `"name": "LocationMap"`, `"description": "Interactive pinned map from the Blux export"`, primary: `band` Number only. `index.svelte` mirrors MediaFull: `bandFor` → `{#if band?.map}` → `<SectionBand {band} sliceType={slice.slice_type} sliceVariation={slice.variation}>` wrapping `<div class="mx-auto w-full max-w-screen-xl px-6 py-12"><LocationMap map={band.map} /></div>`. Register `location_map: LocationMap` in `src/lib/slices/index.js` (alphabetical — after `hero`, before `media_full`). Add an a11y fixture (band 107, one layer, one toggle) following plan 3's `bluxCtx` pattern.
- [ ] **Step 4: PASS**, then the full gate: `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build` (and `pnpm test:a11y` since the fixtures page changed).
- [ ] **Step 5: commit** `feat(slices): location_map slice rendering the manifest map payload`

---

## Ship

Part A: PR to reddoorla/reddoor-maintenance, gate on the head SHA's `build` check (+ the pre-merge `pnpm test:dist` already run locally), squash-merge per merge-authority policy. Part B: PR to reddoorla/the-pointe, `ci / ci` on head SHA, squash-merge. Both PR bodies note: emit (plan 5) writes the `map` payload; center/zoom are placeholders — framing comes from KML bounds; visual verification of the map happens in plan 7's migrate+verify.

## Self-review checklist (controller, before final review)

- `MapConfig` (repo A) and `MapRenderConfig` (repo B) stay field-compatible minus `mountId`.
- No Google API key anywhere in committed content (grep `AIzaSy` both repos).
- Golden classify snapshots unchanged; the map integration test asserts band 14 only.
- LocationMap never touches `window`/google during SSR or keyless renders.
- exactOptionalPropertyTypes discipline: optional center/zoom built via conditional spread on both sides.
