import { describe, it, expect } from "vitest";
import { templatesByName } from "../../src/recipes/sync-configs/templates.js";
import {
  renovateActionGaps,
  withRenovatePinsFrom,
} from "../../src/recipes/sync-configs/renovate-action.js";

const CANONICAL = templatesByName(["renovate-action"])[0]!.contents;

describe("renovateActionGaps", () => {
  it("the canonical template itself has zero gaps", () => {
    expect(renovateActionGaps(CANONICAL)).toEqual([]);
  });

  it("the real reddoor-starter shape — newer digest pin + quoted cron/identity — has zero gaps (#651)", () => {
    // This is the exact false-drift case from issue #651: Renovate bumped its own
    // digest pin on reddoor-starter, and prettier there quotes the cron + the two
    // RENOVATE_* scalar values (both forms are prettier-clean, so prettier never
    // converges them). None of that is a real compliance gap.
    const starterShape = CANONICAL.replace(
      "renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21",
      "renovatebot/github-action@e09d604f8f803bb527bd8321ed5be06c460b8682 # v46.2.2",
    )
      .replace("- cron: 0 */12 * * *", "- cron: '0 */12 * * *'")
      .replace(
        "RENOVATE_USERNAME: reddoor-renovate[bot]",
        "RENOVATE_USERNAME: 'reddoor-renovate[bot]'",
      )
      .replace(
        "RENOVATE_GIT_AUTHOR: reddoor-renovate[bot] <312185038+reddoor-renovate[bot]@users.noreply.github.com>",
        "RENOVATE_GIT_AUTHOR: 'reddoor-renovate[bot] <312185038+reddoor-renovate[bot]@users.noreply.github.com>'",
      );
    expect(starterShape).not.toBe(CANONICAL);
    expect(renovateActionGaps(starterShape)).toEqual([]);
  });

  it("a mutable tag ref on renovatebot/github-action yields a gap mentioning the pin", () => {
    const mutable = CANONICAL.replace(
      "renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21",
      "renovatebot/github-action@v46",
    );
    const gaps = renovateActionGaps(mutable);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.some((g) => g.includes("renovatebot/github-action") && /pin/i.test(g))).toBe(true);
  });

  it("a file containing RENOVATE_TOKEN yields a gap", () => {
    const withToken = `${CANONICAL}          RENOVATE_TOKEN: \${{ secrets.RENOVATE_TOKEN }}\n`;
    const gaps = renovateActionGaps(withToken);
    expect(gaps.some((g) => g.includes("RENOVATE_TOKEN"))).toBe(true);
  });

  it("a missing create-github-app-token step yields a gap", () => {
    const withoutAppTokenStep = CANONICAL.replace(
      /^ {6}- uses: actions\/create-github-app-token@[\s\S]*?\n(?= {6}- uses: actions\/checkout)/m,
      "",
    );
    // (A preceding rationale comment mentions "create-github-app-token" by name —
    // only the actual `uses:` step line must be gone.)
    expect(withoutAppTokenStep).not.toMatch(/uses: actions\/create-github-app-token@/);
    const gaps = renovateActionGaps(withoutAppTokenStep);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.some((g) => g.includes("create-github-app-token"))).toBe(true);
  });

  it("a changed cron yields a gap", () => {
    const changedCron = CANONICAL.replace("- cron: 0 */12 * * *", "- cron: 0 0 * * *");
    const gaps = renovateActionGaps(changedCron);
    expect(gaps.some((g) => /cron/i.test(g))).toBe(true);
  });

  it("an empty string yields several gaps (never zero)", () => {
    const gaps = renovateActionGaps("");
    expect(gaps.length).toBeGreaterThan(3);
  });

  // Comment-blindness: a raw `.match()`/`.includes()` takes the FIRST hit
  // anywhere in the file, comments included. A canonical-looking line living
  // only in a `#` comment must never make a real (non-compliant) line below
  // it read as compliant.
  it("a commented-out canonical uses: line above a real mutable-tag step still yields a pin gap", () => {
    const poisoned = CANONICAL.replace(
      "      - uses: renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21",
      "      # - uses: renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21\n" +
        "      - uses: renovatebot/github-action@v46",
    );
    const gaps = renovateActionGaps(poisoned);
    expect(gaps.some((g) => g.includes("renovatebot/github-action") && /pin/i.test(g))).toBe(true);
  });

  it("a commented-out canonical cron line above a real changed cron still yields a cron gap", () => {
    const poisoned = CANONICAL.replace(
      "    - cron: 0 */12 * * *",
      "    # - cron: 0 */12 * * *\n    - cron: 0 0 * * *",
    );
    const gaps = renovateActionGaps(poisoned);
    expect(gaps.some((g) => /cron/i.test(g))).toBe(true);
  });

  // Quoting tolerance (#651's whole point) must cover every scalar, not just cron.
  it('RENOVATE_REPOSITORIES: "${{ github.repository }}" (quoted) is compliant', () => {
    const quoted = CANONICAL.replace(
      "RENOVATE_REPOSITORIES: ${{ github.repository }}",
      'RENOVATE_REPOSITORIES: "${{ github.repository }}"',
    );
    expect(renovateActionGaps(quoted)).toEqual([]);
  });

  it('contents: "read" (quoted) is compliant', () => {
    const quoted = CANONICAL.replace("contents: read", 'contents: "read"');
    expect(renovateActionGaps(quoted)).toEqual([]);
  });

  it("permissions: with pull-requests: write listed before contents: read is compliant", () => {
    const reordered = CANONICAL.replace(
      "permissions:\n  contents: read",
      "permissions:\n  pull-requests: write\n  contents: read",
    );
    expect(reordered).not.toBe(CANONICAL);
    expect(renovateActionGaps(reordered)).toEqual([]);
  });

  // The pin check's comment says ANY step is covered, not just the three known ones.
  it("an extra uses: pnpm/action-setup@v4 step yields a gap", () => {
    const withExtraStep = CANONICAL.replace(
      "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\n",
      "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\n" +
        "      - uses: pnpm/action-setup@v4\n",
    );
    const gaps = renovateActionGaps(withExtraStep);
    expect(gaps.some((g) => g.includes("pnpm/action-setup"))).toBe(true);
  });

  it("a local uses: ./.github/actions/x step (no @ ref) does not yield a gap", () => {
    const withLocalStep = CANONICAL.replace(
      "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\n",
      "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\n" +
        "      - uses: ./.github/actions/x\n",
    );
    expect(renovateActionGaps(withLocalStep)).toEqual([]);
  });
});

describe("renovateActionGaps — a job or step that can never run (#1607)", () => {
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

  it("if: false inside a block scalar (a run: | body) is text, not a condition", () => {
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

  it("a quoted string inside ${{ }} is truthy in Actions, so not a gap", () => {
    for (const cond of ["${{ 'false' }}", "${{ '0' }}", "${{ 'null' }}", `"'false'"`]) {
      expect(renovateActionGaps(withJobIf(cond)), cond).toEqual([]);
    }
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

describe("withRenovatePinsFrom", () => {
  it("carries the site's newer digest forward for all three actions, preserving the version comment", () => {
    const current = CANONICAL.replace(
      "renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21",
      "renovatebot/github-action@e09d604f8f803bb527bd8321ed5be06c460b8682 # v46.2.2",
    )
      .replace(
        "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0",
        "actions/create-github-app-token@000000000000000000000000000000000000000a # v3.3.0",
      )
      .replace(
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
        "actions/checkout@000000000000000000000000000000000000000b # v7.1.0",
      );

    const healed = withRenovatePinsFrom(CANONICAL, current);

    expect(healed).toContain(
      "renovatebot/github-action@e09d604f8f803bb527bd8321ed5be06c460b8682 # v46.2.2",
    );
    expect(healed).toContain(
      "actions/create-github-app-token@000000000000000000000000000000000000000a # v3.3.0",
    );
    expect(healed).toContain("actions/checkout@000000000000000000000000000000000000000b # v7.1.0");
    // Nothing else about the template changed.
    expect(healed.replace(/uses: [^\n]*/g, "")).toBe(CANONICAL.replace(/uses: [^\n]*/g, ""));
  });

  it("leaves the template alone when current is null", () => {
    expect(withRenovatePinsFrom(CANONICAL, null)).toBe(CANONICAL);
  });

  it("does not carry a mutable tag ref forward", () => {
    const current = CANONICAL.replace(
      "renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21",
      "renovatebot/github-action@v46",
    );
    const healed = withRenovatePinsFrom(CANONICAL, current);
    // The template's own (older but digest-pinned) ref must survive untouched.
    expect(healed).toContain(
      "renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21",
    );
    expect(healed).not.toContain("renovatebot/github-action@v46");
  });

  it("does not carry a sha that appears only in a comment", () => {
    // The real (non-comment) line still carries a mutable tag — so nothing
    // digest-pinned is actually present on the site for this action — but a
    // comment above it contains a distinct, well-formed 40-hex sha. Scraping
    // that commented sha into the healed file would be a pin downgrade
    // delivered by the recipe that exists to prevent pin downgrades.
    const current = CANONICAL.replace(
      "      - uses: renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21",
      "      # old: uses: renovatebot/github-action@1111111111111111111111111111111111111a # v1\n" +
        "      - uses: renovatebot/github-action@v46",
    );
    const healed = withRenovatePinsFrom(CANONICAL, current);
    expect(healed).toContain(
      "renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21",
    );
    expect(healed).not.toContain("1111111111111111111111111111111111111a");
    expect(healed).not.toContain("renovatebot/github-action@v46");
  });
});

describe("healing is always compliant (#651 property)", () => {
  // Whatever a real site's renovate.yml looks like, healing it (carrying its
  // digest pins forward onto the template) must never itself produce a file
  // that still has gaps — otherwise the heal could loop forever, or ship a
  // "fixed" file that isn't.
  const SITE_SHAPES: Array<{ label: string; contents: string | null }> = [
    { label: "no existing file", contents: null },
    { label: "already canonical", contents: CANONICAL },
    {
      label: "newer digest pin + quoted scalars (#651 real shape)",
      contents: CANONICAL.replace(
        "renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21",
        "renovatebot/github-action@e09d604f8f803bb527bd8321ed5be06c460b8682 # v46.2.2",
      )
        .replace("- cron: 0 */12 * * *", "- cron: '0 */12 * * *'")
        .replace(
          "RENOVATE_USERNAME: reddoor-renovate[bot]",
          "RENOVATE_USERNAME: 'reddoor-renovate[bot]'",
        ),
    },
    {
      label: "mutable tag ref on the site",
      contents: CANONICAL.replace(
        "renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21",
        "renovatebot/github-action@v46",
      ),
    },
    {
      label: "changed cron (genuinely non-compliant)",
      contents: CANONICAL.replace("- cron: 0 */12 * * *", "- cron: 0 0 * * *"),
    },
    {
      label: "a commented-out canonical pin above a real mutable tag",
      contents: CANONICAL.replace(
        "      - uses: renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21",
        "      # - uses: renovatebot/github-action@1a96852b0384df1837619d04c60b2d10d1f9ff08 # v46.1.21\n" +
          "      - uses: renovatebot/github-action@v46",
      ),
    },
    { label: "empty file", contents: "" },
  ];

  for (const { label, contents } of SITE_SHAPES) {
    it(`healed(${label}) has zero gaps`, () => {
      expect(renovateActionGaps(withRenovatePinsFrom(CANONICAL, contents))).toEqual([]);
    });
  }
});
