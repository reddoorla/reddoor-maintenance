import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VITE_PLUGIN_PKG = "@sveltejs/vite-plugin-svelte";

/** Match an import statement that pulls one or more named bindings from
 * `@sveltejs/vite-plugin-svelte`. Group 1 is the comma-separated name list. */
const IMPORT_FROM_VITE_PLUGIN = new RegExp(
  String.raw`^import\s+\{\s*([^}]+?)\s*\}\s+from\s+["']` +
    VITE_PLUGIN_PKG.replace(/[/]/g, "\\/") +
    String.raw`["'];?[ \t]*\n`,
  "m",
);

/** Rewrite the import to drop only `vitePreprocess`, preserving any other
 * named bindings. If `vitePreprocess` was the sole import, the whole line
 * is removed. */
function dropVitePreprocessImport(source: string): string {
  return source.replace(IMPORT_FROM_VITE_PLUGIN, (full, names: string) => {
    const remaining = names
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0 && n !== "vitePreprocess");
    if (remaining.length === 0) return ""; // drop entire line including its trailing newline
    return `import { ${remaining.join(", ")} } from "${VITE_PLUGIN_PKG}";\n`;
  });
}

/** Find the end of a balanced-paren call starting at `openIdx`, which must
 * point at the `(` character. Returns the index of the matching `)`, or -1
 * if unbalanced. */
function findMatchingParen(source: string, openIdx: number): number {
  if (source[openIdx] !== "(") return -1;
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Remove a `preprocess: vitePreprocess(<anything>),?` key from a config
 * object. Handles the call with empty parens or with an options object. */
function dropPreprocessKey(source: string): string {
  // Anchor on the start of the preprocess key on its own line so we don't
  // also strip whitespace / commas from neighboring keys.
  const startRe = /^(\s*)preprocess:\s*vitePreprocess\(/m;
  const m = startRe.exec(source);
  if (!m) return source;

  const indent = m[1] ?? "";
  const parenOpenAbs = m.index + m[0].length - 1; // points at `(`
  const parenCloseAbs = findMatchingParen(source, parenOpenAbs);
  if (parenCloseAbs < 0) return source;

  // Consume an optional trailing comma and whitespace through end-of-line.
  let tailIdx = parenCloseAbs + 1;
  while (tailIdx < source.length && /[ \t,]/.test(source[tailIdx] ?? "")) tailIdx++;
  if (source[tailIdx] === "\n") tailIdx++;

  return source.slice(0, m.index) + source.slice(tailIdx).replace(new RegExp(`^${indent}\\n`), "");
}

export async function migrateSvelteConfig(cwd: string): Promise<boolean> {
  const path = join(cwd, "svelte.config.js");
  let src: string;
  try {
    src = await readFile(path, "utf-8");
  } catch {
    return false;
  }

  let next = src;
  next = dropPreprocessKey(next);
  next = dropVitePreprocessImport(next);

  if (next === src) return false;
  await writeFile(path, next, "utf-8");
  return true;
}
