/**
 * Rewrite a single package.json script value to use pnpm equivalents
 * where the substitution is safe. Conservative on purpose: we only touch
 * patterns whose semantics are identical under pnpm.
 *
 * - `npm run <token>` → `pnpm run <token>` (identical behavior)
 * - `npx <token>` → `pnpm dlx <token>` (identical behavior in pnpm 7+)
 *
 * Intentionally NOT rewritten:
 * - `npm install`, `npm install <pkg>`, `npm install --save-dev <pkg>` —
 *   subtle flag mapping (e.g. `--save-dev` → `-D`) and edge cases like
 *   `--save-exact` / `--save-optional`. Better to leave for an operator
 *   eyeball than to silently mis-translate.
 * - Hyphenated identifiers like `npm-check-updates` (word-boundary protected).
 * - `concurrently "npm:scriptName"` shorthand syntax — it isn't actually
 *   running npm; it's a concurrently-specific script reference.
 */
export function rewriteScriptForPnpm(script: string): string {
  let out = script;
  // `npm run <name>` → `pnpm run <name>`. \b before npm prevents
  // matching inside hyphenated identifiers. Lookahead `(?=\s)` after run
  // ensures we don't match `runner`.
  out = out.replace(/\bnpm run(?=\s)/g, "pnpm run");
  // `npx ` → `pnpm dlx `. \b before npx prevents matching `npx-something`.
  out = out.replace(/\bnpx(?=\s)/g, "pnpm dlx");
  return out;
}

/**
 * Rewrite every entry in a package.json `scripts` map. Returns the new
 * map alongside a count of scripts that were actually changed.
 */
export function rewriteScriptsForPnpm(scripts: Record<string, string>): {
  scripts: Record<string, string>;
  changedCount: number;
} {
  const next: Record<string, string> = {};
  let changedCount = 0;
  for (const [name, value] of Object.entries(scripts)) {
    const rewritten = rewriteScriptForPnpm(value);
    next[name] = rewritten;
    if (rewritten !== value) changedCount++;
  }
  return { scripts: next, changedCount };
}
