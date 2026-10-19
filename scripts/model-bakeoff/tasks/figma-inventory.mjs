import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const id = "figma-inventory";
export const title = "T4 site build: Figma context to a slice and field inventory";
export const row = 2;

// The frozen Figma output is not in this repo: it is a client's design, and the repo is
// public. `prepare --root <folder>` copies it from a folder holding one
// `metadata-<node>.json` and one `design-context-<node>.json` per page frame, each the
// connector's own response: `{ tool, input, fetchedAt, text: [payload, ...trailers] }`.
export const sources = [
  { from: ".", match: /^(metadata|design-context)-\d+-\d+\.json$/, to: "figma" },
];

export const layerName = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

export const kinds = {
  layer: (v) => layerName(v).toLowerCase(),
};

export const collections = [
  {
    name: "slices",
    key: "id",
    keyKind: "string",
    fields: {
      name: "layer",
      type: "string",
      height: "number",
      texts: "number",
      images: "number",
      instances: "set:layer",
    },
  },
  {
    name: "fields",
    key: "id",
    keyKind: "string",
    fields: {
      slice: "string",
      tag: "string",
      text: "text",
      href: "string",
    },
  },
];

const strings = { type: "array", items: { type: "string" } };

export const schema = {
  type: "object",
  properties: {
    slices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          height: { type: "number" },
          texts: { type: "number" },
          images: { type: "number" },
          instances: strings,
        },
        required: ["id", "name", "type", "height", "texts", "images", "instances"],
      },
    },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          slice: { type: "string" },
          tag: { type: "string" },
          text: { type: "string" },
          href: { type: "string" },
        },
        required: ["id", "slice", "tag", "text", "href"],
      },
    },
    unverified: strings,
  },
  required: ["slices", "fields", "unverified"],
};

export function prompt(dir) {
  return [
    `Read-only inventory of a website design, from Figma connector output frozen in ${dir}/figma.`,
    "For each page frame there are two JSON files: metadata-<node>.json (from get_metadata) and design-context-<node>.json (from get_design_context). In each, `text[0]` is the payload; later entries of `text` are connector notes to ignore.",
    '- The metadata payload is XML. Its root element is the page frame; every element has `id`, `name` and `height`, and a layer is hidden when it or any ancestor has hidden="true". Names are XML-escaped (`&amp;` is `&`).',
    "- The design-context payload is React/JSX code. Elements carry `data-node-id`. Asset URLs are `const` declarations at the top. The `export default function` renders the page; other functions are components it renders by name (e.g. `<PropertiesSlideshow ... />`).",
    "",
    "Build the inventory a developer needs to turn the page into CMS slices:",
    "",
    "1. slices: one entry for each visible direct child of the page frame in the metadata (every page frame in the folder), with:",
    '   - id: its metadata id, e.g. "6802:1460"',
    "   - name: its layer name",
    '   - type: its metadata element name, e.g. "frame" or "instance"',
    "   - height: its height rounded to the nearest whole number",
    "   - texts: how many entries of `fields` (below) belong to this slice",
    "   - images: how many `<img>` elements are rendered inside this slice in the design-context code whose `src` constant's URL ends in `.png`; an `<img>` inside a component counts once for each place the component is rendered in this slice",
    "   - instances: the names of the visible `instance` elements inside this slice in the metadata, not counting the slice itself, each name once",
    "2. fields: one entry for each text field in the design-context code. A text field is an element with a `data-node-id` that contains visible text (anything but whitespace and zero-width spaces), where no element inside it that also has a `data-node-id` contains visible text. For each:",
    '   - id: its `data-node-id`, exactly as written (instance children look like "I6842:535;4840:376")',
    "   - slice: the id of the slice it is rendered in; a field inside a component belongs to the slice where that component is rendered",
    '   - tag: its JSX element name, e.g. "p", "a", "ul" or "div"',
    "   - text: its text as a reader sees it (JSX text and template literals, with `<br>` and each paragraph or list item as a line break)",
    '   - href: its `href` attribute, or "" if it has none',
    "3. unverified: anything you could not establish (empty if none).",
    "",
    "Be exact: every field is checked against a script's answer.",
  ].join("\n");
}

export const goldAddendum =
  "\n\nYou are building the GOLD STANDARD the other runs are compared against. Establish every field mechanically: write and run small scripts (node, or python3 -I) that parse the frozen files rather than reading them by eye, and put anything you could not verify that way in unverified.";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return String.fromCodePoint(n);
    }
    const named = ENTITIES[e.toLowerCase()];
    if (named === undefined) throw new Error(`unknown entity ${m}`);
    return named;
  });

const attrsOf = (s) => {
  const out = {};
  for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
};

const META_TAG = /<(\/?)([a-z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/gi;

export function parseMetadata(xml) {
  const unread = xml.replace(META_TAG, "").match(/<[^>]*>?/);
  if (unread) throw new Error(`metadata: cannot read ${unread[0].slice(0, 60)}`);
  const stack = [{ children: [] }];
  for (const m of xml.matchAll(META_TAG)) {
    const [, close, tag, attrText, selfClose] = m;
    if (close) {
      if (stack.length < 2 || stack.at(-1).type !== tag)
        throw new Error(`metadata: stray </${tag}>`);
      stack.pop();
      continue;
    }
    const a = attrsOf(attrText);
    const node = {
      type: tag,
      id: a.id,
      name: a.name ?? "",
      height: Number(a.height),
      hidden: a.hidden === "true",
      children: [],
    };
    stack.at(-1).children.push(node);
    if (!selfClose) stack.push(node);
  }
  if (stack.length !== 1) throw new Error("metadata: unclosed element");
  const [root] = stack[0].children;
  if (!root) throw new Error("metadata: no root element");
  return root;
}

// A JSX reader for the code get_design_context emits: elements, attributes (quoted or in
// braces), text, and `{`...`}` / `{"..."}` text expressions. It reads each function's
// `return ( ... );` block and nothing else.
function readTag(src, i) {
  let j = i + 1;
  let quote = null;
  let depth = 0;
  for (; j < src.length; j++) {
    const ch = src[j];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) break;
  }
  return { body: src.slice(i + 1, j), end: j + 1 };
}

function jsxAttrs(body) {
  const out = {};
  for (const m of body.matchAll(/([\w:-]+)(?:=(?:"([^"]*)"|\{([^{}]*)\}))?/g)) {
    out[m[1]] =
      m[2] !== undefined ? decode(m[2]) : m[3] !== undefined ? { expr: m[3].trim() } : true;
  }
  return out;
}

function jsxText(raw) {
  // JSX drops a text run's line breaks and the indentation around them; a `{`...`}` or
  // `{"..."}` expression keeps its own spaces.
  const parts = raw.split(/\{\s*(?:`([^`]*)`|"([^"]*)"|'([^']*)')\s*\}/);
  let out = "";
  for (let n = 0; n < parts.length; n += 4) {
    const t = parts[n];
    out += t.includes("\n")
      ? decode(
          t
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .join(" "),
        )
      : decode(t);
    if (n + 1 < parts.length) out += parts[n + 1] ?? parts[n + 2] ?? parts[n + 3] ?? "";
  }
  // Any other expression ({label}, {cond && <p/>}, a comment) renders something this reader
  // cannot know, so the truth refuses it rather than scoring its source text.
  const expr = parts.filter((_, n) => n % 4 === 0).find((t) => /[{}]/.test(t));
  if (expr !== undefined)
    throw new Error(`jsx: cannot read the expression in ${expr.trim().slice(0, 60)}`);
  return out;
}

export function parseJsx(src) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const textEnd = lt === -1 ? src.length : lt;
    if (textEnd > i) {
      const t = jsxText(src.slice(i, textEnd));
      if (t !== "") stack.at(-1).children.push({ text: t });
    }
    if (lt === -1) break;
    const { body, end } = readTag(src, lt);
    i = end;
    if (body.startsWith("/")) {
      const tag = body.slice(1).trim();
      if (stack.length < 2 || stack.at(-1).tag !== tag) throw new Error(`jsx: stray </${tag}>`);
      stack.pop();
      continue;
    }
    const selfClose = body.trimEnd().endsWith("/");
    const inner = selfClose ? body.trimEnd().slice(0, -1) : body;
    const tag = /^[\w.]+/.exec(inner)?.[0];
    if (!tag) throw new Error(`jsx: cannot read tag <${body.slice(0, 20)}`);
    const el = { tag, attrs: jsxAttrs(inner.slice(tag.length)), children: [] };
    stack.at(-1).children.push(el);
    if (!selfClose) stack.push(el);
  }
  if (stack.length !== 1) throw new Error(`jsx: unclosed <${stack.at(-1).tag}>`);
  return root.children.filter((c) => c.tag);
}

export function parseDesignContext(code) {
  const assets = {};
  for (const m of code.matchAll(/^const (\w+) = (?:"([^"]*)"|'([^']*)');$/gm))
    assets[m[1]] = m[2] ?? m[3];
  const components = {};
  let main = null;
  const heads = [...code.matchAll(/^(export default )?function (\w+)\(/gm)];
  for (const [n, m] of heads.entries()) {
    const stop = heads[n + 1]?.index ?? code.length;
    const start = code.indexOf("return (", m.index);
    const end = code.indexOf("\n  );\n}", start);
    if (start === -1 || end === -1 || end > stop)
      throw new Error(`design context: no return ( ... ); block in ${m[2]}`);
    const [el, ...rest] = parseJsx(code.slice(start + "return (".length, end));
    if (!el || rest.length) throw new Error(`design context: ${m[2]} must return one element`);
    components[m[2]] = el;
    if (m[1]) main = m[2];
  }
  if (!main) throw new Error("design context: no export default function");
  const check = (el) => {
    if (el.text !== undefined) return;
    if (/^[A-Z]/.test(el.tag) && !components[el.tag])
      throw new Error(`design context: <${el.tag}> is not a function this reader found`);
    if (el.tag === "img" && !(typeof el.attrs.src === "object" && el.attrs.src.expr in assets))
      throw new Error(`design context: an <img> src is not one of the asset constants`);
    if (typeof el.attrs.href === "object")
      throw new Error(`design context: href={${el.attrs.href.expr}} is an expression`);
    el.children.forEach(check);
  };
  Object.values(components).forEach(check);
  return { assets, components, main };
}

const VISIBLE = /[^\s\u200b]/;
const BLOCK = new Set(["p", "li", "div", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6"]);

function textOf(el, components, seen = []) {
  if (el.text !== undefined) return el.text;
  if (el.tag === "br") return "\n";
  if (components[el.tag] && !seen.includes(el.tag))
    return textOf(components[el.tag], components, [...seen, el.tag]);
  const inner = el.children.map((c) => textOf(c, components, seen)).join("");
  return BLOCK.has(el.tag) ? `\n${inner}\n` : inner;
}

const cleanText = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

function walkFields(el, components, slice, out, seen) {
  if (el.text !== undefined) return false;
  if (components[el.tag]) {
    if (seen.includes(el.tag)) throw new Error(`design context: ${el.tag} renders itself`);
    return walkFields(components[el.tag], components, slice, out, [...seen, el.tag]);
  }
  let inner = false;
  for (const c of el.children) inner = walkFields(c, components, slice, out, seen) || inner;
  const nodeId = el.attrs["data-node-id"];
  if (inner || typeof nodeId !== "string") return inner;
  const text = cleanText(textOf(el, components));
  if (!VISIBLE.test(text)) return false;
  out.push({
    id: nodeId,
    slice,
    tag: el.tag,
    text,
    href: typeof el.attrs.href === "string" ? el.attrs.href : "",
  });
  return true;
}

function countImages(el, components, assets, seen = []) {
  if (el.text !== undefined) return 0;
  if (components[el.tag] && !seen.includes(el.tag))
    return countImages(components[el.tag], components, assets, [...seen, el.tag]);
  let n = 0;
  if (el.tag === "img") {
    const src = el.attrs.src;
    const url = src && typeof src === "object" ? assets[src.expr] : src;
    if (typeof url === "string" && /\.png$/i.test(url.split("?")[0])) n++;
  }
  for (const c of el.children) n += countImages(c, components, assets, seen);
  return n;
}

function visibleInstances(node, out = []) {
  for (const c of node.children) {
    if (c.hidden) continue;
    if (c.type === "instance") {
      const name = layerName(c.name);
      if (!out.includes(name)) out.push(name);
    }
    visibleInstances(c, out);
  }
  return out;
}

const payload = (frozen, tool) => {
  if (
    !frozen ||
    frozen.tool !== tool ||
    !Array.isArray(frozen.text) ||
    typeof frozen.text[0] !== "string"
  )
    throw new Error(`expected frozen ${tool} output with text[0]`);
  return frozen.text[0];
};

export function inventory(metadataJson, designContextJson) {
  const page = parseMetadata(payload(metadataJson, "get_metadata"));
  const dc = parseDesignContext(payload(designContextJson, "get_design_context"));
  const rootEl = dc.components[dc.main];
  const metaSlices = page.children.filter((c) => !c.hidden);
  const codeSlices = rootEl.children.filter((c) => c.tag);
  const metaIds = metaSlices.map((s) => s.id);
  const codeIds = codeSlices.map((c) => c.attrs["data-node-id"]);
  if (JSON.stringify(metaIds) !== JSON.stringify(codeIds)) {
    throw new Error(
      `the page's slices differ between the tools: metadata ${metaIds.join(",")}, design context ${codeIds.join(",")}`,
    );
  }
  const fields = [];
  const slices = metaSlices.map((s, n) => {
    const before = fields.length;
    walkFields(codeSlices[n], dc.components, s.id, fields, [dc.main]);
    return {
      id: s.id,
      name: layerName(s.name),
      type: s.type,
      height: Math.round(s.height),
      texts: fields.length - before,
      images: countImages(codeSlices[n], dc.components, dc.assets),
      instances: visibleInstances(s),
    };
  });
  const seen = new Set();
  for (const f of fields) {
    // A component rendered twice repeats its node ids; the prompt does not say how to list
    // that, so the truth refuses it rather than choose for the arms.
    if (seen.has(f.id)) throw new Error(`field ${f.id} is rendered more than once`);
    seen.add(f.id);
  }
  return { slices, fields };
}

export function truth(dir) {
  const figma = join(dir, "figma");
  let files;
  try {
    files = readdirSync(figma).sort();
  } catch {
    throw new Error(
      `${figma} is missing: run prepare with --root <folder holding the frozen Figma JSON>`,
    );
  }
  const nodes = files.flatMap((f) => /^metadata-(\d+-\d+)\.json$/.exec(f)?.[1] ?? []);
  if (!nodes.length)
    throw new Error(
      `${figma} holds no metadata-<node>.json: run prepare with --root <folder holding the frozen Figma JSON>`,
    );
  const read = (f) => {
    if (!files.includes(f)) throw new Error(`${figma} has no ${f} to pair with its metadata`);
    return JSON.parse(readFileSync(join(figma, f), "utf8"));
  };
  const out = { slices: [], fields: [] };
  for (const node of nodes) {
    const inv = inventory(read(`metadata-${node}.json`), read(`design-context-${node}.json`));
    out.slices.push(...inv.slices);
    out.fields.push(...inv.fields);
  }
  return out;
}

export const arms = [
  { id: "haiku-low-1", model: "haiku", effort: "low" },
  { id: "haiku-low-2", model: "haiku", effort: "low" },
  { id: "haiku-medium-1", model: "haiku", effort: "medium" },
  { id: "haiku-medium-2", model: "haiku", effort: "medium" },
  { id: "sonnet-medium-1", model: "sonnet", effort: "medium" },
  { id: "sonnet-medium-2", model: "sonnet", effort: "medium" },
];

export const gold = { id: "gold", model: "opus", effort: "high" };
