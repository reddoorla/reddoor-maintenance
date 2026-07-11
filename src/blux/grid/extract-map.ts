// Plan 4 of docs/superpowers/specs/2026-07-08-blux-faithful-grid-slices-design.md:
// deterministic extraction of the Blux map widget's config from the rendered
// index.html. The initMap script carries mount/styles/layers; the toggle-chip
// labels live in the band markup and the group logic in the site's clickMap
// script. The Google API key lives only in the separate loader URL and is
// deliberately NOT extracted — render uses VITE_GOOGLE_MAPS_KEY.

import type { Node } from "./types.js";

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
      initiallyVisible: /\bmap\s*:\s*map\b/.test(args),
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

/** The classifier predicate (plan-2 `ClassifyOptions.isMapMount`): matches the
 * raw node carrying the map mount element. Mounts parse to `raw` nodes; the
 * mount id survives verbatim in the serialized html. */
export function makeIsMapMount(config: MapConfig): (node: Node) => boolean {
  const marker = `id="${config.mountId}"`;
  return (node) => node.kind === "raw" && node.html.includes(marker);
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
  // Non-contiguous clickMap indices would leave holes that serialize as null.
  return groups.length === labels.length && groups.every((g) => g !== undefined) ? groups : [];
}
