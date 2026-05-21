const SCRIPT_TS = /<script\b[^>]*lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/;
const EXPORT_LET = /^\s*export\s+let\s+(\w+)\s*(?::\s*([^=;\n]+))?\s*(?:=\s*([^;\n]+))?;?\s*$/gm;

type Prop = { name: string; type?: string | undefined; defaultExpr?: string | undefined };

function transformScript(scriptBody: string): { body: string; changed: boolean } {
  const props: Prop[] = [];
  const cleaned = scriptBody.replace(
    EXPORT_LET,
    (_full, name: string, type?: string, defaultExpr?: string) => {
      props.push({
        name,
        type: type?.trim(),
        defaultExpr: defaultExpr?.trim(),
      });
      return "";
    },
  );
  if (props.length === 0) return { body: scriptBody, changed: false };

  const typeSig = props
    .map((p) => {
      const optional = p.defaultExpr ? "?" : "";
      return `${p.name}${optional}: ${p.type ?? "unknown"}`;
    })
    .join("; ");
  const destructured = props
    .map((p) => (p.defaultExpr ? `${p.name} = ${p.defaultExpr}` : p.name))
    .join(", ");
  const decl = `  let { ${destructured} }: { ${typeSig} } = $props();`;

  const next = cleaned.replace(/^(\s*)/, (m) => `${m}${decl}\n`);
  return { body: next, changed: true };
}

export function exportLetToProps(source: string): string {
  const match = source.match(SCRIPT_TS);
  if (!match) return source;
  const inner = match[1] ?? "";
  const { body, changed } = transformScript(inner);
  if (!changed) return source;
  return source.replace(SCRIPT_TS, (full) => full.replace(inner, body));
}
