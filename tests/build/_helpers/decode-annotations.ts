/**
 * Decode each `::error::` / `::warning::` line the way GitHub does (`%0D`, then `%0A`,
 * then `%25`), so an assertion reads what a reader sees: a `%250A` the workflow printed
 * shows as `%0A`, a raw `%0A` would show as a line break, and the gate's `(>25%25)` shows
 * as `(>25%)`.
 */
export function decodeAnnotations(text: string): string {
  return text
    .split("\n")
    .map((l) =>
      /^::(error|warning)::/.test(l)
        ? l.replaceAll("%0D", "\r").replaceAll("%0A", "\n").replaceAll("%25", "%")
        : l,
    )
    .join("\n");
}
