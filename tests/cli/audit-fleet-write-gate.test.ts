/**
 * #1605, end to end through `runAuditCommand`: the write gate's `total` is checked
 * against the sites the run resolved BEFORE prep, so a site prep drops is named as
 * missing rather than vanishing from the count. Every other test of the gate calls
 * `writeFleetAudits` or `runFleetWriteBack` directly; this one pins the call site
 * that hands them the roster, which nothing else would notice being dropped.
 *
 * No network: the fleet is a local JSON inventory of two sites, one checkout with no
 * `test:smoke` script (not applicable) and one whose path does not exist and has no
 * repo to clone (dropped at prep). The write-back reads a scratch migrated `file:`
 * database, never a `TURSO_*` url from the environment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/client.js";
import { mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { runAuditCommand } from "../../src/cli/commands/audit.js";

const NOW = "2026-10-21T06:43:00.000Z";

let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "audit-fleet-gate-"));
  const url = `file:${join(dir, "fleet.db")}`;
  const db = await openDb({ url });
  try {
    for (const [id, name] of [
      ["recAlpha", "Alpha"],
      ["recBeta", "Beta"],
    ] as const) {
      await mirrorSiteInsert(db, { id, fields: { Name: name, Status: "maintained" } }, NOW);
    }
  } finally {
    await db.destroy();
  }
  vi.stubEnv("TURSO_DATABASE_URL", url);
  vi.stubEnv("TURSO_AUTH_TOKEN", "");

  const alpha = join(dir, "alpha");
  mkdirSync(alpha);
  writeFileSync(join(alpha, "package.json"), JSON.stringify({ name: "alpha", scripts: {} }));
  // A JSON inventory, not a generated module: no code is built from the temp paths.
  writeFileSync(
    join(dir, "fleet.json"),
    JSON.stringify([
      { name: "alpha", path: alpha },
      { name: "beta", path: join(dir, "beta-absent") },
    ]),
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("audit --fleet --write-back checks total against the resolved roster", () => {
  it("names a site dropped at prep as missing, and counts the not-applicable site", async () => {
    const { output } = await runAuditCommand(undefined, {
      fleet: join(dir, "fleet.json"),
      only: "smoke",
      writeBack: true,
      workdir: join(dir, "work"),
      cwd: dir,
    });
    expect(output).toContain("⚠ 1 site(s) skipped (could not prepare): beta");
    expect(output).toContain("· 1 site(s) not applicable: alpha");
    // The CLI hands the formatter each result whole: the n/a site is not unmeasured.
    expect(output).toContain("FLEET_SMOKE_UNMEASURED count=0 sites=");
    expect(output).toContain("⚠ 1 site(s) on the roster never reached write-back: beta");
    expect(output).toMatch(
      /FLEET_WRITE_SUMMARY wrote=0 failed=0 total=2 .* na=1 missing=1 kept=0$/m,
    );
    // Nothing was written, so the gate is red whatever else holds.
    expect(output).toContain("\nFLEET_WRITE_GATE verdict=red");
  });
});
