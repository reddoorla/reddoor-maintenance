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

const ORG = "reddoorla";
const NOW = new Date("2026-09-16T12:00:00Z");

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
 * Modelled on the measurement posted to #690 on 2026-09-16: 24 repos carrying
 * `pnpm@11.11.0` with no drift, two carrying no field at all (`claude-skills`,
 * `reddoor-md-pdf` — the latter pinning its pnpm in `ci.yml` instead), and
 * three with no `package.json` at all. A check that has only ever been seen to
 * fail is an untested assertion, so the instrument is driven against the real
 * fleet's shape and must find NOTHING live there.
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
    "reddoor-website",
    "espada",
    "naked",
    "29-navy",
    "medical-solutions-of-texas",
    "1836dig",
    "hedloc-web",
    "reddoor-la",
    "erp",
    "invitations",
  ].map((name) => ({
    name,
    packageJson: pkg("pnpm@11.11.0"),
    workflows: { ".github/workflows/ci.yml": HEALTHY_CI },
  }));
  return [
    ...pinned,
    { name: "claude-skills", packageJson: pkg(null) },
    {
      name: "reddoor-md-pdf",
      packageJson: pkg(null),
      workflows: { ".github/workflows/ci.yml": PINNING_CI },
    },
    {
      name: ".github",
      packageJson: null,
      workflows: { ".github/workflows/renovate.yml": HEALTHY_CI },
    },
    { name: "reddoor-prospect-runner", packageJson: null },
    { name: "reddoor-rfp-analyses", packageJson: null },
  ];
}

describe("collectPackageManagerPins", () => {
  it("the REAL fleet (2026-09-16) produces no live gap — the two known ones are accepted, with expiry", async () => {
    const rows = await collectPackageManagerPins(ORG, makeDeps(realFleet()), NOW);
    expect(rows.filter((r) => r.gaps.length > 0)).toEqual([]);

    const accepted = rows.filter((r) => r.accepted.length > 0).map((r) => r.repo);
    expect(accepted).toEqual(["reddoorla/claude-skills", "reddoorla/reddoor-md-pdf"]);
    expect(rows.find((r) => r.repo === "reddoorla/reddoor-md-pdf")!.accepted[0]).toContain(
      "accepted until 2026-10-01",
    );

    // The three package-less repos read as out of scope, NOT as gaps — they
    // would otherwise light up every night forever.
    expect(rows.filter((r) => r.scope === "out-of-scope").map((r) => r.repo)).toEqual([
      "reddoorla/.github",
      "reddoorla/reddoor-prospect-runner",
      "reddoorla/reddoor-rfp-analyses",
    ]);
    expect(packageManagerPinSummary(rows)).toContain("fleetPin=pnpm@11.11.0");
    expect(packageManagerPinSummary(rows)).toContain("gaps=0");
  });

  /** THE FAIL-ON-PURPOSE RUN: the same fleet, one repo moved off the pin. */
  it("one drifted repo in that same fleet IS a gap", async () => {
    const drifted = realFleet();
    drifted[0] = { ...drifted[0]!, packageJson: pkg("pnpm@11.9.0") };
    const rows = await collectPackageManagerPins(ORG, makeDeps(drifted), NOW);
    const gapped = rows.filter((r) => r.gaps.length > 0);
    expect(gapped).toHaveLength(1);
    expect(gapped[0]!.repo).toBe("reddoorla/reddoor-maintenance");
    expect(gapped[0]!.gaps[0]).toContain(
      "packageManager is pnpm@11.9.0 but the fleet pin is pnpm@11.11.0 (23/24 repos agree)",
    );
    expect(packageManagerPinSummary(rows)).toContain("gaps=1");
  });

  it("a repo that adds the missing field while KEEPING the workflow input gaps immediately", async () => {
    const fleet = realFleet();
    const i = fleet.findIndex((r) => r.name === "reddoor-md-pdf");
    fleet[i] = { ...fleet[i]!, packageJson: pkg("pnpm@11.11.0") };
    const rows = await collectPackageManagerPins(ORG, makeDeps(fleet), NOW);
    const gapped = rows.filter((r) => r.gaps.length > 0);
    expect(gapped).toHaveLength(1);
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

  it("an acceptance that has EXPIRED stops accepting", async () => {
    const rows = await collectPackageManagerPins(
      ORG,
      makeDeps(realFleet()),
      new Date("2026-10-01T00:00:00Z"),
    );
    const gapped = rows.filter((r) => r.gaps.length > 0).map((r) => r.repo);
    expect(gapped).toEqual(["reddoorla/claude-skills", "reddoorla/reddoor-md-pdf"]);
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

  it("every accepted entry names one repo, one surface, and an expiry (the doctrine)", () => {
    for (const a of PACKAGE_MANAGER_ACCEPTED_GAPS) {
      expect(a.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
      expect(a.detailPrefix.length).toBeGreaterThan(0);
      expect(a.reason).toContain("#690");
      expect(Number.isNaN(Date.parse(a.until))).toBe(false);
    }
  });
});
