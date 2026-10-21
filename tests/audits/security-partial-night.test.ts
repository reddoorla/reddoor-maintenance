/**
 * #1654: a night `pnpm audit` cannot run reads exactly as a full night would on the same alerts.
 *
 * The row now stores pnpm's own result from the last full merged night (its counts, and its
 * advisories before any merge lifted a severity). A partial night rebuilds that result and runs
 * the same `mergeAudits` a full night runs. So every case here asks one question, through the
 * production path (`securityAudit` → `planAuditWrite` → the Turso row): after the same history,
 * does a partial night write what a full night with the same pnpm answer would have written?
 *
 * The cases are every round's from #1561 (eight review rounds on `claude/1654-partial-night-design`,
 * whose stand-in had to guess pnpm's view), round 8's two that it could not pass among them.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/client.js";
import { getSiteById, mirrorHealthFields, mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { securityAudit } from "../../src/audits/security.js";
import { planAuditWrite } from "../../src/audits/write-audits.js";
import { autoTickChecklist } from "../../src/reports/auto-tick.js";
import type { DependabotAlert } from "../../src/github/gh-rest.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";

const TWO_DOCUMENTS = "---\nlockfileVersion: '9.0'\n---\nlockfileVersion: '9.0'\n";
const ONE_DOCUMENT = "lockfileVersion: '9.0'\n";

type PnpmAdvisory = Record<string, unknown>;
/** pnpm's answer: its advisories, and its metadata counts (tallied from them unless given). */
type Pnpm = { advisories: PnpmAdvisory[]; metadata?: Record<string, number> };
/** One night: Dependabot's open alerts, and whether pnpm audit runs. */
type Night = { alerts: DependabotAlert[]; pnpm: "runs" | "fails" };

const alert = (over: Partial<DependabotAlert>): DependabotAlert => ({
  package: "actions/checkout",
  severity: "high",
  summary: "GitHub words it",
  cves: [],
  url: null,
  scope: "runtime",
  relationship: "direct",
  manifestPath: ".github/workflows/ci.yml",
  ghsaId: null,
  ...over,
});

function pnpmJson(p: Pnpm): string {
  const tally = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const a of p.advisories) tally[a["severity"] as keyof typeof tally] += 1;
  return JSON.stringify({
    metadata: { vulnerabilities: { ...tally, ...p.metadata } },
    advisories: Object.fromEntries(p.advisories.map((a, i) => [String(i + 1), a])),
  });
}

async function freshDb(seed: Record<string, unknown> = {}) {
  const db = await openDb({ url: ":memory:" });
  await mirrorSiteInsert(
    db,
    { id: "recACME", fields: { Name: "Acme", Status: "maintained", ...seed } },
    new Date().toISOString(),
  );
  return db;
}

/** Runs the nights through the production path, one write per night, and returns each row. */
async function run(
  nights: Night[],
  pnpm: Pnpm,
  opts: { lockfile?: string; packageJson?: object; seed?: Record<string, unknown> } = {},
): Promise<WebsiteRow[]> {
  const db = await freshDb(opts.seed);
  const dir = mkdtempSync(join(tmpdir(), "security-partial-night-"));
  writeFileSync(join(dir, "pnpm-lock.yaml"), opts.lockfile ?? TWO_DOCUMENTS);
  if (opts.packageJson) writeFileSync(join(dir, "package.json"), JSON.stringify(opts.packageJson));
  const rows: WebsiteRow[] = [];
  for (const night of nights) {
    const result = await securityAudit({
      site: { path: dir, gitRepo: "reddoorla/acme" },
      dependabotDeps: { listAlerts: async () => night.alerts },
      spawn: async (cmd) => {
        if (cmd !== "pnpm" || night.pnpm === "fails") throw new Error(`ENOENT: ${cmd}`);
        return { code: 1, stdout: pnpmJson(pnpm), stderr: "" };
      },
    });
    const before = (await getSiteById(db, "recACME"))!;
    const { summary } = planAuditWrite({ websites: [before], slug: "acme", results: [result] });
    if (summary.fields) await mirrorHealthFields(db, "recACME", summary.fields);
    rows.push((await getSiteById(db, "recACME"))!);
  }
  await db.destroy();
  return rows;
}

/** What the row says about security, the audit time aside. */
function view(r: WebsiteRow) {
  return {
    counts: [
      r.securityVulnsCritical,
      r.securityVulnsHigh,
      r.securityVulnsModerate,
      r.securityVulnsLow,
    ],
    advisories: (r.securityAdvisories ?? [])
      .map((a) => `${a.module}:${a.severity}:${a.relationship ?? "-"}:${a.scope ?? "-"}`)
      .sort(),
  };
}

/**
 * The property. `history` starts with a full night. Every later partial night must leave the row
 * as that same night would have, had pnpm run and given the same answer, and must not stamp the
 * audit time. Returns the partial nights' views for case-specific checks.
 */
async function expectPartialNightsReadAsFull(
  history: Night[],
  pnpm: Pnpm,
  opts: { lockfile?: string; packageJson?: object } = {},
) {
  expect(history[0]!.pnpm).toBe("runs");
  const actual = await run(history, pnpm, opts);
  const views = [];
  for (let i = 1; i < history.length; i++) {
    if (history[i]!.pnpm !== "fails") continue;
    const asFull = history
      .slice(0, i + 1)
      .map((n, j) => (j === i ? { ...n, pnpm: "runs" as const } : n));
    const expected = (await run(asFull, pnpm, opts))[i]!;
    expect({ night: i, ...view(actual[i]!) }).toEqual({ night: i, ...view(expected) });
    expect(actual[i]!.lastSecurityAuditAt).toBe(actual[i - 1]!.lastSecurityAuditAt);
    views.push(view(actual[i]!));
  }
  return views;
}

const full = (alerts: DependabotAlert[]): Night => ({ alerts, pnpm: "runs" });
const partial = (alerts: DependabotAlert[]): Night => ({ alerts, pnpm: "fails" });
/** A partial night with one more live alert than the full night before it. Without it, a night
 *  that writes nothing would leave the row equal to the full night's, and pass. */
const EXTRA = alert({ package: "z-extra", severity: "low", ghsaId: "GHSA-eeee-eeee-0009" });
const partialPlus = (alerts: DependabotAlert[]): Night => partial([...alerts, EXTRA]);

const sharpHigh = {
  module_name: "sharp",
  severity: "high",
  title: "pnpm words it",
  url: "https://github.com/advisories/GHSA-aaaa-bbbb-1001",
};
const sharpAlert = (over: Partial<DependabotAlert> = {}) =>
  alert({
    package: "sharp",
    ghsaId: "GHSA-aaaa-bbbb-1001",
    manifestPath: "a/package.json",
    ...over,
  });

describe("a partial night reads as a full night on the same alerts (#1654)", () => {
  it("round 1: Dependabot's counts do not erase pnpm's high", async () => {
    const [v] = await expectPartialNightsReadAsFull(
      [full([alert({ severity: "critical" })]), partial([alert({ severity: "low" })])],
      { advisories: [sharpHigh] },
    );
    expect(v!.counts).toEqual([0, 1, 0, 1]);
  });

  it("round 3: a Dependabot alert fixed since is not locked in", async () => {
    const setupNode = alert({ package: "actions/setup-node", severity: "low", summary: "cache" });
    const [v] = await expectPartialNightsReadAsFull(
      [full([alert({ severity: "critical" })]), partial([setupNode])],
      { advisories: [] },
    );
    expect(v!.counts).toEqual([0, 0, 0, 1]);
  });

  it("round 4: past the persisted list's cap, the count stays put night after night", async () => {
    const thirty = Array.from({ length: 30 }, (_, i) =>
      alert({
        package: `pkg${i}`,
        severity: "low",
        summary: `a${i}`,
        ghsaId: `GHSA-aaaa-bbbb-${1000 + i}`,
      }),
    );
    const views = await expectPartialNightsReadAsFull(
      [full(thirty), partialPlus(thirty), partialPlus(thirty), partialPlus(thirty)],
      { advisories: [] },
    );
    expect(views.map((v) => v.counts[3])).toEqual([31, 31, 31]);
  });

  it("round 4: one advisory both sources name by GHSA alone, under different titles, counts once", async () => {
    const pkg1 = {
      module_name: "pkg1",
      severity: "high",
      title: "pnpm words it",
      github_advisory_id: "GHSA-aaaa-bbbb-1001",
    };
    const a = alert({
      package: "pkg1",
      ghsaId: "GHSA-aaaa-bbbb-1001",
      manifestPath: "a/package.json",
    });
    const [v] = await expectPartialNightsReadAsFull([full([a]), partialPlus([a])], {
      advisories: [pkg1],
    });
    expect(v!.counts).toEqual([0, 1, 0, 1]);
  });

  it("round 5: a pnpm high that Dependabot rates moderate stays high, and stays after the alert closes", async () => {
    const low = alert({ severity: "low" });
    const views = await expectPartialNightsReadAsFull(
      [
        full([sharpAlert({ severity: "moderate" }), low]),
        partial([sharpAlert({ severity: "moderate" }), low]),
        partial([low]),
      ],
      { advisories: [sharpHigh] },
    );
    expect(views.map((v) => v.counts[1])).toEqual([1, 1]);
  });

  it("round 6: two per-manifest alerts on one pnpm advisory count once", async () => {
    const [v] = await expectPartialNightsReadAsFull(
      [
        full([sharpAlert(), sharpAlert({ manifestPath: "b/package.json" })]),
        partialPlus([sharpAlert(), sharpAlert({ manifestPath: "b/package.json" })]),
      ],
      { advisories: [sharpHigh] },
    );
    expect(v!.counts).toEqual([0, 1, 0, 1]);
  });

  it("round 7: relationship merges as the full night's does", async () => {
    const t = sharpAlert({ relationship: "transitive" });
    await expectPartialNightsReadAsFull([full([t]), partialPlus([t]), partialPlus([t])], {
      advisories: [sharpHigh],
    });
  });

  it("round 7: a second manifest's direct alert is not lost", async () => {
    const alerts = [
      sharpAlert({ relationship: "transitive" }),
      sharpAlert({ severity: "moderate", relationship: "direct", manifestPath: "b/package.json" }),
    ];
    await expectPartialNightsReadAsFull([full(alerts), partialPlus(alerts)], {
      advisories: [sharpHigh],
    });
  });

  it("round 7: two pnpm advisories one alert matches both stay", async () => {
    const legacy = {
      module_name: "sharp",
      severity: "moderate",
      title: "pnpm legacy",
      cves: ["CVE-2026-9"],
    };
    const a = sharpAlert({ cves: ["CVE-2026-9"] });
    const [v] = await expectPartialNightsReadAsFull([full([a]), partialPlus([a])], {
      advisories: [sharpHigh, legacy],
    });
    expect(v!.counts).toEqual([0, 1, 1, 1]);
  });

  it("round 7: a Dependabot-only advisory on two manifests counts once", async () => {
    const lodash = alert({ package: "lodash", ghsaId: "GHSA-cccc-dddd-2002" });
    const alerts = [
      { ...lodash, manifestPath: "a/package.json" },
      { ...lodash, manifestPath: "b/package.json" },
    ];
    const [v] = await expectPartialNightsReadAsFull([full(alerts), partialPlus(alerts)], {
      advisories: [],
    });
    expect(v!.counts).toEqual([0, 1, 0, 1]);
  });

  it("round 7: pnpm's own transitive relationship carries through", async () => {
    const t = sharpAlert({ relationship: "transitive" });
    const [v] = await expectPartialNightsReadAsFull(
      [full([t]), partialPlus([t])],
      { advisories: [sharpHigh] },
      { packageJson: { dependencies: { svelte: "^5.0.0" } } },
    );
    expect(v!.advisories).toContain("sharp:high:transitive:runtime");
  });

  it("round 8: pnpm's metadata count above its own detail is not lowered", async () => {
    // pnpm counts two highs and names none; Dependabot has two highs and a low, then only the low.
    const highs = [
      alert({ package: "x", ghsaId: "GHSA-xxxx-xxxx-0001" }),
      alert({ package: "y", ghsaId: "GHSA-yyyy-yyyy-0002" }),
    ];
    const low = alert({ package: "z", severity: "low", ghsaId: "GHSA-zzzz-zzzz-0003" });
    const views = await expectPartialNightsReadAsFull(
      [full([...highs, low]), partial([...highs, low]), partial([low])],
      { advisories: [], metadata: { high: 2 } },
    );
    expect(views.map((v) => v.counts[1])).toEqual([2, 2]);
  });

  it("round 8: a severity only Dependabot raised falls back once Dependabot closes it", async () => {
    const sharpModerate = { ...sharpHigh, severity: "moderate" };
    const low = alert({ package: "z", severity: "low", ghsaId: "GHSA-zzzz-zzzz-0003" });
    const views = await expectPartialNightsReadAsFull([full([sharpAlert(), low]), partial([low])], {
      advisories: [sharpModerate],
    });
    expect(views[0]!.counts).toEqual([0, 0, 1, 1]);
  });

  it("round 8: at the persisted list's cap, a closed Dependabot-only alert lowers the count", async () => {
    const thirty = Array.from({ length: 30 }, (_, i) =>
      alert({
        package: `pkg${i}`,
        severity: "low",
        summary: `a${i}`,
        ghsaId: `GHSA-aaaa-bbbb-${2000 + i}`,
      }),
    );
    const views = await expectPartialNightsReadAsFull([full(thirty), partial(thirty.slice(1))], {
      advisories: [sharpHigh],
    });
    expect(views[0]!.counts).toEqual([0, 1, 0, 29]);
  });

  it("a Dependabot-only advisory re-rated between nights counts once, at its new severity", async () => {
    const lodash = (severity: string) =>
      alert({ package: "lodash", severity, ghsaId: "GHSA-cccc-dddd-2002" });
    const [v] = await expectPartialNightsReadAsFull(
      [full([lodash("moderate")]), partial([lodash("high")])],
      { advisories: [sharpHigh] },
    );
    expect(v!.counts).toEqual([0, 2, 0, 0]);
  });

  it("one advisory both sources name by CVE alone, under different titles, counts once", async () => {
    const pnpmCve = {
      module_name: "pkg1",
      severity: "high",
      title: "pnpm words it",
      cves: ["CVE-2026-1"],
    };
    const a = alert({ package: "pkg1", cves: ["CVE-2026-1"], manifestPath: "a/package.json" });
    const [v] = await expectPartialNightsReadAsFull([full([]), partialPlus([a])], {
      advisories: [pnpmCve],
    });
    expect(v!.counts).toEqual([0, 1, 0, 1]);
  });

  it("the #1612 cross-check path: a readable lockfile whose pnpm audit flakes", async () => {
    const actions = alert({ severity: "low" });
    const [v] = await expectPartialNightsReadAsFull(
      [full([actions]), partial([actions]), partial([])],
      { advisories: [sharpHigh] },
      { lockfile: ONE_DOCUMENT },
    );
    expect(v!.counts).toEqual([0, 1, 0, 1]);
  });
});

describe("the stored lockfile result (#1654)", () => {
  it("a full merged night stores pnpm's own counts and severities, before the merge lifted them", async () => {
    const sharpModerate = { ...sharpHigh, severity: "moderate" };
    const [row] = await run([full([sharpAlert()])], {
      advisories: [sharpModerate],
      metadata: { low: 3 },
    });
    expect(row!.securityVulnsHigh).toBe(1);
    expect(row!.securityLockfileAudit).toEqual({
      counts: { critical: 0, high: 0, moderate: 1, low: 3 },
      advisories: [
        expect.objectContaining({
          module: "sharp",
          severity: "moderate",
          ghsa: "GHSA-aaaa-bbbb-1001",
        }),
      ],
      truncated: false,
    });
  });

  it("a partial night leaves it as stored", async () => {
    const rows = await run([full([sharpAlert()]), partial([alert({ severity: "low" })])], {
      advisories: [sharpHigh],
    });
    expect(rows[1]!.securityLockfileAudit).toEqual(rows[0]!.securityLockfileAudit);
  });

  it("with none stored, a partial night writes nothing over audited counts", async () => {
    const stale = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const seed = {
      "Security Vulns Critical": 0,
      "Security Vulns High": 2,
      "Security Vulns Moderate": 0,
      "Security Vulns Low": 0,
      "Last security audit at": stale,
    };
    const [row] = await run([partial([alert({ severity: "low" })])], { advisories: [] }, { seed });
    expect(view(row!).counts).toEqual([0, 2, 0, 0]);
    expect(row!.lastSecurityAuditAt).toBe(stale);
  });

  it("with a stored clean result, a stale clean row takes tonight's alert and stays stale", async () => {
    const stale = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const seed = {
      "Security Vulns Critical": 0,
      "Security Vulns High": 0,
      "Security Vulns Moderate": 0,
      "Security Vulns Low": 0,
      "Last security audit at": stale,
      "Security lockfile audit": JSON.stringify({
        counts: { critical: 0, high: 0, moderate: 0, low: 0 },
        advisories: [],
      }),
    };
    const [row] = await run([partial([alert({ severity: "low" })])], { advisories: [] }, { seed });
    expect(view(row!).counts).toEqual([0, 0, 0, 1]);
    expect(row!.lastSecurityAuditAt).toBe(stale);
    const evidence = autoTickChecklist(row!, "Maintenance", new Date(), {
      search: { value: null, softFailed: false, notConfigured: false },
    }).get("Maint: Security Updates")!;
    expect(evidence.result).toBe("unknown");
  });

  it("a never-audited row takes tonight's live alerts, and the box does not tick", async () => {
    const [row] = await run([partial([alert({ severity: "moderate" })])], { advisories: [] });
    expect(view(row!).counts).toEqual([0, 0, 1, 0]);
    expect(row!.lastSecurityAuditAt).toBeNull();
    const evidence = autoTickChecklist(row!, "Maintenance", new Date(), {
      search: { value: null, softFailed: false, notConfigured: false },
    }).get("Maint: Security Updates")!;
    expect(evidence.result).not.toBe("pass");
  });

  it("a truncated stored result is not merged with: nothing is written", async () => {
    const seed = {
      "Security Vulns High": 1,
      "Security lockfile audit": JSON.stringify({
        counts: { critical: 0, high: 300, moderate: 0, low: 0 },
        advisories: [],
        truncated: true,
      }),
    };
    const [row] = await run([partial([alert({ severity: "low" })])], { advisories: [] }, { seed });
    expect(view(row!).counts).toEqual([null, 1, null, null]);
  });
});
