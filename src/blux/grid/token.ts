import type { GridToken } from "./types.js";

const TOKEN_RE = /\bgrid-(\d+|any)(?:-(r|s)(\d+))?\b/;

/** Parse the `grid-*` layout token out of an element's class string.
 * `grid-2` -> equal 2-col; `grid-2-r60` -> 60% of a 2-col row; `grid-1-s40` ->
 * 1-col with 40px inter-cell spacing (the `s` suffix is the grid's gap, matching
 * `data-spacing`, NOT a width — width comes from the column count). Returns null
 * when the class has no grid token (e.g. `grid-container`, no column count). */
export function parseGridToken(className: string): GridToken | null {
  const m = TOKEN_RE.exec(className);
  if (!m) return null;
  const cols = m[1] === "any" ? "any" : Number(m[1]);
  const token: GridToken = { cols, raw: m[0] };
  if (m[2] === "r") token.ratio = Number(m[3]);
  if (m[2] === "s") token.spacing = Number(m[3]);
  return token;
}
