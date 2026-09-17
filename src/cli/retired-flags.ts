/**
 * Retired CLI flag spellings, and the one place they are translated (#698).
 *
 * `--write-airtable` named the store the flag once wrote to. Since the #539 flip
 * Turso is authoritative and Airtable is the shadow, so the name described the
 * wrong store — and agents believed it. The flag is now `--write-back`: it writes
 * the site's row, in whichever stores the write path owns, which stays true after
 * Phase 6 removes the shadow.
 *
 * The old spelling still works, because it is typed by runbooks, shell history
 * and anything outside this repository that cannot be updated in the same commit.
 * It is rewritten in argv BEFORE cac parses rather than registered as a second
 * `.option()`: cac has no hidden options, so a second registration would keep
 * advertising the retired name in every `--help`.
 *
 * Kept free of imports: bin.ts loads it statically, and the smoke-dist gate holds
 * bin.js's static import closure to its own light dependencies.
 */
export const RETIRED_FLAGS: Readonly<Record<string, string>> = {
  "--write-airtable": "--write-back",
};

/** Return `argv` with every retired flag replaced by its current name. `argv[0]`
 *  and `argv[1]` (node and the script) are never touched, nor is anything after a
 *  `--` terminator. Each retired spelling seen is reported once through `note`. */
export function rewriteRetiredFlags(
  argv: readonly string[],
  note: (message: string) => void = (message) => console.error(message),
): string[] {
  const seen = new Set<string>();
  const out = argv.slice(0, 2);
  let terminated = false;
  for (const token of argv.slice(2)) {
    if (terminated || token === "--") {
      terminated = true;
      out.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const next = Object.hasOwn(RETIRED_FLAGS, name) ? RETIRED_FLAGS[name] : undefined;
    if (next === undefined) {
      out.push(token);
      continue;
    }
    if (!seen.has(name)) {
      seen.add(name);
      note(`note: ${name} is now ${next}; the old spelling still works.`);
    }
    out.push(eq === -1 ? next : `${next}${token.slice(eq)}`);
  }
  return out;
}
