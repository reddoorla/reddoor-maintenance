/**
 * A SHRINKING ROSTER READ AS A CLEAN FLEET (#1607).
 *
 * `--fleet turso` visits only rows whose Status is in the vocabulary. A row on a
 * retired name (`maintenance`, the restored-backup case `site-status.ts` names)
 * was dropped before the sweep began, so it was neither checked nor counted: with
 * 3 of 4 rows on `maintenance`, including the drifted repo, the weekly drift run
 * printed `drifted=0 clean=1 skipped=0 total=1` and stayed green. Such a row is
 * now a SKIPPED line, so it counts toward `total`, keeps a drift issue open, and
 * past half the roster reds the run like any other unchecked repo.
 *
 * Driven end to end: a `file:` database migrated by the real migrations, the real
 * `resolveSites` → `fromTursoDb` → `selectFleetSites` path, and pre-made
 * checkouts so nothing is cloned.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../../src/db/client.js";
import { mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { runSyncConfigsCommand } from "../../src/cli/commands/sync-configs.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLEAN_FIXTURE = resolve(here, "../fixtures/sync-clean");
const DRIFT_FIXTURE = resolve(here, "../fixtures/sync-drift");
const AT = "2026-10-21T00:00:00.000Z";

let dir: string;
let workdir: string;

const machine = (out: string) =>
  out.split("\n").filter((l) => /^(DRIFT|CLEAN|SKIPPED|SYNC_CONFIGS_DRIFT) /.test(l));

/** A checkout at `{workdir}/{slug}` whose origin is the row's repo, so the fleet
 *  prep reuses it instead of cloning. */
async function checkout(slug: string, repo: string, fixture: string): Promise<void> {
  const path = join(workdir, slug);
  await cp(fixture, path, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: path, stdio: "ignore" });
  git("init", "-q", "--initial-branch=main");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@reddoor.local", "commit", "-qm", "initial");
  git("remote", "add", "origin", `https://github.com/${repo}.git`);
}

async function roster(
  rows: { name: string; status: string; repo: string; url?: string }[],
): Promise<void> {
  const db = await openDb({ url: `file:${join(dir, "fleet.db")}` });
  try {
    for (const [i, r] of rows.entries()) {
      await mirrorSiteInsert(
        db,
        {
          id: `rec${i}`,
          fields: {
            Name: r.name,
            Status: r.status,
            url: r.url ?? `https://${r.repo.split("/")[1]}.example.com`,
            "Git repo": r.repo,
          },
        },
        AT,
      );
    }
  } finally {
    await db.destroy();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sync-roster-status-"));
  workdir = join(dir, "work");
  vi.stubEnv("TURSO_DATABASE_URL", `file:${join(dir, "fleet.db")}`);
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("sync-configs --fleet turso --dry — rows the roster drops for their status", () => {
  it("the pass control: an all-maintained roster is unchanged", async () => {
    await roster([{ name: "Clean Co", status: "maintained", repo: "reddoorla/clean-co" }]);
    await checkout("clean-co", "reddoorla/clean-co", CLEAN_FIXTURE);
    const { output, code } = await runSyncConfigsCommand(undefined, {
      dry: true,
      fleet: "turso",
      workdir,
    });
    expect(code).toBe(0);
    expect(machine(output)).toEqual([
      "CLEAN reddoorla/clean-co",
      "SYNC_CONFIGS_DRIFT drifted=0 clean=1 skipped=0 total=1",
    ]);
  });

  it("the issue's input: 3 of 4 rows on the retired `maintenance`, the drifted repo among them", async () => {
    await roster([
      { name: "Clean Co", status: "maintained", repo: "reddoorla/clean-co" },
      { name: "Drift Co", status: "maintenance", repo: "reddoorla/drift-co" },
      { name: "Other Co", status: "maintenance", repo: "reddoorla/other-co" },
      { name: "Third Co", status: "maintenance", repo: "reddoorla/third-co" },
    ]);
    await checkout("clean-co", "reddoorla/clean-co", CLEAN_FIXTURE);
    await checkout("drift-co", "reddoorla/drift-co", DRIFT_FIXTURE);
    const { output } = await runSyncConfigsCommand(undefined, {
      dry: true,
      fleet: "turso",
      workdir,
    });
    const lines = machine(output);
    expect(lines).toContain("SYNC_CONFIGS_DRIFT drifted=0 clean=1 skipped=3 total=4");
    for (const repo of ["reddoorla/drift-co", "reddoorla/other-co", "reddoorla/third-co"]) {
      const line = lines.find((l) => l.startsWith(`SKIPPED ${repo} `));
      expect(line, repo).toBeDefined();
      expect(line).toContain('status "maintenance"');
    }
  });

  it("does not count a retired-status row with no url, which the roster would drop anyway", async () => {
    await roster([
      { name: "Clean Co", status: "maintained", repo: "reddoorla/clean-co" },
      { name: "Bare Co", status: "maintenance", repo: "reddoorla/bare-co", url: "" },
    ]);
    await checkout("clean-co", "reddoorla/clean-co", CLEAN_FIXTURE);
    const { output } = await runSyncConfigsCommand(undefined, {
      dry: true,
      fleet: "turso",
      workdir,
    });
    expect(machine(output)).toEqual([
      "CLEAN reddoorla/clean-co",
      "SYNC_CONFIGS_DRIFT drifted=0 clean=1 skipped=0 total=1",
    ]);
  });

  it("does not count rows the roster leaves out on purpose", async () => {
    // Archived, pre-launch and external rows are outside the drift fleet by
    // design; only a Status the vocabulary does not know is an anomaly.
    await roster([
      { name: "Clean Co", status: "maintained", repo: "reddoorla/clean-co" },
      { name: "Gone Co", status: "archived", repo: "reddoorla/gone-co" },
      { name: "New Co", status: "building", repo: "reddoorla/new-co" },
      { name: "Their Co", status: "external", repo: "reddoorla/their-co" },
    ]);
    await checkout("clean-co", "reddoorla/clean-co", CLEAN_FIXTURE);
    const { output } = await runSyncConfigsCommand(undefined, {
      dry: true,
      fleet: "turso",
      workdir,
    });
    expect(machine(output)).toEqual([
      "CLEAN reddoorla/clean-co",
      "SYNC_CONFIGS_DRIFT drifted=0 clean=1 skipped=0 total=1",
    ]);
  });
});
