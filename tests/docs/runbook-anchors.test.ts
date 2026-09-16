import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every runbook under `docs/runbooks/` cites code as `path:N` or `path:N–M`, and nothing
 * watched those numbers until this file. `continuity.md` — the page a colleague follows for a
 * week if the operator is unreachable — carries ~40 of them; two had already drifted when the
 * page was reviewed, and four more were drifted or mis-numbered when this test first ran.
 *
 * The check has three levels, weakest to strongest:
 *
 *   1. The cited file exists.
 *   2. The cited line range lies inside it.
 *   3. The cited range still contains something the prose names FOR THAT CITATION — the
 *      backticked terms written since the previous citation in the same block, which is the
 *      clause the citation is parenthetical to. Only when a citation introduces no term of its
 *      own does the whole block's pool stand in for it, which keeps the shape that leads with
 *      the citation and names its term afterwards (`src/x.ts:1–9` — `sendOne` **throws**).
 *
 * Scoping (3) that way is what closes the blind spot found on 2026-09-15. `continuity.md` read
 * "exits non-zero with a `✗` line per mismatch (`src/cli/commands/db.ts:405–418`)" and then
 * listed three refusals by name. `db.ts` grew 36 lines, the mismatch code moved to 441–454, and
 * the stale range came to rest on `RESTORE refused=auth-token-absent` — a term the same
 * paragraph does name, two sentences later, about something else entirely. The checker found "a
 * term the paragraph names" inside the range and marked the citation VERIFIED: a gate passing
 * where it should fail, on the one class this repo cares about most. A citation is now anchored
 * only by the terms it was written to point at.
 *
 * (3) is the one that catches the dangerous case: a citation that still resolves and still
 * points INTO the file, but now lands on unrelated code because everything above it moved.
 * Level 1 and 2 are cheap and absolute; level 3 is a heuristic, and is deliberately built so
 * that its two failure modes land on the safe side:
 *
 *   - It NEVER fails a citation it cannot judge. A paragraph with no usable backticked token
 *     yields no evidence either way, so the citation is reported `unanchored` and passes.
 *   - It prefers a false PASS to a false FAIL, because a test that cries wolf gets deleted and
 *     then nothing watches the page at all. Matching is nonetheless CASE-SENSITIVE on purpose:
 *     the very first drift this test found (`fleet-cockpit.ts:33`, the `Tier` union, which is
 *     on line 34) would have passed a case-insensitive match against line 33's
 *     `import { diffAttention, ... }` — "attention" inside "diffAttention".
 *
 * The instrument is proved before it is trusted (CLAUDE.md, "Prove the instrument before you
 * trust its verdict"): the fixture tests below drive a known-good citation to `verified` and a
 * known-bad one to a failure, so the real-runbook assertion is not the first thing this code
 * has ever been asked.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RUNBOOK_DIR = join(REPO_ROOT, "docs/runbooks");

/** Extensions that make a bare basename (no `/`) read as a file rather than prose. */
const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  "ts",
  "tsx",
  "js",
  "mjs",
  "cjs",
  "mts",
  "json",
  "yml",
  "yaml",
  "md",
  "sh",
  "svelte",
  "html",
  "css",
  "toml",
  "txt",
  "gitignore",
  "gitattributes",
  "npmrc",
  "nvmrc",
]);

/**
 * Tokens that carry no identifying information: they appear in almost every file, so letting
 * one anchor a citation would turn level 3 into a rubber stamp. Kept deliberately short — the
 * language keywords are here because a quoted line of code (`` `const tokenValue = …` ``)
 * would otherwise anchor on its leading `const`.
 */
const STOPLIST: ReadonlySet<string> = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "main",
  "pnpm",
  "npm",
  "node",
  "bash",
  "curl",
  "HEAD",
  "this",
  "const",
  "let",
  "var",
  "new",
  "type",
  "class",
  "async",
  "await",
  "return",
  "import",
  "export",
  "function",
]);

/** Shortest token worth looking for. Below this, a match is coincidence. */
const MIN_TOKEN_LENGTH = 4;

/**
 * A markdown code span: ``double-backticked`` first (it may contain single backticks — the
 * runbooks use it to quote a line of code that itself contains a template literal), then the
 * ordinary single-backtick form.
 */
const CODE_SPAN = /``(.+?)``|`([^`\n]+)`/g;

/**
 * A citation, as the whole content of a code span: `path:N`, `path:N-M`, `path:N–M` (en dash),
 * or the bare `:N` continuation the runbooks use for "the same file again". Anchored at both
 * ends, so `09:23 UTC` and `README.md §"…"` are prose, not citations.
 */
const CITATION = /^([^\s`]*?):(\d+)(?:[-–](\d+))?$/;

type Citation = {
  /** The code span exactly as written, for the failure message. */
  readonly raw: string;
  /** Path as written; "" for a bare `:N` continuation. */
  readonly written: string;
  readonly start: number;
  readonly end: number;
  /** 1-based line in the runbook, so a failure names where to go and edit. */
  readonly line: number;
  /** Position among the code spans of its block, which is what scopes its anchor terms. */
  readonly order: number;
};

type RunbookReport = {
  readonly runbook: string;
  readonly cited: number;
  readonly verified: number;
  readonly unanchored: number;
  readonly failures: readonly string[];
};

/** A file the audit may cite, as its lines; `null` when the path is not a readable file. */
type FileReader = (repoRelativePath: string) => readonly string[] | null;

/**
 * Is this a repo-relative path we should try to resolve? Skips URLs, absolute paths and `~`
 * paths — none of those are ours to range-check — and requires either a directory separator
 * or a known extension, so `18` (from a time) and `3000` (from a port) stay prose.
 */
export function looksLikeRepoPath(written: string): boolean {
  if (written === "") return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(written)) return false;
  if (written.startsWith("~") || written.startsWith("/")) return false;
  if (written.includes("/")) return true;
  const dot = written.lastIndexOf(".");
  if (dot < 0) return false;
  // `>= 0`, not `> 0`: `.gitignore` is a dotfile whose whole name is the extension.
  return KNOWN_EXTENSIONS.has(written.slice(dot + 1).toLowerCase());
}

/**
 * Prose blocks, each a list of the code spans inside it, in document order.
 *
 * A block is a run of non-blank lines, with three exceptions that keep the token pool honest:
 * a table row, a list item and a heading each start their own block, and a table row and a
 * heading also END it. Without that, the one big signals table in `continuity.md` would be a
 * single block and every row's tokens would be offered to every other row's citations.
 *
 * Fenced code blocks are skipped entirely: they hold commands and sample output, where a
 * backticked span is literal text rather than a reference.
 */
function codeSpanBlocks(lines: readonly string[]): Array<Array<{ text: string; line: number }>> {
  const blocks: Array<Array<{ text: string; line: number }>> = [];
  let current: Array<{ text: string; line: number }> | null = null;
  let inFence = false;

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      current = null;
      return;
    }
    if (inFence) return;
    if (line.trim() === "") {
      current = null;
      return;
    }
    const isRow = /^\s*\|/.test(line);
    const isItem = /^\s*(?:[-*+]|\d+[.)])\s/.test(line);
    const isHeading = /^\s*#/.test(line);
    if (isRow || isItem || isHeading || current === null) {
      current = [];
      blocks.push(current);
    }
    CODE_SPAN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CODE_SPAN.exec(line)) !== null) {
      const text = (match[1] ?? match[2] ?? "").trim();
      if (text !== "") current.push({ text, line: index + 1 });
    }
    if (isRow || isHeading) current = null;
  });

  return blocks;
}

/**
 * The forms of a token worth looking for, most specific first:
 *
 *   - the token itself;
 *   - its leading identifier run, so `mismatches=0` anchors on the `mismatches` in
 *     `` mismatches=${bad.length} `` and `gpg --version` on the `gpg` the cited lines name.
 *     Three characters is enough here because the FULL token still had to clear
 *     MIN_TOKEN_LENGTH; the stoplist keeps `const …` from anchoring on `const`;
 *   - its last dotted segment, so prose that names a field by its qualified name
 *     (`forms.testMode`, `sites.report_recipients_to`) still matches code that has only the
 *     bare one.
 */
export function tokenVariants(token: string): string[] {
  const variants = [token];
  const lead = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(token)?.[0];
  if (lead !== undefined && lead.length >= 3 && lead !== token && !STOPLIST.has(lead)) {
    variants.push(lead);
  }
  const dot = token.lastIndexOf(".");
  if (dot > 0) {
    const tail = token.slice(dot + 1);
    if (tail.length >= MIN_TOKEN_LENGTH && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tail)) {
      variants.push(tail);
    }
  }
  return variants;
}

/**
 * Does `region` contain `variant`, allowing the punctuation BETWEEN its alphanumeric runs to
 * differ? Prose writes `` `overages: false` `` where the code writes `"overages": false`, and
 * `` `const tokenValue = `testmode-${testSitekey}`` `` has ` = \`` where a naive compare wants
 * one space. The alphanumeric runs themselves must match exactly, in order, case-sensitively,
 * and the gap is capped at six characters so this never welds two unrelated words together.
 */
export function regionContains(region: string, variant: string): boolean {
  const runs = variant.match(/[A-Za-z0-9]+/g);
  if (runs === null || runs.length === 0) return false;
  return new RegExp(runs.join("[^A-Za-z0-9]{0,6}")).test(region);
}

/**
 * Audit one runbook. Pure: every file it consults arrives through `read`, which is what lets
 * the fixture tests below drive both controls without touching the disk.
 */
export function auditRunbook(runbook: string, markdown: string, read: FileReader): RunbookReport {
  const lines = markdown.split("\n");
  const failures: string[] = [];
  let cited = 0;
  let verified = 0;
  let unanchored = 0;

  /**
   * The last citation path resolved anywhere in THIS runbook. The runbooks abbreviate a
   * repeated file to its basename (`fleet-cockpit.ts:180` after
   * `src/dashboard/fleet-cockpit.ts:33`), so a basename that is not itself a repo path is
   * resolved against the nearest preceding citation that ends in it — the writer's own
   * antecedent, never a guess.
   */
  let lastResolvedInFile: string | null = null;

  for (const block of codeSpanBlocks(lines)) {
    const citations: Citation[] = [];
    const tokens: Array<{ text: string; order: number }> = [];
    block.forEach((span, order) => {
      const match = CITATION.exec(span.text);
      const written = match?.[1];
      if (match !== undefined && match !== null && written !== undefined) {
        if (looksLikeRepoPath(written) || written === "") {
          citations.push({
            raw: span.text,
            written,
            start: Number(match[2]),
            end: Number(match[3] ?? match[2]),
            line: span.line,
            order,
          });
          return;
        }
      }
      if (span.text.length >= MIN_TOKEN_LENGTH && !STOPLIST.has(span.text)) {
        tokens.push({ text: span.text, order });
      }
    });

    // A bare `:N` only ever means "the file just cited in this same parenthetical", so its
    // antecedent is scoped to the block, not the whole document.
    let lastResolvedInBlock: string | null = null;

    // Where the previous citation of this block sat among its code spans. Terms before it
    // belong to that citation, not to this one.
    let previousCitationOrder = -1;

    for (const citation of citations) {
      // The terms THIS citation introduces: everything backticked between the previous
      // citation and this one. A paragraph that cites one thing and then names three others
      // must not have the later three vouch for the earlier citation's range.
      const introduced = tokens
        .filter((t) => t.order > previousCitationOrder && t.order < citation.order)
        .map((t) => t.text);
      previousCitationOrder = citation.order;

      let path = citation.written;
      if (path === "") {
        if (lastResolvedInBlock === null) continue; // no antecedent: not a citation we can read
        path = lastResolvedInBlock;
      } else if (!path.includes("/") && read(path) === null) {
        const antecedent: string | null = lastResolvedInFile;
        if (antecedent !== null && antecedent.endsWith(`/${path}`)) path = antecedent;
      }

      cited += 1;
      const where = `${runbook}:${citation.line}`;
      const fileLines = read(path);
      if (fileLines === null) {
        failures.push(
          `${where} — citation \`${citation.raw}\` names ${path}, which is not a file in the repo. ` +
            `Write the repo-relative path (a bare basename is only resolved when an earlier ` +
            `citation in the same runbook spells it out in full).`,
        );
        continue;
      }
      lastResolvedInFile = path;
      lastResolvedInBlock = path;

      if (citation.end > fileLines.length || citation.start < 1) {
        failures.push(
          `${where} — citation \`${citation.raw}\` points at lines ${citation.start}–${citation.end} ` +
            `of ${path}, which is ${fileLines.length} lines long.`,
        );
        continue;
      }

      // A citation that introduces nothing of its own (it leads its sentence, or shares a
      // parenthetical with the citation before it) falls back to the block's whole pool —
      // no evidence is better than evidence borrowed from the wrong clause.
      const candidates = [
        ...new Set(introduced.length > 0 ? introduced : tokens.map((t) => t.text)),
      ];
      if (candidates.length === 0) {
        unanchored += 1;
        continue;
      }
      const region = fileLines.slice(citation.start - 1, citation.end).join("\n");
      const hit = candidates.some((token) =>
        tokenVariants(token).some((variant) => regionContains(region, variant)),
      );
      if (hit) {
        verified += 1;
      } else {
        failures.push(
          `${where} — citation \`${citation.raw}\` no longer points at what the prose says it ` +
            `does: none of the terms the prose names for it appear in ${path} lines ` +
            `${citation.start}–${citation.end} (of ${fileLines.length}). ` +
            `Looked for: ${candidates.map((t) => JSON.stringify(t)).join(", ")}. ` +
            `Either the code moved (re-number the citation) or the prose did (re-word it).`,
        );
      }
    }
  }

  return { runbook, cited, verified, unanchored, failures };
}

/** A reader over the real repo that reads each cited file at most once. */
function repoReader(): FileReader {
  const cache = new Map<string, readonly string[] | null>();
  return (relativePath) => {
    const hit = cache.get(relativePath);
    if (hit !== undefined) return hit;
    let lines: readonly string[] | null = null;
    try {
      const full = join(REPO_ROOT, relativePath);
      if (statSync(full).isFile()) lines = readFileSync(full, "utf8").split("\n");
    } catch {
      lines = null;
    }
    cache.set(relativePath, lines);
    return lines;
  };
}

/** A reader over an in-memory fixture tree, for the controls. */
function fixtureReader(files: Record<string, string>): FileReader {
  return (relativePath) => {
    const body = files[relativePath];
    return body === undefined ? null : body.split("\n");
  };
}

describe("the runbook-citation checker", () => {
  // One fixture drives both controls: the source file is real-shaped (a doc comment, then the
  // declaration the prose names), so "shift the citation by 10" moves it off the declaration
  // and onto unrelated lines exactly the way a real edit above it would.
  const SOURCE = [
    ...Array.from({ length: 18 }, (_, i) => `import { thing${i} } from "./thing${i}.js";`),
    "",
    "/** The bands a site can be sorted into. */",
    'export type Tier = "attention" | "watch" | "healthy";',
    "",
    ...Array.from({ length: 20 }, (_, i) => `const filler${i} = ${i};`),
  ].join("\n");
  const FILES = { "src/example.ts": SOURCE };

  it("verifies a citation that lands on what the prose names (PASS control)", () => {
    const md =
      "It sorts every site into three tiers — `attention`, `watch`, `healthy`\n(`src/example.ts:21`).\n";
    const report = auditRunbook("fixture.md", md, fixtureReader(FILES));
    expect(report.failures).toEqual([]);
    expect(report).toMatchObject({ cited: 1, verified: 1, unanchored: 0 });
  });

  it("fails that same citation once it is shifted off its anchor (FAIL control)", () => {
    const md =
      "It sorts every site into three tiers — `attention`, `watch`, `healthy`\n(`src/example.ts:31`).\n";
    const report = auditRunbook("fixture.md", md, fixtureReader(FILES));
    expect(report.verified).toBe(0);
    expect(report.failures).toHaveLength(1);
    const failure = report.failures[0]!;
    expect(failure).toContain("fixture.md:2");
    expect(failure).toContain("`src/example.ts:31`");
    expect(failure).toContain("lines 31–31");
    expect(failure).toContain('"attention"');
    expect(failure).toContain('"healthy"');
  });

  // The 2026-09-15 blind spot, in miniature. The paragraph cites the mismatch code and THEN
  // names three refusals; the refusals live above it in the file. Before anchor terms were
  // scoped to the citation that introduces them, a range that had drifted onto a refusal was
  // marked verified, because the checker only asked whether the range held a term the
  // paragraph names somewhere — not whether it held the term this citation is about.
  const RESTORE = [
    "export async function restore(opts) {", // 1
    '  if (!token) return "RESTORE refused=auth-token-absent";', // 2
    '  if (!manifest) return "RESTORE refused=manifest-absent";', // 3
    '  if (existing) return "RESTORE refused=target-not-empty";', // 4
    "  const bad = [];", // 5
    "  for (const t of tables) if (counts[t] !== want[t]) bad.push(t);", // 6
    "  return `RESTORE loaded=true mismatches=${bad.length}`;", // 7
    "}", // 8
  ].join("\n");
  const RESTORE_FILES = { "src/restore.ts": RESTORE };
  const restoreMd = (range: string) =>
    "What you are checking is `mismatches=0`. A restore that came up short of the origin\n" +
    `manifest exits non-zero with a ✗ line per mismatch (\`src/restore.ts:${range}\`). Three\n` +
    "refusals you may see instead: `RESTORE refused=auth-token-absent`,\n" +
    "`RESTORE refused=manifest-absent`, and `RESTORE refused=target-not-empty`.\n";

  it("verifies the citation while it still points at the mismatch code (PASS control)", () => {
    const report = auditRunbook("fixture.md", restoreMd("5–7"), fixtureReader(RESTORE_FILES));
    expect(report.failures).toEqual([]);
    expect(report).toMatchObject({ cited: 1, verified: 1, unanchored: 0 });
  });

  it("fails it once it drifts onto a refusal the same paragraph happens to name", () => {
    const report = auditRunbook("fixture.md", restoreMd("1–4"), fixtureReader(RESTORE_FILES));
    expect(report.verified).toBe(0);
    expect(report.failures).toHaveLength(1);
    const failure = report.failures[0]!;
    expect(failure).toContain("`src/restore.ts:1–4`");
    expect(failure).toContain('"mismatches=0"');
    // The terms lines 1–4 DO contain are named after the citation, so they are not evidence
    // for it. Their absence from "Looked for:" is the whole fix.
    expect(failure).not.toContain("auth-token-absent");
  });

  it("still anchors a citation that precedes the term it names (fallback control)", () => {
    const md = "- `src/example.ts:21` — the `Tier` union every cockpit lane sorts on.\n";
    const report = auditRunbook("fixture.md", md, fixtureReader(FILES));
    expect(report.failures).toEqual([]);
    expect(report).toMatchObject({ cited: 1, verified: 1, unanchored: 0 });
  });

  it("is case-sensitive, so `attention` does not anchor on `diffAttention`", () => {
    const md = "The tiers are `attention`, `watch`, `healthy` (`src/example.ts:1`).\n";
    const files = { "src/example.ts": 'import { diffAttention } from "./x.js";' };
    expect(auditRunbook("fixture.md", md, fixtureReader(files)).failures).toHaveLength(1);
  });

  it("fails a range that runs past the end of the file, naming the file's real length", () => {
    const md = "The tiers (`src/example.ts:20–99`) and `attention`.\n";
    const report = auditRunbook("fixture.md", md, fixtureReader(FILES));
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]!).toContain("which is 42 lines long");
  });

  it("fails a path that is not a file in the repo", () => {
    const md = "See `src/nope.ts:4` for the `attention` tier.\n";
    const report = auditRunbook("fixture.md", md, fixtureReader(FILES));
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]!).toContain("not a file in the repo");
  });

  it("reports a citation whose paragraph names nothing as unanchored, and does not fail it", () => {
    const md = "Do not rely on it (`src/example.ts:31`).\n";
    const report = auditRunbook("fixture.md", md, fixtureReader(FILES));
    expect(report).toMatchObject({ cited: 1, verified: 0, unanchored: 0 + 1 });
    expect(report.failures).toEqual([]);
  });

  it("resolves a bare basename and a bare `:N` against the citation that spelled them out", () => {
    const md =
      "The tiers live at `src/example.ts:21`; the same `Tier` union again at `example.ts:21`,\n" +
      "and once more at `:21`.\n";
    const report = auditRunbook("fixture.md", md, fixtureReader(FILES));
    expect(report.failures).toEqual([]);
    expect(report.cited).toBe(3);
  });

  it("ignores URLs, absolute paths, times and fenced code", () => {
    const md =
      "Hit `https://example.com:8080` at `09:23 UTC`, per `~/.config/x.env:4` and `/etc/hosts:9`,\n" +
      "for the `attention` tier (`src/example.ts:21`).\n" +
      "\n" +
      "```sh\n" +
      "grep -n `src/nope.ts:999` file\n" +
      "```\n";
    const report = auditRunbook("fixture.md", md, fixtureReader(FILES));
    expect(report.failures).toEqual([]);
    expect(report.cited).toBe(1);
  });
});

describe("docs/runbooks", () => {
  it("every citation still points at what its prose says it does", () => {
    const read = repoReader();
    const runbooks = readdirSync(RUNBOOK_DIR)
      .filter((name) => name.endsWith(".md"))
      .sort();
    expect(runbooks.length).toBeGreaterThan(0);

    const failures: string[] = [];
    let totalCited = 0;
    for (const name of runbooks) {
      const markdown = readFileSync(join(RUNBOOK_DIR, name), "utf8");
      const report = auditRunbook(name, markdown, read);
      totalCited += report.cited;
      failures.push(...report.failures);
      console.log(
        `RUNBOOK_ANCHORS ${report.runbook} cited=${report.cited} verified=${report.verified} unanchored=${report.unanchored}`,
      );
    }

    // A guard on the guard: if the extractor ever stops finding citations (a markdown style
    // change, a regex edit), every runbook reports cited=0 and this test goes green having
    // checked nothing. That is the hollow green the repo's own rule is about.
    expect(totalCited).toBeGreaterThan(30);
    expect(failures).toEqual([]);
  });
});
