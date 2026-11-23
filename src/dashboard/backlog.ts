/**
 * The backlog's top P1 items for the cockpit's Triage page (P1-111).
 *
 * `BACKLOG.md` lives in the private `reddoorla/reddoor-workspace`; this repo is
 * public. So the file is read at request time by the cockpit's server, never
 * committed, built or logged here: the error messages below name a row by its
 * ID and a line by its number, and never quote the file's text.
 *
 * The rank is the order of the P1 table's rows (the PM pass re-ranks by
 * reordering them), so "the top five" is the first five data rows under the
 * `## P1` heading.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import type { PhrasingContent } from "mdast";

export const WORKSPACE_REPO = "reddoorla/reddoor-workspace";
export const BACKLOG_PATH = "BACKLOG.md";
/** The repo a bare `#NNN` means: the backlog writes maintenance's numbers bare
 *  and qualifies every other repo's (`reddoorla/reddoor-website#340 closed #893`
 *  names website's PR and maintenance's issue). */
const DEFAULT_REF_REPO = "reddoorla/reddoor-maintenance";

export type BacklogRef = { label: string; href: string };

export type BacklogStatus = {
  /** `YYYY-MM-DD`, from `Status <date>`. */
  date: string;
  /** The status line's first sentence, markdown stripped, its `[evidence]:` tag dropped. */
  sentence: string;
  /** Every issue or PR the status line names, in order, once each. */
  refs: BacklogRef[];
};

export type BacklogItem = {
  rank: number;
  id: string;
  title: string;
  /** The tier cell as written, markdown stripped; null when the row has no tier cell. */
  tier: string | null;
  /** The newest `Status <date> …` line in any cell of the row, or null when there is none. */
  status: BacklogStatus | null;
};

export type BacklogTop = {
  /** The header's "Last full re-rank" as an ISO instant, or null when it is not written. */
  rerankedAt: string | null;
  items: BacklogItem[];
};

/** A backlog the parser cannot read faithfully. The message names a row or a line, never its text. */
export class BacklogParseError extends Error {
  override name = "BacklogParseError";
}

/**
 * The code spans in a text, by CommonMark's rule: a run of n backticks not
 * escaped by a backslash opens a span only when a later run of exactly n
 * closes it; otherwise it is literal. `open` lists, in order, the lengths of
 * the runs left unclosed. Every step that must not look inside code (cell
 * splitting, the bold title, the first sentence, markdown stripping) reads
 * spans from here, so none of them guesses on its own (P1-111 round 7).
 */
export function codeSpans(text: string): { spans: Array<[number, number]>; open: number[] } {
  const spans: Array<[number, number]> = [];
  const open: number[] = [];
  const runAt = (i: number) => {
    let n = 0;
    while (text[i + n] === "`") n++;
    return n;
  };
  for (let i = 0; i < text.length;) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] !== "`") {
      i++;
      continue;
    }
    const n = runAt(i);
    let j = i + n;
    let close = -1;
    while (j < text.length) {
      if (text[j] === "`") {
        const m = runAt(j);
        if (m === n) {
          close = j;
          break;
        }
        j += m;
      } else j++;
    }
    if (close === -1) {
      open.push(n);
      i += n;
    } else {
      spans.push([i, close + n]);
      i = close + n;
    }
  }
  return { spans, open };
}

/**
 * Split a table row into cells. Every unescaped `|` splits, as GitHub does;
 * then a piece that leaves a backtick run unclosed is joined to the following
 * pieces up to the first one whose own first unclosed run has the same length (a piece
 * whose first unclosed run differs, such as a lone backtick inside a ``…`` span,
 * is passed over),
 * so a code span holding `|` (`a | b`, ``a|b``) stays one cell. A piece whose
 * backticks all pair within it, or a lone backtick with no such partner,
 * joins nothing.
 */
export function splitRow(line: string): string[] {
  const pieces: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    // A backslash escapes the next character, so `\\|` is an escaped
    // backslash and then a pipe that splits (P1-111 round 10).
    if (ch === "\\" && i + 1 < line.length) {
      cur += ch + line[i + 1]!;
      i++;
    } else if (ch === "|") {
      pieces.push(cur);
      cur = "";
    } else cur += ch;
  }
  pieces.push(cur);
  // Each piece's unclosed runs, read once; then, from the right, the nearest
  // later piece whose first unclosed run has a given length, so the join is
  // linear in the row (round 9 measured the per-pair search as quadratic).
  const opens = pieces.map((p) => codeSpans(p).open);
  const partner: Array<number | undefined> = new Array(pieces.length);
  const nearest = new Map<number, number>();
  for (let i = pieces.length - 1; i >= 0; i--) {
    const open = opens[i]!;
    // The earliest unclosed run that a later piece can close is the one
    // CommonMark pairs: its span swallows every run after it (round 10).
    for (const n of open) {
      partner[i] = nearest.get(n);
      if (partner[i] !== undefined) break;
    }
    if (open[0] !== undefined) nearest.set(open[0], i);
  }
  const cells: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const j = partner[i];
    if (j === undefined) cells.push(pieces[i]!);
    else {
      cells.push(pieces.slice(i, j + 1).join("|"));
      i = j;
    }
  }
  // A row is `| a | b |`: drop the empty edges outside the first and last pipe.
  if (cells.length > 0 && cells[0]!.trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]!.trim() === "") cells.pop();
  // Unescape `\|` pair by pair from the left, so `\\` stays an escaped backslash.
  return cells.map((c) => c.replace(/\\(.)/g, (m, x: string) => (x === "|" ? "|" : m)).trim());
}

/** The one well-formed shape: `Status YYYY-MM-DD`, then a space, `[`, `:` or the end. */
const STATUS_AT = /^Status (\d{4}-\d{2}-\d{2})(?=[\s[:]|$)/;
/** The word status, in any case, not inside a longer word ("Statuses" is not it). */
const STATUS_WORD = /(?<!\p{L})status(?!\p{L})/giu;
/** A title that begins with the word Status, in any case. */
const STATUS_TITLE = /^status(?!\p{L})/iu;

function validDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/**
 * A table cell holds inline markdown only: GitHub never reads `- `, `1. `,
 * `> `, `# `, `~~~` or an HTML block at a cell's start as a block. Turning
 * the block constructs off keeps such a cell a paragraph, so its text is read
 * (P1-111 round 9: a cell starting `- Status …` was read as empty).
 */
const INLINE_ONLY = {
  disable: {
    null: [
      "blockQuote",
      "codeFenced",
      "codeIndented",
      "definition",
      "headingAtx",
      "htmlFlow",
      "list",
      "setextUnderline",
      "thematicBreak",
    ],
  },
};

/** One cell's inline markdown, parsed by mdast (CommonMark plus GFM strikethrough). */
function inline(md: string): PhrasingContent[] {
  const root = fromMarkdown(md, {
    extensions: [gfmStrikethrough(), INLINE_ONLY],
    mdastExtensions: [gfmStrikethroughFromMarkdown()],
  });
  const first = root.children[0];
  // With every block construct off, a cell is one paragraph (or nothing).
  return first?.type === "paragraph" ? first.children : [];
}

/**
 * What a character of flattened text came from: `plain` (text, or text in
 * bold), `code` (a code span), `marked` (inside emphasis, strike or a link),
 * `html` (one character standing for an HTML tag), or `title` (one character
 * standing for the item cell's title, which ends every status line before it).
 */
type Kind = "plain" | "code" | "marked" | "html" | "title";
type Flat = { text: string; kinds: Kind[] };

const HTML_MARK = "￼";
const TITLE_MARK = "�";

function flatten(
  nodes: PhrasingContent[],
  kind: Kind = "plain",
  out: Flat = { text: "", kinds: [] },
  title?: PhrasingContent,
): Flat {
  const put = (text: string, k: Kind) => {
    out.text += text;
    for (let i = 0; i < text.length; i++) out.kinds.push(k);
  };
  for (const node of nodes) {
    if (node === title) put(TITLE_MARK, "title");
    else if (node.type === "text") put(node.value, kind);
    else if (node.type === "inlineCode") put(node.value, "code");
    else if (node.type === "html") put(HTML_MARK, "html");
    else if (node.type === "break") put(" ", kind);
    else if (node.type === "image") put(node.alt ?? "", "marked");
    else if (node.type === "strong") flatten(node.children, kind, out);
    else if ("children" in node) flatten(node.children as PhrasingContent[], "marked", out);
  }
  return out;
}

/** Whitespace in flattened text: a space, or an HTML tag, which separates
 *  words as `<br>` does rather than gluing them (P1-111 round 10). */
function blank(flat: Flat, i: number): boolean {
  return flat.kinds[i] === "html" || /\s/.test(flat.text[i]!);
}

/** Visible text: HTML tags read as spaces, whitespace collapsed. */
function visible(flat: Flat): string {
  return tidy(flat, 0, flat.text.length, false);
}

/** The index just past the first sentence of `flat.text` from `from`: the first
 *  `.`, `!` or `?` that ends a word, outside brackets, parentheses and code,
 *  followed (after any closing quotes or brackets) by a space or the end. */
function sentenceEnd(flat: Flat, from = 0, to = flat.text.length): number {
  const end = findSentenceEnd(flat, from, to);
  return end === -1 ? to : end;
}

/** As `sentenceEnd`, but -1 when no sentence ends before `to`. */
function findSentenceEnd(flat: Flat, from = 0, to = flat.text.length): number {
  const t = flat.text;
  let depth = 0;
  for (let i = from; i < to; i++) {
    if (flat.kinds[i] === "code") continue;
    const ch = t[i]!;
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    else if (depth === 0 && (ch === "." || ch === "!" || ch === "?")) {
      let j = i + 1;
      while (j < to && flat.kinds[j] !== "html" && /["'’”)*_~]/.test(t[j]!)) j++;
      // Not a decimal point, a version or a domain (`4.2.0`, `reddoorla.com`).
      if ((j >= to || blank(flat, j)) && i > from && !blank(flat, i - 1)) {
        return i + 1;
      }
    }
  }
  return -1;
}

/** The first sentence of a markdown text, as plain text. */
export function firstSentence(md: string): string {
  const flat = flatten(inline(md));
  return tidy(flat, 0, sentenceEnd(flat));
}

/** Plain text for display from a span of flattened text: a tag mark reads as
 *  a space and the title mark as nothing, both found by kind so the same
 *  characters written in the text stay (round 10); stray `**` and `~~`
 *  dropped outside code unless `strip` is false; whitespace collapsed. */
function tidy(flat: Flat, from = 0, to = flat.text.length, strip = true): string {
  let out = "";
  let i = from;
  const group = (k: Kind | undefined) =>
    k === "code" || k === "html" || k === "title" ? k : "text";
  while (i < to) {
    const g = group(flat.kinds[i]);
    let j = i;
    while (j < to && group(flat.kinds[j]) === g) j++;
    const part = flat.text.slice(i, j);
    if (g === "code") out += part;
    else if (g === "html") out += " ";
    else if (g === "text") out += strip ? part.replace(/\*\*|~~/g, "") : part;
    i = j;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Every `owner/repo#NNN` and bare `#NNN` in a line, in order, once each. */
export function refsIn(text: string): BacklogRef[] {
  const out: BacklogRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(
    /(?<![\w/#])(?:([A-Za-z0-9][\w.-]*\/[\w.-]+)#(\d+)|#(\d+))(?!\w)/g,
  )) {
    const repo = m[1] ?? DEFAULT_REF_REPO;
    const num = m[2] ?? m[3]!;
    const key = `${repo}#${num}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      label: m[1] ? key : `#${num}`,
      // `/issues/N` redirects to `/pull/N` for a PR, so one URL shape serves both.
      href: `https://github.com/${repo}/issues/${num}`,
    });
  }
  return out;
}

/**
 * Every status in a cell's flattened text (P1-111; the operator's answer (b)
 * on 2026-11-23 reads them from every cell). Every whole word "status" must
 * open an exact `Status YYYY-MM-DD` with a valid date, in plain or bold text
 * (not code, emphasis, strike, a link or after an HTML tag), at the start or
 * after a space. Any other use fails loudly, naming the row and the column:
 * each earlier guess at which spellings were prose was a hole in the last.
 * A status's line runs to the next status, the title, or the cell's end.
 */
function statusesIn(id: string, column: number, flat: Flat): BacklogStatus[] {
  const t = flat.text;
  const refuse = () =>
    new BacklogParseError(
      `${id}: column ${column} uses the word status other than as "Status YYYY-MM-DD" with a valid date`,
    );
  const found: Array<{ start: number; end: number; date: string }> = [];
  for (const m of t.matchAll(STATUS_WORD)) {
    const start = m.index!;
    const at = STATUS_AT.exec(t.slice(start, start + 40));
    const before = t[start - 1];
    if (
      flat.kinds[start] === "title" ||
      !at ||
      (before !== undefined && !/\s/.test(before)) ||
      flat.kinds.slice(start, start + at[0].length).some((k) => k !== "plain") ||
      !validDate(at[1]!)
    ) {
      throw refuse();
    }
    found.push({ start, end: start + at[0].length, date: at[1]! });
  }
  return found.map((s, k) => {
    let stop = found[k + 1]?.start ?? t.length;
    // The title by its kind, not its character: a literal U+FFFD is text (round 10).
    const title = flat.kinds.indexOf("title", s.end);
    if (title !== -1 && title < stop) stop = title;
    // Drop the provenance tag (`[M, merge commits]`) and a `:` or dash after the date.
    let from = s.end;
    const lead = /^\s*(?:\[[^\]]*\]\s*)?(?::|—|–|-)?\s*/.exec(t.slice(from, stop))!;
    from += lead[0].length;
    const sentence = tidy(flat, from, sentenceEnd(flat, from, stop));
    if (sentence === "") {
      throw new BacklogParseError(
        `${id}: its status line dated ${s.date} has no text after the date`,
      );
    }
    // Refs from the whole line, its `[tag]` included (round 10).
    return { date: s.date, sentence, refs: refsIn(tidy(flat, s.end, stop)) };
  });
}

/** A bold node, or an emphasis holding only one (`***Title***`). */
function boldOf(node: PhrasingContent): boolean {
  if (node.type === "strong") return true;
  return (
    node.type === "emphasis" && node.children.length === 1 && node.children[0]!.type === "strong"
  );
}

/** A bold node whose text opens with `Status YYYY-MM-DD` in plain text: a status prefix. */
function statusBold(node: PhrasingContent): boolean {
  if (node.type !== "strong") return false;
  const first = node.children[0];
  return first?.type === "text" && STATUS_AT.test(first.value);
}

/**
 * The item cell's title: the first bold node that is not a status prefix. The
 * cell must open with a bold node. After a status whose bold holds only its
 * label (`**Status 2026-11-22:** done, see **P1-82** first. **Title**`), the
 * plain text that follows is that status's, and the title is the first bold
 * that opens after a sentence ends.
 */
function titleOf(id: string, nodes: PhrasingContent[]): PhrasingContent {
  let labelOnly = false;
  let since: PhrasingContent[] = [];
  let seenStatus = false;
  for (const node of nodes) {
    if (statusBold(node)) {
      seenStatus = true;
      const rest = flatten([node]).text.replace(STATUS_AT, "");
      labelOnly = /^(?:\[[^\]]*\])?\s?[:—–-]?$/.test(rest.trim());
      since = [];
      continue;
    }
    if (boldOf(node)) {
      // A sentence has ended in the text since the label (outside code and
      // brackets, by the same rule as a status's sentence), or there is none.
      const pending = flatten(since);
      if (!labelOnly || pending.text.trim() === "" || findSentenceEnd(pending) !== -1) {
        return node;
      }
    }
    if (!seenStatus && flatten([node]).text.trim() !== "") break;
    since.push(node);
  }
  throw new BacklogParseError(`${id}: its item cell has no bold title`);
}

function parseItem(rank: number, cells: string[], lineNo: number): BacklogItem {
  const id = cells[0] ?? "";
  if (!/^P1-\d+[a-z]?$/.test(id)) {
    throw new BacklogParseError(
      `line ${lineNo}: the P1 table's row has no P1-NNN ID in its first cell`,
    );
  }
  const item = inline(cells[1] ?? "");
  const titleNode = titleOf(id, item);
  const title = visible(flatten([titleNode]));
  if (title === "") throw new BacklogParseError(`${id}: its item cell has no bold title`);
  if (STATUS_TITLE.test(title.replace(/^[^\p{L}\p{N}]+/u, ""))) {
    throw new BacklogParseError(
      `${id}: its title begins with the word Status; a status line must read "Status YYYY-MM-DD"`,
    );
  }
  // The item cell (its title excluded) and every cell after it; column 1 is the ID.
  const statuses = [
    ...statusesIn(id, 2, flatten(item, "plain", undefined, titleNode)),
    ...cells.slice(2).flatMap((cell, k) => statusesIn(id, k + 3, flatten(inline(cell)))),
  ];
  // The newest by date; on a tie, the first met.
  const newest = statuses.reduce<BacklogStatus | null>(
    (best, s) => (best === null || s.date > best.date ? s : best),
    null,
  );
  const tierCell = cells[2];
  const tierText = tierCell === undefined ? "" : visible(flatten(inline(tierCell)));
  return { rank, id, title, tier: tierText === "" ? null : tierText, status: newest };
}

/** "Last full re-rank: 2026-11-23 ~13:20Z" → the ISO instant, or null. */
function parseRerank(md: string): string | null {
  const m = /Last full re-rank:\s*(\d{4}-\d{2}-\d{2})\s*~?\s*(\d{1,2}):(\d{2})Z/.exec(md);
  if (!m) return null;
  // Date.parse rolls 2026-02-30 and 24:00 over to the next day; refuse both.
  if (!validDate(m[1]!) || Number(m[2]) > 23 || Number(m[3]) > 59) return null;
  return new Date(`${m[1]}T${m[2]!.padStart(2, "0")}:${m[3]}:00Z`).toISOString();
}

/** The first `count` rows of the backlog's P1 table, in rank order. */
export function topBacklogItems(md: string, count = 5): BacklogTop {
  const lines = md.split(/\r?\n/);
  const heading = lines.findIndex((l) => /^## P1\b/.test(l));
  if (heading === -1) throw new BacklogParseError("no `## P1` heading in the backlog");
  let i = heading + 1;
  while (i < lines.length && !lines[i]!.startsWith("|")) {
    if (/^#{1,3} /.test(lines[i]!)) {
      throw new BacklogParseError(
        `line ${heading + 1}: the P1 section has no table before its next heading`,
      );
    }
    i++;
  }
  if (i >= lines.length)
    throw new BacklogParseError(`line ${heading + 1}: the P1 section has no table`);
  // The header row, then its `| --- |` separator.
  const sep = lines[i + 1] ?? "";
  if (!/^\|[\s:|-]+\|?\s*$/.test(sep)) {
    throw new BacklogParseError(
      `line ${i + 2}: the P1 table's header has no separator row under it`,
    );
  }
  const items: BacklogItem[] = [];
  for (let j = i + 2; j < lines.length && lines[j]!.startsWith("|") && items.length < count; j++) {
    items.push(parseItem(items.length + 1, splitRow(lines[j]!), j + 1));
  }
  return { rerankedAt: parseRerank(md), items };
}
