/** Locate `interface $$Props {` declarations and remove them, including
 * the matching closing `}` even if the body has nested braces or spans
 * multiple lines. Regex alone can't do balanced-brace matching, so we
 * walk the string manually. */
function removeInterfaceBlock(source: string): string {
  const re = /^\s*interface\s+\$\$Props\s*\{/m;
  let out = source;
  while (true) {
    const match = re.exec(out);
    if (!match) return out;

    const openBraceIdx = match.index + match[0].length - 1;
    let depth = 1;
    let i = openBraceIdx + 1;
    while (i < out.length && depth > 0) {
      const ch = out[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    if (depth !== 0) return out; // unbalanced; bail rather than corrupt

    // Consume trailing whitespace through end-of-line.
    let endIdx = i;
    while (endIdx < out.length && /[ \t]/.test(out[endIdx] ?? "")) endIdx++;
    if (out[endIdx] === "\n") endIdx++;

    out = out.slice(0, match.index) + out.slice(endIdx);
  }
}

export function removeDollarRestProps(source: string): string {
  let next = source;
  next = next.replace(/\$\$restProps/g, "rest");
  next = removeInterfaceBlock(next);
  return next;
}
