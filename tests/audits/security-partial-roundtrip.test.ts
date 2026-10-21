/**
 * #1561 through the real path: `securityAudit` on a lockfile GitHub's dependency graph cannot
 * read, with `pnpm audit` unable to run, then `planAuditWrite`, the Turso row, and the Security
 * Updates auto-tick. Dependabot saw no npm package, so the row must not come out reading as a
 * freshly audited, clean tree.
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

const SECURITY = "Maint: Security Updates";
const TWO_DOCUMENTS = "---\nlockfileVersion: '9.0'\n---\nlockfileVersion: '9.0'\n";

const alert = (severity: DependabotAlert["severity"]): DependabotAlert => ({
  package: "actions/checkout",
  severity,
  summary: "checkout leaks the token",
  cves: [],
  url: "https://github.com/reddoorla/acme/security/dependabot/1",
  scope: "runtime",
  relationship: "direct",
  manifestPath: ".github/workflows/ci.yml",
  ghsaId: null,
});

async function partialRun(alerts: DependabotAlert[]) {
  const dir = mkdtempSync(join(tmpdir(), "security-partial-"));
  writeFileSync(join(dir, "pnpm-lock.yaml"), TWO_DOCUMENTS);
  return securityAudit({
    site: { path: dir, gitRepo: "reddoorla/acme" },
    dependabotDeps: { listAlerts: async () => alerts },
    spawn: async (cmd) => {
      throw new Error(`ENOENT: ${cmd}`);
    },
  });
}

async function siteAfterPartialRun(seed: Record<string, unknown>, severity: "moderate" | "low") {
  const db = await openDb({ url: ":memory:" });
  const now = new Date();
  await mirrorSiteInsert(
    db,
    { id: "recACME", fields: { Name: "Acme", Status: "maintained", ...seed } },
    now.toISOString(),
  );
  const before = (await getSiteById(db, "recACME"))!;
  const result = await partialRun([alert(severity)]);
  const { summary } = planAuditWrite({ websites: [before], slug: "acme", results: [result] });
  await mirrorHealthFields(db, "recACME", summary.fields!);
  const site = (await getSiteById(db, "recACME"))!;
  await db.destroy();
  const evidence = autoTickChecklist(site, "Maintenance", now, {
    search: { value: null, softFailed: false, notConfigured: false },
  }).get(SECURITY)!;
  return { site, evidence };
}

describe("a partial security run through the Turso row and the auto-tick (#1561)", () => {
  it("a never-audited site stays unaudited: the counts land, the box does not tick", async () => {
    const { site, evidence } = await siteAfterPartialRun({}, "moderate");
    expect(site.securityVulnsModerate).toBe(1);
    expect(site.lastSecurityAuditAt).toBeNull();
    expect(evidence.result).not.toBe("pass");
  });

  it("a clean row from a stale audit stays stale rather than turning freshly clean", async () => {
    const stale = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const { site, evidence } = await siteAfterPartialRun(
      {
        "Security Vulns Critical": 0,
        "Security Vulns High": 0,
        "Security Vulns Moderate": 0,
        "Security Vulns Low": 0,
        "Last security audit at": stale,
      },
      "low",
    );
    expect(site.securityVulnsLow).toBe(1);
    expect(site.lastSecurityAuditAt).toBe(stale);
    expect(evidence.result).toBe("unknown");
  });

  it("night after night, a Dependabot alert fixed since is not locked in", async () => {
    const db = await openDb({ url: ":memory:" });
    await mirrorSiteInsert(
      db,
      { id: "recACME", fields: { Name: "Acme", Status: "maintained" } },
      new Date().toISOString(),
    );
    const sweep = async (alerts: DependabotAlert[]) => {
      const before = (await getSiteById(db, "recACME"))!;
      const result = await partialRun(alerts);
      const { summary } = planAuditWrite({ websites: [before], slug: "acme", results: [result] });
      await mirrorHealthFields(db, "recACME", summary.fields!);
      return (await getSiteById(db, "recACME"))!;
    };
    const first = await sweep([alert("critical")]);
    expect(first.securityVulnsCritical).toBe(1);
    const setupNode = {
      ...alert("low"),
      package: "actions/setup-node",
      summary: "cache poisoning",
    };
    const second = await sweep([setupNode]);
    await db.destroy();
    expect(second.securityVulnsCritical).toBe(0);
    expect(second.securityVulnsLow).toBe(1);
    expect(second.securityAdvisories!.map((a) => a.module)).toEqual(["actions/setup-node"]);
  });

  it("after a full merged run, a partial one keeps the lockfile's advisory and replaces Dependabot's", async () => {
    const db = await openDb({ url: ":memory:" });
    await mirrorSiteInsert(
      db,
      { id: "recACME", fields: { Name: "Acme", Status: "maintained" } },
      new Date().toISOString(),
    );
    const dir = mkdtempSync(join(tmpdir(), "security-partial-"));
    writeFileSync(join(dir, "pnpm-lock.yaml"), TWO_DOCUMENTS);
    const pnpmOut = JSON.stringify({
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
      advisories: {
        "1": { module_name: "sharp", severity: "high", title: "sharp : librsvg" },
      },
    });
    const write = async (result: Awaited<ReturnType<typeof securityAudit>>) => {
      const before = (await getSiteById(db, "recACME"))!;
      const { summary } = planAuditWrite({ websites: [before], slug: "acme", results: [result] });
      await mirrorHealthFields(db, "recACME", summary.fields!);
      return (await getSiteById(db, "recACME"))!;
    };
    const full = await write(
      await securityAudit({
        site: { path: dir, gitRepo: "reddoorla/acme" },
        dependabotDeps: { listAlerts: async () => [alert("low")] },
        spawn: async (cmd) => {
          if (cmd !== "pnpm") throw new Error(`ENOENT: ${cmd}`);
          return { code: 1, stdout: pnpmOut, stderr: "" };
        },
      }),
    );
    expect([full.securityVulnsHigh, full.securityVulnsLow]).toEqual([1, 1]);
    const setupNode = {
      ...alert("low"),
      package: "actions/setup-node",
      summary: "cache poisoning",
    };
    const after = await write(await partialRun([setupNode]));
    await db.destroy();
    expect([after.securityVulnsHigh, after.securityVulnsLow]).toEqual([1, 1]);
    expect(after.securityAdvisories!.map((a) => a.module).sort()).toEqual([
      "actions/setup-node",
      "sharp",
    ]);
  });

  async function freshDb() {
    const db = await openDb({ url: ":memory:" });
    await mirrorSiteInsert(
      db,
      { id: "recACME", fields: { Name: "Acme", Status: "maintained" } },
      new Date().toISOString(),
    );
    const write = async (result: Awaited<ReturnType<typeof securityAudit>>) => {
      const before = (await getSiteById(db, "recACME"))!;
      const { summary } = planAuditWrite({ websites: [before], slug: "acme", results: [result] });
      await mirrorHealthFields(db, "recACME", summary.fields!);
      return (await getSiteById(db, "recACME"))!;
    };
    return { db, write };
  }

  it("more live alerts than the persisted list holds: the count stays put night after night", async () => {
    const { db, write } = await freshDb();
    const alerts = Array.from({ length: 30 }, (_, i) => ({
      ...alert("low"),
      package: `pkg${i}`,
      summary: `advisory ${i}`,
      ghsaId: `GHSA-aaaa-bbbb-${1000 + i}`,
    }));
    const nights = [];
    for (let n = 0; n < 3; n++)
      nights.push((await write(await partialRun(alerts))).securityVulnsLow);
    await db.destroy();
    expect(nights).toEqual([30, 30, 30]);
  });

  async function mergedThenPartial(
    pnpmAdvisory: Record<string, unknown>,
    dependabot: DependabotAlert,
  ) {
    const { db, write } = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), "security-partial-"));
    writeFileSync(join(dir, "pnpm-lock.yaml"), TWO_DOCUMENTS);
    const pnpmOut = JSON.stringify({
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
      advisories: { "1": pnpmAdvisory },
    });
    const merged = await write(
      await securityAudit({
        site: { path: dir, gitRepo: "reddoorla/acme" },
        dependabotDeps: { listAlerts: async () => [dependabot] },
        spawn: async (cmd) => {
          if (cmd !== "pnpm") throw new Error(`ENOENT: ${cmd}`);
          return { code: 1, stdout: pnpmOut, stderr: "" };
        },
      }),
    );
    const partial = await write(await partialRun([dependabot]));
    await db.destroy();
    return { merged, partial };
  }
  const pkg1 = (over: Partial<DependabotAlert>): DependabotAlert => ({
    ...alert("high"),
    package: "pkg1",
    summary: "GitHub words it",
    manifestPath: "pnpm-lock.yaml",
    ...over,
  });

  it("an advisory both sources name by GHSA alone, under different titles, counts once on a partial night", async () => {
    const { merged, partial } = await mergedThenPartial(
      {
        module_name: "pkg1",
        severity: "high",
        title: "pnpm words it",
        cves: [],
        github_advisory_id: "GHSA-aaaa-bbbb-1001",
      },
      pkg1({ ghsaId: "GHSA-aaaa-bbbb-1001", cves: [] }),
    );
    expect(merged.securityVulnsHigh).toBe(1);
    expect(partial.securityVulnsHigh).toBe(1);
    expect(partial.securityAdvisories).toHaveLength(1);
  });

  it("two partial nights do not lose an advisory the lockfile audit found when Dependabot drops it", async () => {
    const pkg1Alert = pkg1({ ghsaId: "GHSA-aaaa-bbbb-1001", cves: [] });
    const { db, write } = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), "security-partial-"));
    writeFileSync(join(dir, "pnpm-lock.yaml"), TWO_DOCUMENTS);
    const pnpmOut = JSON.stringify({
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
      advisories: {
        "1": {
          module_name: "pkg1",
          severity: "high",
          title: "pnpm words it",
          cves: [],
          github_advisory_id: "GHSA-aaaa-bbbb-1001",
        },
      },
    });
    await write(
      await securityAudit({
        site: { path: dir, gitRepo: "reddoorla/acme" },
        dependabotDeps: { listAlerts: async () => [pkg1Alert, alert("low")] },
        spawn: async (cmd) => {
          if (cmd !== "pnpm") throw new Error(`ENOENT: ${cmd}`);
          return { code: 1, stdout: pnpmOut, stderr: "" };
        },
      }),
    );
    const highs = [];
    highs.push((await write(await partialRun([pkg1Alert, alert("low")]))).securityVulnsHigh);
    highs.push((await write(await partialRun([alert("low")]))).securityVulnsHigh);
    await db.destroy();
    expect(highs).toEqual([1, 1]);
  });

  // Review round 7: a partial night must read as the full night before it did, because both
  // now go through mergeAudits. Each case runs a full night, then two partial nights.
  async function fullThenPartials(
    pnpmAdvisories: Record<string, unknown>[],
    alerts: DependabotAlert[],
    packageJson?: object,
  ) {
    const { db, write } = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), "security-partial-"));
    writeFileSync(join(dir, "pnpm-lock.yaml"), TWO_DOCUMENTS);
    if (packageJson) writeFileSync(join(dir, "package.json"), JSON.stringify(packageJson));
    const tally = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
    for (const a of pnpmAdvisories) tally[a["severity"] as keyof typeof tally] += 1;
    const pnpmOut = JSON.stringify({
      metadata: { vulnerabilities: tally },
      advisories: Object.fromEntries(pnpmAdvisories.map((a, i) => [String(i + 1), a])),
    });
    const full = await write(
      await securityAudit({
        site: { path: dir, gitRepo: "reddoorla/acme" },
        dependabotDeps: { listAlerts: async () => alerts },
        spawn: async (cmd) => {
          if (cmd !== "pnpm") throw new Error(`ENOENT: ${cmd}`);
          return { code: 1, stdout: pnpmOut, stderr: "" };
        },
      }),
    );
    const first = await write(await partialRun(alerts));
    const second = await write(await partialRun(alerts));
    await db.destroy();
    const view = (r: typeof full) => ({
      counts: [
        r.securityVulnsCritical,
        r.securityVulnsHigh,
        r.securityVulnsModerate,
        r.securityVulnsLow,
      ],
      advisories: (r.securityAdvisories ?? [])
        .map((a) => `${a.module}:${a.severity}:${a.relationship ?? "-"}`)
        .sort(),
    });
    return { full: view(full), first: view(first), second: view(second) };
  }
  const sharpGhsa = { ghsaId: "GHSA-aaaa-bbbb-1001", cves: [] as string[] };

  it("a partial night merges relationship as the full night does (round 7)", async () => {
    const r = await fullThenPartials(
      [
        {
          module_name: "sharp",
          severity: "high",
          title: "pnpm",
          github_advisory_id: "GHSA-aaaa-bbbb-1001",
        },
      ],
      [{ ...pkg1(sharpGhsa), package: "sharp", relationship: "transitive" }],
    );
    expect(r.first).toEqual(r.full);
    expect(r.second).toEqual(r.full);
  });

  it("a second manifest's direct alert is not lost on a partial night (round 7)", async () => {
    const r = await fullThenPartials(
      [
        {
          module_name: "sharp",
          severity: "high",
          title: "pnpm",
          github_advisory_id: "GHSA-aaaa-bbbb-1001",
        },
      ],
      [
        {
          ...pkg1(sharpGhsa),
          package: "sharp",
          relationship: "transitive",
          manifestPath: "a/package.json",
        },
        {
          ...pkg1(sharpGhsa),
          package: "sharp",
          severity: "moderate",
          relationship: "direct",
          manifestPath: "b/package.json",
        },
      ],
    );
    expect(r.first).toEqual(r.full);
    expect(r.second).toEqual(r.full);
  });

  it("two stored pnpm advisories one alert matches both stay (round 7)", async () => {
    const r = await fullThenPartials(
      [
        {
          module_name: "sharp",
          severity: "high",
          title: "pnpm G",
          github_advisory_id: "GHSA-aaaa-bbbb-1001",
        },
        { module_name: "sharp", severity: "moderate", title: "pnpm legacy", cves: ["CVE-2026-9"] },
      ],
      [{ ...pkg1({ ghsaId: "GHSA-aaaa-bbbb-1001", cves: ["CVE-2026-9"] }), package: "sharp" }],
    );
    expect(r.first).toEqual(r.full);
    expect(r.second).toEqual(r.full);
  });

  it("a Dependabot-only advisory on two manifests counts once on every night (round 7)", async () => {
    const lodash = { ...pkg1({ ghsaId: "GHSA-cccc-dddd-2002", cves: [] }), package: "lodash" };
    const r = await fullThenPartials(
      [],
      [
        { ...lodash, manifestPath: "a/package.json" },
        { ...lodash, manifestPath: "b/package.json" },
      ],
    );
    expect(r.first).toEqual(r.full);
    expect(r.second).toEqual(r.full);
  });

  it("a pnpm advisory's own transitive relationship carries through a partial night (round 7)", async () => {
    // package.json names no sharp, so pnpm's entry is transitive; Dependabot agrees.
    const r = await fullThenPartials(
      [
        {
          module_name: "sharp",
          severity: "high",
          title: "pnpm",
          github_advisory_id: "GHSA-aaaa-bbbb-1001",
        },
      ],
      [{ ...pkg1(sharpGhsa), package: "sharp", relationship: "transitive" }],
      { dependencies: { svelte: "^5.0.0" } },
    );
    expect(r.full.advisories).toEqual(["sharp:high:transitive"]);
    expect(r.first).toEqual(r.full);
    expect(r.second).toEqual(r.full);
  });
});
