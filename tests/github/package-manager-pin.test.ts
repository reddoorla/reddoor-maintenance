import { describe, it, expect } from "vitest";
import {
  collectPackageManagerPins,
  fleetPin,
  packageManagerGaps,
  packageManagerPinSummary,
  parsePackageManagerField,
  parsePnpmActionSetupPins,
  PACKAGE_MANAGER_ACCEPTED_GAPS,
  type PackageManagerPinDeps,
} from "../../src/github/package-manager-pin.js";
import type { AcceptedGap } from "../../src/audits/protection-coverage.js";

const ORG = "reddoorla";
const NOW = new Date("2026-09-15T12:00:00Z");

const pkg = (pin: string | null): string =>
  JSON.stringify(pin === null ? { name: "x", private: true } : { name: "x", packageManager: pin });

/**
 * The real fleet workflow shape, and the reason this fixture is verbatim: the
 * hand-run measurement that grepped `version:` matched `node-version: "24"`
 * here and called eleven such workflows broken. If this file ever reports a
 * pin, the trap is back.
 */
const HEALTHY_CI = `name: ci
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: "24"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
`;

/** reddoor-md-pdf's shape: the one workflow fleet-wide that really does pin. */
const PINNING_CI = `name: ci
jobs:
  build:
    steps:
      - uses: pnpm/action-setup@v6
        with:
          version: 11.11.0
      - uses: actions/setup-node@v7
        with:
          node-version: "24"
`;

describe("parsePnpmActionSetupPins", () => {
  it("reads nothing from a healthy workflow — node-version is NOT a pnpm pin", () => {
    expect(parsePnpmActionSetupPins(HEALTHY_CI)).toEqual([]);
  });

  it("reads the version input out of the action-setup step's own block", () => {
    expect(parsePnpmActionSetupPins(PINNING_CI)).toEqual(["11.11.0"]);
  });

  it("handles the `- name:` + `uses:` step form, and quoted versions", () => {
    const wf = `jobs:
  build:
    steps:
      - name: Set up pnpm
        uses: pnpm/action-setup@v6
        with:
          version: "10.0.0"
          run_install: false
      - name: Node
        uses: actions/setup-node@v7
        with:
          node-version: 24
`;
    expect(parsePnpmActionSetupPins(wf)).toEqual(["10.0.0"]);
  });

  it("does not reach into a LATER step's with: block when action-setup has none", () => {
    const wf = `jobs:
  build:
    steps:
      - uses: pnpm/action-setup@v6
      - uses: some/other-action@v1
        with:
          version: 9.9.9
`;
    expect(parsePnpmActionSetupPins(wf)).toEqual([]);
  });

  it("finds a pin in every action-setup step, across jobs", () => {
    const wf = `jobs:
  a:
    steps:
      - uses: pnpm/action-setup@v6
        with:
          version: 11.11.0
  b:
    steps:
      - uses: pnpm/action-setup@v6
        with:
          version: 11.9.0
`;
    expect(parsePnpmActionSetupPins(wf)).toEqual(["11.11.0", "11.9.0"]);
  });

  it("reads nothing from a workflow with no pnpm step at all", () => {
    expect(
      parsePnpmActionSetupPins("jobs:\n  a:\n    steps:\n      - run: echo version: 3\n"),
    ).toEqual([]);
  });
});

describe("parsePackageManagerField", () => {
  it("reads the pin", () => {
    expect(parsePackageManagerField(pkg("pnpm@11.11.0"))).toEqual({
      state: "present",
      value: "pnpm@11.11.0",
    });
  });

  it("absent and unreadable are DIFFERENT answers", () => {
    expect(parsePackageManagerField(pkg(null))).toEqual({ state: "absent" });
    expect(parsePackageManagerField("{not json")).toMatchObject({ state: "unreadable" });
    expect(parsePackageManagerField('{"packageManager": 11}')).toMatchObject({
      state: "unreadable",
    });
  });
});

describe("fleetPin", () => {
  it("a strict majority names the fleet pin", () => {
    expect(fleetPin(["pnpm@11.11.0", "pnpm@11.11.0", "pnpm@11.9.0"])).toEqual({
      state: "majority",
      pin: "pnpm@11.11.0",
      count: 2,
      total: 3,
    });
  });

  it("an even split names NO pin — gapping half the fleet over one unmade decision is worse", () => {
    const split = fleetPin(["pnpm@11.11.0", "pnpm@11.9.0"]);
    expect(split.state).toBe("split");
  });

  it("no pinned repos at all is its own state", () => {
    expect(fleetPin([])).toEqual({ state: "none" });
  });
});

describe("packageManagerGaps", () => {
  const FLEET = fleetPin(["pnpm@11.11.0", "pnpm@11.11.0", "pnpm@11.11.0"]);

  it("a repo on the fleet pin with no workflow input is clean", () => {
    expect(
      packageManagerGaps({ packageJson: pkg("pnpm@11.11.0"), workflowPins: [] }, FLEET),
    ).toEqual([]);
  });

  it("a disagreeing pin is a gap naming both versions", () => {
    const gaps = packageManagerGaps({ packageJson: pkg("pnpm@11.9.0"), workflowPins: [] }, FLEET);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("packageManager is pnpm@11.9.0 but the fleet pin is pnpm@11.11.0");
  });

  it("a missing field is a gap", () => {
    const gaps = packageManagerGaps({ packageJson: pkg(null), workflowPins: [] }, FLEET);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("no packageManager field");
  });

  /**
   * The remediation, not just the verdict. Telling this repo to "add the
   * missing field" without deleting the workflow input is telling it to break
   * its own CI — action-setup hard-errors on the mismatch.
   */
  it("a missing field NEXT TO a workflow pin prescribes both edits in one change", () => {
    const gaps = packageManagerGaps(
      { packageJson: pkg(null), workflowPins: [{ file: "ci.yml", version: "11.11.0" }] },
      FLEET,
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("ci.yml (version: 11.11.0)");
    expect(gaps[0]).toContain("SAME change");
  });

  it("a field AND a workflow input is a gap even while they agree", () => {
    const gaps = packageManagerGaps(
      {
        packageJson: pkg("pnpm@11.11.0"),
        workflowPins: [{ file: "ci.yml", version: "11.11.0" }],
      },
      FLEET,
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("they agree today, but nothing keeps them in step");
  });

  it("a field and a DISAGREEING workflow input says so — that CI is already broken", () => {
    const gaps = packageManagerGaps(
      {
        packageJson: pkg("pnpm@11.11.0"),
        workflowPins: [{ file: "ci.yml", version: "11.9.0" }],
      },
      FLEET,
    );
    expect(gaps[0]).toContain("THEY DISAGREE");
  });

  it("unreadable package.json is a gap, never a pass", () => {
    expect(packageManagerGaps({ packageJson: "{oops", workflowPins: [] }, FLEET)[0]).toContain(
      "unreadable",
    );
  });
});

type RepoFixture = {
  name: string;
  packageJson?: string | null;
  workflows?: Record<string, string>;
  archived?: boolean;
  visibility?: string;
};

function makeDeps(repos: RepoFixture[]): PackageManagerPinDeps {
  const byRepo = new Map(repos.map((r) => [`${ORG}/${r.name}`, r]));
  return {
    listOrgRepos: async () =>
      repos.map((r) => ({
        name: r.name,
        visibility: r.visibility ?? "public",
        archived: r.archived ?? false,
        secretScanning: "enabled",
        pushProtection: "enabled",
      })),
    repoTextFile: async (repo, path) => {
      const r = byRepo.get(repo);
      if (!r) throw new Error(`unexpected repo ${repo}`);
      if (path === "package.json") return r.packageJson ?? null;
      return r.workflows?.[path] ?? null;
    },
    listWorkflowPaths: async (repo) => Object.keys(byRepo.get(repo)?.workflows ?? {}),
  };
}

/**
 * THE PASS CONTROL, and it is the whole fleet.
 *
 * RE-DERIVED 2026-09-15 from live GitHub: the org repo listing (32 repos, with
 * each one's `isArchived` and `visibility`), every repo's `package.json`, and
 * all 75 files under `.github/workflows` parsed by this module's own
 * `parsePnpmActionSetupPins`. It is not hand-maintained and not carried
 * forward, because the shape it replaces was already untrue the day it was
 * written and then went on to encode a state the fleet had left:
 *
 *  - it listed `claude-skills` as a judged repo with no `packageManager`
 *    field. `claude-skills` is PRIVATE, so this sweep SKIPS it and has never
 *    judged it at all — the acceptance naming it could not have applied even
 *    before the field landed;
 *  - it gave `reddoor-md-pdf` no field and a pnpm-pinning `ci.yml`. It now
 *    carries `pnpm@11.11.0` and its `pnpm/action-setup` step takes no
 *    `version:` input;
 *  - it called `reddoor-prospect-runner` and `reddoor-rfp-analyses`
 *    out-of-scope package-less repos. Both are PRIVATE and are skipped before
 *    the out-of-scope branch is reached; `.github` is the only repo that
 *    actually reaches it;
 *  - and six of its repo names (`naked`, `reddoor-la`, `erp`, `hedloc-web`,
 *    `invitations`, …) are not repos in this org at all.
 *
 * The judged population is 26 non-archived PUBLIC repos: 25 carry
 * `pnpm@11.11.0`, `.github` has no `package.json`, NOBODY pins a workflow
 * `version:` input, and six repos are skipped as archived or private.
 *
 * A check that has only ever been seen to fail is an untested assertion, so
 * the instrument is driven against the real fleet's shape and must find
 * NOTHING live there.
 */
function realFleet(): RepoFixture[] {
  const pinned = [
    "reddoor-maintenance",
    "reddoor-starter",
    "reddoor-starter-blux",
    "beachfront-dentistry",
    "vida-legacy-foundation",
    "alamo-anatomy",
    "caltex-landing",
    "composition-hospitality",
    "canvas-starter",
    "the-pointe-burbank",
    "the-tower-burbank",
    "data-dynamiq",
    "gallerysonder",
    "la-homelessness-initiative",
    "la-homelessness-youth",
    "reddoor-website",
    "espada",
    "hedloc",
    "29-navy",
    "medical-solutions-of-texas",
    "1836dig",
    "erp-industrial",
    "vineyard-custom-homes",
    "revogen",
    "reddoor-md-pdf",
  ].map((name) => ({
    name,
    packageJson: pkg("pnpm@11.11.0"),
    workflows: { ".github/workflows/ci.yml": HEALTHY_CI },
  }));
  return [
    ...pinned,
    // The only repo that reaches the out-of-scope branch.
    {
      name: ".github",
      packageJson: null,
      workflows: { ".github/workflows/renovate.yml": HEALTHY_CI },
    },
    // SKIPPED — private. Their pins are given deliberately DRIFTED values so
    // that a skip which stopped skipping could not pass unnoticed: these would
    // gap loudly and move the fleet pin if they were ever judged.
    { name: "claude-skills", visibility: "private", packageJson: pkg("pnpm@9.0.0") },
    { name: "reddoor-prospect-runner", visibility: "private", packageJson: null },
    { name: "reddoor-rfp-analyses", visibility: "private", packageJson: null },
    // SKIPPED — archived.
    { name: "reddoor-test", archived: true, visibility: "private", packageJson: pkg("pnpm@9.0.0") },
    { name: "the-pointe", archived: true, packageJson: pkg("pnpm@9.0.0") },
    { name: "the-tower", archived: true, packageJson: pkg("pnpm@9.0.0") },
  ];
}

describe("collectPackageManagerPins", () => {
  it("the REAL fleet (re-derived 2026-09-15) produces no gap AND masks nothing", async () => {
    const rows = await collectPackageManagerPins(ORG, makeDeps(realFleet()), NOW);
    expect(rows.filter((r) => r.gaps.length > 0)).toEqual([]);

    // Nothing is ACCEPTED either, and that is the point of this run. An
    // acceptance is a mute scoped to one repo and one surface; while it stands
    // the named repo is the one repo whose gap cannot gate. Both original
    // entries outlived their fix, so the two repos most recently proven able
    // to lose the field were the two that could not have reported losing it.
    expect(rows.filter((r) => r.accepted.length > 0)).toEqual([]);
    expect(PACKAGE_MANAGER_ACCEPTED_GAPS).toEqual([]);

    // claude-skills is PRIVATE — SKIPPED, never judged. The retired acceptance
    // naming it could not have applied even while it stood.
    expect(rows.find((r) => r.repo === "reddoorla/claude-skills")!.scope).toBe("skipped");
    expect(rows.filter((r) => r.scope === "skipped").map((r) => r.repo)).toEqual([
      "reddoorla/claude-skills",
      "reddoorla/reddoor-prospect-runner",
      "reddoorla/reddoor-rfp-analyses",
      "reddoorla/reddoor-test",
      "reddoorla/the-pointe",
      "reddoorla/the-tower",
    ]);

    // `.github` is the ONLY repo that reaches the out-of-scope branch.
    expect(rows.filter((r) => r.scope === "out-of-scope").map((r) => r.repo)).toEqual([
      "reddoorla/.github",
    ]);
    expect(packageManagerPinSummary(rows)).toContain("fleetPin=pnpm@11.11.0");
    expect(packageManagerPinSummary(rows)).toContain("gaps=0");
    expect(packageManagerPinSummary(rows)).toContain("pinned=25");
    // The six skipped repos carry drifted pins; none of them moved the fleet
    // pin, so the skip really is happening before the read.
    expect(packageManagerPinSummary(rows)).toContain("skipped=6");
  });

  /** THE FAIL-ON-PURPOSE RUN: the same fleet, one repo moved off the pin. */
  it("one drifted repo in that same fleet IS a gap", async () => {
    const drifted = realFleet();
    const i = drifted.findIndex((r) => r.name === "reddoor-maintenance");
    drifted[i] = { ...drifted[i]!, packageJson: pkg("pnpm@11.9.0") };
    const rows = await collectPackageManagerPins(ORG, makeDeps(drifted), NOW);
    const gapped = rows.filter((r) => r.gaps.length > 0);
    expect(gapped).toHaveLength(1);
    expect(gapped[0]!.repo).toBe("reddoorla/reddoor-maintenance");
    expect(gapped[0]!.gaps[0]).toContain(
      "packageManager is pnpm@11.9.0 but the fleet pin is pnpm@11.11.0 (24/25 repos agree)",
    );
    expect(packageManagerPinSummary(rows)).toContain("gaps=1");
  });

  /**
   * THE REGRESSION THE RETIRED ACCEPTANCE WOULD HAVE MASKED, stated as a test.
   * `reddoor-md-pdf` losing its field again before 2026-10-01 would have been
   * reported as accepted-with-expiry and gated nothing.
   */
  it("a repo that LOSES its packageManager field gaps immediately", async () => {
    const fleet = realFleet();
    const i = fleet.findIndex((r) => r.name === "reddoor-md-pdf");
    fleet[i] = { ...fleet[i]!, packageJson: pkg(null) };
    const rows = await collectPackageManagerPins(ORG, makeDeps(fleet), NOW);
    const gapped = rows.filter((r) => r.gaps.length > 0);
    expect(gapped).toHaveLength(1);
    expect(gapped[0]!.repo).toBe("reddoorla/reddoor-md-pdf");
    expect(gapped[0]!.gaps[0]).toContain("no packageManager field");
  });

  /**
   * The collision clause's failing arm is INJECTED, not borrowed. No repo in
   * the fleet pins a workflow `version:` input any more, and a failing arm
   * that depends on one repo's current shape silently stops being exercised
   * the day that repo is fixed — which is exactly what happened to the
   * version of this test that used `reddoor-md-pdf`'s real `ci.yml`.
   */
  it("a repo pinning a workflow version input ALONGSIDE the field gaps immediately", async () => {
    const fleet = realFleet();
    const i = fleet.findIndex((r) => r.name === "reddoor-md-pdf");
    fleet[i] = { ...fleet[i]!, workflows: { ".github/workflows/ci.yml": PINNING_CI } };
    const rows = await collectPackageManagerPins(ORG, makeDeps(fleet), NOW);
    const gapped = rows.filter((r) => r.gaps.length > 0);
    expect(gapped).toHaveLength(1);
    expect(gapped[0]!.repo).toBe("reddoorla/reddoor-md-pdf");
    expect(gapped[0]!.gaps[0]).toContain("hard-errors on a mismatch");
  });

  it("archived and private repos are skipped — the sweep can never print COVERED for them", async () => {
    const rows = await collectPackageManagerPins(
      ORG,
      makeDeps([
        { name: "the-pointe", archived: true, packageJson: pkg("pnpm@9.0.0") },
        { name: "secret", visibility: "private", packageJson: pkg("pnpm@9.0.0") },
      ]),
      NOW,
    );
    expect(rows.every((r) => r.scope === "skipped")).toBe(true);
    expect(rows.every((r) => r.gaps.length === 0)).toBe(true);
  });

  /**
   * The expiry mechanism, driven through the INJECTED `accepted` list rather
   * than the shipped constant — which is empty now, so a test reading it would
   * assert nothing while looking like it asserted something. Both states have
   * to be supplied for either to mean anything.
   */
  it("an acceptance accepts before its expiry and stops accepting ON it", async () => {
    const fleet = realFleet();
    const i = fleet.findIndex((r) => r.name === "reddoor-md-pdf");
    fleet[i] = { ...fleet[i]!, packageJson: pkg(null) };
    const accepted: AcceptedGap[] = [
      {
        repo: "reddoorla/reddoor-md-pdf",
        detailPrefix: "no packageManager field",
        reason: "a named, tracked, pending fix",
        until: "2026-10-01",
      },
    ];

    const before = await collectPackageManagerPins(ORG, makeDeps(fleet), NOW, accepted);
    expect(before.filter((r) => r.gaps.length > 0)).toEqual([]);
    expect(before.find((r) => r.repo === "reddoorla/reddoor-md-pdf")!.accepted[0]).toContain(
      "accepted until 2026-10-01",
    );

    const after = await collectPackageManagerPins(
      ORG,
      makeDeps(fleet),
      new Date("2026-10-01T00:00:00Z"),
      accepted,
    );
    expect(after.filter((r) => r.gaps.length > 0).map((r) => r.repo)).toEqual([
      "reddoorla/reddoor-md-pdf",
    ]);
  });

  it("a read that THROWS is a gap, never a silent pass", async () => {
    const deps = makeDeps([{ name: "espada", packageJson: pkg("pnpm@11.11.0") }]);
    const rows = await collectPackageManagerPins(
      ORG,
      { ...deps, repoTextFile: async () => Promise.reject(new Error("HTTP 500")) },
      NOW,
    );
    expect(rows[0]!.gaps[0]).toContain("probe failed");
  });

  /** The shipped list is empty, and an emptiness assertion is the only arm of
   *  this pair that can actually fail today — the doctrine loop below is
   *  vacuous while the list is empty, and is kept for the entries that come. */
  it("the shipped acceptance list is EMPTY — no gap in this fleet is muted", () => {
    expect(PACKAGE_MANAGER_ACCEPTED_GAPS).toEqual([]);
  });

  it("any accepted entry names one repo, one surface, and an expiry (the doctrine)", () => {
    for (const a of PACKAGE_MANAGER_ACCEPTED_GAPS) {
      expect(a.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
      expect(a.detailPrefix.length).toBeGreaterThan(0);
      expect(a.reason.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(a.until))).toBe(false);
    }
  });
});
