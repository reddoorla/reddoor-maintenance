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
});
