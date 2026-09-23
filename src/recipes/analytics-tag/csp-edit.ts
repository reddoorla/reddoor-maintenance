/**
 * Turning on the analytics hosts in a site's `svelte.config.js`.
 *
 * The emitted policy carries no `'strict-dynamic'` (measured on
 * reddoor-starter, 2026-09-22), so the host allowlist governs the loader
 * `initAnalytics` injects from bundle JS exactly as it would one typed into
 * `app.html`. A site with a CSP and no `analytics: true` therefore ships a tag
 * the browser refuses, and refuses SILENTLY as far as the page is concerned:
 * the property simply records nothing.
 *
 * These files are hand-maintained and heavily commented — reddoor-starter's
 * `csp` block is ~50 lines of reasoning around a dozen values — so this edit
 * does exactly one thing and REFUSES anything it does not recognise. A recipe
 * that half-rewrites a production CSP is worse than one that says "this site
 * needs a hand": the failure lands on the live site, on every request.
 */

export type CspEditPlan =
  /** No `csp` option at all. The site has no CSP, so nothing governs the loader. */
  | { kind: "none" }
  /** `analytics` is already on. */
  | { kind: "already" }
  /** The rewritten file. */
  | { kind: "edit"; next: string }
  /** Recognised the option but not its shape. The caller reports and does not write. */
  | { kind: "refuse"; reason: string };

/** `csp:` as an object KEY — start of line or after `{`/`,` — so a `csp:` inside
 *  a comment or a string is not mistaken for the option. */
const CSP_KEY = /(^|[{,\s])csp:\s*/gm;

/**
 * A copy of `source` with every comment body and string body replaced by
 * spaces, preserving length so indices still line up with the original.
 *
 * Without this, prose counts as code. These files carry ~50 lines of comment
 * around a dozen values, and a sentence mentioning the `csp:` option read as a
 * second occurrence and made the whole edit refuse itself as ambiguous —
 * caught by a test, on a shape reddoor-starter is one edit away from.
 */
export function maskNonCode(source: string): string {
  const out = source.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const nl = source.indexOf("\n", i);
      const end = nl === -1 ? source.length : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === c) break;
        j++;
      }
      blank(i + 1, j);
      i = Math.min(j + 1, source.length);
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * Is this `csp:` an option of `createSvelteConfig`, or SvelteKit's own
 * `kit.csp`?
 *
 * It matters absolutely. `analytics` is a REDDOOR option that
 * `createSvelteConfig` strips before it builds `kit.csp`. SvelteKit's own
 * config schema types `kit.csp` as `{mode, directives, reportOnly}` with
 * unknown keys REJECTED, and throws `Unexpected option config.kit.csp.analytics`
 * at validation — so writing it into a native block does not merely fail to
 * work, it breaks the build.
 *
 * The first version of this module did not distinguish the two and the mapping
 * turned out to be perfectly inverted: measured across all 28 fleet configs, it
 * fired on 13 native blocks where the option is invalid and on zero of the 12
 * `createSvelteConfig` callers where it would have worked. Both starter
 * templates were in that 13. The proof that "passed" was `node --check`, which
 * only ever asked whether the result was syntactically a JavaScript file.
 */
function usesConfigFactory(source: string, masked: string, cspIndex: number): boolean {
  if (!/\bcreateSvelteConfig\s*\(/.test(masked)) return false;
  // A `csp:` nested inside a `kit: { … }` is SvelteKit's own, even in a file
  // that also calls the factory.
  const before = masked.slice(0, cspIndex);
  let depth = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const c = before[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        // The key that opened this block.
        const key = /([A-Za-z_$][\w$]*)\s*:\s*$/.exec(before.slice(Math.max(0, i - 40), i));
        if (key?.[1] === "kit") return false;
        continue;
      }
      depth--;
    }
  }
  return true;
}

/** The hosts, spelled for a human to paste into a native `kit.csp`. */
const MANUAL_HOSTS = [
  '"script-src": add "https://www.googletagmanager.com"',
  '"connect-src": add "https://www.google-analytics.com", "https://*.google-analytics.com", "https://*.analytics.google.com"',
  '"img-src": add "https://www.google-analytics.com"',
].join("; ");

export function planCspEdit(source: string): CspEditPlan {
  // Located against the masked copy so prose cannot be mistaken for code, then
  // sliced out of the ORIGINAL, which the mask is length-preserving for.
  const masked = maskNonCode(source);

  // FAIL CLOSED on anything the masker cannot classify.
  //
  // The masker has no notion of regex literals, and it does not need one — but
  // it must not pretend. A quote inside a regex (`const A = /'/;`) opens a
  // phantom string and INVERTS quote parity for the rest of the file, after
  // which the edit can land inside a comment while `cspNote` reports success:
  // a wrong edit that parses, on a live site's policy, announced as done. That
  // is the one outcome this module exists to prevent, so an unclassifiable
  // slash is a refusal rather than a guess.
  //
  // Comments are blanked INCLUDING their `//` and `/*`, so any `/` left in the
  // mask is in code position: division, or a regex literal. None of the 22
  // fleet configs has one, so refusing costs nothing today and cannot be
  // silently wrong tomorrow.
  const stray = masked.indexOf("/");
  if (stray !== -1) {
    const line = source.slice(0, stray).split("\n").length;
    return {
      kind: "refuse",
      reason:
        `line ${line} has a \`/\` this recipe cannot classify as a comment (a regex literal or ` +
        "division). Quote parity after one is not something it will guess at",
    };
  }
  const matches = [...masked.matchAll(CSP_KEY)];
  if (matches.length === 0) return { kind: "none" };
  if (matches.length > 1) {
    return {
      kind: "refuse",
      reason: `found ${matches.length} \`csp:\` keys, so which one configures the policy is ambiguous`,
    };
  }

  const m = matches[0] as RegExpMatchArray;
  const valueStart = (m.index ?? 0) + m[0].length;
  const rest = source.slice(valueStart);
  const maskedRest = masked.slice(valueStart);

  if (!usesConfigFactory(source, masked, m.index ?? 0)) {
    return {
      kind: "refuse",
      reason:
        "this `csp` is SvelteKit's own `kit.csp`, not a `createSvelteConfig` option. " +
        "`analytics` is not a key SvelteKit accepts there — it rejects unknown csp keys and the " +
        `build would fail. Add the hosts to the directives by hand: ${MANUAL_HOSTS}`,
    };
  }

  if (/^true\b/.test(rest)) {
    return {
      kind: "edit",
      next: source.slice(0, valueStart) + "{ analytics: true }" + rest.slice("true".length),
    };
  }

  if (rest.startsWith("{")) {
    // Scoped to the option's own braces, not the whole file: a site with an
    // unrelated `analytics` key elsewhere must not read as already done.
    const end = matchingBrace(maskedRest);
    if (end === null) {
      return { kind: "refuse", reason: "the `csp: {` block has no matching closing brace" };
    }
    const block = maskedRest.slice(0, end + 1);
    if (/(^|[{,\s])analytics:\s*true\b/.test(block)) return { kind: "already" };
    if (/(^|[{,\s])analytics:/.test(block)) {
      return {
        kind: "refuse",
        reason: "`csp` already sets `analytics` to something other than true",
      };
    }
    return {
      kind: "edit",
      next: source.slice(0, valueStart) + "{ analytics: true," + rest.slice(1),
    };
  }

  return {
    kind: "refuse",
    reason: `\`csp:\` is set to an expression this recipe cannot extend (${rest.slice(0, 40).split("\n")[0]}…)`,
  };
}

/** Index of the `}` closing the `{` at position 0, or null. Skips braces inside
 *  strings, template literals and comments, which every one of these files has. */
function matchingBrace(s: string): number | null {
  let depth = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;
    const next = s[i + 1];
    if (c === "/" && next === "/") {
      const nl = s.indexOf("\n", i);
      if (nl === -1) return null;
      i = nl + 1;
      continue;
    }
    if (c === "/" && next === "*") {
      const close = s.indexOf("*/", i + 2);
      if (close === -1) return null;
      i = close + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(s, i, c);
      if (end === null) return null;
      i = end;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return null;
}

/** Index just past the string starting at `start` with quote `quote`, or null. */
function skipString(s: string, start: number, quote: string): number | null {
  let i = start + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    i++;
  }
  return null;
}
