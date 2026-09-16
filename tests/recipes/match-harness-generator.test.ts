import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import {
  GITIGNORE_BLOCK,
  PRETTIERIGNORE_BLOCK,
  CLAUDE_MD_BLOCK,
  MATCH_HARNESS_PREVIOUS,
  MATCH_HARNESS_COUPLED,
  MATCH_HARNESS_FILES,
} from "../../src/recipes/match-harness/template.js";

const here = dirname(fileURLToPath(import.meta.url));
const generatorPath = resolve(here, "../../scripts/gen-match-harness-template.mjs");

/**
 * template.ts is GENERATED, and its header says so — which means a correction
 * applied to template.ts and not to its source survives exactly until the next
 * regeneration, and the header tells you to regenerate. That happened: three
 * false claims were corrected in template.ts alone, and `node
 * scripts/gen-match-harness-template.mjs` reverted all three (8 insertions, 15
 * deletions) because they lived in the copied site files, plus a fourth that
 * lived in the generator's own PRETTIERIGNORE_BLOCK.
 *
 * The seven COPIED constants cannot be checked here — their source is a client
 * repo that does not exist in CI. The three AUTHORED blocks can: they are
 * written inside the generator, so a hand edit to template.ts that the
 * generator does not agree with is detectable with no external checkout.
 *
 * This is a partial guard and says so. It covers the constants whose source is
 * in this repo; #732-adjacent drift in the copied files needs the regeneration
 * itself, which only runs where the source site is checked out.
 */
async function authoredBlock(name: string): Promise<string> {
  const src = await readFile(generatorPath, "utf-8");
  const m = new RegExp(`const ${name} = \`([\\s\\S]*?)\\n\`;`, "m").exec(src);
  const body = m?.[1];
  if (body === undefined) throw new Error(`could not find const ${name} in the generator`);
  // The generator's own escaping, undone by the JS engine rather than by hand:
  // these bodies ARE template literals in the generator's source, so evaluating
  // one as a template literal is correct for every escape it can carry —
  // backtick, ${, and the backslash-escaped `\[uid\]` glob in
  // PRETTIERIGNORE_BLOCK, which a hand-rolled backtick/${ pass silently gets
  // wrong. Same technique the generator's own round-trip check uses
  // (scripts/gen-match-harness-template.mjs `embed`). Repo source only — never
  // anything read from a site.
  return new Function(`return \`${body}\n\`;`)() as string;
}

describe("match-harness generator agrees with the committed template", () => {
  const cases: Array<[string, string]> = [
    ["GITIGNORE_BLOCK", GITIGNORE_BLOCK],
    ["PRETTIERIGNORE_BLOCK", PRETTIERIGNORE_BLOCK],
    ["CLAUDE_MD_BLOCK", CLAUDE_MD_BLOCK],
  ];

  for (const [name, committed] of cases) {
    it(`${name} in template.ts matches the generator's own string`, async () => {
      expect(await authoredBlock(name)).toBe(committed);
    });
  }

  it("finds a real body for each block, so a silent regex miss cannot pass", async () => {
    for (const [name] of cases) {
      const body = await authoredBlock(name);
      expect(body.length, `${name} body looks empty`).toBeGreaterThan(80);
    }
    // The PREVIOUS bodies are checked below by VALUE, but a table that came
    // back empty would satisfy every `for` loop over it vacuously — the same
    // silent-miss shape this test exists for, one level up.
    expect(Object.keys(MATCH_HARNESS_PREVIOUS).length).toBeGreaterThan(0);
    for (const [rel, bodies] of Object.entries(MATCH_HARNESS_PREVIOUS)) {
      expect(bodies.length, `${rel} has no previous bodies`).toBeGreaterThan(0);
      for (const b of bodies)
        expect(b.length, `${rel} previous body looks empty`).toBeGreaterThan(80);
    }
  });
});

/**
 * The installed rules must name every gate the recipe installs. `census.sh` —
 * the Phase 3 style gate, the only one that catches an 11px footer line or a
 * cyan-vs-teal link the pixel diff is structurally blind to — was installed by
 * the recipe and named by no rule, no Check line and no round-protocol step, so
 * a fresh site had no instruction that would cause anyone to run it (#736).
 */
describe("the installed CLAUDE.md block names census.sh", () => {
  it("as a Check on rule 4 and as a round-protocol step between the gate and the LEDGER", () => {
    const rule4 = CLAUDE_MD_BLOCK.slice(
      CLAUDE_MD_BLOCK.indexOf("### 4."),
      CLAUDE_MD_BLOCK.indexOf("### 5."),
    );
    expect(rule4).toMatch(/\*\*Check:\*\*[^\n]*census\.sh/);

    const protocol = CLAUDE_MD_BLOCK.slice(CLAUDE_MD_BLOCK.indexOf("### Round protocol"));
    const steps = protocol.split(/\n(?=\d+\. )/).filter((s) => /^\d+\. /.test(s));
    const at = (re: RegExp) => steps.findIndex((s) => re.test(s));
    const gate = at(/matching\/gate\.sh/);
    const census = at(/matching\/census\.sh/);
    const ledger = at(/matching\/LEDGER\.md/);
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(census, "no round-protocol step runs census.sh").toBeGreaterThanOrEqual(0);
    expect(census).toBe(gate + 1);
    expect(ledger).toBe(census + 1);
    // Numbered contiguously after the insertion.
    expect(steps.map((s) => s.match(/^(\d+)\. /)![1])).toEqual(steps.map((_, i) => String(i + 1)));
  });
});

/**
 * MATCH_HARNESS_PREVIOUS is what lets an ALREADY-INSTALLED site take a fix: a
 * body that does not byte-match one of these is flagged as hand-edited and left
 * broken. A corrupted entry is therefore silent in the worst way — it does not
 * fail here, it fails as a spurious refusal on somebody's site months later. So
 * the committed table is checked against the committed prior renders, both of
 * which are in this repo and need no client checkout.
 */
describe("MATCH_HARNESS_PREVIOUS matches the committed prior renders", () => {
  const prevRoot = resolve(here, "../../scripts/match-harness-previous");

  it("carries every prior render byte-for-byte, and invents none", async () => {
    const versions = (await readdir(prevRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(versions.length, "no prior renders are committed at all").toBeGreaterThan(0);

    const current = new Map(MATCH_HARNESS_FILES.map((f) => [f.rel, f.template]));
    const expected = new Map<string, string[]>();
    for (const version of versions.sort()) {
      for (const rel of current.keys()) {
        let body: string;
        try {
          body = await readFile(join(prevRoot, version, rel), "utf-8");
        } catch {
          continue;
        }
        // A prior render identical to the current one needs no entry:
        // planFileWrite returns `skip` before `previous` is ever consulted.
        if (body === current.get(rel)) continue;
        expected.set(rel, [...(expected.get(rel) ?? []), body]);
      }
    }

    expect(Object.keys(MATCH_HARNESS_PREVIOUS).sort()).toEqual([...expected.keys()].sort());
    for (const [rel, bodies] of expected) {
      expect(MATCH_HARNESS_PREVIOUS[rel], `${rel} previous bodies`).toEqual(bodies);
    }
  });

  it("names every coupled script, and every one of them is a real installed file", () => {
    // The set is what stops a partial upgrade bricking a harness, so a typo in
    // a path would silently exempt that file from the whole mechanism.
    const rels = new Set(MATCH_HARNESS_FILES.map((f) => f.rel));
    expect(MATCH_HARNESS_COUPLED.length).toBeGreaterThan(0);
    for (const rel of MATCH_HARNESS_COUPLED)
      expect(rels, `${rel} is not an installed file`).toContain(rel);
    // Every matching/ SCRIPT that CHANGED in this release must be in the set —
    // an upgraded script outside it could move alone. Scoped to `matching/`:
    // the recipe-owned files under src/ (the /dev/match route and the fixture
    // test) neither import nor invoke harness.mjs, so a correction to one of
    // them is free to land alone (#763 was the first).
    for (const rel of Object.keys(MATCH_HARNESS_PREVIOUS).filter((r) =>
      r.startsWith("matching/"),
    )) {
      expect(MATCH_HARNESS_COUPLED, `${rel} changed but is not coupled`).toContain(rel);
    }
  });
});

/**
 * The harness's prose must not name a `reddoor-maint` command the CLI does not
 * have. Two installed files told the operator to run `reddoor-maint
 * prismic-seed` — which was never written — and on 29-navy that read as "the
 * content is one command away from live" through a full phase of work (#763).
 * Same class as #732 (prose naming `matching/probe-anchor-parity.mjs`, which the
 * recipe does not install): the harness describing a tool it does not ship.
 *
 * The registered command list is read from `src/cli/bin.ts` itself, so a
 * command renamed there redlines every template that still names the old one.
 */
describe("every `reddoor-maint <cmd>` the harness names is a command bin.ts registers", () => {
  const binPath = resolve(here, "../../src/cli/bin.ts");

  async function registeredCommands(): Promise<Set<string>> {
    const src = await readFile(binPath, "utf-8");
    // `.command("name [site]", …)` — the first token of the first string
    // argument, across the single-line and the multi-line call shapes.
    const names = [...src.matchAll(/\.command\(\s*"([a-z][a-z0-9-]*)/g)].map((m) => m[1]!);
    return new Set(names);
  }

  /** Every `reddoor-maint <cmd>` reference in a body. A reference may wrap
   *  across a comment line (`reddoor-maint\n// prismic-seed` — the exact shape
   *  the route file carried), so the gap may hold whitespace and comment
   *  leaders; a bare `reddoor-maint` followed by a backtick or punctuation is
   *  not a command reference. */
  function namedCommands(body: string): string[] {
    return [...body.matchAll(/reddoor-maint[\s/#*]+([a-z][a-z0-9-]*)/g)].map((m) => m[1]!);
  }

  it("the instrument reads real data: bin.ts registers match-harness, and the harness names it", async () => {
    const commands = await registeredCommands();
    expect(commands.size).toBeGreaterThan(20);
    expect(commands).toContain("match-harness");
    expect(commands).toContain("launch");
    // The extractor finds a reference in the shipped prose, so an empty scan
    // could not pass the case below vacuously.
    const bodies = [
      ...MATCH_HARNESS_FILES.map((f) => f.template),
      GITIGNORE_BLOCK,
      PRETTIERIGNORE_BLOCK,
      CLAUDE_MD_BLOCK,
    ];
    expect(bodies.flatMap(namedCommands)).toContain("match-harness");
    // And it catches the wrapped shape the route file shipped with.
    expect(namedCommands("renders what `reddoor-maint\n// prismic-seed` publishes")).toEqual([
      "prismic-seed",
    ]);
  });

  it("names no command the CLI does not register", async () => {
    const commands = await registeredCommands();
    const offenders: string[] = [];
    for (const f of MATCH_HARNESS_FILES)
      for (const cmd of namedCommands(f.template))
        if (!commands.has(cmd)) offenders.push(`${f.rel}: reddoor-maint ${cmd}`);
    for (const [name, block] of [
      ["GITIGNORE_BLOCK", GITIGNORE_BLOCK],
      ["PRETTIERIGNORE_BLOCK", PRETTIERIGNORE_BLOCK],
      ["CLAUDE_MD_BLOCK", CLAUDE_MD_BLOCK],
    ] as const)
      for (const cmd of namedCommands(block))
        if (!commands.has(cmd)) offenders.push(`${name}: reddoor-maint ${cmd}`);
    expect(offenders).toEqual([]);
  });
});

/**
 * The SEVEN COPIED constants had no guard at all (#738 item 1). Their source is
 * a client repo that does not exist in CI, so a hand edit to one of them in
 * `template.ts` was invisible — and the file's own header tells readers to
 * regenerate, which SILENTLY REVERTS the edit. That is not hypothetical: three
 * corrections were applied to `template.ts` alone and one regeneration undid
 * all three.
 *
 * `scripts/match-harness-bodies.sha256` is the half of the guard that needs no
 * checkout: a digest of every shipped body, written by the generator in the
 * same run that writes `template.ts`. A hand edit changes a body and not its
 * digest, and this reddens; a legitimate regeneration rewrites both together.
 *
 * It covers all seventeen shipped bodies, not only the seven copied ones —
 * the AUTHORED FILE bodies (the /dev/match route, the fixture test, the site
 * stubs) were equally unguarded. Only the three authored BLOCKS had a check,
 * at the top of this file.
 *
 * The digest is taken over the RAW body, which is the identical string on both
 * sides: `body` in the generator, `MATCH_HARNESS_FILES[].template` here.
 * Neither side re-derives the generator's backtick/`${` escaping, so this
 * cannot fail for a reason that is really about escaping.
 */
describe("every shipped body matches its committed digest", () => {
  const manifestPath = resolve(here, "../../scripts/match-harness-bodies.sha256");
  const digest = (body: string) => createHash("sha256").update(body, "utf-8").digest("hex");

  async function manifest(): Promise<Map<string, string>> {
    const text = await readFile(manifestPath, "utf-8");
    const rows = new Map<string, string>();
    for (const line of text.split("\n")) {
      if (line.trim() === "" || line.startsWith("#")) continue;
      const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
      if (!m) throw new Error(`unparseable digest line: ${line}`);
      rows.set(m[2]!, m[1]!);
    }
    return rows;
  }

  it("covers every installed file, and names none the recipe does not install", async () => {
    // Both directions: a body added to the manifest without being installed is
    // as wrong as an installed one with no digest, and the second is how this
    // guard would quietly stop covering a file.
    const rows = await manifest();
    expect([...rows.keys()].sort()).toEqual([...MATCH_HARNESS_FILES.map((f) => f.rel)].sort());
  });

  it("the digest recorded for each body is the digest of the committed body", async () => {
    const rows = await manifest();
    const wrong: string[] = [];
    for (const f of MATCH_HARNESS_FILES) {
      if (rows.get(f.rel) !== digest(f.template)) wrong.push(f.rel);
    }
    expect(wrong).toEqual([]);
  });

  it("the instrument reads real data: one byte changes the digest", async () => {
    // A manifest that came back empty, or a digest function returning a
    // constant, would satisfy the `for` loop above vacuously — the same
    // silent-miss shape the authored-block cases guard against, one level up.
    const rows = await manifest();
    expect(rows.size).toBe(MATCH_HARNESS_FILES.length);
    expect(rows.size).toBeGreaterThan(15);

    const f = MATCH_HARNESS_FILES[0]!;
    expect(rows.get(f.rel)).toBe(digest(f.template));
    expect(rows.get(f.rel)).not.toBe(digest(`${f.template}\n`));
  });
});
