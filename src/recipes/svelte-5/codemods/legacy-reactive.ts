/**
 * Converts Svelte 4 `$:` reactive statements to Svelte 5 runes.
 *
 * - `$: var = expr;`     →  `let var = $derived(expr);`
 * - `$: { body }`        →  `$effect(() => { body });`
 *
 * Triggered by:
 *   "`$:` is not allowed in runes mode, use `$derived` or `$effect` instead"
 *   (svelte.dev/e/legacy_reactive_statement_invalid)
 *
 * Block patterns become `$effect` rather than per-variable `$derived` calls
 * because the block typically mutates multiple already-declared `let`
 * variables with conditional logic — too contextual for a safe automatic
 * decomposition into discrete derived values. The user can refine each
 * `$effect` into idiomatic `$derived` calls afterward if desired.
 *
 * Scoped to `<script>` content only — `$:` in template/style text is left
 * alone (it would only ever appear there as literal text anyway).
 */
import { findStringEnd } from "../../../util/svelte-source.js";

const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
const SIMPLE_REACTIVE = /^([ \t]*)\$:\s*(\w+)\s*=\s*([^;\n]+);?[ \t]*$/gm;
const BLOCK_REACTIVE_HEAD = /(^|\n)([ \t]*)\$:\s*\{/g;

function findMatchingClose(source: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < source.length) {
    const ch = source[i];
    // Skip over string literals so braces inside strings don't fool the counter.
    if (ch === '"' || ch === "'" || ch === "`") {
      const closeStr = findStringEnd(source, i);
      if (closeStr === -1) return -1;
      i = closeStr + 1;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Flag each converted `$effect` block for manual review. The conversion is
 * syntactically safe (compiles), but if any of the locals the block mutates
 * was declared as plain `let` (not `$state`), the `$effect` runs once on
 * mount and never again — code silently loses its reactivity. We can't
 * detect that automatically (it would require scope analysis on the
 * declaration sites), so we leave a breadcrumb for the human reviewer. */
const MIGRATION_MARKER =
  "// @migration-task: $effect won't trigger UI updates on plain `let` bindings — refine mutated locals to $state or split into per-variable $derived.";

function transformBlocks(body: string): string {
  const out: string[] = [];
  let last = 0;
  BLOCK_REACTIVE_HEAD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_REACTIVE_HEAD.exec(body)) !== null) {
    const leadingNewline = m[1] ?? "";
    const indent = m[2] ?? "";
    const headEnd = m.index + m[0].length; // position just after `{`
    const openBraceIdx = headEnd - 1;
    const closeBraceIdx = findMatchingClose(body, openBraceIdx);
    if (closeBraceIdx === -1) continue;
    out.push(body.slice(last, m.index));
    out.push(leadingNewline);
    const blockBody = body.slice(openBraceIdx + 1, closeBraceIdx);
    out.push(`${indent}${MIGRATION_MARKER}\n`);
    out.push(`${indent}$effect(() => {${blockBody}});`);
    last = closeBraceIdx + 1;
    BLOCK_REACTIVE_HEAD.lastIndex = last;
  }
  out.push(body.slice(last));
  return out.join("");
}

function transformSimple(body: string): string {
  return body.replace(SIMPLE_REACTIVE, (_full, indent: string, name: string, expr: string) => {
    return `${indent}let ${name} = $derived(${expr.trim()});`;
  });
}

export function legacyReactiveToRunes(source: string): string {
  return source.replace(SCRIPT_BLOCK, (full, _attrs: string, body: string) => {
    // Blocks first so an outer `$: { ... }` containing nothing matchable
    // for the simple pass still gets wrapped. Order doesn't matter for the
    // patterns currently in the fleet but keeps the codemod robust to future
    // shapes.
    let next = transformBlocks(body);
    next = transformSimple(next);
    if (next === body) return full;
    return full.replace(body, next);
  });
}
