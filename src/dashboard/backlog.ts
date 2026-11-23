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

/** The text with every code span's characters, backticks included, replaced
 *  by `\u0000`: positions line up with the original, and no search sees code. */
function masked(text: string): string {
  let out = text;
  for (const [a, b] of codeSpans(text).spans) {
    out = out.slice(0, a) + "\u0000".repeat(b - a) + out.slice(b);
  }
  return out;
}

/** The index of the next `**` outside code, from `from`, or -1. */
function boldAt(text: string, from = 0): number {
  return masked(text).indexOf("**", from);
}

/**
 * Split a table row into cells. Every unescaped `|` splits, as GitHub does;
 * then a piece that leaves a backtick run unclosed is joined to the following
 * pieces up to the first one whose own first unclosed run has the same length,
 * so a code span holding `|` (`a | b`, ``a|b``) stays one cell. A piece whose
 * backticks all pair within it, or a lone backtick with no such partner,
 * joins nothing.
 */
export function splitRow(line: string): string[] {
  const pieces: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "\\" && line[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (ch === "|") {
      pieces.push(cur);
      cur = "";
    } else cur += ch;
  }
  pieces.push(cur);
  const cells: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    let cell = pieces[i]!;
    const open = codeSpans(cell).open;
    if (open.length > 0) {
      for (let j = i + 1; j < pieces.length; j++) {
        const first = codeSpans(pieces[j]!).open[0];
        if (first === undefined) continue;
        if (first === open[open.length - 1]) {
          cell = pieces.slice(i, j + 1).join("|");
          i = j;
        }
        break;
      }
    }
    cells.push(cell);
  }
  // A row is `| a | b |`: drop the empty edges outside the first and last pipe.
  if (cells.length > 0 && cells[0]!.trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]!.trim() === "") cells.pop();
  return cells.map((c) => c.replace(/\\\|/g, "|").trim());
}

/** Markdown outside code to plain text: links to their text; bold, italic and
 *  strike markers dropped (an `_` only at a word's edge, so `snake_case`
 *  stays). */
function plainProse(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/~~|\*+/g, "")
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, "");
}

/** Markdown to plain text: code spans keep their content verbatim, without
 *  their backticks; everything else goes through `plainProse`. */
export function plain(md: string): string {
  let out = "";
  let at = 0;
  for (const [a, b] of codeSpans(md).spans) {
    out += plainProse(md.slice(at, a));
    out += md.slice(a, b).replace(/^`+|`+$/g, "");
    at = b;
  }
  out += plainProse(md.slice(at));
  return out.replace(/\s+/g, " ").trim();
}

/**
 * A title that begins with the word Status, in any case, followed by anything
 * but a letter. Only an exact `Status YYYY-MM-DD` is peeled off as a status
 * (`leadingParts`), so every other way of writing one (`status 2026-…`,
 * `Status-2026-…`, `Status [M]: …`, `Status Nov 12: …`, `~~Status 2026-…~~`,
 * `` `Status 2026-…` ``, `<s>Status …</s>`) arrives here as the title, and is
 * refused rather than shown as one. Telling those apart from a real title such
 * as "Status page for clients" is a guess that four review rounds kept finding
 * holes in, so a title may not begin with the word at all: such a row fails
 * loudly, naming its ID, until it is reworded.
 */
const STATUS_TITLE = /^status(?!\p{L})/iu;

/** A title as a reader sees it: HTML tags dropped, then leading symbols,
 *  spaces and invisible characters (anything not a letter or digit). */
function visibleText(title: string): string {
  return title.replace(/<[^>]*>/g, "").replace(/^[^\p{L}\p{N}]+/u, "");
}

/** The one well-formed shape: `Status YYYY-MM-DD`, then a space, `[`, `:` or the end. */
const STATUS_DATED = /^Status (\d{4}-\d{2}-\d{2})(?=[\s[:]|$)\s*(.*)$/s;

function validDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** The first sentence: up to the first `.`, `!` or `?` that ends a word and is
 *  followed by a space or the end, outside brackets, parentheses and code. */
export function firstSentence(text: string): string {
  const seen = masked(text);
  let depth = 0;
  for (let i = 0; i < seen.length; i++) {
    const ch = seen[i]!;
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    else if (depth === 0 && (ch === "." || ch === "!" || ch === "?")) {
      const next = seen[i + 1];
      const prev = seen[i - 1];
      // Not a decimal point, a version or a domain (`4.2.0`, `reddoorla.com`).
      if ((next === undefined || /\s/.test(next)) && prev !== undefined && !/\s/.test(prev)) {
        return text.slice(0, i + 1);
      }
    }
  }
  return text;
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
 * A title cell is zero or more status prefixes, then the bold title:
 * `**Status <date> …** **Title…** more text`. Each prefix runs from `Status` to
 * the next `**`. The prefixes are peeled off one at a time rather than read as
 * paired `**…**` spans, because a status prepended to a cell that already began
 * with one can leave the older one's opening `**` behind (P1-82, 2026-11-11),
 * which shifts every later pair. The title is the text after the prefixes, up
 * to the next `**`, and must itself open with `**`.
 */
function leadingParts(cell: string): {
  statuses: string[];
  title: string | null;
  /** The cell's text after the title's closing `**`. */
  after: string;
} {
  const statuses: string[] = [];
  let rest = cell;
  for (;;) {
    const opened = /^\s*\*\*/.test(rest);
    rest = rest.replace(/^\s*(?:\*\*\s*)?/, "");
    const close = boldAt(rest);
    const segment = close === -1 ? rest : rest.slice(0, close);
    if (STATUS_DATED.test(segment.trim())) {
      statuses.push(segment.trim());
      rest = close === -1 ? "" : rest.slice(close + 2);
      continue;
    }
    // Plain text straight after a status whose bold held only its label
    // (`**Status 2026-11-22:** done. **Title**`) is that status's text, a
    // sentence at a time: a bold inside it (`see **P1-82** first.`) is part of
    // the sentence, and the title is the bold that opens after a sentence ends.
    if (!opened && statuses.length > 0 && rest.trim() !== "") {
      const sentence = firstSentence(rest);
      statuses[statuses.length - 1] += ` ${sentence.trim()}`;
      rest = rest.slice(sentence.length);
      continue;
    }
    const title = opened && close !== -1 ? segment.trim() : null;
    return { statuses, title, after: title === null ? "" : rest.slice(close + 2) };
  }
}

/** A status's date and the raw text after it, as a status. */
function statusFrom(id: string, date: string, raw: string): BacklogStatus {
  // Drop the provenance tag (`[M, merge commits]:`, not a leading `[link](url)`),
  // a bare `:` or dash after the date, and the bold markers around either
  // (`**Status 2026-11-01 [M]:** text`, where the bold holds only the label).
  const bold = /^(?:\*\*|__)\s*/;
  const body = raw
    .trim()
    .replace(bold, "")
    .replace(/^\[[^\]]*\](?!\()\s*/, "")
    .replace(bold, "")
    .replace(/^[:\u2014\u2013-]\s*/, "")
    .replace(bold, "");
  const sentence = plain(firstSentence(body));
  if (sentence === "") {
    throw new BacklogParseError(`${id}: its status line dated ${date} has no text after the date`);
  }
  return { date, sentence, refs: refsIn(body) };
}

/** The word status, in any case, not inside a longer word ("Statuses" is not it). */
const STATUS_WORD = /(?<!\p{L})status(?!\p{L})/giu;
/** What a status may stand after: the cell's start, a space, or a bold opener that does. */
const STATUS_BEFORE = /(?:^|\s)(?:\*\*|__)?$/;
/** A well-formed status at the word: `Status YYYY-MM-DD`, then a space, `[`, `:`, `*`, `_` or the end. */
const STATUS_AT = /^Status (\d{4}-\d{2}-\d{2})(?=[\s[:*_]|$)/;

/**
 * Every status in a cell's text, wherever it stands (P1-111, the operator's
 * answer (b) on 2026-11-23: P1-93 writes its status in the "Start here"
 * column). Every whole word "status" must open an exact `Status YYYY-MM-DD`
 * with a valid date, standing at the start, after a space or after a bold
 * opener; any other use of the word (`status 2026-…`, `~~Status …`,
 * `` `Status …` ``, prose such as "the status of") fails loudly, naming the row
 * and the column, for the same reason as a title beginning with the word: each
 * guess at which spellings are prose was a hole in the last.
 */
function statusesIn(id: string, column: number, text: string): BacklogStatus[] {
  const at = [...text.matchAll(STATUS_WORD)].map((m) => m.index!);
  return at.map((start, k) => {
    const m = STATUS_AT.exec(text.slice(start));
    if (!m || !STATUS_BEFORE.test(text.slice(0, start)) || !validDate(m[1]!)) {
      throw new BacklogParseError(
        `${id}: column ${column} uses the word status other than as "Status YYYY-MM-DD" with a valid date`,
      );
    }
    // The line runs to the next status in the cell, or the cell's end.
    const end = at[k + 1] ?? text.length;
    return statusFrom(id, m[1]!, text.slice(start + m[0].length, end));
  });
}

function parseItem(rank: number, cells: string[], lineNo: number): BacklogItem {
  const id = cells[0] ?? "";
  if (!/^P1-\d+[a-z]?$/.test(id)) {
    throw new BacklogParseError(
      `line ${lineNo}: the P1 table's row has no P1-NNN ID in its first cell`,
    );
  }
  const { statuses: spans, title: lead, after } = leadingParts(cells[1] ?? "");
  // A prefix may itself hold more statuses, or a misspelled one: the same
  // word check as every other cell applies to it.
  const statuses = spans.flatMap((s) => statusesIn(id, 2, s));
  const title = lead === null ? "" : plain(lead);
  if (title === "") {
    throw new BacklogParseError(`${id}: its item cell has no bold title`);
  }
  if (STATUS_TITLE.test(visibleText(title))) {
    throw new BacklogParseError(
      `${id}: its title begins with the word Status; a status line must read "Status YYYY-MM-DD"`,
    );
  }
  // The rest of the item cell, after its title, and every cell after it
  // (column 1 is the ID; the title is checked above, by its own rule).
  statuses.push(...statusesIn(id, 2, after));
  cells.slice(2).forEach((cell, k) => statuses.push(...statusesIn(id, k + 3, cell)));
  const newest = statuses.reduce<BacklogStatus | null>(
    (best, s) => (best === null || s.date > best.date ? s : best),
    null,
  );
  const tierCell = cells[2];
  const tier = tierCell === undefined || plain(tierCell) === "" ? null : plain(tierCell);
  return { rank, id, title, tier, status: newest };
}

/** "Last full re-rank: 2026-11-23 ~13:20Z" → the ISO instant, or null. */
function parseRerank(md: string): string | null {
  const m = /Last full re-rank:\s*(\d{4}-\d{2}-\d{2})\s*~?\s*(\d{1,2}):(\d{2})Z/.exec(md);
  if (!m) return null;
  const iso = `${m[1]}T${m[2]!.padStart(2, "0")}:${m[3]}:00Z`;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
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
