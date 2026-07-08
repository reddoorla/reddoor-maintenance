import type { ThemeIR } from "../ir.js";

/** ThemeIR → a Tailwind v4 `@theme` block of CSS custom properties. Deterministic.
 *  A leading comment lists the exact web-font weights the export loads, so the
 *  design pass can install them without measuring the rendered site. */
export function emitThemeCss(theme: ThemeIR): string {
  const lines: string[] = [];
  if (theme.fontLoad.length) {
    const spec = theme.fontLoad.map((f) => `${f.family} ${f.weights.join(",")}`).join("; ");
    lines.push(`/* Fonts to load — ${spec} */`);
  }
  lines.push("@theme {");
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
    if (t.mobileSize) lines.push(`  --text-${t.role}--mobile-font-size: ${t.mobileSize};`);
    if (t.mobileLineHeight)
      lines.push(`  --text-${t.role}--mobile-line-height: ${t.mobileLineHeight};`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}
