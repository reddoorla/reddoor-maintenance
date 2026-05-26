/** Locate `interface $$Props {` declarations and remove them, including
 * the matching closing `}` even if the body has nested braces or spans
 * multiple lines. Regex alone can't do balanced-brace matching, so we
 * walk the string manually. */
function removeInterfaceBlock(source: string): string {
  const re = /^\s*interface\s+\$\$Props\s*\{/m;
  let out = source;
  while (true) {
    const match = re.exec(out);
    if (!match) return out;

    const openBraceIdx = match.index + match[0].length - 1;
    let depth = 1;
    let i = openBraceIdx + 1;
    while (i < out.length && depth > 0) {
      const ch = out[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    if (depth !== 0) return out; // unbalanced; bail rather than corrupt

    // Consume trailing whitespace through end-of-line.
    let endIdx = i;
    while (endIdx < out.length && /[ \t]/.test(out[endIdx] ?? "")) endIdx++;
    if (out[endIdx] === "\n") endIdx++;

    out = out.slice(0, match.index) + out.slice(endIdx);
  }
}

/** Find the index of the closing quote for a string literal that opens at
 * `openIdx`. Handles backslash escapes. Returns -1 if unterminated. */
function findStringEnd(source: string, openIdx: number): number {
  const quote = source[openIdx];
  let i = openIdx + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i;
    i++;
  }
  return -1;
}

/** Mask every `'…'`, `"…"`, and template literal in `source` with a placeholder
 * so subsequent regex passes can rewrite identifiers without corrupting string
 * contents. Returns the masked body and a function to restore originals. */
function maskStringLiterals(source: string): {
  masked: string;
  restore: (s: string) => string;
} {
  const strings: string[] = [];
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const closeIdx = findStringEnd(source, i);
      if (closeIdx === -1) {
        out += source.slice(i);
        break;
      }
      const literal = source.slice(i, closeIdx + 1);
      out += `__RDMNT_STR_${strings.length}__`;
      strings.push(literal);
      i = closeIdx + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return {
    masked: out,
    restore: (s) => s.replace(/__RDMNT_STR_(\d+)__/g, (_full, idx) => strings[Number(idx)] ?? ""),
  };
}

const PROPS_DECL = /let\s*\{([^}]*)\}\s*(?::\s*\{([^}]*)\})?\s*=\s*\$props\(\)\s*;?/;

/** If the script declares `let { … } = $props();` (with or without an inline
 * type annotation) and doesn't already collect `...rest`, inject it. For TS,
 * widen the inline type with an `[key: string]: unknown` index signature so
 * the rest binding actually captures excess attributes (without the widening,
 * TS infers `rest` as `{}` and the spread forwards nothing). */
function injectRestIntoProps(scriptBody: string): string {
  const match = scriptBody.match(PROPS_DECL);
  if (!match) return scriptBody;
  const destructured = match[1] ?? "";
  if (/\.\.\.\s*\w+/.test(destructured)) return scriptBody; // already has rest

  const trimmed = destructured.trim();
  const newDestructured = trimmed === "" ? " ...rest " : ` ${trimmed}, ...rest `;

  let replacement: string;
  if (match[2] !== undefined) {
    const typeBody = match[2];
    const hasIndexSig = /\[\s*key\s*:\s*string\s*\]\s*:/.test(typeBody);
    const newTypeBody = hasIndexSig
      ? typeBody
      : `${typeBody.trimEnd().replace(/;?\s*$/, "")}; [key: string]: unknown `;
    replacement = `let {${newDestructured}}: {${newTypeBody}} = $props();`;
  } else {
    replacement = `let {${newDestructured}} = $props();`;
  }
  return scriptBody.replace(PROPS_DECL, replacement);
}

const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script>/;
const HAS_PROPS_CALL = /\$props\(\s*\)/;

export function removeDollarRestProps(source: string): string {
  const next = removeInterfaceBlock(source);

  const scriptMatch = next.match(SCRIPT_BLOCK);
  if (!scriptMatch) return next;
  if (!HAS_PROPS_CALL.test(scriptMatch[2] ?? "")) {
    // No $props() in this script — refuse to rewrite $$restProps anywhere, since
    // doing so would emit references to an undeclared identifier. The user sees
    // the original $$restProps and a clear Svelte 5 build error to migrate by hand.
    return next;
  }

  const scriptInner = scriptMatch[2] ?? "";
  const { masked, restore } = maskStringLiterals(scriptInner);
  let processed = injectRestIntoProps(masked);
  processed = processed.replace(/\$\$restProps/g, "rest");
  const restoredInner = restore(processed);

  // Use a function callback so `$$` in the restored script body isn't
  // interpreted as the `$` substitution pattern by String.prototype.replace.
  const newScriptBlock = scriptMatch[0].replace(scriptInner, () => restoredInner);
  const before = next.slice(0, scriptMatch.index!);
  const after = next.slice(scriptMatch.index! + scriptMatch[0].length);

  // Template (outside script) gets a plain swap. Template attribute strings
  // containing the literal text "$$restProps" are vanishingly rare in practice;
  // accept the limitation rather than parse the whole template.
  return (
    before.replace(/\$\$restProps/g, "rest") +
    newScriptBlock +
    after.replace(/\$\$restProps/g, "rest")
  );
}
