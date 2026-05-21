/**
 * Collapses the "manual sync state with prop" anti-pattern into `$derived`.
 *
 * Input:
 *   let content = $state(data.page.data);
 *   $effect(() => { data; content = data.page.data });
 *
 * Output:
 *   let content = $derived(data.page.data);
 *
 * Only transforms when the `$state(...)` initializer expression matches the
 * effect's right-hand assignment exactly (after trim). Intervening statements
 * between the `let` and the `$effect` block prevent the match — keeps the
 * codemod conservative.
 *
 * Triggered by Svelte 5's `state_referenced_locally` warning, which fires
 * whenever a local `let X = $state(prop.expr)` captures a prop reference
 * only at init time.
 */
const PATTERN =
  /let\s+(\w+)\s*=\s*\$state\(\s*([^)]+?)\s*\)\s*;[ \t\r\n]*\$effect\(\s*\(\s*\)\s*=>\s*\{\s*\w+\s*;\s*\1\s*=\s*([^;}]+?)\s*\}\s*\)\s*;?/g;

export function stateEffectSyncToDerived(source: string): string {
  return source.replace(PATTERN, (full, name: string, initExpr: string, effectExpr: string) => {
    if (initExpr.trim() !== effectExpr.trim()) return full;
    return `let ${name} = $derived(${initExpr.trim()});`;
  });
}
