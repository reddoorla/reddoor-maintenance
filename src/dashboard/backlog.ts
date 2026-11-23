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
  /** The newest `**Status <date> …**` line in the title cell, or null when there is none. */
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

/** Split a table row into cells on `|`, except inside a code span or after a backslash. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "`") {
      inCode = !inCode;
      cur += ch;
    } else if (ch === "|" && !inCode) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  // A row is `| a | b |`: drop the empty edges outside the first and last pipe.
  if (cells.length > 0 && cells[0]!.trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]!.trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

/** Markdown to plain text: emphasis and code markers dropped, links to their text. */
export function plain(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A segment meant as a status: the word in any case, then a colon, or up to
 *  three non-word characters and a digit (`Status 2026-…`, `status 2026-…`,
 *  `Status2026-…`, `Status-2026-…`, `Status (2026-…)`, `Status: …`). A title
 *  that only begins with the word (`Status page for clients`) is not one; a
 *  title like `Status 404 pages` is read as a malformed status and fails
 *  loudly, which is the safe way to be wrong. */
const STATUS_WORD = /^status(?:\W{0,3}\d|\s*:)/i;
/** The one well-formed shape: `Status YYYY-MM-DD`, then a space, `[`, `:` or the end. */
const STATUS_DATED = /^Status (\d{4}-\d{2}-\d{2})(?=[\s[:]|$)\s*(.*)$/s;

function validDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** The first sentence: up to the first `.`, `!` or `?` that ends a word and is
 *  followed by a space or the end, outside brackets, parentheses and code. */
export function firstSentence(text: string): string {
  let depth = 0;
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "`") inCode = !inCode;
    if (inCode) continue;
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    else if (depth === 0 && (ch === "." || ch === "!" || ch === "?")) {
      const next = text[i + 1];
      const prev = text[i - 1];
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
function leadingParts(cell: string): { statuses: string[]; title: string | null } {
  const statuses: string[] = [];
  let rest = cell;
  for (;;) {
    const opened = /^\s*\*\*/.test(rest);
    rest = rest.replace(/^\s*(?:\*\*\s*)?/, "");
    const close = rest.indexOf("**");
    const segment = close === -1 ? rest : rest.slice(0, close);
    if (STATUS_WORD.test(segment)) {
      statuses.push(segment.trim());
      rest = close === -1 ? "" : rest.slice(close + 2);
      continue;
    }
    return { statuses, title: opened && close !== -1 ? segment.trim() : null };
  }
}

function parseStatus(id: string, span: string): BacklogStatus {
  const m = STATUS_DATED.exec(span);
  if (!m || !validDate(m[1]!)) {
    throw new BacklogParseError(
      `${id}: a status line is not "Status YYYY-MM-DD" with a valid date`,
    );
  }
  // Drop the provenance tag (`[M, merge commits]:`, not a leading `[link](url)`)
  // and a bare `:` or dash after the date.
  const body = m[2]!.replace(/^\[[^\]]*\](?!\()\s*/, "").replace(/^[:\u2014\u2013-]\s*/, "");
  const sentence = plain(firstSentence(body));
  if (sentence === "") {
    throw new BacklogParseError(`${id}: its status line dated ${m[1]} has no text after the date`);
  }
  return { date: m[1]!, sentence, refs: refsIn(body) };
}

function parseItem(rank: number, cells: string[], lineNo: number): BacklogItem {
  const id = cells[0] ?? "";
  if (!/^P1-\d+[a-z]?$/.test(id)) {
    throw new BacklogParseError(
      `line ${lineNo}: the P1 table's row has no P1-NNN ID in its first cell`,
    );
  }
  const { statuses: spans, title: lead } = leadingParts(cells[1] ?? "");
  const statuses = spans.map((s) => parseStatus(id, s));
  const title = lead === null ? "" : plain(lead);
  if (title === "") {
    throw new BacklogParseError(`${id}: its item cell has no bold title`);
  }
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
