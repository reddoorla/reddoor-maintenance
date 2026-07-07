import type { ThemeIR } from "../ir.js";

/** ThemeIR → a Tailwind v4 `@theme` block of CSS custom properties. Deterministic. */
export function emitThemeCss(theme: ThemeIR): string {
  const lines: string[] = ["@theme {"];
  for (const c of theme.colors) lines.push(`  --color-${c.role}: ${c.value};`);
  lines.push(`  --font-heading: ${theme.fonts.heading || "sans-serif"};`);
  lines.push(`  --font-body: ${theme.fonts.body || "sans-serif"};`);
  for (const t of theme.textStyles) {
    if (t.label) lines.push(`  /* ${t.role} — ${t.label} */`);
    lines.push(`  --text-${t.role}: ${t.size};`);
    lines.push(`  --text-${t.role}--line-height: ${t.lineHeight};`);
    lines.push(`  --text-${t.role}--font-weight: ${t.weight};`);
    if (t.fontFamily) lines.push(`  --text-${t.role}--font-family: ${t.fontFamily};`);
    if (t.transform) lines.push(`  --text-${t.role}--text-transform: ${t.transform};`);
    if (t.letterSpacing) lines.push(`  --text-${t.role}--letter-spacing: ${t.letterSpacing};`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}
