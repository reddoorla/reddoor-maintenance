import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { templatesByName } from "../../src/recipes/sync-configs/templates.js";
import { renovateActionGaps } from "../../src/recipes/sync-configs/renovate-action.js";

// #1607 input 2: a renovate.yml whose Renovate job can never run read CLEAN.
// The verdicts are GitHub's own (workflow-parser + expressions 0.3.61), kept in
// #1607; `place` rebuilds the files they were measured on, and the oracle gave
// the recorded verdict for all 336 placements below (2026-10-27).

const CANONICAL = templatesByName(["renovate-action"])[0]!.contents;

const ORACLE = JSON.parse(
  readFileSync(new URL("../fixtures/renovate-action-if-oracle.json", import.meta.url), "utf-8"),
) as { cases: Array<{ v: string; runs: "no" | "yes" | "INV" }> };

type Level = "job" | "step" | "app";

/** CANONICAL with `v` (YAML source, as the oracle wrote it) as the `if:` of the
 *  `renovate:` job, the renovatebot step or the app-token step. The corpus
 *  indents continuation lines by 6 (job) or 10 (step); they are re-indented to
 *  two past this level's `if:` key. */
function place(v: string, lvl: Level): string {
  const key = lvl === "job" ? 4 : 8;
  const base = v.includes("\n          ") ? 10 : 6;
  const line = `${" ".repeat(key)}if: ${v.split("\n" + " ".repeat(base)).join("\n" + " ".repeat(key + 2))}\n`;
  if (lvl === "job") return CANONICAL.replace("  renovate:\n", `  renovate:\n${line}`);
  const re =
    lvl === "step"
      ? /( {6}- uses: renovatebot\/github-action@[^\n]*\n)/
      : /( {6}- uses: actions\/create-github-app-token@[^\n]*\n)/;
  return CANONICAL.replace(re, (m) => m + line);
}

const cannotRun = (contents: string) =>
  renovateActionGaps(contents).filter((g) => /can never run/.test(g));

// js-yaml rejects `'''''` (five quotes, unterminated by the YAML spec) where
// GitHub's parser reads `''`, so this file has no tree to judge: a miss, which
// #1607 prefers to a false gap.
const KNOWN_MISSES = new Set(["'''''"]);

describe("renovateActionGaps: a Renovate job that can never run (#1607 input 2)", () => {
  it("the oracle corpus holds 112 distinct values", () => {
    expect(new Set(ORACLE.cases.map((c) => c.v)).size).toBe(112);
  });

  for (const lvl of ["job", "step", "app"] as const) {
    describe(`as the ${lvl === "job" ? "renovate: job's" : lvl === "step" ? "renovatebot step's" : "app-token step's"} if:`, () => {
      for (const { v, runs } of ORACLE.cases) {
        const expectGap = runs === "no" && !KNOWN_MISSES.has(v);
        it(`${JSON.stringify(v)} (Actions: ${runs}) → ${expectGap ? "gap" : "no gap"}`, () => {
          const contents = place(v, lvl);
          expect(contents).not.toBe(CANONICAL);
          expect(cannotRun(contents)).toHaveLength(expectGap ? 1 : 0);
        });
      }
    });
  }

  it("every other check still passes on a disabled job: the new gap is the only one", () => {
    expect(renovateActionGaps(place("false", "job"))).toEqual([
      expect.stringMatching(/can never run/),
    ]);
  });

  it("the gap names where the always-false if: sits", () => {
    expect(cannotRun(place("false", "job"))[0]).toMatch(/job `renovate`/);
    expect(cannotRun(place("false", "step"))[0]).toMatch(/the renovatebot\/github-action step/);
    expect(cannotRun(place("false", "app"))[0]).toMatch(/step `app-token`, which mints its token/);
  });

  it("a disabled sidecar: job beside a working renovate: job is no gap", () => {
    const withSidecar = CANONICAL.replace(
      "jobs:\n",
      "jobs:\n  sidecar:\n    if: false\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n",
    );
    expect(withSidecar).not.toBe(CANONICAL);
    expect(renovateActionGaps(withSidecar)).toEqual([]);
  });

  it("an enabled sidecar: job does not rescue a disabled renovate: job", () => {
    const withSidecar = place("false", "job").replace(
      "jobs:\n",
      "jobs:\n  sidecar:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n",
    );
    expect(cannotRun(withSidecar)).toHaveLength(1);
  });

  it("a step-level if: false on checkout is no gap: Renovate works through the API", () => {
    const disabledCheckout = CANONICAL.replace(
      /( {6}- uses: actions\/checkout@[^\n]*\n)/,
      "$1        if: false\n",
    );
    expect(disabledCheckout).not.toBe(CANONICAL);
    expect(renovateActionGaps(disabledCheckout)).toEqual([]);
  });

  it("an if: key inside a step's env: is not the step's if:", () => {
    const envIf = CANONICAL.replace(
      "          RENOVATE_REPOSITORIES:",
      "          if: false\n          RENOVATE_REPOSITORIES:",
    );
    expect(envIf).not.toBe(CANONICAL);
    expect(renovateActionGaps(envIf)).toEqual([]);
  });

  it("a disabled second app-token step beside a working one is no gap", () => {
    const second = CANONICAL.replace(
      /( {6}- uses: actions\/create-github-app-token@[^\n]*\n)/,
      "      - uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0\n        if: false\n        id: spare\n$1",
    );
    expect(second).not.toBe(CANONICAL);
    expect(renovateActionGaps(second)).toEqual([]);
  });

  it("a second, enabled renovatebot step rescues a disabled one", () => {
    const step = CANONICAL.match(/ {6}- uses: renovatebot\/github-action@[\s\S]*$/)![0];
    const twice = place("false", "step") + step;
    expect(cannotRun(twice)).toEqual([]);
  });

  it("an if: that reads a context is left undecided: no gap", () => {
    for (const v of ["github.event_name == 'schedule'", "${{ vars.RENOVATE_OFF != 'true' }}"]) {
      expect(cannotRun(place(v, "job")), v).toEqual([]);
    }
  });

  it("a file that is not YAML gets no can-never-run gap (the string checks still run)", () => {
    const broken = `${place("false", "job").replace("- cron: 0 */12 * * *", "- cron: 0 0 * * *")}\n  : : [\n`;
    expect(renovateActionGaps(broken)).toEqual([expect.stringMatching(/cron/)]);
  });

  // Review round 1 of this PR. Each "runs" verdict below is the oracle's.
  for (const lvl of ["job", "step", "app"] as const) {
    it(`a ${lvl} if: whose ${"${{ }}"} GitHub keeps as source text runs, so is no gap`, () => {
      for (const v of [
        "# note\n      |-\n      ${{ false }}", // a comment before the block header
        "!!str # note\n      >-\n      ${{ false }}",
        '"${{ false\n      }}"', // a quoted scalar over two lines
        "'${{\n      false }}'",
        '"${{ false }}\\\n      "', // an escaped line break
      ]) {
        expect(cannotRun(place(v, lvl)), JSON.stringify(v)).toEqual([]);
      }
    });
  }

  it("a CRLF file with a comment before the block header is no gap", () => {
    const crlf = place("# note\n      |-\n      ${{ false }}", "job").replaceAll("\n", "\r\n");
    expect(cannotRun(crlf)).toEqual([]);
  });

  it("a disabled create-github-app-token step the Renovate step does not take its token from is no gap", () => {
    const other = CANONICAL.replace(
      /( {6}- uses: actions\/create-github-app-token@)/,
      "      - uses: tibdex/github-app-token@3beb63f4bd073e61482598c45c71c1019b59b73a\n        id: minted\n        with:\n          app_id: x\n$1",
    )
      .replace("        id: app-token\n", "        id: old-token\n        if: false\n")
      .replace("steps.app-token.outputs.token", "steps.minted.outputs.token");
    expect(other).toContain("id: old-token\n        if: false");
    expect(cannotRun(other)).toEqual([]);
  });

  it("a job that calls a reusable workflow means no verdict, whatever a leftover job says", () => {
    const withCall = place("false", "job").replace(
      "jobs:\n",
      "jobs:\n  call:\n    uses: reddoorla/reddoor-maintenance/.github/workflows/renovate.yml@3beb63f4bd073e61482598c45c71c1019b59b73a\n    secrets: inherit\n",
    );
    expect(cannotRun(withCall)).toEqual([]);
  });

  it("a renovatebot step spelled in another case still counts as Renovate", () => {
    const step = CANONICAL.match(/ {6}- uses: renovatebot\/github-action@[\s\S]*$/)![0];
    const twice = place("false", "step") + step.replace("renovatebot/", "RenovateBot/");
    expect(cannotRun(twice)).toEqual([]);
  });

  // Review round 1: a regex that can split a run of characters many ways
  // hung on these (an anchor of 40 `!`s took over 100 s; 20,000 digits 1.1 s).
  it("a long anchor or number in an if: is read in linear time", () => {
    for (const v of [`&a${"!".repeat(40)}  foo`, `${"1".repeat(200_000)}a`]) {
      const started = Date.now();
      renovateActionGaps(place(v, "job"));
      expect(Date.now() - started, v.slice(0, 12)).toBeLessThan(2_000);
    }
  });

  // Review round 1: each pins a rule a mutant broke without a test going red.
  // The verdicts are the oracle's.
  it("values GitHub runs are no gap", () => {
    for (const v of [
      "-1",
      "${{ !true || true }}", // ! binds tighter than ||
      "false false", // GitHub rejects it: two values, no operator
      "!!str |\n      ${{ false }}", // a tag before the block header
      "&a >\n      ${{ false }}", // an anchor before it
    ]) {
      expect(cannotRun(place(v, "job")), JSON.stringify(v)).toEqual([]);
    }
  });

  it("values GitHub always skips are a gap", () => {
    for (const v of ["${{ '''''' }}", "${{ 0x0 }}", "${{ always() && false }}"]) {
      expect(cannotRun(place(v, "job")), v).toHaveLength(1);
    }
  });

  // Review round 2. The oracle runs the Renovate step in each.
  it("a token with a fallback does not come only from the skipped step", () => {
    const fallbacks = ["steps.app-token-2.outputs.token", "secrets.RENOVATE_PAT", "github.token"];
    for (const fallback of fallbacks) {
      const yml = place("false", "app")
        .replace(
          /( {6}- uses: actions\/checkout@)/,
          "      - uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1\n        id: app-token-2\n$1",
        )
        .replace(
          "${{ steps.app-token.outputs.token }}",
          `\${{ steps.app-token.outputs.token || ${fallback} }}`,
        );
      expect(yml).toContain(`|| ${fallback} }}`);
      expect(cannotRun(yml), fallback).toEqual([]);
    }
  });

  it("a step that runs Renovate some other way means no verdict", () => {
    for (const step of [
      "      - run: npx renovate --token=${{ steps.app-token.outputs.token }}\n",
      "      - uses: docker://ghcr.io/renovatebot/renovate@sha256:0000000000000000000000000000000000000000000000000000000000000000\n",
      "      - uses: ./.github/actions/renovate\n",
    ]) {
      expect(cannotRun(place("false", "step") + step), step).toEqual([]);
    }
  });

  it("many steps are read in linear time", () => {
    const step = CANONICAL.match(/ {6}- uses: renovatebot\/github-action@[\s\S]*$/)![0];
    const yml =
      place("false", "job").replace(step, step.replace("- uses:", "- &r\n        uses:")) +
      "      - *r\n".repeat(40_000);
    const started = Date.now();
    expect(cannotRun(yml)).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  // Review round 3: a step only counts as another Renovate runner when it can
  // run and its command is Renovate. The oracle skips the renovate: job in each.
  it("a step that only mentions Renovate leaves the disabled job a gap", () => {
    const base = place("false", "job");
    for (const yml of [
      `${base}      - run: echo renovate done\n`,
      `${base}      - run: npx renovate\n`, // inside the disabled job: it cannot run either
      `${base}  notify:\n    needs: renovate\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "Renovate finished"\n`,
      base.replace(
        "jobs:\n",
        "jobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx --yes --package renovate -- renovate-config-validator\n",
      ),
    ]) {
      expect(yml).not.toBe(base);
      expect(cannotRun(yml), yml.slice(-90)).toHaveLength(1);
    }
  });

  it("an enabled step in another job that runs Renovate means no verdict", () => {
    for (const run of [
      "npx renovate",
      "npx --yes renovate --platform=github",
      "LOG_LEVEL=debug pnpm dlx renovate",
      "docker run --rm renovate/renovate:41",
    ]) {
      const yml = place("false", "job").replace(
        "jobs:\n",
        `jobs:\n  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`,
      );
      expect(cannotRun(yml), run).toEqual([]);
    }
  });

  it("0X0 and .nan are always false (the oracle skips both)", () => {
    for (const v of ["0X0", "${{ 0X0 }}", ".nan", "!!float .nan"]) {
      expect(cannotRun(place(v, "job")), v).toHaveLength(1);
    }
  });
});

// The inputs of #1680's six review rounds (tests/recipes/renovate-action-compliance.test.ts
// at 7899cb81), each a false gap or a miss the line scanner gave.
describe("renovateActionGaps — #1680's review-round inputs (#1607)", () => {
  const JOB = "  renovate:\n    runs-on: ubuntu-latest\n";
  const withJobIf = (cond: string) =>
    CANONICAL.replace(JOB, `  renovate:\n    if: ${cond}\n    runs-on: ubuntu-latest\n`);

  it("the job anchor exists in the template (else every case below is vacuous)", () => {
    expect(CANONICAL).toContain(JOB);
  });

  // The sweep's input: cron, pins and App auth intact, `if: false` on the job.
  // Every string the check looks for is present, and Renovate never runs.
  for (const cond of [
    "false",
    "${{ false }}",
    "'false'",
    '"false"',
    "0",
    "${{ 0 }}",
    "${{ null }}",
    `"null"`,
    `"''"`,
  ]) {
    it(`if: ${cond} on the renovate job yields a gap`, () => {
      const gaps = renovateActionGaps(withJobIf(cond));
      expect(gaps.some((g) => g.includes("can never run"))).toBe(true);
    });
  }

  // Review round 4, against GitHub's own parser (@actions/workflow-parser
  // convertToIfCondition: "Empty condition defaults to success()"): an empty or
  // null `if:` RUNS the job, so it is no gap.
  for (const cond of ["''", '""', "null", "~", "${{ '' }}"]) {
    it(`if: ${cond} on the renovate job runs it, so is not a gap`, () => {
      expect(renovateActionGaps(withJobIf(cond))).toEqual([]);
    });
  }

  // Review round 5, against @actions/workflow-parser: whitespace around ${{ }}
  // inside quotes, or the newline a block keeps, makes the condition a
  // format() string, which is truthy. Those jobs run.
  for (const cond of [
    `"\${{ false }} "`,
    `'  \${{ null }}'`,
    "|\n      ${{ false }}",
    ">\n      ${{ 0 }}",
  ]) {
    it(`if: ${JSON.stringify(cond)} runs the job, so is not a gap`, () => {
      expect(renovateActionGaps(withJobIf(cond))).toEqual([]);
    });
  }

  it("a disabled checkout is not a gap: Renovate reads the repo through the API, not the checkout", () => {
    const off = CANONICAL.replace(/(- uses: actions\/checkout@[^\n]*\n)/, "$1        if: false\n");
    expect(off).not.toBe(CANONICAL);
    expect(renovateActionGaps(off)).toEqual([]);
  });

  it("a constant-false if: on a step yields a gap too", () => {
    const disabled = CANONICAL.replace(
      "        id: app-token\n",
      "        id: app-token\n        if: ${{ false }}\n",
    );
    expect(disabled).not.toBe(CANONICAL);
    expect(renovateActionGaps(disabled).some((g) => g.includes("can never run"))).toBe(true);
  });

  it("a real condition is not called a gap: only a constant that can never be true is", () => {
    // Sites may legitimately guard a job; this check owns "it cannot run", not
    // "it has a condition".
    expect(renovateActionGaps(withJobIf("github.repository_owner == 'reddoorla'"))).toEqual([]);
    expect(renovateActionGaps(withJobIf("${{ !cancelled() }}"))).toEqual([]);
    expect(renovateActionGaps(withJobIf("true"))).toEqual([]);
    expect(renovateActionGaps(withJobIf("falsey_input == 'x'"))).toEqual([]);
  });

  // Review round 1: a line regex read these wrong.
  it("a real condition written over two lines is not a gap (a plain scalar continued)", () => {
    const twoLine = CANONICAL.replace(
      JOB,
      "  renovate:\n    if:\n      github.repository_owner == 'reddoorla'\n    runs-on: ubuntu-latest\n",
    );
    expect(twoLine).not.toBe(CANONICAL);
    expect(renovateActionGaps(twoLine)).toEqual([]);
  });

  it("a folded block if: whose value is false is a gap", () => {
    expect(
      renovateActionGaps(withJobIf(">-\n      false")).some((g) => g.includes("can never run")),
    ).toBe(true);
  });

  it("if: false inside a block scalar (an env: value) is text, not a condition", () => {
    const inBlock = CANONICAL.replace(
      "        id: app-token\n",
      "        id: app-token\n        env:\n          NOTE: |\n            if: false\n            if: 0\n",
    );
    expect(inBlock).not.toBe(CANONICAL);
    expect(renovateActionGaps(inBlock)).toEqual([]);
  });

  it("a constant-false if: on a site's own extra step, not one Renovate needs, is not a gap", () => {
    const extra = CANONICAL.replace(
      "    steps:\n",
      "    steps:\n      - name: notify\n        if: false\n        run: echo hi\n",
    );
    expect(extra).not.toBe(CANONICAL);
    expect(renovateActionGaps(extra)).toEqual([]);
  });

  // Review round 2: a false gap overwrites the site's file, so each of these
  // must read clean.
  const noGap = (yml: string) => {
    expect(yml).not.toBe(CANONICAL);
    expect(renovateActionGaps(yml)).toEqual([]);
  };

  it("an if: false on a site's own extra job is not a gap", () => {
    noGap(
      CANONICAL.trimEnd() +
        "\n  sidecar:\n    if: false\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n",
    );
  });

  it("a key named if inside env: or with: on a required step is not a condition", () => {
    noGap(
      CANONICAL.replace(
        "        id: app-token\n",
        "        id: app-token\n        env:\n          if: false\n",
      ),
    );
    noGap(CANONICAL.replace("        with:\n", "        with:\n          if: false\n"));
  });

  // #1680 also expected no gap for `${{ 'false' }}` and `${{ '0' }}`; GitHub
  // unwraps both to a constant and skips the job, so the oracle corpus above
  // expects a gap there.
  it("a quoted 'false' (a non-empty string) is not constant-false", () => {
    expect(renovateActionGaps(withJobIf(`"'false'"`))).toEqual([]);
  });

  it("- if: false as the first key of a site's own step is not a gap", () => {
    noGap(
      CANONICAL.replace("    steps:\n", "    steps:\n      - if: false\n        run: echo hi\n"),
    );
  });

  it("a dash on its own line or a wide dash on a site's own step is not a gap", () => {
    noGap(
      CANONICAL.replace(
        "    steps:\n",
        "    steps:\n      -\n        if: false\n        run: echo hi\n",
      ),
    );
    noGap(
      CANONICAL.replace(
        "    steps:\n",
        "    steps:\n      -   run: echo hi\n          if: false\n",
      ),
    );
  });

  it("an if: false line inside a quoted-key block scalar is text", () => {
    noGap(CANONICAL.replace("    steps:\n", '    steps:\n      - "run": |\n          if: false\n'));
  });

  it("if: | over false on the job is a gap (a literal block, read as its value)", () => {
    expect(
      renovateActionGaps(withJobIf("|\n      false")).some((g) => g.includes("can never run")),
    ).toBe(true);
  });

  // Review round 3: a gap means Renovate cannot run at all. A second copy of a
  // required step, or a second renovate job, that is disabled leaves the
  // working one running.
  const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
  const RENOVATE_USES = /( *)- (?:name: [^\n]*\n *)?uses: renovatebot\/github-action@[^\n]*\n/;

  it("a disabled extra app-token step beside the working one is not a gap", () => {
    noGap(
      CANONICAL.replace(
        "    steps:\n",
        "    steps:\n      - uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1\n        if: false\n",
      ),
    );
  });

  it("a disabled extra checkout beside the working one is not a gap", () => {
    noGap(
      CANONICAL.replace(
        "    steps:\n",
        `    steps:\n      - uses: ${CHECKOUT}\n        if: false\n        with:\n          repository: reddoorla/shared-config\n`,
      ),
    );
  });

  it("a disabled second renovatebot step beside the working one is not a gap", () => {
    const m = RENOVATE_USES.exec(CANONICAL);
    expect(m).not.toBeNull();
    const dup = m![0].replace(/(uses: [^\n]*\n)/, `$1${m![1]}  if: false\n`);
    noGap(CANONICAL.replace(m![0], m![0] + dup)); // after the working one
    noGap(CANONICAL.replace(m![0], dup + m![0])); // and before it
  });

  it("a disabled second renovate job beside the working one is not a gap", () => {
    const at = CANONICAL.indexOf("  renovate:\n");
    const job = CANONICAL.slice(at);
    const old = job.replace(
      "  renovate:\n    runs-on",
      "  renovate-old:\n    if: false\n    runs-on",
    );
    expect(old).toContain("renovate-old:");
    noGap(CANONICAL.trimEnd() + "\n" + old); // after the working job
    noGap(CANONICAL.slice(0, at) + old.trimEnd() + "\n" + job); // and before it
  });

  it("disabling every app-token step IS a gap: Renovate has no token", () => {
    const both = CANONICAL.replace(
      "    steps:\n",
      "    steps:\n      - uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1\n        if: false\n",
    ).replace("        id: app-token\n", "        id: app-token\n        if: ${{ false }}\n");
    expect(both.match(/if: (false|\$\{\{ false \}\})/g)?.length).toBe(2);
    expect(renovateActionGaps(both).some((g) => g.includes("can never run"))).toBe(true);
  });

  it("a trailing comment on steps: does not hide a job's if: false", () => {
    const yml = withJobIf("false").replace(/\n {4}steps:\n/, "\n    steps: # the steps\n");
    expect(yml).toContain("steps: # the steps");
    expect(renovateActionGaps(yml).some((g) => g.includes("can never run"))).toBe(true);
  });

  it("in a compact steps: sequence, a site's own - if: false step is not a gap", () => {
    const i = CANONICAL.indexOf("    steps:\n") + "    steps:\n".length;
    const compact =
      CANONICAL.slice(0, i) +
      CANONICAL.slice(i)
        .split("\n")
        .map((l) => (l.startsWith("  ") ? l.slice(2) : l))
        .join("\n");
    expect(renovateActionGaps(compact)).toEqual([]);
    noGap(compact.replace("    steps:\n", "    steps:\n    - if: false\n      run: echo hi\n"));
    expect(
      renovateActionGaps(compact.replace("  renovate:\n", "  renovate:\n    if: false\n")).some(
        (g) => g.includes("can never run"),
      ),
    ).toBe(true);
  });

  it("a commented-out if: false is not a gap", () => {
    const commented = CANONICAL.replace(
      JOB,
      "  renovate:\n    # if: false\n    runs-on: ubuntu-latest\n",
    );
    expect(renovateActionGaps(commented)).toEqual([]);
  });
});
