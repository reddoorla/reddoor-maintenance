import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Docs cite the rules in `CLAUDE.md` and `AUTONOMY.md` by heading, and until this file nothing
 * checked that the heading still existed. On 2026-10-05 #1188 renamed "Worker sessions never
 * ask mid-flight"; three citations of the old name, in `docs/BACKLOG.md`, `docs/pm-pass.md` and
 * `docs/worker-brief.md`, stayed dead until #1224 fixed them by hand. All three wrapped across a
 * hand-typed line break, so no line-by-line grep ever saw one whole.
 *
 * `scripts/directive-refs.mjs` joins each paragraph's lines, then reads every `CLAUDE.md` or
 * `AUTONOMY.md` code span followed by → or § as a citation. It must be one of two shapes:
 *
 *   - arrow:     `CLAUDE.md` → "Heading"
 *   - section:   `CLAUDE.md` §"Heading"
 *
 * Anything else after the → or § fails as "cannot read this citation": no quotes, curly
 * quotes, a link, emphasis, mismatched, unclosed or blank quotes, a space after §, quoted
 * text that begins or ends with a space, or a closing quote followed by anything but a space,
 * one of , . ; : ) ] ! ? — – or the end of the paragraph. The cost is that a valid citation in another spelling fails loudly,
 * with the spelling to use in the message.
 *
 * Six review rounds shaped this. The first three each added spellings to read, and each one
 * left a neighbour that was silently not counted, so a dead heading in it passed; refusing
 * what it cannot read closed that class. The fourth found that an unquoted name cannot say
 * where it ends: two real headings contain a comma, and `→ Before a fleet sweep, check …` was
 * checked only up to the comma, so a heading that does not exist resolved; quotes became
 * required. The fifth and sixth found the same cut at a quote inside the heading:
 * `AUTONOMY.md` has `## Merge authority (current policy: "everything but releases")`, and
 * reading up to the first inner quote checked only "Merge authority (current policy:", so the
 * old full name would pass after the policy changed. The character after an inner opening
 * quote is the start of the quoted words, a dash or a bracket, none of which may follow a
 * closing quote, and an inner quote preceded by a space leaves the cut text ending in one.
 * Cite such a heading by the words before its first quote.
 *
 * Paragraphs are joined after `>` blockquote prefixes are stripped. A heading (`#` to `######`
 * followed by a space), a table row or a list item (inside a blockquote too) starts a new one.
 *
 * A citation resolves when some `##` or `###` heading of the target, outside code fences,
 * starts with the cited text and the match ends on a word boundary, so a short name such as
 * §"Before a fleet sweep" still resolves and "Concurrent sess" does not. Fences are skipped
 * when reading headings (`CLAUDE.md` quotes a journal heading inside a fenced markdown
 * example) but not when reading citations: the brief template in `docs/worker-brief.md` is a
 * fenced block, and it is the text every brief is copied from.
 *
 * What it cannot see, all of which resolve today or do not occur in the tree:
 *
 *   - a parenthetical with no arrow or §, such as `CLAUDE.md` ("Prove the instrument", …;
 *   - a citation with no file named, such as (see "Prove the instrument", above) inside
 *     `CLAUDE.md` or (see "The evening pass") in `docs/pm-pass.md`, including a second → or §
 *     after the same code span (`AUTONOMY.md` §"A", §"B" checks only "A");
 *   - any citation of a file other than `CLAUDE.md` or `AUTONOMY.md` (`README.md`,
 *     `docs/pm-pass.md`, a table row in `docs/meta-week/`);
 *   - files it does not scan: history (`docs/workJournal.md`, `docs/journal/`,
 *     `docs/morning-reports/`, `docs/meta-week/`, `docs/superpowers/`), which records what was
 *     true then and is never corrected in place; subdirectories of `docs/runbooks/` and
 *     `docs/briefs/`; and code (`scripts/land-prs.mjs` cites `AUTONOMY.md` by heading in
 *     comments);
 *   - anything other than whitespace between the code span and the arrow or §, which is not
 *     counted at all: `->`, `=>` or `⟶` for →, a comma, a parenthesis or emphasis before the
 *     arrow, a zero-width space, `./CLAUDE.md`, a double-backtick span, or a link as the
 *     target. A citation written inside a longer code span as a format example is counted and
 *     fails loudly;
 *   - in the targets: `####`, setext and indented headings, a `## ` line inside an HTML
 *     comment or a fence that nests another fence (counted as a heading), and CRLF line ends
 *     (no heading is read, so every citation fails loudly). The word boundary is ASCII, so
 *     "Caf" resolves against "Café rules";
 *   - a heading that still exists but has come to mean something else.
 *
 * The instrument is proved before it is trusted (CLAUDE.md, "Prove the instrument before you
 * trust its verdict"): every fixture below has a known-good citation beside its known-bad one,
 * and the root that holds only good citations must exit 0.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts/directive-refs.mjs");

const CLAUDE_MD = [
  "# CLAUDE.md",
  "",
  "## Prove the instrument before you trust its verdict",
  "",
  "## Concurrent sessions",
  "",
  "## The work journal",
  "",
  "## Before a fleet sweep, ask which repos can receive a push",
  "",
  "### Worker sessions ask a blocking question once, with all its context",
  "",
  "```sh",
  "## Fenced not a heading",
  "```",
  "",
].join("\n");

const AUTONOMY_MD = [
  "# Autonomy contract",
  "",
  '## Merge authority (current policy: "nothing without the operator")',
  "",
].join("\n");

const GOOD = [
  'See `CLAUDE.md` → "Concurrent sessions" and `CLAUDE.md` §"Before a fleet sweep".',
  "",
  'Also (`CLAUDE.md` → "Concurrent  sessions"), and `AUTONOMY.md` → "Merge authority".',
  "",
  '- the asking rule (`CLAUDE.md` → "Worker sessions ask a blocking question',
  '  once, with all its context").',
  "",
].join("\n");

const roots: string[] = [];

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "directive-refs-"));
  roots.push(root);
  const all = { "CLAUDE.md": CLAUDE_MD, "AUTONOMY.md": AUTONOMY_MD, ...files };
  for (const [path, body] of Object.entries(all)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

function run(root?: string): { status: number | null; stdout: string; stderr: string } {
  const args = root === undefined ? [SCRIPT] : [SCRIPT, "--root", root];
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function deadLines(stdout: string): string[] {
  return stdout.split("\n").filter((l) => l.startsWith("dead "));
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("scripts/directive-refs.mjs on fixture roots", () => {
  it("exits 0 on a root whose citations all resolve (PASS control)", () => {
    const r = run(makeRoot({ "docs/pm-pass.md": GOOD, "docs/runbooks/x.md": GOOD }));
    expect(r.stdout + r.stderr).not.toContain("dead ");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\b10 citations\b/);
  });

  it("catches a dead quoted citation in docs/pm-pass.md", () => {
    const r = run(makeRoot({ "docs/pm-pass.md": `${GOOD}\nSee \`CLAUDE.md\` → "Gone rule".\n` }));
    expect(r.status).toBe(1);
    expect(deadLines(r.stdout)).toEqual([
      expect.stringMatching(/^dead docs\/pm-pass\.md:8 .*Gone rule/),
    ]);
  });

  it("ignores the same dead citation in docs/workJournal.md and docs/journal/", () => {
    const dead = 'See `CLAUDE.md` → "Gone rule".\n';
    const r = run(
      makeRoot({
        "docs/pm-pass.md": GOOD,
        "docs/workJournal.md": dead,
        "docs/journal/x.md": dead,
        "docs/morning-reports/x.md": dead,
        "docs/meta-week/x.md": dead,
        "docs/superpowers/x.md": dead,
      }),
    );
    expect(deadLines(r.stdout)).toEqual([]);
    expect(r.status).toBe(0);
  });

  it("catches a dead citation wrapped across lines, naming both lines", () => {
    const md =
      'Intro.\n\n7. **Rule.** It ends; see `CLAUDE.md` → "Worker\n   sessions never ask\n   mid-flight").\n';
    const r = run(makeRoot({ "docs/BACKLOG.md": md }));
    expect(r.status).toBe(1);
    expect(deadLines(r.stdout)).toEqual([
      expect.stringMatching(/^dead docs\/BACKLOG\.md:3-5 .*"Worker sessions never ask mid-flight"/),
    ]);
  });

  it('passes a valid prefix such as §"Before a fleet sweep"', () => {
    const r = run(makeRoot({ "docs/runbooks/x.md": '(`CLAUDE.md` §"Before a fleet sweep")\n' }));
    expect(deadLines(r.stdout)).toEqual([]);
    expect(r.status).toBe(0);
  });

  it('catches a dead §"…" citation', () => {
    const r = run(makeRoot({ "docs/runbooks/x.md": '(`CLAUDE.md` §"Before a fleet walk")\n' }));
    expect(r.status).toBe(1);
    expect(deadLines(r.stdout)).toEqual([
      expect.stringMatching(/^dead docs\/runbooks\/x\.md:1 .*Before a fleet walk/),
    ]);
  });

  it("catches a dead arrow citation that wraps after the arrow", () => {
    const r = run(
      makeRoot({
        "docs/worker-brief.md": '1. Fetch (`CLAUDE.md` →\n   "Lonely sessions"); then go.\n',
      }),
    );
    expect(r.status).toBe(1);
    expect(deadLines(r.stdout)).toEqual([
      expect.stringMatching(/^dead docs\/worker-brief\.md:1-2 .*→ "Lonely sessions"$/),
    ]);
  });

  it("catches a dead citation of an AUTONOMY.md heading", () => {
    const r = run(makeRoot({ "docs/briefs/b.md": 'Per `AUTONOMY.md` → "Merge policy".\n' }));
    expect(r.status).toBe(1);
    expect(deadLines(r.stdout)).toEqual([
      expect.stringMatching(/^dead docs\/briefs\/b\.md:1 .*AUTONOMY\.md.*Merge policy/),
    ]);
  });

  it("does not count a ## line inside a code fence as a heading", () => {
    const r = run(makeRoot({ "docs/pm-pass.md": 'See `CLAUDE.md` → "Fenced not a heading".\n' }));
    expect(r.status).toBe(1);
    expect(deadLines(r.stdout)).toHaveLength(1);
  });

  it("still reads a source's fenced block, where the brief template lives", () => {
    const md =
      '## Template\n\n```markdown\n1. Fetch (`CLAUDE.md` →\n   "Lonely sessions"); stop.\n```\n';
    const r = run(makeRoot({ "docs/worker-brief.md": md }));
    expect(r.status).toBe(1);
    expect(deadLines(r.stdout)).toEqual([
      expect.stringMatching(/^dead docs\/worker-brief\.md:4-5 /),
    ]);
  });

  it("ends a paragraph at a heading, a table row and a list item, and not at #932", () => {
    const md = [
      '### Why `CLAUDE.md` → "Concurrent',
      'sessions"',
      '| x | see `CLAUDE.md` → "Concurrent',
      'sessions" |',
      'Para `CLAUDE.md` → "Concurrent',
      '- sessions"',
      '> - see `CLAUDE.md` → "Concurrent',
      '> - sessions"',
      'Wrapped `CLAUDE.md` → "Concurrent',
      '#932 sessions" end.',
      "",
    ].join("\n");
    const r = run(makeRoot({ "docs/pm-pass.md": md }));
    expect(r.status).toBe(1);
    const dead = deadLines(r.stdout);
    expect(dead.map((l) => /^dead docs\/pm-pass\.md:(\d+)/.exec(l)?.[1])).toEqual([
      "1",
      "3",
      "5",
      "7",
      "9",
    ]);
    expect(dead.slice(0, 4).every((l) => l.includes("cannot read this citation"))).toBe(true);
    expect(dead[4]).toMatch(/:9-10 .*"Concurrent #932 sessions"$/);
  });

  it("matches whole words only", () => {
    const md = 'A `CLAUDE.md` → "Concurrent".\n\nC `CLAUDE.md` → "Concurrent sess".\n';
    const r = run(makeRoot({ "docs/pm-pass.md": md }));
    expect(r.status).toBe(1);
    expect(deadLines(r.stdout)).toEqual([
      expect.stringMatching(/^dead docs\/pm-pass\.md:3 .*"Concurrent sess"$/),
    ]);
  });

  it("fails every spelling it cannot read, valid heading or not", () => {
    const spellings = [
      "→ Concurrent sessions",
      "→ Before a fleet sweep, check the archive list",
      "→ “Concurrent sessions”",
      "→ [Concurrent sessions](../CLAUDE.md#x)",
      "→ [**Concurrent sessions**](../CLAUDE.md#x)",
      "→ [Gone heading][ref]",
      '→ **"Concurrent sessions"**',
      "→ **Concurrent sessions**",
      '→ “Gone heading"',
      '→ " "',
      '§"  "',
      "§“Concurrent sessions”",
      '§ "Concurrent sessions"',
      "§Concurrent sessions",
    ];
    const md = spellings.map((s) => `See \`CLAUDE.md\` ${s}.`).join("\n\n") + "\n";
    const r = run(makeRoot({ "docs/pm-pass.md": md }));
    expect(r.status).toBe(1);
    const dead = deadLines(r.stdout);
    expect(dead).toHaveLength(spellings.length);
    for (const line of dead) expect(line).toContain("cannot read this citation");
  });

  it("refuses a citation that a quote inside the heading would cut short", () => {
    const md = [
      'Per `AUTONOMY.md` → "Merge authority (current policy: "everything but releases")".',
      "",
      'And `CLAUDE.md` → "The "evening pass" rule".',
      "",
      'And `CLAUDE.md` → "The "--force" flag".',
      "",
      'And `CLAUDE.md` → "The "(x)" gone".',
      "",
      'And `CLAUDE.md` → "The " x" gone".',
      "",
      'And `CLAUDE.md` → "The ", "work"".',
      "",
      'And `CLAUDE.md` → "The "été" rule".',
      "",
      'And `CLAUDE.md` → "The work journal"él.',
      "",
      'And `CLAUDE.md` §"The "evening pass" rule".',
      "",
      'And `CLAUDE.md` §"The "--force" flag".',
      "",
      'And `CLAUDE.md` → "The ("--force") flag".',
      "",
      'And `CLAUDE.md` §"The ("--force") flag".',
      "",
      'But `AUTONOMY.md` → "Merge authority (current policy:" and `CLAUDE.md` §"The work" resolve.',
      "",
    ].join("\n");
    const r = run(makeRoot({ "docs/pm-pass.md": md }));
    expect(r.status).toBe(1);
    const dead = deadLines(r.stdout);
    expect(dead).toHaveLength(12);
    for (const line of dead) expect(line).toContain("cannot read this citation");
    expect(r.stdout).toMatch(/\b12 of 14 citations dead\b/);
  });

  it("reads a citation inside AUTONOMY.md, with tabs and extra spaces around the arrow", () => {
    const root = makeRoot({
      "AUTONOMY.md": `${AUTONOMY_MD}\nSee \`CLAUDE.md\`\t→  "Concurrent sessions" and \`CLAUDE.md\`  →\t"Gone".\n`,
    });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(deadLines(r.stdout)).toEqual([
      expect.stringMatching(/^dead AUTONOMY\.md:\d+ .*→ "Gone"$/),
    ]);
    expect(r.stdout).toMatch(/\b1 of 2 citations dead\b/);
  });

  it("catches a citation in CLAUDE.md itself, and every citation of a missing target", () => {
    const root = makeRoot({
      "CLAUDE.md": `${CLAUDE_MD}\nSee \`CLAUDE.md\` §"Nope".\n`,
      "docs/pm-pass.md": 'Per `AUTONOMY.md` → "Merge authority".\n',
    });
    rmSync(join(root, "AUTONOMY.md"));
    const r = run(root);
    expect(r.status).toBe(1);
    const dead = deadLines(r.stdout);
    expect(dead).toHaveLength(2);
    expect(dead.some((l) => l.startsWith("dead CLAUDE.md:"))).toBe(true);
    expect(dead.some((l) => l.startsWith("dead docs/pm-pass.md:1") && l.includes("missing"))).toBe(
      true,
    );
  });
});

describe("the real tree", () => {
  it("has no dead CLAUDE.md or AUTONOMY.md citation", () => {
    const r = run();
    expect(deadLines(r.stdout)).toEqual([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\b10 citations, all resolve\b/);
  });
});
