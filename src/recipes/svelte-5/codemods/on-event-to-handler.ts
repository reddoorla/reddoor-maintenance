const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script>/g;
const SIMPLE_ON_EVENT = /\bon:([a-z]+)(?=\s*=)/g;
const MODIFIER_EVENT = /\bon:[a-z]+\|[a-zA-Z]+(?=\s*=)/g;

/** Svelte 5 removed event modifier syntax (`on:click|preventDefault={fn}`).
 * The rewrite is non-trivial — the modifier behavior must be inlined into
 * the handler body — so this codemod doesn't attempt it automatically.
 * Instead it inserts a `@migration-task` marker immediately above each
 * offending element so the user gets a visible audit trail rather than
 * a silent build error from the Svelte 5 compiler. */
function flagEventModifiers(source: string): string {
  const insertions: Array<{ tagStart: number; indent: string; modifier: string }> = [];
  let m: RegExpExecArray | null;
  MODIFIER_EVENT.lastIndex = 0;
  while ((m = MODIFIER_EVENT.exec(source)) !== null) {
    const tagStart = source.lastIndexOf("<", m.index);
    if (tagStart === -1) continue;

    // Idempotency: if the line immediately above the tag already carries an
    // @migration-task marker for this site, don't double-insert on re-run.
    const prevLineEnd = tagStart - 1;
    if (prevLineEnd >= 0) {
      const prevLineStart = source.lastIndexOf("\n", prevLineEnd - 1) + 1;
      const prevLine = source.slice(prevLineStart, prevLineEnd + 1);
      if (/<!--\s*@migration-task/.test(prevLine)) continue;
    }

    const lineStart = source.lastIndexOf("\n", tagStart - 1) + 1;
    const indent = source.slice(lineStart, tagStart);
    const safeIndent = /^[ \t]*$/.test(indent) ? indent : "";
    insertions.push({ tagStart, indent: safeIndent, modifier: m[0] });
  }

  // Apply back-to-front so earlier insertion offsets stay valid.
  let out = source;
  for (let i = insertions.length - 1; i >= 0; i--) {
    const { tagStart, indent, modifier } = insertions[i]!;
    const comment = `<!-- @migration-task: Svelte 5 removed event modifier syntax (\`${modifier}\`). Rewrite inline, e.g. onclick={(e) => { e.preventDefault(); ... }}. -->\n${indent}`;
    out = out.slice(0, tagStart) + comment + out.slice(tagStart);
  }
  return out;
}

export function onEventToHandler(source: string): string {
  const masked: string[] = [];
  const placeholder = (i: number): string => ` SCRIPT_${i} `;
  const intermediate = source.replace(SCRIPT_BLOCK, (match) => {
    masked.push(match);
    return placeholder(masked.length - 1);
  });

  let processed = intermediate.replace(SIMPLE_ON_EVENT, (_full, name: string) => `on${name}`);
  processed = flagEventModifiers(processed);

  let out = processed;
  masked.forEach((blk, i) => {
    out = out.replace(placeholder(i), blk);
  });

  return out;
}
