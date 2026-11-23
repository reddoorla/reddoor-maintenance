// Find hard-coded visitor-facing literals in one SvelteKit source file.
//
// One parser for everything: a `.svelte` file is parsed as itself, and a
// `.ts`/`.js` file is parsed as the body of a `<script lang="ts">` block, so the
// template and every script share one ESTree walk and one set of rules. The
// wrapper opens on the file's first line, so line numbers are the file's own.
//
// The two questions the walk answers for each string literal:
//   1. Does a visitor read or see it? (`rules.ts`: a place in the template, a
//      content-shaped name, or a value shaped like a phone, URL or asset.)
//   2. Is it a FALLBACK for a Prismic field? (`isFallback` below.) The operator
//      kept fallbacks (decision 2026-11-21-1841, fork 1), so these never count.
import { parse } from "svelte/compiler";
import {
  FALLBACK_HELPER,
  assetKind,
  isDecorative,
  isMachineUrl,
  isPropertyLine,
  isIdentifierLike,
  isProseKind,
  kindForKey,
  linkKind,
  refineProse,
  strongKind,
  type Kind,
} from "./rules.js";

export type Finding = { file: string; line: number; kind: Kind; text: string };

export type ScanOptions = {
  /** Extra fallback helper names (the site's own `vimeoIdOr`-style calls). */
  fallbackHelpers?: readonly string[];
  /** Literals never to report: exact strings, or `/regex/flags`. */
  ignore?: readonly string[];
  /** The parameter names of a function this file calls by name, wherever it
   *  is defined (`scanSite` resolves imports). An argument passed to a
   *  parameter named `fallback…` or `default…` is a fallback. */
  paramsOf?: (callee: string) => readonly string[] | undefined;
  /** Does the site's error page show `error()`'s message? `scanSite` reads
   *  its `+error.svelte`; on its own a file assumes SvelteKit's default
   *  page, which does. */
  kitErrorShown?: boolean;
};

/** A literal inside an exported constant: whether it is a fallback depends on
 *  how other files read the constant, so the site-level scan decides. */
export type Deferred = Finding & { binding: string };

export type Uses = Map<string, { bare: number; fallback: number }>;

/** A component's prop default, or a literal behind `prop || "…"`: shown
 *  whenever a caller leaves the prop out, so the site-level scan decides by
 *  the component's call sites. With several props (`a || b || "…"`), a call
 *  that passes any one of them covers it. */
export type PropDefault = Finding & { prop: string | readonly string[] };

export type FileScan = {
  findings: Finding[];
  deferred: Deferred[];
  uses: Uses;
  props: PropDefault[];
};

/** One `<Component …>` in a template: the props it passes. A spread of an
 *  object literal (or a `const` of one) passes its keys; any other spread may
 *  pass anything, so `spread` is set. */
export type Usage = { name: string; attrs: string[]; spread: boolean };

/** What other files need to know about this one: what it imports from where,
 *  and the parameter names of the functions it defines. */
export type Parsed = {
  file: string;
  ast: Node;
  isSvelte: boolean;
  lineOf: (pos: number) => number;
  /** local name → where it comes from (`imported` is "default" or "*" for those forms) */
  imports: Map<string, { source: string; imported: string }>;
  /** function name → parameter names, for functions declared at top level */
  functions: Map<string, string[]>;
  /** `export { a as b } from "./x"` (imported "a", exported "b") and
   *  `export * from "./x"` (both "*"): what a barrel passes on. */
  reexports: Array<{ source: string; imported: string; exported: string }>;
  /** every component this file renders, and the props each passes */
  usages: Usage[];
};

type Node = { type: string; start?: number; end?: number; [key: string]: unknown };

const isNode = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";

/** The name a `.json` file's value is scanned under; its importers' default
 *  import reads it. */
export const JSON_BINDING = "__json__";

/** A parse that failed. The caller reports it and moves on: one odd file must
 *  never turn the check (and so a site's CI) red in warn mode. */
export class ScanParseError extends Error {}

// --- small AST helpers --------------------------------------------------------

const children = (node: Node): Array<[string, Node]> => {
  const out: Array<[string, Node]> = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "metadata" || key === "parent") continue;
    if (Array.isArray(value)) {
      for (const v of value) if (isNode(v)) out.push([key, v]);
    } else if (isNode(value)) {
      out.push([key, value]);
    }
  }
  return out;
};

/** A string literal's text, or a template literal's with `${…}` for each hole. */
function literalText(node: Node): string | undefined {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") {
    const quasis = node.quasis as Array<{ value: { cooked: string | null; raw: string } }>;
    return quasis.map((q) => q.value.cooked ?? q.value.raw).join("${…}");
  }
  return undefined;
}

const isPureLiteral = (node: Node): boolean =>
  node.type === "Literal" ||
  (node.type === "TemplateLiteral" && (node.expressions as unknown[]).length === 0);

/** A literal, or words written around holes (`${count} homes built`): a
 *  ternary between one and a literal chooses between two things the code
 *  says, so neither branch is a fallback (review round 4 on #2231). */
const isWordLiteral = (node: Node): boolean =>
  isPureLiteral(node) ||
  (node.type === "TemplateLiteral" && /[a-z]{2}/i.test(literalText(node)!.replace(/\$\{…\}/g, "")));

/** `a.b.c` / `a?.b` / `a["b"]` as a dotted path, else undefined. */
function memberPath(node: Node): string | undefined {
  if (node.type === "Identifier") return node.name as string;
  if (node.type === "ChainExpression") return memberPath(node.expression as Node);
  if (node.type === "MemberExpression") {
    const obj = memberPath(node.object as Node);
    const prop = node.property as Node;
    const name =
      !node.computed && prop.type === "Identifier"
        ? (prop.name as string)
        : prop.type === "Literal"
          ? String(prop.value)
          : undefined;
    return obj && name ? `${obj}.${name}` : undefined;
  }
  return undefined;
}

/** The values an expression reads, without the functions it calls: in
 *  `isFilled.image(d?.logo) && quoted` that is `d.logo` and `quoted`, not
 *  `isFilled.image`. A callee's object is still read: `doc.title.trim()`
 *  reads `doc.title`. */
function valuePaths(node: Node, out = new Set<string>()): Set<string> {
  if (node.type === "CallExpression" || node.type === "NewExpression") {
    const callee = node.callee as Node;
    if (callee.type === "MemberExpression") valuePaths(callee.object as Node, out);
    for (const a of node.arguments as Node[]) valuePaths(a, out);
    return out;
  }
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") return out;
  if (node.type === "MemberExpression" || node.type === "Identifier") {
    const p = memberPath(node);
    if (p) {
      out.add(p);
      if (node.type === "MemberExpression" && node.computed) valuePaths(node.property as Node, out);
      return out;
    }
  }
  for (const [key, c] of children(node)) {
    if ((node.type === "Property" && key === "key" && !node.computed) || key === "typeAnnotation") {
      continue;
    }
    valuePaths(c, out);
  }
  return out;
}

/** Do two sets of paths read the same value? `content.hero` and
 *  `content.hero.url` do; `page.status` and `page.error` do not. */
function sharePath(a: Set<string>, b: Set<string>): boolean {
  for (const p of a) {
    for (const q of b) if (p === q || q.startsWith(`${p}.`) || p.startsWith(`${q}.`)) return true;
  }
  return false;
}

/** Svelte runes that only wrap a value: `const x = $derived("…")`. */
const RUNE = /^\$(?:derived|state)(?:\.raw)?$/;
/** Svelte context getters: `getContext`, `getAppState`, `getCartStore`. */
const CONTEXT_GETTER = /^getContext$|^get\w*(?:State|Context|Store)$/;
const calleePath = (node: Node): string | undefined => memberPath(node.callee as Node);

const calleeName = (node: Node): string | undefined => {
  const callee = node.callee as Node;
  if (callee.type === "Identifier") return callee.name as string;
  if (callee.type === "MemberExpression" && !callee.computed) {
    return (callee.property as Node).name as string;
  }
  return undefined;
};

/** HTML attributes whose value a visitor reads or sees. */
const SHOWN_ATTRS = new Set([
  "alt",
  "title",
  "aria-label",
  "placeholder",
  "src",
  "srcset",
  "href",
  "content",
  "value",
  "label",
  "poster",
]);

/** Template directives whose values are behaviour or styling, never shown. */
const DIRECTIVES = new Set([
  "OnDirective",
  "BindDirective",
  "UseDirective",
  "TransitionDirective",
  "AnimateDirective",
  "LetDirective",
  "ClassDirective",
  "StyleDirective",
]);

/** A `class`/`style` attribute or a `class:`/`style:` directive. */
const isStyling = (n: Node): boolean =>
  n.type === "ClassDirective" ||
  n.type === "StyleDirective" ||
  (n.type === "Attribute" && /^(?:class|style)$/i.test(String(n.name)));

/** Methods whose string argument is matched against, never shown. */
const STRING_TEST =
  /^(?:startsWith|endsWith|includes|indexOf|lastIndexOf|split|match|matchAll|search|replace|replaceAll|test|has|get|getAll|getAttribute|hasAttribute|querySelector|querySelectorAll|closest|matches|addEventListener|removeEventListener)$/;

/** A URL or path to code or data, never something a visitor sees. */
const CODE_URL = /\.(?:m?js|css|json|xml)(?:[?#].*)?$/i;

const ELEMENTS = new Set([
  "RegularElement",
  "Component",
  "SvelteElement",
  "SvelteComponent",
  "SvelteSelf",
]);

/** Expression wrappers a literal passes through without changing its role. */
const TRANSPARENT = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "ParenthesizedExpression",
  "ChainExpression",
]);

/** Elements a visitor acts on, or that hold a whole region: a branch holding
 *  one is an alternate template, never a stand-in for one field. */
const INTERACTIVE = new Set([
  "a",
  "button",
  "form",
  "input",
  "select",
  "textarea",
  "label",
  "details",
  "dialog",
  "nav",
  "header",
  "footer",
  "section",
  "ul",
  "ol",
]);
/** Inline formatting that keeps a run of text one text. */
const INLINE = new Set(["em", "strong", "b", "i", "span", "br", "small", "sup", "sub", "mark"]);
/** Media whose own children are its sources. */
const MEDIA = new Set(["picture", "video", "audio"]);

const contentNodes = (fragment: Node | undefined): Node[] =>
  ((fragment?.nodes as Node[] | undefined) ?? []).filter(
    (n) => n.type !== "Comment" && !(n.type === "Text" && String(n.data).trim() === ""),
  );

/** A run of text: text, `{expr}` and inline formatting around text. */
const isInlineText = (n: Node): boolean =>
  n.type === "Text" ||
  n.type === "ExpressionTag" ||
  (n.type === "RegularElement" &&
    INLINE.has(String(n.name).toLowerCase()) &&
    contentNodes(n.fragment as Node).every(isInlineText));

/**
 * Is a branch a leaf substitute for one field: one run of text, or one
 * element holding one (a heading, a paragraph, an image, a `<picture>` with
 * its sources), perhaps inside plain wrappers? A link, a button, a form, a
 * nested block, a component or a second element makes it an alternate
 * template, whose words are the site's own (review round 3 on #2231: the
 * starter `Nav`'s `{:else}` is the whole site-config menu).
 */
function isLeafSubstitute(fragment: Node | undefined): boolean {
  const nodes = contentNodes(fragment);
  if (nodes.every(isInlineText)) return true;
  if (nodes.length !== 1) return false;
  const [el] = nodes as [Node];
  if (el.type !== "RegularElement") return false;
  const name = String(el.name).toLowerCase();
  if (INTERACTIVE.has(name)) return false;
  if (MEDIA.has(name)) {
    return contentNodes(el.fragment as Node).every(
      (c) =>
        c.type === "RegularElement" &&
        /^(?:source|track|img)$/i.test(String(c.name)) &&
        contentNodes(c.fragment as Node).length === 0,
    );
  }
  return isLeafSubstitute(el.fragment as Node);
}

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** Is the `url()` at `at` the value of a `mask` property (`mask-image`,
 *  `-webkit-mask`)? A mask is a shape the page is cut by, never a picture
 *  (review round 6: vida's heart mask). Read without a regex over the
 *  declaration, so it stays linear on any input. */
function isMask(css: string, at: number): boolean {
  const before = css.slice(0, at);
  const decl = before.slice(Math.max(before.lastIndexOf(";"), before.lastIndexOf("{")) + 1);
  const colon = decl.lastIndexOf(":");
  if (colon < 0) return false;
  const prop = decl.slice(0, colon).trim().split(/\s+/).at(-1) ?? "";
  return prop
    .toLowerCase()
    .replace(/^-webkit-/, "")
    .startsWith("mask");
}

// --- the scanner --------------------------------------------------------------

type Ancestor = { node: Node; key: string };

const paramName = (p: Node): string => {
  if (p.type === "Identifier") return p.name as string;
  if (p.type === "AssignmentPattern") return paramName(p.left as Node);
  return "";
};

export function parseFile(file: string, source: string): Parsed {
  const isSvelte = file.endsWith(".svelte");
  // A `</script` inside a .ts file (JSON-LD helpers write one) would end the
  // wrapper early, so it is defused to the same length first: offsets, and so
  // line numbers, stay the file's own. A `.json` file is one exported
  // constant, so its values meet the same key rules as a `.ts` file's, and
  // its importers decide whether they are fallbacks (pass 3).
  const body = file.endsWith(".json")
    ? `export const ${JSON_BINDING} = (${source.replace(/^\uFEFF/, "")})`
    : source;
  const wrapped = isSvelte
    ? source
    : `<script lang="ts">${body.replace(/<\/(script)/gi, "<_$1")}\n</script>`;

  let ast: Node;
  try {
    ast = parse(wrapped, { modern: true }) as unknown as Node;
  } catch (err) {
    throw new ScanParseError(`${file}: ${(err as Error).message.split("\n")[0]}`);
  }

  const lineStarts = [0];
  for (let i = 0; i < wrapped.length; i++) if (wrapped[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (pos: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const imports = new Map<string, { source: string; imported: string }>();
  const functions = new Map<string, string[]>();
  const reexports: Parsed["reexports"] = [];
  const nameOf = (n: Node): string => literalText(n) ?? (n.name as string);
  for (const script of [ast.module, ast.instance]) {
    if (!isNode(script)) continue;
    for (const top of (script.content as Node).body as Node[]) {
      if (top.type === "ExportAllDeclaration" && isNode(top.source)) {
        if (!top.exported) {
          reexports.push({ source: top.source.value as string, imported: "*", exported: "*" });
        }
        continue;
      }
      if (top.type === "ExportNamedDeclaration" && isNode(top.source)) {
        for (const sp of top.specifiers as Node[]) {
          reexports.push({
            source: top.source.value as string,
            imported: nameOf(sp.local as Node),
            exported: nameOf(sp.exported as Node),
          });
        }
        continue;
      }
      if (top.type === "ImportDeclaration") {
        const source = (top.source as Node).value as string;
        for (const sp of top.specifiers as Node[]) {
          const imported =
            sp.type === "ImportDefaultSpecifier"
              ? "default"
              : sp.type === "ImportNamespaceSpecifier"
                ? "*"
                : (literalText(sp.imported as Node) ?? ((sp.imported as Node).name as string));
          imports.set((sp.local as Node).name as string, { source, imported });
        }
        continue;
      }
      const decl = top.type === "ExportNamedDeclaration" ? (top.declaration as Node | null) : top;
      if (!decl) continue;
      if (decl.type === "FunctionDeclaration" && isNode(decl.id)) {
        functions.set(decl.id.name as string, (decl.params as Node[]).map(paramName));
      }
      if (decl.type === "VariableDeclaration") {
        for (const d of decl.declarations as Node[]) {
          const init = d.init as Node | null;
          const id = d.id as Node;
          if (
            init &&
            id.type === "Identifier" &&
            (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
          ) {
            functions.set(id.name as string, (init.params as Node[]).map(paramName));
          }
        }
      }
    }
  }
  // `const p = { label: "x" }`: what a `{...p}` spread passes, by its keys.
  const objects = new Map<string, Node>();
  (function collect(n: Node): void {
    if (n.type === "VariableDeclaration" && n.kind === "const") {
      for (const d of n.declarations as Node[]) {
        const init = d.init as Node | null;
        if ((d.id as Node).type === "Identifier" && init?.type === "ObjectExpression") {
          objects.set((d.id as Node).name as string, init);
        }
      }
    }
    for (const [, c] of children(n)) collect(c);
  })(ast);
  /** The keys a spread passes, or undefined when it cannot be seen (a prop,
   *  `slice`, a computed object): then it may pass anything (round 4). */
  const spreadKeys = (e: Node): string[] | undefined => {
    const o = e.type === "Identifier" ? objects.get(e.name as string) : e;
    if (o?.type !== "ObjectExpression") return undefined;
    const keys: string[] = [];
    for (const p of o.properties as Node[]) {
      if (p.type !== "Property" || p.computed) return undefined;
      const k = p.key as Node;
      const key = k.type === "Identifier" ? (k.name as string) : literalText(k);
      if (key === undefined) return undefined;
      keys.push(key);
    }
    return keys;
  };
  const usages: Usage[] = [];
  (function walk(n: Node): void {
    if (n.type === "Component" || n.type === "SvelteComponent") {
      const attrs = (n.attributes as Node[]) ?? [];
      const names = attrs
        .filter((a) => a.type === "Attribute" || a.type === "BindDirective")
        .map((a) => String(a.name));
      let spread = false;
      for (const a of attrs) {
        if (a.type !== "SpreadAttribute") continue;
        const keys = spreadKeys(a.expression as Node);
        if (keys) names.push(...keys);
        else spread = true;
      }
      usages.push({ name: String(n.name), attrs: names, spread });
    }
    for (const [, c] of children(n)) walk(c);
  })(ast);
  return { file, ast, isSvelte, lineOf, imports, functions, reexports, usages };
}

/** One file on its own: an exported constant's literals are reported unless
 *  this file's own reads of it are all fallbacks. `scanSite` sees further. */
export function scanSource(file: string, source: string, opts: ScanOptions = {}): Finding[] {
  const parsed = parseFile(file, source);
  const { findings, deferred, uses, props } = scanParsed(parsed, {
    ...opts,
    paramsOf: opts.paramsOf ?? ((name) => parsed.functions.get(name)),
  });
  const kept = deferred.filter((d) => !onlyFallbackUses(uses.get(d.binding)));
  return [
    ...findings,
    ...kept.map(({ binding: _b, ...f }) => f),
    ...props.map(({ prop: _p, ...f }) => f),
  ].sort((x, y) => x.line - y.line);
}

/** Every read is a fallback, and there is at least one. */
export const onlyFallbackUses = (u: { bare: number; fallback: number } | undefined): boolean =>
  u !== undefined && u.fallback > 0 && u.bare === 0;

/**
 * An `ignore` entry: an exact string, or `/regex/flags` when it is wrapped in
 * slashes (so `"/about/"` is a regex, and also hides "Learn about us"). Only
 * the flags `imsu` mean anything here; `g` and `y` are dropped, because they
 * make `.test()` remember where it stopped and skip every other match. Throws
 * on a bad pattern or flag, which `readConfig` turns into exit 2.
 */
export function compileIgnore(entry: string): string | RegExp {
  const m = /^\/(.*)\/([a-z]*)$/s.exec(entry);
  if (!m) return entry;
  const flags = m[2]!.replace(/[gy]/g, "");
  if (/[^imsu]/.test(flags))
    throw new Error(`ignore entry ${entry}: only the flags imsu are allowed`);
  try {
    return new RegExp(m[1]!, flags);
  } catch (err) {
    throw new Error(`ignore entry ${entry}: ${(err as Error).message}`, { cause: err });
  }
}

const FALLBACK_PARAM = /^(?:fallback|default|otherwise|backup)/i;

export function scanParsed(parsed: Parsed, opts: ScanOptions = {}): FileScan {
  const { file, ast, isSvelte, lineOf } = parsed;
  const helpers = new Set(opts.fallbackHelpers ?? []);

  // When is a test "about" a field, so that a branch of it can fall back for
  // that field? Only when it asks whether a value is EMPTY: `doc.title`,
  // `isFilled.image(doc.hero)`, `items.length > 0`, `x != null`, and `&&` / `||`
  // of those. A comparison with a literal (`theme === "dark"`,
  // `status === 404`) chooses between two things and is never a fallback test
  // (review round 2 on #2231).
  //
  // A local is followed into what it was computed from when the test reads it
  // whole (`{#if pair}` with `const pair = isFilled.image(d?.logo) && quoted`),
  // and only when its initialiser is itself an emptiness test; otherwise the
  // local stands for itself (`isMobile = $derived(w < 768)` is a switch).
  const inits = new Map<string, Node>();
  const snippets = new Map<string, Node>();
  const renders = new Map<string, number[]>();
  // Locals declared with no initialiser (`let error;`): Svelte 4 local state,
  // never a field, unless exported (a prop).
  const bareLets = new Set<string>();
  const eachOf = new Map<string, string>();
  (function collect(n: Node): void {
    if (n.type === "VariableDeclarator" && isNode(n.init) && (n.id as Node).type === "Identifier") {
      inits.set((n.id as Node).name as string, n.init);
    }
    if (n.type === "VariableDeclaration" && n.kind === "let") {
      for (const d of n.declarations as Node[]) {
        if (!d.init && (d.id as Node).type === "Identifier")
          bareLets.add((d.id as Node).name as string);
      }
    }
    if (n.type === "ExportNamedDeclaration" && isNode(n.declaration)) {
      for (const [, c] of children(n)) collect(c);
      for (const d of (n.declaration.declarations as Node[] | undefined) ?? []) {
        if ((d.id as Node).type === "Identifier") bareLets.delete((d.id as Node).name as string);
      }
      return;
    }
    // `{#each services as s}`: s → services, so showing s shows the list.
    if (
      n.type === "EachBlock" &&
      isNode(n.context) &&
      n.context.type === "Identifier" &&
      (n.expression as Node).type === "Identifier"
    ) {
      eachOf.set(n.context.name as string, (n.expression as Node).name as string);
    }
    if (n.type === "SnippetBlock" && (n.expression as Node).type === "Identifier") {
      snippets.set((n.expression as Node).name as string, n);
    }
    // `{@render card("x")}`: how many arguments each call of a snippet passes,
    // so a parameter's default is judged by the calls (review round 5).
    if (n.type === "RenderTag" && isNode(n.expression)) {
      const e = n.expression;
      const call = TRANSPARENT.has(e.type) ? (e.expression as Node) : e;
      if (call.type === "CallExpression" && (call.callee as Node).type === "Identifier") {
        const name = (call.callee as Node).name as string;
        renders.set(name, [...(renders.get(name) ?? []), (call.arguments as Node[]).length]);
      }
    }
    for (const [, c] of children(n)) collect(c);
  })(ast);
  // The names `$props()` hands this component: `let { sub, label: l } =
  // $props()` gives sub → sub and l → label; `let props = $props()` or a
  // `...rest` gives a whole object whose members are props. Svelte 4's
  // `export let sub` in the instance script is one too.
  const unwrapCall = (n: Node): string | undefined => {
    const u = TRANSPARENT.has(n.type) ? (n.expression as Node) : n;
    return u.type === "CallExpression" ? calleePath(u) : undefined;
  };
  const propLocals = new Map<string, string>();
  const propObjects = new Set<string>();
  for (const [name, init] of inits) {
    if (init.type === "CallExpression" && calleePath(init) === "$props") propObjects.add(name);
  }
  (function props(n: Node): void {
    if (
      n.type === "VariableDeclarator" &&
      (n.id as Node).type === "ObjectPattern" &&
      isNode(n.init) &&
      unwrapCall(n.init) === "$props"
    ) {
      for (const p of ((n.id as Node).properties as Node[]) ?? []) {
        if (p.type === "RestElement" && (p.argument as Node).type === "Identifier") {
          propObjects.add((p.argument as Node).name as string);
          continue;
        }
        const k = p.key as Node;
        const key = k.type === "Identifier" ? (k.name as string) : literalText(k);
        const v = p.value as Node;
        const local = v.type === "AssignmentPattern" ? (v.left as Node) : v;
        if (key && local.type === "Identifier") propLocals.set(local.name as string, key);
      }
    }
    for (const [, c] of children(n)) props(c);
  })(ast);
  if (isSvelte && isNode(ast.instance)) {
    for (const top of (ast.instance.content as Node).body as Node[]) {
      const decl = top.type === "ExportNamedDeclaration" ? (top.declaration as Node | null) : null;
      if (decl?.type !== "VariableDeclaration" || decl.kind !== "let") continue;
      for (const d of decl.declarations as Node[]) {
        if ((d.id as Node).type === "Identifier") {
          const name = (d.id as Node).name as string;
          propLocals.set(name, name);
        }
      }
    }
  }
  /** The props an expression is exactly a read of: `sub`, `props.label`,
   *  `a || b`. A deeper read (`slice.primary.title`) is a field, not a prop. */
  function propReads(n: Node): string[] | undefined {
    const u = TRANSPARENT.has(n.type) ? unwrap(n) : n;
    if (u.type === "Identifier") {
      const p = propLocals.get(u.name as string);
      return p ? [p] : undefined;
    }
    if (u.type === "MemberExpression" && !u.computed && (u.object as Node).type === "Identifier") {
      return propObjects.has((u.object as Node).name as string)
        ? [(u.property as Node).name as string]
        : undefined;
    }
    if (u.type === "LogicalExpression" && (u.operator === "||" || u.operator === "??")) {
      const l = propReads(u.left as Node);
      const r = propReads(u.right as Node);
      return l && r ? [...l, ...r] : undefined;
    }
    return undefined;
  }
  const unwrap = (n: Node): Node => {
    if (TRANSPARENT.has(n.type)) return unwrap(n.expression as Node);
    if (
      n.type === "CallExpression" &&
      RUNE.test(calleePath(n) ?? "") &&
      isNode((n.arguments as Node[])[0])
    ) {
      return unwrap((n.arguments as Node[])[0]!);
    }
    return n;
  };
  const isEmptyLiteral = (n: Node): boolean =>
    (n.type === "Literal" &&
      (n.value === null || n.value === "" || n.value === 0 || n.value === false)) ||
    (n.type === "Identifier" && n.name === "undefined");
  const lengthOf = (n: Node): Node | undefined => {
    const u = unwrap(n);
    if (u.type !== "MemberExpression" || u.computed) return undefined;
    return (u.property as Node).name === "length" ? (u.object as Node) : undefined;
  };
  /**
   * Is a local computed here rather than read from a field? `$state(…)` is
   * the component's own state, `let error;` too, and a `$derived` or `const`
   * of a call, a list or a sum is data the file works out (reddoor-website's
   * report: `rows = $derived(healthRows(view))`). An emptiness test on one is
   * a choice about that data, so its branches are the site's own words
   * (review round 4 on #2231). An alias of a path (`$derived(doc.data)`), an
   * emptiness test (`isFilled.image(d?.logo) && quoted`) or `a ?? b` of a
   * path still stands for the field.
   */
  const computing = new Set<string>();
  function isComputedLocal(name: string, depth = 0): boolean {
    if (bareLets.has(name)) return true;
    const init = inits.get(name);
    if (!init || computing.has(name)) return false;
    computing.add(name);
    try {
      return computedInit(name, init, depth);
    } finally {
      computing.delete(name);
    }
  }
  function computedInit(name: string, init: Node, depth: number): boolean {
    const bare = TRANSPARENT.has(init.type) ? unwrap(init) : init;
    if (bare.type === "CallExpression" && /^\$state(?:\.raw)?$/.test(calleePath(bare) ?? "")) {
      return true;
    }
    // `getAppState()`, `getContext("app")`: shared state other components
    // fill, often from fields (gallerysonder's lightbox alt), not data worked
    // out here (round 5's fold).
    if (bare.type === "CallExpression" && CONTEXT_GETTER.test(calleePath(bare) ?? "")) return false;
    const u = unwrap(init);
    if (emptiness(u, 2) !== undefined) return false;
    switch (u.type) {
      case "Identifier":
      case "MemberExpression": {
        const root = memberPath(u)?.split(".")[0];
        return root !== undefined && root !== name && depth < 2 && isComputedLocal(root, depth + 1);
      }
      case "LogicalExpression":
      case "ConditionalExpression":
      case "AwaitExpression":
        return false;
      default:
        return true;
    }
  }
  function emptiness(test: Node, depth = 0): Set<string> | undefined {
    const n = unwrap(test);
    if (n.type === "Identifier" || n.type === "MemberExpression") {
      const p = memberPath(n);
      // `data[key]`, `data?.[key]`: a value of `data`, by a key read at run
      // time (reddoor-website's funnel copy, review round 6).
      if (!p && n.type === "MemberExpression" && n.computed) {
        return emptiness(n.object as Node, depth);
      }
      if (!p) return undefined;

      const out = new Set([p]);
      const init = n.type === "Identifier" && depth < 2 ? inits.get(p) : undefined;
      const via = init ? emptiness(init, depth + 1) : undefined;
      if (via) for (const q of via) out.add(q);
      return out;
    }
    // `T ? x : null` is truthy exactly when `T && x` is: MSOT's
    // `const pair = isFilled.image(d?.logo) && quoted ? d.logo : null`.
    if (n.type === "ConditionalExpression" && isEmptyLiteral(unwrap(n.alternate as Node))) {
      const t = emptiness(n.test as Node, depth);
      const c = emptiness(n.consequent as Node, depth);
      if (!t && !c) return undefined;
      return new Set([...(t ?? []), ...(c ?? [])]);
    }
    if (n.type === "LogicalExpression" && (n.operator === "&&" || n.operator === "||")) {
      const l = emptiness(n.left as Node, depth);
      const r = emptiness(n.right as Node, depth);
      // Both sides must be emptiness tests: `variation === "video" && f` or
      // `video && playing === true` also asks something else (round 3).
      if (!l || !r) return undefined;
      return new Set([...l, ...r]);
    }
    // `value.trim()`: is the string blank?
    if (
      n.type === "CallExpression" &&
      (n.callee as Node).type === "MemberExpression" &&
      !(n.callee as Node).computed &&
      ((n.callee as Node).property as Node).name === "trim" &&
      (n.arguments as Node[]).length === 0
    ) {
      return emptiness((n.callee as Node).object as Node, depth);
    }
    if (n.type === "CallExpression") {
      const callee = calleePath(n) ?? "";
      if (!/^isFilled(?:\.\w+)?$|^(?:asText|asHTML|asLink|Boolean|hasContent)$/.test(callee)) {
        return undefined;
      }
      const out = new Set<string>();
      for (const a of n.arguments as Node[]) valuePaths(a, out);
      return out.size ? out : undefined;
    }
    if (n.type === "BinaryExpression") {
      const op = n.operator as string;
      const [a, b] = [n.left as Node, n.right as Node];
      // `items.length > 0`, `items.length !== 0`, `items.length >= 1`
      const len = lengthOf(a);
      if (len && b.type === "Literal" && typeof b.value === "number") {
        const v = b.value;
        if (
          (op === ">" && v === 0) ||
          ((op === "!==" || op === "!=") && v === 0) ||
          (op === ">=" && v === 1)
        ) {
          return emptiness(len, depth);
        }
        return undefined;
      }
      // `x != null`, `x !== undefined`, `x !== ""`
      if ((op === "!==" || op === "!=") && (isEmptyLiteral(b) || isEmptyLiteral(a))) {
        return emptiness(isEmptyLiteral(b) ? a : b, depth);
      }
    }
    return undefined;
  }
  /** `!x`, `x.length === 0`, `x == null`: the paths of x, as an emptiness test. */
  function negatedEmptiness(test: Node): Set<string> | undefined {
    const n = unwrap(test);
    if (n.type === "UnaryExpression" && n.operator === "!") return emptiness(n.argument as Node);
    if (n.type === "BinaryExpression") {
      const op = n.operator as string;
      const [a, b] = [n.left as Node, n.right as Node];
      const len = lengthOf(a);
      if (len && b.type === "Literal" && b.value === 0 && (op === "===" || op === "==")) {
        return emptiness(len);
      }
      if ((op === "===" || op === "==") && (isEmptyLiteral(b) || isEmptyLiteral(a))) {
        return emptiness(isEmptyLiteral(b) ? a : b);
      }
    }
    return undefined;
  }
  /** The value paths a template fragment SHOWS: text and prop values, the list
   *  an `#each` renders. Not event handlers, `bind:`, `class` or `style`, and
   *  not the tests of nested blocks: a menu toggle's `onclick` reading
   *  `menuOpen` does not make its branch "show" `menuOpen`. */
  function rendered(n: Node, out = new Set<string>()): Set<string> {
    if (DIRECTIVES.has(n.type) || isStyling(n)) return out;
    if (n.type === "Attribute" && /^on/i.test(String(n.name))) return out;
    if (n.type === "ExpressionTag" || n.type === "HtmlTag" || n.type === "RenderTag") {
      valuePaths(n.expression as Node, out);
      return out;
    }
    const element = n.type === "RegularElement" || n.type === "SvelteElement";
    for (const [key, c] of children(n)) {
      if (key === "test" && (n.type === "IfBlock" || n.type === "ConditionalExpression")) continue;
      // On an HTML element only the attributes a visitor reads show a value:
      // `aria-expanded={menuOpen}` or `id={slug}` does not. A component's
      // props all count: `<PrismicRichText field={doc.intro} />` shows it.
      if (
        element &&
        key === "attributes" &&
        c.type === "Attribute" &&
        !SHOWN_ATTRS.has(String(c.name).toLowerCase())
      ) {
        continue;
      }
      if (key === "expression" && n.type === "EachBlock") {
        valuePaths(c, out);
        continue;
      }
      rendered(c, out);
    }
    return out;
  }
  const shares = (a: Set<string> | undefined, b: Set<string>): boolean =>
    a !== undefined && sharePath(a, b);
  /** Does a test read at least one value that is not worked out in this file?
   *  `{#if rows.length === 0}` with `rows = $derived(healthRows(view))` does
   *  not: its branches are the file's own words about its own data. */
  const aboutField = (test: Node): boolean =>
    [...valuePaths(test)].some((p) => !isComputedLocal(p.split(".")[0]!));
  /** `typeof x === "string"`: the paths of x. Only a guard beside an
   *  emptiness test of the same value (`typeof v === "string" && v.trim()`);
   *  alone, `{#if typeof src === "object"}<Img>{:else}<img>` chooses between
   *  two shapes of one value (review round 6, espada's SubHero). */
  const typeofGuard = (n: Node): Set<string> | undefined => {
    const u = unwrap(n);
    if (u.type !== "BinaryExpression" || (u.operator !== "===" && u.operator !== "==")) {
      return undefined;
    }
    const [a, b] = [u.left as Node, u.right as Node];
    return a.type === "UnaryExpression" &&
      a.operator === "typeof" &&
      b.type === "Literal" &&
      typeof b.value === "string" &&
      b.value !== "undefined"
      ? valuePaths(a.argument as Node)
      : undefined;
  };
  /** Every `&&` conjunct of `test` asks whether something `shown` holds is
   *  empty: `{#if video && playing}{video}…` also waits on `playing`, which
   *  the branch does not show, so its else is a choice, not a fallback. */
  const coveredBy = (test: Node, shown: Set<string>): boolean => {
    const all = conjuncts(unwrap(test));
    const real = all.filter((c) => typeofGuard(c) === undefined);
    return (
      real.length > 0 &&
      real.every((c) => shares(emptiness(c), shown)) &&
      all.every((c) => typeofGuard(c) === undefined || shares(typeofGuard(c), shown))
    );
  };

  // SvelteKit's `dev` is true only under `vite dev`: a branch it guards never
  // reaches a visitor, so nothing in it is reported and no read in it counts.
  const devNames = new Set(
    [...parsed.imports]
      .filter(([, i]) => i.imported === "dev" && /^\$app\/env(?:ironment)?$/.test(i.source))
      .map(([local]) => local),
  );
  // `error(404, "Not found")` from SvelteKit: `+error.svelte` shows the
  // message (review round 6).
  const kitErrors = new Set(
    [...parsed.imports]
      .filter(([, i]) => i.imported === "error" && i.source === "@sveltejs/kit")
      .map(([local]) => local),
  );
  /** Climb from a literal through what only builds a value from it (wrappers,
   *  a ternary's arms, `||`/`??`, `+`, a template's holes) to the node that
   *  takes the value. `joined` says whether it was built with something else. */
  function valueHolder(chain: Ancestor[]): { at: number; joined: boolean } {
    let joined = false;
    for (let i = chain.length - 1; i > 0; i--) {
      const parent = chain[i - 1]!.node;
      const key = chain[i]!.key;
      if (TRANSPARENT.has(parent.type) || parent.type === "LogicalExpression") continue;
      if (
        (parent.type === "ConditionalExpression" && key !== "test") ||
        (parent.type === "BinaryExpression" && parent.operator === "+") ||
        (parent.type === "TemplateLiteral" && key === "expressions")
      ) {
        joined = true;
        continue;
      }
      return { at: i, joined };
    }
    return { at: 0, joined };
  }
  /** Is the literal `error()`'s message: its second argument? */
  function isKitErrorMessage(chain: Ancestor[]): boolean {
    if (kitErrors.size === 0) return false;
    const { at } = valueHolder(chain);
    const call = chain[at - 1]?.node;
    if (call?.type !== "CallExpression" || chain[at]!.key !== "arguments") return false;
    const callee = call.callee as Node;
    return (
      callee.type === "Identifier" &&
      kitErrors.has(callee.name as string) &&
      (call.arguments as Node[])[1] === chain[at]!.node
    );
  }
  /** A link that is only punctuation (`"/"`, `"?"`, `"&"`) joined into a URL
   *  (`${origin}${src.startsWith("/") ? "" : "/"}${src}`): glue, not a
   *  destination. Whole, as `href="/"`, it is the home page (review round 6). */
  const isUrlGlue = (kind: Kind, text: string, chain: Ancestor[]): boolean =>
    kind === "link" && !/[\p{L}\p{N}]/u.test(text) && valueHolder(chain).joined;
  const conjuncts = (n: Node): Node[] =>
    n.type === "LogicalExpression" && n.operator === "&&"
      ? [...conjuncts(n.left as Node), ...conjuncts(n.right as Node)]
      : [n];
  const devTest = (n: Node): boolean =>
    conjuncts(n).some((c) => c.type === "Identifier" && devNames.has(c.name as string));
  function isDevOnly(chain: Ancestor[]): boolean {
    if (devNames.size === 0) return false;
    for (let i = chain.length - 1; i > 0; i--) {
      const parent = chain[i - 1]!.node;
      const key = chain[i]!.key;
      if (
        (parent.type === "ConditionalExpression" ||
          parent.type === "IfStatement" ||
          parent.type === "IfBlock") &&
        key === "consequent" &&
        devTest(parent.test as Node)
      ) {
        return true;
      }
      if (
        parent.type === "LogicalExpression" &&
        parent.operator === "&&" &&
        key === "right" &&
        devTest(parent.left as Node)
      ) {
        return true;
      }
    }
    return false;
  }
  const ignores = (opts.ignore ?? []).map(compileIgnore);
  const ignored = (text: string): boolean =>
    ignores.some((i) => (typeof i === "string" ? i === text.trim() : i.test(text)));

  const findings: Finding[] = [];
  // Source order within a line: the sort key, kept off the public shape.
  const offsets = new WeakMap<Finding, number>();
  const report = (pos: number, kind: Kind, raw: string): void => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (text === "") return;
    if (isProseKind(kind) && isDecorative(text)) return;
    if (isPropertyLine(text)) return;
    if (ignored(text)) return;
    findings.push({ file, line: lineOf(pos), kind, text });
    offsets.set(findings.at(-1)!, pos);
  };

  // Asset imports: `import hero from "$lib/assets/hero.jpg"`. Reported at the
  // import line once the walk has seen whether any use is NOT a fallback.
  type AssetImport = { pos: number; kind: "image" | "video"; text: string };
  const assets = new Map<string, AssetImport>();
  // Every name read anywhere in the file, and how: a constant whose every
  // read is a fallback (`meta_description || DEFAULT_DESCRIPTION`) is a
  // fallback itself.
  const uses: Uses = new Map();
  // Literals inside `const NAME = …`, held until the walk knows NAME's reads.
  const props: PropDefault[] = [];
  const pending: Array<{
    binding: string;
    exported: boolean;
    pos: number;
    kind: Kind;
    text: string;
  }> = [];
  const onlyFallbacks = (name: string): boolean => onlyFallbackUses(uses.get(name));
  // `const greeting = "Welcome"; <h1>{greeting}</h1>`: a local whose name says
  // nothing, reported only if the template shows it. Name → the kind of the
  // template text it is shown as.
  const shownAs = new Map<string, Kind>();
  // How often each name is read inside a `class` or `style` attribute, and
  // anywhere else: a constant read only for styling (`const lines = […
  // "translate-y-0 opacity-100"]` behind `class="{lines[0]}"`) is not content.
  const styleReads = new Map<string, { style: number; other: number; cls: number }>();
  const onlyStyling = (name: string): boolean => {
    const r = styleReads.get(name);
    return r !== undefined && r.style > 0 && r.other === 0;
  };
  // An image read only inside `class` (`{src === placeholder ? 'lg:w-1/2' : ''}`)
  // is compared against, never shown; one in a `style` value is a background.
  const onlyInClass = (name: string): boolean => {
    const r = styleReads.get(name);
    return r !== undefined && r.cls > 0 && r.cls === r.style && r.other === 0;
  };
  const unnamed: Array<{ binding: string; pos: number; text: string }> = [];
  /** The kind a list is shown as through `{#each list as item}{item}`. */
  const eachShown = (list: string): Kind | undefined => {
    for (const [item, of] of eachOf) {
      if (of === list && shownAs.has(item)) return shownAs.get(item);
    }
    return undefined;
  };

  /** The constant a literal is part of: `const NAME = { … "x" … }`. */
  function enclosingBinding(chain: Ancestor[]): { name: string; exported: boolean } | undefined {
    for (let i = chain.length - 1; i > 0; i--) {
      const parent = chain[i - 1]!.node;
      if (parent.type === "VariableDeclarator" && chain[i]!.key === "init") {
        const id = parent.id as Node;
        if (id.type !== "Identifier") return undefined;
        return {
          name: id.name as string,
          exported: chain[i - 3]?.node.type === "ExportNamedDeclaration",
        };
      }
    }
    return undefined;
  }

  /**
   * Is the node at the end of `chain` in a fallback position?
   *
   *   field || "x"     field ?? "x"          the right of || or ??
   *   ok ? field : "x"                       a branch whose other branch is not a literal
   *   vimeoIdOr(field, "x")                  an argument to a fallback helper
   *   let { title = "x" } = $props()         a default value
   *   export let title = "x"                 a Svelte 4 prop default
   *   <X field={doc.f} src={img} />          anything beside a `field` prop
   *   {#if doc.f}…{doc.f}…{:else}x{/if}      an else branch for the same field
   */
  function isFallback(chain: Ancestor[], via?: string[]): boolean {
    for (let i = chain.length - 1; i > 0; i--) {
      const { node: parent } = chain[i - 1]!;
      const { key } = chain[i]!;
      switch (parent.type) {
        case "LogicalExpression":
          if (
            key === "right" &&
            (parent.operator === "||" || parent.operator === "??") &&
            !isPureLiteral(parent.left as Node) &&
            !isLiteralChoice(parent.left as Node) &&
            // In the template, as for a ternary, `{selected || "Choose a plan"}`
            // with `selected = $state("")` is the file's own words (round 5).
            (chain[1]?.key !== "fragment" || aboutField(parent.left as Node)) &&
            !isResponseBody(parent.left as Node)
          ) {
            // `{sub || "Serving Austin"}` with `sub` a prop: shown whenever a
            // caller leaves `sub` out, so the call sites decide (round 4).
            const read = via && propReads(parent.left as Node);
            if (!read) return true;
            via.push(...read);
          }
          break;
        case "ConditionalExpression": {
          // `f ? f : "x"`, `isFilled.keyText(f) ? asText(f) : "x"`: the test asks
          // about the value the other branch shows. `status === 404 ? "a" : b`
          // is a choice between two things, not a fallback.
          const other =
            key === "consequent"
              ? (parent.alternate as Node)
              : key === "alternate"
                ? (parent.consequent as Node)
                : undefined;
          // In the template, a test of the file's own data is a choice too
          // (`{user ? user.name : "Sign in"}` with `user = $state(null)`); in
          // script, `steps.length ? steps : DEFAULTS.steps` is the fallback
          // idiom even when `steps` is worked out from the field.
          if (
            other &&
            !isWordLiteral(other) &&
            (chain[1]?.key !== "fragment" || aboutField(parent.test as Node)) &&
            (key === "alternate"
              ? coveredBy(parent.test as Node, valuePaths(other))
              : shares(negatedEmptiness(parent.test as Node), valuePaths(other)))
          ) {
            return true;
          }
          break;
        }
        case "CallExpression": {
          if (key !== "arguments") break;
          const name = calleeName(parent);
          if (name && (FALLBACK_HELPER.test(name) || helpers.has(name))) return true;
          // `text(d?.title, "Welcome")` where `text(value, fallback)`.
          const callee = parent.callee as Node;
          if (callee.type === "Identifier" && opts.paramsOf) {
            const params = opts.paramsOf(callee.name as string);
            const at = (parent.arguments as Node[]).indexOf(chain[i]!.node);
            if (params && at >= 0 && FALLBACK_PARAM.test(params[at] ?? "")) return true;
          }
          break;
        }
        case "AssignmentPattern":
          // A `$props()` default is decided by the call sites (`propOf`).
          if (key === "right" && !propOf(chain) && defaultIsFallback(chain, i - 1)) return true;
          break;
        case "AssignmentExpression":
          if (key === "right" && assignsFallback(chain, i - 1)) return true;
          break;
        case "VariableDeclarator":
          // Only `export let` in the instance script is a Svelte 4 prop; an
          // `export const` is a constant, and `<script module>` has no props.
          break;
        case "RegularElement":
        case "Component":
        case "SvelteElement":
        case "SvelteComponent":
        case "SvelteSelf":
          if (key === "attributes" && hasFieldProp(parent) && besideField(chain[i]!.node))
            return true;
          break;
        case "IfBlock":
          if (key === "alternate" && elseIsFallback(parent)) return true;
          // `{#if !doc.title}Welcome{:else}{doc.title}{/if}`
          if (key === "consequent" && negatedIsFallback(parent)) return true;
          break;
      }
    }
    return false;
  }

  /**
   * The prop a literal is the default of, if it is one:
   * `let { label = "x" } = $props()` (or `$props<…>()`), or a Svelte 4
   * `export let label = "x"` in the instance script (never `export const`,
   * and never `<script module>`, which has no props).
   */
  function propOf(chain: Ancestor[]): string | undefined {
    for (let i = chain.length - 1; i > 0; i--) {
      const parent = chain[i - 1]!.node;
      const key = chain[i]!.key;
      if (parent.type === "AssignmentPattern" && key === "right") {
        const prop = chain[i - 2]?.node;
        const pattern = chain[i - 3]?.node;
        const decl = chain[i - 4]?.node;
        if (
          prop?.type === "Property" &&
          pattern?.type === "ObjectPattern" &&
          decl?.type === "VariableDeclarator" &&
          isNode(decl.init) &&
          unwrapCall(decl.init) === "$props"
        ) {
          const k = prop.key as Node;
          return k.type === "Identifier" ? (k.name as string) : literalText(k);
        }
        return undefined;
      }
      if (parent.type === "VariableDeclarator" && key === "init") {
        const id = parent.id as Node;
        if (
          isSvelte &&
          id.type === "Identifier" &&
          chain[i - 3]?.node.type === "ExportNamedDeclaration" &&
          chain[i - 2]?.node.kind === "let" &&
          chain[1]?.key === "instance"
        ) {
          return id.name as string;
        }
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Is a default outside `$props()` a fallback? `const { heading = "x" } =
   * slice.primary` is: it stands in for a field the value may lack. A
   * parameter's default is what shows whenever a caller leaves it out, and a
   * default over an object or list written right there always shows, so both
   * are reported (review round 4 on #2231: `seo({ title = "Acme" } = {})`),
   * unless the parameter is named `fallback…` or `default…`.
   */
  function defaultIsFallback(chain: Ancestor[], at: number): boolean {
    const isFn = (n: Node | undefined): boolean =>
      n !== undefined &&
      /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
    const pattern = chain[at]!.node;
    // `{#snippet card(t = "x")}`: shown when a `{@render card()}` here leaves
    // the argument out; with no call here, the snippet is handed elsewhere.
    const owner = chain[at - 1]?.node;
    if (owner?.type === "SnippetBlock" && chain[at]!.key === "parameters") {
      const index = (owner.parameters as Node[]).indexOf(pattern);
      const name = (owner.expression as Node).name as string;
      return !(renders.get(name) ?? []).some((n) => n <= index);
    }
    if (isFn(chain[at - 1]?.node) && chain[at]!.key === "params") {
      return FALLBACK_PARAM.test(paramName(pattern));
    }
    const prop = chain[at - 1]?.node;
    const object = chain[at - 2]?.node;
    if (prop?.type !== "Property" || object?.type !== "ObjectPattern") return true;
    const holder = chain[at - 3];
    if (holder?.node.type === "VariableDeclarator" && holder.key !== "init") {
      const init = holder.node.init as Node | null;
      const u = init ? unwrap(init) : undefined;
      return !(u?.type === "ObjectExpression" || u?.type === "ArrayExpression");
    }
    // `function seo({ title = "x" })`, `({ title = "x" } = {}) => …`
    if (isFn(holder?.node) && chain[at - 2]!.key === "params") return false;
    if (
      holder?.node.type === "AssignmentPattern" &&
      chain[at - 2]!.key === "left" &&
      isFn(chain[at - 4]?.node)
    ) {
      return false;
    }
    return true;
  }

  /** `cond && "A"`: the left of `cond && "A" || "B"` is a literal or nothing,
   *  so "B" is the other literal of a choice, not a fallback for a field. */
  const isLiteralChoice = (n: Node): boolean =>
    n.type === "LogicalExpression" && n.operator === "&&" && isPureLiteral(n.right as Node);

  /** `!x`, as the path x, else undefined. */
  const negated = (n: Node): string | undefined =>
    n.type === "UnaryExpression" && n.operator === "!" ? memberPath(n.argument as Node) : undefined;

  /** `data?.error` with `const data = await res.json()` (or
   *  `await res.json().catch(…)`): a response body the site's own endpoint
   *  sent, not a field. A Prismic read never ends in `.json()` (round 5). */
  function isResponseBody(n: Node): boolean {
    const root = memberPath(unwrap(n))?.split(".")[0];
    const init = root === undefined ? undefined : inits.get(root);
    if (init?.type !== "AwaitExpression") return false;
    let call = unwrap(init.argument as Node);
    const member = (c: Node, name: string): Node | undefined =>
      c.type === "CallExpression" &&
      (c.callee as Node).type === "MemberExpression" &&
      ((c.callee as Node).property as Node).name === name
        ? ((c.callee as Node).object as Node)
        : undefined;
    const caught = member(call, "catch");
    if (caught) call = caught;
    return member(call, "json") !== undefined;
  }

  /** `x = "lit"` inside `if (!x) …`, or `x ||= "lit"` / `x ??= "lit"`. */
  function assignsFallback(chain: Ancestor[], at: number): boolean {
    const assign = chain[at]!.node;
    if (assign.operator === "||=" || assign.operator === "??=") return true;
    if (assign.operator !== "=") return false;
    const target = memberPath(assign.left as Node);
    if (!target) return false;
    for (let j = at; j > 0; j--) {
      const parent = chain[j - 1]!.node;
      if (parent.type === "ExpressionStatement" || parent.type === "BlockStatement") continue;
      return (
        parent.type === "IfStatement" &&
        chain[j]!.key === "consequent" &&
        negated(parent.test as Node) === target
      );
    }
    return false;
  }

  /** Props a component shows only while its `field` is empty: the media and
   *  link it falls back to, and anything named `fallback…`. An `aria-label`,
   *  a heading prop or an `alt` beside a field is still the component's own
   *  words (`<Img field alt="…">` may override the field's alt, not stand in
   *  for it); `fallbackAlt` is the fallback. */
  const besideField = (attr: Node): boolean => {
    if (attr.type !== "Attribute") return false;
    const name = String(attr.name);
    const kind = kindForKey(name);
    return /^fallback/i.test(name) || kind === "image" || kind === "video" || kind === "link";
  };

  const hasFieldProp = (el: Node): boolean =>
    (el.attributes as Node[]).some(
      (a) => a.type === "Attribute" && a.name === "field" && a.value !== true,
    );

  /** `{#if X}…{:else}literal{/if}` is a fallback when the test asks only
   *  whether fields the true branch shows are empty, and the else is a leaf
   *  substitute (one text or one image). An `{:else if}` arm is its own
   *  block, judged by its own test: the arm it sits in is never a leaf. */
  const elseIsFallback = (block: Node): boolean =>
    isLeafSubstitute(block.alternate as Node) &&
    aboutField(block.test as Node) &&
    coveredBy(block.test as Node, rendered(block.consequent as Node));

  const negatedIsFallback = (block: Node): boolean =>
    isNode(block.alternate) &&
    aboutField(block.test as Node) &&
    isLeafSubstitute(block.consequent as Node) &&
    shares(negatedEmptiness(block.test as Node), rendered(block.alternate));

  /** `{@render heading("mt-16 px-8")}`: does the snippet, when it is in this
   *  file, show the parameter the literal is passed as, or only style with
   *  it? A snippet passed in from elsewhere cannot be seen, so it shows. */
  function snippetShows(chain: Ancestor[], at: number): boolean {
    const call = unwrap(chain[at]!.node);
    if (call.type !== "CallExpression") return true;
    const snippet = snippets.get(calleePath(call) ?? "");
    if (!snippet) return true;
    const arg = chain.slice(at + 1).find((a) => a.key === "arguments")?.node;
    const param = (snippet.parameters as Node[])[(call.arguments as Node[]).indexOf(arg!)];
    const name = param ? paramName(param) : "";
    return name === "" || shares(new Set([name]), rendered(snippet.body as Node));
  }

  /** The name of the function a node at `chain[at]` returns from: its own
   *  name, or the key, variable or field it is assigned to. */
  function functionName(chain: Ancestor[], at: number): string | undefined {
    for (let j = at; j >= 0; j--) {
      const fn = chain[j]!.node;
      if (!/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(fn.type)) {
        continue;
      }
      const id = fn.id as Node | null | undefined;
      if (id?.type === "Identifier") return id.name as string;
      const holder = chain[j - 1]?.node;
      const key = chain[j]!.key;
      if (!holder) return undefined;
      if (
        (holder.type === "Property" ||
          holder.type === "MethodDefinition" ||
          holder.type === "PropertyDefinition") &&
        key === "value"
      ) {
        const k = holder.key as Node;
        return k.type === "Identifier" || k.type === "PrivateIdentifier"
          ? (k.name as string)
          : literalText(k);
      }
      if (holder.type === "VariableDeclarator" && key === "init") {
        const v = holder.id as Node;
        return v.type === "Identifier" ? (v.name as string) : undefined;
      }
      return undefined;
    }
    return undefined;
  }

  /** The name a literal's value sits under, climbing through arrays, wrappers,
   *  concatenation and non-fallback branches: `{ title: "x" }` → title,
   *  `const heading = "x"` → heading, `items: ["a", "b"]` → items. */
  function slotOf(chain: Ancestor[]): {
    name?: string | undefined;
    /** The plain local the literal is assigned to (`error = "x"`) or is the
     *  snippet parameter default of: judged like `const error = "x"`. */
    local?: string;
    templateText?: Ancestor[];
    attr?: Node;
  } {
    // Words passed through a call (`{upper("Welcome")}`, `{"Open".toUpperCase()}`)
    // are followed to the template only, and only when they hold a space: a
    // call in script is behaviour, and `toLocaleDateString("en-US")` is code.
    let viaCall = false;
    const words = /\s/.test(literalText(chain.at(-1)!.node) ?? "");
    for (let i = chain.length - 1; i > 0; i--) {
      const { node: parent } = chain[i - 1]!;
      const { key } = chain[i]!;
      if (
        words &&
        ((parent.type === "CallExpression" && key === "arguments") ||
          (parent.type === "MemberExpression" &&
            key === "object" &&
            chain[i - 2]?.node.type === "CallExpression" &&
            chain[i - 1]!.key === "callee") ||
          (parent.type === "CallExpression" && key === "callee" && viaCall))
      ) {
        if (!(parent.type === "CallExpression" && RUNE.test(calleePath(parent) ?? ""))) {
          viaCall = true;
        }
        continue;
      }
      if (
        viaCall &&
        (parent.type === "Property" ||
          parent.type === "VariableDeclarator" ||
          parent.type === "AssignmentExpression" ||
          parent.type === "PropertyDefinition")
      ) {
        return {};
      }
      // `{#each ["Weddings", "Events"] as s}`: the list is what the block shows.
      if (parent.type === "EachBlock" && key === "expression") {
        return { templateText: chain.slice(0, i) };
      }
      if (
        TRANSPARENT.has(parent.type) ||
        parent.type === "ArrayExpression" ||
        parent.type === "ConditionalExpression" ||
        parent.type === "LogicalExpression" ||
        (parent.type === "BinaryExpression" && parent.operator === "+") ||
        parent.type === "TemplateLiteral" ||
        (parent.type === "CallExpression" &&
          key === "arguments" &&
          RUNE.test(calleePath(parent) ?? ""))
      ) {
        continue;
      }
      if (parent.type === "Property" && key === "value") {
        const k = parent.key as Node;
        const name = k.type === "Identifier" ? (k.name as string) : literalText(k);
        return { name };
      }
      if (parent.type === "VariableDeclarator" && key === "init") {
        const id = parent.id as Node;
        return { name: id.type === "Identifier" ? (id.name as string) : undefined };
      }
      // `{ label = "x" }`: the default sits under the property's name.
      if (parent.type === "AssignmentPattern" && key === "right") {
        const prop = chain[i - 2]?.node;
        if (prop?.type === "Property" && (prop.key as Node).type === "Identifier") {
          return { name: (prop.key as Node).name as string };
        }
        const param = paramName(parent.left as Node) || undefined;
        if (param && prop?.type === "SnippetBlock") return { name: param, local: param };
        return { name: param };
      }
      if (parent.type === "AssignmentExpression" && key === "right") {
        const left = parent.left as Node;
        const p = memberPath(left);
        if (left.type === "Identifier" && parent.operator === "=") {
          return { name: left.name as string, local: left.name as string };
        }
        return { name: p?.split(".").at(-1) };
      }
      if (parent.type === "PropertyDefinition" && key === "value") {
        const k = parent.key as Node;
        // `#title = "x"` is named like `title = "x"`.
        return {
          name:
            k.type === "Identifier" || k.type === "PrivateIdentifier"
              ? (k.name as string)
              : undefined,
        };
      }
      // `get title() { return "x" }`, `const heading = () => "x"`: a returned
      // literal sits under the function's name.
      if (
        (parent.type === "ReturnStatement" && key === "argument") ||
        (parent.type === "ArrowFunctionExpression" && key === "body")
      ) {
        if (viaCall) return {};
        return { name: functionName(chain, i - 1) };
      }
      if (
        parent.type === "ExpressionTag" ||
        parent.type === "HtmlTag" ||
        // `{@render card("Our story")}`: the snippet shows its arguments.
        parent.type === "RenderTag"
      ) {
        const grand = chain[i - 2];
        if (grand?.node.type === "Attribute") {
          return { attr: grand.node, templateText: chain.slice(0, i - 2) };
        }
        // `style:font-family={"Open Sans"}`: a style value, never words.
        if (grand && DIRECTIVES.has(grand.node.type)) return {};
        if (parent.type === "RenderTag" && !snippetShows(chain, i)) return {};
        return { templateText: chain.slice(0, i) };
      }
      return {};
    }
    return {};
  }

  /** The kind of template text by the element it sits in. */
  function textKind(chain: Ancestor[]): Kind | undefined {
    let kind: Kind = "copy";
    let inHead = false;
    for (const { node } of chain) {
      if (node.type === "SvelteHead") inHead = true;
      // Svelte 5 parses `<svelte:head><title>` as its own node type.
      if (node.type === "TitleElement") kind = "seo";
      if (node.type !== "RegularElement" && node.type !== "SvelteElement") continue;
      const name = String(node.name).toLowerCase();
      if (name === "script" || name === "style" || name === "code" || name === "pre") {
        return undefined;
      }
      if (name === "title" && inHead) kind = "seo";
      else if (/^h[1-6]$/.test(name)) kind = "heading";
      else if (name === "button") kind = "button";
      else if (name === "blockquote" && kind === "copy") kind = "testimonial";
    }
    return kind;
  }

  /** Which kind a value under an attribute is, or undefined when no visitor
   *  reads it. `el` is the element or component the attribute is on. */
  function attrKind(el: Node, attrName: string, value: string): Kind | undefined {
    const tag = String(el.name);
    const isComponent = el.type === "Component" || el.type === "SvelteComponent";
    const name = attrName.toLowerCase();
    if (!isComponent) {
      // A tag manager's `<noscript><iframe>` or a tracking pixel: its title
      // and alt are no more read than its src (review round 6).
      const machine = (el.attributes as Node[]).some((a) => {
        if (a.type !== "Attribute" || !/^(?:src|href)$/i.test(String(a.name))) return false;
        const v = staticValue(a);
        return v !== undefined && isMachineUrl(v);
      });
      if (machine) return undefined;
      switch (name) {
        case "alt":
          return "alt";
        case "title":
        case "placeholder":
        case "label":
        case "aria-label":
          return "copy";
        case "href":
          return tag === "link" ? undefined : linkKind(value);
        case "src":
        case "srcset":
        case "data-src":
        case "poster": {
          if (tag === "iframe") return strongKind(value) === "video" ? "video" : linkKind(value);
          if (tag === "script") return undefined;
          const a = assetKind(value.split(/\s/)[0] ?? "");
          if (name === "poster") return a ? "video" : undefined;
          return (
            a ??
            (/^(?:https?:)?\/\//.test(value) ? (tag === "video" ? "video" : "image") : undefined)
          );
        }
        case "content": {
          if (tag !== "meta") return undefined;
          const meta = (el.attributes as Node[]).find(
            (a) => a.type === "Attribute" && (a.name === "name" || a.name === "property"),
          );
          const which = meta ? staticValue(meta)?.toLowerCase() : undefined;
          if (!which || !/(?:description|title|image)$/.test(which)) return undefined;
          return "seo";
        }
        case "value": {
          if (tag !== "input") return undefined;
          const type = (el.attributes as Node[]).find(
            (a) => a.type === "Attribute" && a.name === "type",
          );
          const t = type ? staticValue(type) : undefined;
          return t === "submit" || t === "button" ? "button" : undefined;
        }
        default:
          return undefined;
      }
    }
    // A component prop: by its name, then by the value's shape.
    const byKey = kindForKey(attrName);
    return valueKindForKey(byKey, value);
  }

  /** Combine a name's kind with what the value looks like. */
  function valueKindForKey(byKey: Kind | undefined, value: string): Kind | undefined {
    // `script.src = "https://player.vimeo.com/api/player.js"` loads code.
    if (CODE_URL.test(value.trim()) || isMachineUrl(value)) return undefined;
    const strong = strongKind(value);
    if (byKey === undefined) return strong;
    switch (byKey) {
      case "link":
      case "social":
        return linkKind(value) ?? strong;
      case "image":
        return assetKind(value) ?? (/^(?:https?:)?\/\//.test(value) ? "image" : strong);
      case "video":
        // A poster image under a video name is part of the video.
        if (strong === "video" || assetKind(value) !== undefined) return "video";
        return /^\d{5,}$/.test(value.trim()) || /^[\w-]{11}$/.test(value.trim()) ? "video" : strong;
      case "phone":
      case "email":
        return strong ?? (/\d|@/.test(value) ? byKey : undefined);
      default:
        if (strong) return strong;
        if (isIdentifierLike(value)) return undefined;
        return refineProse(byKey === "copy" ? "copy" : byKey, value);
    }
  }

  const staticValue = (attr: Node): string | undefined => {
    const v = attr.value;
    if (Array.isArray(v) && v.every((p) => isNode(p) && p.type === "Text")) {
      return (v as Node[]).map((p) => p.data as string).join("");
    }
    if (isNode(v) && v.type === "ExpressionTag") return literalText(v.expression as Node);
    return undefined;
  };

  // A string literal (or template literal) somewhere in an expression.
  function onLiteral(node: Node, chain: Ancestor[]): void {
    const text = literalText(node);
    if (text === undefined) return;
    // Types, import sources, object keys, comparisons and computed keys are
    // never content.
    for (let i = chain.length - 1; i > 0; i--) {
      const parent = chain[i - 1]!.node;
      const key = chain[i]!.key;
      if (parent.type.startsWith("TS") && !TRANSPARENT.has(parent.type)) return;
      if (
        parent.type === "ImportDeclaration" ||
        parent.type === "ExportNamedDeclaration" ||
        parent.type === "ExportAllDeclaration" ||
        parent.type === "ImportExpression"
      ) {
        if (key === "source") return;
      }
      if ((parent.type === "Property" || parent.type === "PropertyDefinition") && key === "key") {
        return;
      }
      if (parent.type === "MemberExpression" && key === "property") return;
      if (
        parent.type === "BinaryExpression" &&
        ["===", "!==", "==", "!=", "in", "instanceof"].includes(parent.operator as string)
      ) {
        return;
      }
      if (parent.type === "SwitchCase" && key === "test") return;
      // `href.startsWith("tel:")`, `url.searchParams.get("Topic")`: a method
      // that tests, finds or splits by the string is a comparison by another
      // name.
      if (
        parent.type === "CallExpression" &&
        key === "arguments" &&
        STRING_TEST.test(calleeName(parent) ?? "")
      ) {
        return;
      }
      if (TRANSPARENT.has(parent.type)) continue;
      break;
    }
    const via: string[] = [];
    if (isFallback(chain, via) || isDevOnly(chain)) return;

    const pos = node.start ?? 0;
    const holes = node.type === "TemplateLiteral" && (node.expressions as unknown[]).length > 0;
    // A link or a path with a hole in it is built from data; words with a hole
    // in them are still words written in code.
    // Behind `prop || "…"`, the finding waits for the call sites (pass 4).
    const emit = (p: number, kind: Kind, t: string): void => {
      const before = findings.length;
      report(p, kind, t);
      if (via.length && findings.length > before) props.push({ ...findings.pop()!, prop: via });
    };
    const reportLiteral = (p: number, kind: Kind, t: string): void => {
      if (holes && !isProseKind(kind)) return;
      emit(p, kind, t);
    };
    if (isKitErrorMessage(chain)) {
      if (opts.kitErrorShown !== false && !isIdentifierLike(text)) {
        emit(pos, refineProse("copy", text), text);
      }
      return;
    }
    const slot = slotOf(chain);
    if (slot.attr) {
      const el = [...chain].reverse().find((a) => ELEMENTS.has(a.node.type))?.node;
      if (!el) return;
      const kind = attrKind(el, String(slot.attr.name), text);
      if (kind && !isUrlGlue(kind, text, chain)) reportLiteral(pos, kind, text);
      return;
    }
    if (slot.templateText) {
      // `{"script"}` is a code word, and `{@html "<script …>"}` is markup.
      if (isIdentifierLike(text) || /<(?:script|style)\b/i.test(text)) return;
      const kind = textKind(slot.templateText);
      const words = text.replace(/<[^>]*>/g, " ");
      if (kind) reportLiteral(pos, refineProse(kind, words), words);
      return;
    }
    const binding = enclosingBinding(chain);
    const byKey =
      (slot.name ? kindForKey(slot.name) : undefined) ??
      (binding ? kindForKey(binding.name) : undefined);
    const kind = valueKindForKey(byKey, text);
    // `const go = () => { error = "x" }`: the local assigned, not the arrow.
    const local = slot.local ?? (binding && !binding.exported ? binding.name : undefined);
    if (!kind && local && slot.name === local && !holes) {
      unnamed.push({ binding: local, pos, text });
    }
    if (!kind || (holes && !isProseKind(kind)) || isUrlGlue(kind, text, chain)) return;
    const prop = propOf(chain) ?? (via.length ? via : undefined);
    if (prop) {
      const before = findings.length;
      report(pos, kind, text);
      if (findings.length > before) props.push({ ...findings.pop()!, prop });
      return;
    }
    if (binding)
      pending.push({ binding: binding.name, exported: binding.exported, pos, kind, text });
    else report(pos, kind, text);
  }

  // A number literal can be a video ID: `vimeoId={1092190178}`, `vimeoId: 123456789`.
  function onNumber(node: Node, chain: Ancestor[]): void {
    if (typeof node.value !== "number" || isFallback(chain)) return;
    const slot = slotOf(chain);
    const name = slot.attr ? String(slot.attr.name) : slot.name;
    if (name && kindForKey(name) === "video" && String(node.value).length >= 5) {
      report(node.start ?? 0, "video", String(node.value));
    }
  }

  /** `background-image: url('/images/hero.jpg')` in a static style value:
   *  an image like any other. A `url()` with a hole is built from data. */
  function styleImages(parts: Node[], chain: Ancestor[]): void {
    if (isDevOnly(chain) || isFallback(chain)) return;
    for (const p of parts) {
      if (p.type !== "Text") continue;
      const data = p.data as string;
      for (const m of data.matchAll(CSS_URL)) {
        const url = m[2]!.trim();
        if (isMask(data, m.index ?? 0)) continue;
        if (assetKind(url) || /^(?:https?:)?\/\//.test(url)) {
          report((p.start as number) + (m.index ?? 0), "image", url);
        }
      }
    }
  }

  function onStyle(dir: Node, chain: Ancestor[]): void {
    if (Array.isArray(dir.value)) styleImages(dir.value as Node[], chain);
  }

  function onAttribute(attr: Node, chain: Ancestor[]): void {
    const v = attr.value;
    if (!Array.isArray(v)) return; // expression values are walked as expressions
    const el = chain.at(-2)!.node;
    if (isDevOnly(chain)) return;
    const parts = v as Node[];
    if (String(attr.name).toLowerCase() === "style") {
      styleImages(parts, chain);
      return;
    }
    const allText = parts.every((p) => p.type === "Text");
    const text = parts.map((p) => (p.type === "Text" ? (p.data as string) : "${…}")).join("");
    if (!allText) {
      // `alt="Photo of {name}"`: the words are still written in code. A link or
      // a path with a hole in it is built from data, so it is not reported.
      const kind = attrKind(el, String(attr.name), text);
      if (kind && isProseKind(kind) && !isFallback(chain)) {
        report(attr.start ?? 0, kind, text);
      }
      return;
    }
    if (isFallback(chain)) return;
    const kind = attrKind(el, String(attr.name), text);
    if (kind) report((parts[0]?.start as number | undefined) ?? attr.start ?? 0, kind, text);
  }

  function onText(node: Node, chain: Ancestor[]): void {
    const kind = textKind(chain);
    if (!kind) return;
    if (isFallback(chain) || isDevOnly(chain)) return;
    const text = node.data as string;
    if (text.trim() === "") return;
    const start = (node.start ?? 0) + (text.length - text.trimStart().length);
    report(start, refineProse(kind, text), text);
  }

  function onIdentifier(node: Node, chain: Ancestor[]): void {
    const name = node.name as string;
    const parent = chain.at(-2)?.node;
    const key = chain.at(-1)!.key;
    if (!parent) return;
    // A property key, `x.y`'s `y`, or a declaration's own name is not a use.
    if (parent.type === "Property" && key === "key" && !parent.shorthand) return;
    if (parent.type === "MemberExpression" && key === "property" && !parent.computed) return;
    if (parent.type === "VariableDeclarator" && key === "id") return;
    if (isDevOnly(chain)) return;
    if (showsNothing(chain)) return;
    // `const fallback = DEFAULTS[key]`: this read of DEFAULTS is whatever
    // the local's reads are (review round 6: reddoor-website's funnel copy).
    if (parent.type === "MemberExpression" && key === "object" && parent.computed) {
      let j = chain.length - 2;
      while (j > 0 && TRANSPARENT.has(chain[j - 1]!.node.type)) j--;
      const decl = chain[j - 1]?.node;
      if (
        decl?.type === "VariableDeclarator" &&
        chain[j]!.key === "init" &&
        (decl.id as Node).type === "Identifier" &&
        !isFallback(chain)
      ) {
        const local = (decl.id as Node).name as string;
        const u = readsIn(chain.slice(0, j - 2), local);
        const use = uses.get(name) ?? { bare: 0, fallback: 0 };
        if (onlyFallbackUses(u)) use.fallback++;
        else use.bare++;
        uses.set(name, use);
        return;
      }
    }
    const use = uses.get(name) ?? { bare: 0, fallback: 0 };
    const fallback = isFallback(chain);
    if (fallback) use.fallback++;
    else use.bare++;
    uses.set(name, use);
    const sr = styleReads.get(name) ?? { style: 0, other: 0, cls: 0 };
    if (chain.some(({ node: n }) => isStyling(n))) {
      sr.style++;
      const isClass = ({ node: n }: Ancestor): boolean =>
        n.type === "ClassDirective" || (n.type === "Attribute" && /^class$/i.test(String(n.name)));
      if (chain.some(isClass)) sr.cls++;
    } else sr.other++;
    styleReads.set(name, sr);
    if (!fallback && parent.type === "ExpressionTag" && chain.at(-3)?.node.type !== "Attribute") {
      const kind = textKind(chain.slice(0, -2));
      if (kind) shownAs.set(name, kind);
    }
    // `<Hero subtitle={msg} />`, `<img alt={msg}>`: a local handed straight to
    // a prop or attribute a visitor reads is shown as that (round 4).
    const attr = chain.at(-3)?.node;
    const el = chain.at(-4)?.node;
    if (!fallback && parent.type === "ExpressionTag" && attr?.type === "Attribute" && el) {
      const attrName = String(attr.name);
      const kind =
        el.type === "Component" || el.type === "SvelteComponent"
          ? kindForKey(attrName)
          : /^(?:alt|title|aria-label|placeholder)$/i.test(attrName)
            ? attrName.toLowerCase() === "alt"
              ? "alt"
              : "copy"
            : undefined;
      if (kind && isProseKind(kind)) shownAs.set(name, kind);
    }
  }

  /**
   * `let items = [placeholders]; … if (testimonials.length > 0) items =
   * testimonials;`: a local whose literal the field replaces whenever the
   * field has something is a fallback for it, like `field || placeholders`
   * (Vineyard's testimonial sliders, review round 5). Every assignment must
   * be of that shape: one that sets anything else makes the literal a value.
   */
  /** Reads that show nothing: a type (`type D = typeof X`), a `typeof x`
   *  test, and `Object.keys(X)`, which reads the names, not the values. */
  function showsNothing(chain: Ancestor[]): boolean {
    const parent = chain.at(-2)?.node;
    const key = chain.at(-1)!.key;
    if (chain.some((a) => a.node.type.startsWith("TS") && !TRANSPARENT.has(a.node.type))) {
      return true;
    }
    if (parent?.type === "UnaryExpression" && parent.operator === "typeof") return true;
    return (
      parent?.type === "CallExpression" &&
      key === "arguments" &&
      calleePath(parent) === "Object.keys"
    );
  }
  /** How a local is read inside the block that declares it (`chain` ends at
   *  the declaration's parent): the file-wide count would add an unrelated
   *  `fallback` parameter elsewhere in the file. */
  function readsIn(chain: Ancestor[], local: string): { bare: number; fallback: number } {
    const u = { bare: 0, fallback: 0 };
    (function walk(n: Node, ch: Ancestor[]): void {
      if (n.type === "Identifier" && n.name === local) {
        const parent = ch.at(-2)?.node;
        const key = ch.at(-1)!.key;
        if (
          !parent ||
          (parent.type === "Property" && key === "key" && !parent.shorthand) ||
          (parent.type === "MemberExpression" && key === "property" && !parent.computed) ||
          (parent.type === "VariableDeclarator" && key === "id") ||
          isDevOnly(ch) ||
          showsNothing(ch)
        ) {
          return;
        }
        if (isFallback(ch)) u.fallback++;
        else u.bare++;
        return;
      }
      for (const [key, c] of children(n)) walk(c, [...ch, { node: c, key }]);
    })(chain.at(-1)!.node, chain);
    return u;
  }
  const reassigned = new Map<string, { all: number; byField: number }>();
  function onAssignment(node: Node, chain: Ancestor[]): void {
    const left = node.left as Node;
    if (left.type !== "Identifier") return;
    const name = left.name as string;
    const r = reassigned.get(name) ?? { all: 0, byField: 0 };
    r.all++;
    reassigned.set(name, r);
    if (node.operator !== "=") return;
    const right = node.right as Node;
    for (let j = chain.length - 1; j > 0; j--) {
      const parent = chain[j - 1]!.node;
      if (parent.type === "ExpressionStatement" || parent.type === "BlockStatement") continue;
      if (
        parent.type === "IfStatement" &&
        chain[j]!.key === "consequent" &&
        aboutField(right) &&
        shares(emptiness(parent.test as Node), valuePaths(right))
      ) {
        r.byField++;
      }
      return;
    }
  }
  const replacedByField = (name: string): boolean => {
    const r = reassigned.get(name);
    return r !== undefined && r.byField > 0 && r.byField === r.all;
  };

  // `chain` is the path from the root to `node`, `node` included as its last
  // entry; each entry's `key` is the property of the entry before it that the
  // node hangs off.
  function visit(node: Node, chain: Ancestor[]): void {
    switch (node.type) {
      case "ImportDeclaration": {
        const src = (node.source as Node).value as string;
        const kind = assetKind(src);
        if (kind) {
          for (const s of node.specifiers as Node[]) {
            const local = (s.local as Node).name as string;
            assets.set(local, {
              pos: (node.source as Node).start ?? 0,
              kind,
              text:
                src
                  .replace(/[?#].*$/, "")
                  .split("/")
                  .at(-1) ?? src,
            });
          }
        }
        return; // nothing else in an import is content
      }
      case "Literal":
        if (typeof node.value === "string") onLiteral(node, chain);
        else if (typeof node.value === "number") onNumber(node, chain);
        return;
      case "TemplateLiteral":
        onLiteral(node, chain);
        // Holes are expressions in their own right: `${a || "x"}`.
        for (const e of node.expressions as Node[])
          visit(e, [...chain, { node: e, key: "expressions" }]);
        return;
      case "Text":
        if (
          chain.at(-2)?.node.type !== "Attribute" &&
          !DIRECTIVES.has(chain.at(-2)?.node.type ?? "")
        )
          onText(node, chain);
        return;
      case "Attribute":
        onAttribute(node, chain);
        break;
      case "StyleDirective":
        onStyle(node, chain);
        break;
      case "AssignmentExpression":
        onAssignment(node, chain);
        break;
      case "Identifier":
        onIdentifier(node, chain);
        return;
      case "Comment":
        return;
    }
    for (const [key, child] of children(node)) visit(child, [...chain, { node: child, key }]);
  }

  // Asset imports first: the template can come before the script in the
  // file, and a use is only recognisable once its import is known.
  for (const script of [ast.module, ast.instance]) {
    if (!isNode(script)) continue;
    for (const stmt of (script.content as Node).body as Node[]) {
      if (stmt.type === "ImportDeclaration") visit(stmt, []);
    }
  }
  visit(ast, [{ node: ast, key: "" }]);
  // `<style>.hero { background-image: url(/images/hero.jpg) }</style>`: an
  // image like a `style=` attribute's (review round 6: 29-navy's hero photos).
  // Only a file with an image extension: a font or a data: URI is not one.
  const css = isNode(ast.css)
    ? (ast.css.content as { start: number; styles: string } | undefined)
    : undefined;
  if (isSvelte && typeof css?.styles === "string") {
    for (const m of css.styles.matchAll(CSS_URL)) {
      const url = m[2]!.trim();
      if (isMask(css.styles, m.index ?? 0)) continue;
      if (!/^data:/i.test(url) && assetKind(url) === "image") {
        report(css.start + (m.index ?? 0), "image", url);
      }
    }
  }
  return finalize();

  function finalize(): FileScan {
    for (const [name, a] of assets) {
      if (!onlyFallbacks(name) && !onlyInClass(name)) report(a.pos, a.kind, a.text);
    }
    for (const u of unnamed) {
      const kind = shownAs.get(u.binding) ?? eachShown(u.binding);
      if (!kind || isIdentifierLike(u.text) || onlyStyling(u.binding)) continue;
      if (replacedByField(u.binding)) continue;
      report(u.pos, refineProse(kind, u.text), u.text);
    }
    const deferred: Deferred[] = [];
    for (const p of pending) {
      if (p.exported) {
        const before = findings.length;
        report(p.pos, p.kind, p.text);
        // `report` applies the filters; what survives waits for the site.
        if (findings.length > before) deferred.push({ ...findings.pop()!, binding: p.binding });
      } else if (
        !onlyFallbacks(p.binding) &&
        !replacedByField(p.binding) &&
        !(isProseKind(p.kind) && onlyStyling(p.binding))
      ) {
        report(p.pos, p.kind, p.text);
      }
    }
    findings.sort((x, y) => (offsets.get(x) ?? 0) - (offsets.get(y) ?? 0));
    return { findings, deferred, uses, props };
  }
}
