// Offline layout-fidelity gate (plan 6). Diffs the classified source
// (`SliceSpec[]`, already gated band→spec by grid-classify-golden) against the
// emitted presentation manifest (plan 5), naming every band whose layout,
// media, or map drifted. Pure + offline — the render side (Playwright DOM
// signature) is plan 7's verify. See the plan's "The comparison, precisely".
import type { Cell, Node, SliceSpec } from "../grid/index.js";
import { hasMapWidget, type Presentation, type RenderCell, type RenderNode } from "./presentation.js";

/** Canonical grid-token key — cols + optional ratio/sized, WITHOUT the
 * source-only `raw` string, so a source token and its render-side twin (which
 * never carries `raw`) compare equal. */
function tokKey(t: { cols: number | "any"; ratio?: number; sized?: number }): string {
  return `${t.cols}${t.ratio !== undefined ? `r${t.ratio}` : ""}${t.sized !== undefined ? `s${t.sized}` : ""}`;
}

/** Compact structural signature of a node tree, computed identically for a
 * source `Node` and its serialized `RenderNode` twin (they share `kind`s and
 * aligned fields). Prose is excluded; only kinds + grid tokens + media/widget
 * kinds appear — so it snapshots LAYOUT, not content. A source media node the
 * manifest dropped (unresolved url) makes the two signatures diverge, which is
 * exactly the fidelity signal we want. Mirrors `grid/signature.ts`'s exhaustive
 * switch so a new node kind is a compile error, not a silent drop. */
export function sigOf(node: Node | RenderNode): string {
  switch (node.kind) {
    case "row":
      return `row[${node.cells
        .map((c: Cell | RenderCell) => `${tokKey(c.token)}:${sigOf(c.node)}`)
        .join(",")}]`;
    case "stack":
      return `stack[${node.children.map(sigOf).join(",")}]`;
    case "heading":
      return `h${node.level}`;
    case "body":
      return "body";
    case "subtitle":
      return "subtitle";
    case "media":
      return `media:${node.media.kind}`;
    case "widget":
      return `widget:${node.widget.type}`;
    case "raw":
      return "raw";
  }
}

export type LayoutFinding =
  | { kind: "band-count"; specs: number; manifest: number }
  | { kind: "band-missing"; band: number }
  | { kind: "tree-drift"; band: number; expected: string; actual: string }
  | { kind: "media-dropped"; band: number; where: string }
  | { kind: "map-missing"; band: number };

export type LayoutRow = {
  band: number;
  slice: SliceSpec["slice"];
  source: string;
  converted: string;
  ok: boolean;
};

export type LayoutReport = {
  /** number of source bands (== specs.length) */
  bands: number;
  /** Grid-fallback bands whose tree fidelity was signature-checked */
  gridBands: number;
  faithful: boolean;
  findings: LayoutFinding[];
  rows: LayoutRow[];
};

/** A short source-side label per slice, used for the report row's `source`
 * column and the missing-band row. Grid uses the full structural signature. */
function sourceLabel(spec: SliceSpec): string {
  switch (spec.slice) {
    case "Grid":
      return sigOf(spec.root);
    case "Gallery":
      return `gallery(${spec.media.length})`;
    case "MediaFull":
      return "media_full";
    case "VideoFeature":
      return "video";
    case "SplitFeature":
      return `split(${spec.mediaSide},${spec.ratio})`;
    case "LocationMap":
      return "location_map";
    case "Hero":
      return "hero";
    case "TitleBand":
      return "title_band";
    case "RichText":
      return "rich_text";
  }
}

/** Diff the classified source against the emitted manifest. Grid bands must
 * round-trip their structural signature exactly (spec.root vs the serialized
 * tree); smart slices are checked for payload completeness (gallery count,
 * split/media present, background/map present). Returns a structured report;
 * `faithful` is true iff `findings` is empty. */
export function validateLayout(specs: SliceSpec[], presentation: Presentation): LayoutReport {
  const findings: LayoutFinding[] = [];
  const rows: LayoutRow[] = [];
  const manifestKeys = Object.keys(presentation.bands);
  let gridBands = 0;

  if (specs.length !== manifestKeys.length) {
    findings.push({ kind: "band-count", specs: specs.length, manifest: manifestKeys.length });
  }

  for (const spec of specs) {
    const source = sourceLabel(spec);
    const bp = presentation.bands[String(spec.index)];
    if (!bp) {
      findings.push({ kind: "band-missing", band: spec.index });
      rows.push({ band: spec.index, slice: spec.slice, source, converted: "∅", ok: false });
      continue;
    }
    const before = findings.length;
    let converted = source;

    // Band background (any slice) must survive if the source declared one.
    if (spec.background && !bp.background) {
      findings.push({ kind: "media-dropped", band: spec.index, where: "background" });
    }

    switch (spec.slice) {
      case "Grid": {
        gridBands++;
        converted = bp.tree ? sigOf(bp.tree) : "∅";
        if (source !== converted) {
          findings.push({ kind: "tree-drift", band: spec.index, expected: source, actual: converted });
        }
        if (hasMapWidget(spec.root) && !bp.map) {
          findings.push({ kind: "map-missing", band: spec.index });
        }
        break;
      }
      case "Gallery": {
        const got = bp.gallery?.length ?? 0;
        converted = `gallery(${got})`;
        if (got < spec.media.length) {
          findings.push({ kind: "media-dropped", band: spec.index, where: `gallery ${got}/${spec.media.length}` });
        }
        break;
      }
      case "MediaFull":
      case "VideoFeature": {
        if (!bp.media) {
          converted = "∅";
          findings.push({ kind: "media-dropped", band: spec.index, where: "media" });
        }
        break;
      }
      case "SplitFeature": {
        if (!bp.split) {
          converted = "∅";
          findings.push({ kind: "media-dropped", band: spec.index, where: "split" });
        }
        break;
      }
      case "LocationMap": {
        if (!bp.map) {
          converted = "∅";
          findings.push({ kind: "map-missing", band: spec.index });
        }
        break;
      }
      case "Hero":
      case "TitleBand":
      case "RichText":
        break; // text lives in the page doc (gated by grid-slice.test.ts); nothing manifest-carried to lose beyond background
    }

    rows.push({ band: spec.index, slice: spec.slice, source, converted, ok: findings.length === before });
  }

  return { bands: specs.length, gridBands, faithful: findings.length === 0, findings, rows };
}
