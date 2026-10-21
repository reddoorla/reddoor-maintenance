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

async function siteAfterPartialRun(seed: Record<string, unknown>, severity: "moderate" | "low") {
  const db = await openDb({ url: ":memory:" });
  const now = new Date();
  await mirrorSiteInsert(
    db,
    { id: "recACME", fields: { Name: "Acme", Status: "maintained", ...seed } },
    now.toISOString(),
  );
  const before = (await getSiteById(db, "recACME"))!;
  const dir = mkdtempSync(join(tmpdir(), "security-partial-"));
  writeFileSync(join(dir, "pnpm-lock.yaml"), TWO_DOCUMENTS);
  const result = await securityAudit({
    site: { path: dir, gitRepo: "reddoorla/acme" },
    dependabotDeps: { listAlerts: async () => [alert(severity)] },
    spawn: async (cmd) => {
      throw new Error(`ENOENT: ${cmd}`);
    },
  });
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
});
