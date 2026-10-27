/** Find the index of the closing quote for a string literal that opens at
 * `openIdx`. Handles backslash escapes. Returns -1 if the string is
 * unterminated.
 *
 * Treats backtick template literals the same as `'…'` / `"…"` — the
 * closing backtick terminates. Callers needing precise `${…}` interpolation
 * handling will need a real parser; this helper is intentionally simple
 * and good enough for the codemod-grade string masking we do today. */
export function findStringEnd(source: string, openIdx: number): number {
  const quote = source[openIdx];
  let i = openIdx + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i;
    i++;
  }
  return -1;
}
