import type { ThemeIR } from "../ir.js";

/** ThemeIR → a Tailwind v4 `@theme` block of CSS custom properties. Deterministic. */
export function emitThemeCss(theme: ThemeIR): string {
  const lines: string[] = ["@theme {"];
  for (const c of theme.colors) lines.push(`  --color-${c.role}: ${c.value};`);
  lines.push(`  --font-heading: ${theme.fonts.heading || "sans-serif"};`);
  lines.push(`  --font-body: ${theme.fonts.body || "sans-serif"};`);
  for (const t of theme.textStyles) {
    lines.push(`  --text-${t.role}: ${t.size};`);
    lines.push(`  --text-${t.role}--line-height: ${t.lineHeight};`);
    lines.push(`  --text-${t.role}--font-weight: ${t.weight};`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}
