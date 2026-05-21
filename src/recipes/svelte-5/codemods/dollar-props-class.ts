/**
 * Converts the legacy `$$props.class` pattern (passing extra HTML class from
 * a parent component) to a Svelte 5 named-prop destructuring.
 *
 * Input:
 *   <script lang="ts">
 *     let { foo }: { foo?: string } = $props();
 *   </script>
 *   <div class="other {$$props.class || ''}">x</div>
 *
 * Output:
 *   <script lang="ts">
 *     let { foo, class: className = "" }: { foo?: string; class?: string } = $props();
 *   </script>
 *   <div class="other {className || ''}">x</div>
 *
 * Triggered by Svelte 5 build errors:
 *   "Cannot use `$$props` in runes mode" (svelte.dev/e/legacy_props_invalid)
 *
 * The original svelte-migrate tool flagged this with a `@migration-task`
 * comment because it couldn't safely combine `$$props` with already-named
 * props. We can: `class` is the dominant case across the reddoor fleet,
 * so we destructure it as `class: className = ""` (renamed because `class`
 * is a JS reserved word as a bare binding) and rewrite template references.
 *
 * Conservative: only transforms files that have BOTH a template
 * `$$props.class` reference AND an existing `$props()` destructuring.
 * Files using `$$props.class` without a `$props()` declaration are left
 * for the `exportLetToProps` codemod to handle in a prior pass.
 */
// Note: lazy `[\s\S]*?` (not `[^}]*`) so default values containing braces
// — `() => {}`, `{ foo: 1 }`, etc. — don't truncate the match early.
const PROPS_DESTRUCTURE = /let\s*\{([\s\S]*?)\}(\s*:\s*\{([\s\S]*?)\})?\s*=\s*\$props\(\)/;
const DOLLAR_PROPS_CLASS = /\$\$props\.class\b/g;
const DOLLAR_PROPS_ANY = /\$\$props\b/;
const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script>/g;
const MIGRATION_TASK = /^<!--\s*@migration-task[\s\S]*?-->\s*\n?/gm;
const IDENT = "className";

function maskScripts(source: string): { masked: string; blocks: string[] } {
  const blocks: string[] = [];
  const masked = source.replace(SCRIPT_BLOCK, (m) => {
    blocks.push(m);
    return `__SCRIPT_${blocks.length - 1}__`;
  });
  return { masked, blocks };
}

function restoreScripts(masked: string, blocks: string[]): string {
  let out = masked;
  blocks.forEach((blk, i) => {
    out = out.replace(`__SCRIPT_${i}__`, blk);
  });
  return out;
}

export function dollarPropsClass(source: string): string {
  // Bail early if the template doesn't reference $$props.class
  const { masked } = maskScripts(source);
  if (!DOLLAR_PROPS_CLASS.test(masked)) return source;
  DOLLAR_PROPS_CLASS.lastIndex = 0;

  // Bail if there's no $props() destructuring to extend
  if (!PROPS_DESTRUCTURE.test(source)) return source;

  let updated = source.replace(PROPS_DESTRUCTURE, (full, body, typeAnno, typeBody) => {
    // Already migrated (someone added class manually)
    if (/\bclass\s*:/.test(body as string)) return full;

    const cleanBody = (body as string).trim().replace(/,\s*$/, "").trim();
    const newBody = cleanBody ? `${cleanBody}, class: ${IDENT} = ""` : `class: ${IDENT} = ""`;

    if (typeAnno) {
      const cleanType = ((typeBody as string) ?? "").trim().replace(/;\s*$/, "").trim();
      const newType = cleanType ? `${cleanType}; class?: string` : `class?: string`;
      return `let { ${newBody} }: { ${newType} } = $props()`;
    }
    return `let { ${newBody} } = $props()`;
  });

  // Replace $$props.class in template only (re-mask after destructuring update)
  const reMasked = maskScripts(updated);
  const templateRewritten = reMasked.masked.replace(DOLLAR_PROPS_CLASS, IDENT);
  updated = restoreScripts(templateRewritten, reMasked.blocks);

  // Strip @migration-task comments if no $$props references remain anywhere
  // EXCEPT inside those very comments. Strip-then-check, restore if still dirty.
  const stripped = updated.replace(MIGRATION_TASK, "");
  if (!DOLLAR_PROPS_ANY.test(stripped)) {
    updated = stripped;
  }

  return updated;
}
