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

import { ANALYTICS_CSP } from "../../configs/svelte.js";

export type CspEditPlan =
  /** No `csp` option in svelte.config.js. A policy set elsewhere (a header) was not read. */
  | { kind: "none" }
  /** `analytics` is already on. */
  | { kind: "already" }
  /** The rewritten file. */
  | { kind: "edit"; next: string }
  /**
   * Not edited. The caller reports and does not write. `policy` says whether a
   * CSP is known to be there ("present": the option was located) or only
   * possible ("possible": the file could not be parsed far enough to tell), so
   * the note never claims the browser refuses a loader on a site with no CSP.
   * `handAdd` is always the full host list, whatever the reason.
   */
  | { kind: "refuse"; reason: string; policy: "present" | "possible"; handAdd: string };

/** {@link ANALYTICS_CSP}, spelled for a human to add by hand, one directive per
 *  clause. Derived from the constant, never transcribed: a copied host list
 *  cannot be told apart from a stale one, and round six's review found the
 *  transcribed copy here had fallen out of every refusal it was meant for. */
export const HAND_ADD_HOSTS: string = Object.entries(ANALYTICS_CSP)
  .map(([directive, hosts]) => `${directive} ${hosts.join(" ")}`)
  .join("; ");

function refuse(reason: string, policy: "present" | "possible"): CspEditPlan {
  return { kind: "refuse", reason, policy, handAdd: HAND_ADD_HOSTS };
}

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
 * A POSITIVE test: the object that holds this `csp:` key must be the literal
 * first argument of a `createSvelteConfig(` call. The previous test was
 * negative ("not under a `kit:` key"), so a kit object held in a variable —
 * `const kit = { csp: {…} }` — read as the factory's and was edited into a
 * build failure.
 */
function isFactoryOption(masked: string, cspIndex: number): boolean {
  let depth = 0;
  for (let i = cspIndex - 1; i >= 0; i--) {
    const c = masked[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth > 0) {
        depth--;
        continue;
      }
      // The object literal that holds the key. What opened it?
      return /\bcreateSvelteConfig\s*\(\s*$/.test(masked.slice(Math.max(0, i - 60), i));
    }
  }
  return false;
}

/** The 1-based line of `index` in `source`. */
function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

export function planCspEdit(source: string): CspEditPlan {
  // Certain, and checked first: a file that never says "csp" in any case, in
  // code, comment or string, sets no CSP here. roalson-interests' refusal on
  // a regex literal used to precede this, so a site with no CSP at all was
  // told the browser refuses its loader.
  if (!/csp/i.test(source)) return { kind: "none" };

  // Located against the masked copy so prose cannot be mistaken for code, then
  // sliced out of the ORIGINAL, which the mask is length-preserving for.
  const masked = maskNonCode(source);

  // FAIL CLOSED on anything the masker cannot classify.
  //
  // The masker has no notion of regex literals, and it does not need one — but
  // it must not pretend. A quote inside a regex (`const A = /'/;`) opens a
  // phantom string and INVERTS quote parity for the rest of the file, after
  // which the edit can land inside a comment while the note reports success.
  // Comments are blanked INCLUDING their `//` and `/*`, so any `/` left in the
  // mask is in code position: division, or a regex literal.
  const stray = masked.indexOf("/");
  if (stray !== -1) {
    const mention = /\bcsp\s*:/.exec(source);
    return refuse(
      `svelte.config.js line ${lineOf(source, stray)} has a \`/\` this recipe cannot classify ` +
        "(a regex literal or division), and quote parity after one is not something it will " +
        "guess at, so it did not look for the CSP" +
        (mention !== null
          ? ` (the file mentions \`csp:\` at line ${lineOf(source, mention.index)})`
          : ""),
      "possible",
    );
  }

  const matches = [...masked.matchAll(CSP_KEY)];
  if (matches.length === 0) {
    // "csp" appears, but never as a `csp:` key in code: in a comment, a string
    // (a quoted `"csp":` key is a string to the masker), or as a shorthand
    // `{ csp }`. The last two set a policy this recipe cannot see.
    if (/\bcsp\b/.test(masked) || /["'`]csp["'`]\s*:/.test(source)) {
      return refuse(
        "svelte.config.js sets `csp` in a shape this recipe does not parse (a shorthand " +
          "`{ csp }` or a quoted key)",
        "possible",
      );
    }
    return { kind: "none" };
  }
  if (matches.length > 1) {
    return refuse(
      `found ${matches.length} \`csp:\` keys, so which one configures the policy is ambiguous`,
      "present",
    );
  }

  const m = matches[0] as RegExpMatchArray;
  const keyIndex = (m.index ?? 0) + (m[1]?.length ?? 0);
  const valueStart = (m.index ?? 0) + m[0].length;
  const rest = source.slice(valueStart);
  const maskedRest = masked.slice(valueStart);

  if (!isFactoryOption(masked, keyIndex)) {
    return refuse(
      "this `csp` is not the literal option object of a `createSvelteConfig(` call — it is " +
        "SvelteKit's own `kit.csp`, or an object this recipe cannot trace to the factory. " +
        "`analytics` is not a key SvelteKit accepts in kit.csp; it rejects unknown keys and the " +
        "build would fail",
      "present",
    );
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
      return refuse("the `csp: {` block has no matching closing brace", "present");
    }
    const block = maskedRest.slice(0, end + 1);
    if (/(^|[{,\s])analytics:\s*true\b/.test(block)) return { kind: "already" };
    if (/(^|[{,\s])analytics:/.test(block)) {
      return refuse("`csp` already sets `analytics` to something other than true", "present");
    }
    return {
      kind: "edit",
      next: source.slice(0, valueStart) + "{ analytics: true," + rest.slice(1),
    };
  }

  return refuse(
    `\`csp:\` is set to an expression this recipe cannot extend (${rest.slice(0, 40).split("\n")[0]}…)`,
    "present",
  );
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
