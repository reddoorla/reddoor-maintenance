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
