/**
 * #646 step 4: the batch jobs' roster is Turso's, so a `site_<ULID>` site — which
 * has NO Airtable record since step 3 (#856) — is finally visible to them.
 *
 * The other tests of these seams inject a roster built from a fake Airtable base,
 * because the writes they pin are Airtable SHADOW writes. This file drives the real
 * `readFleetRoster` against a REAL migrated libSQL database in a temp `file:` —
 * never `:memory:` and never a `TURSO_*` url from the environment — and includes
 * the CONTROL that fails: the same run against the roster Airtable could return.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../src/db/client.js";
import { mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { readFleetRoster } from "../../src/fleet/roster.js";
import { mintSiteId } from "../../src/fleet/site-id.js";
import { runFleetWriteBack } from "../../src/cli/commands/audit.js";
import { runRenovateDispatchCommand } from "../../src/cli/commands/renovate-dispatch.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";
import type { AuditResult } from "../../src/types.js";

const NOW = "2026-09-17T00:00:00.000Z";
const NATIVE = mintSiteId(Date.parse(NOW));

let dir: string;
let url: string;

/** The two shapes that coexist permanently (operator decision, 2026-09-17): an
 *  imported `rec…` site and a Turso-native `site_<ULID>` one. Both go in through
 *  the importer's own mapper, which is how every row in `sites` is written. */
async function seed(): Promise<void> {
  const db = await openDb({ url });
  try {
    await mirrorSiteInsert(
      db,
      {
        id: "recLegacy",
        fields: {
          Name: "Legacy Co",
          Status: "maintained",
          url: "https://legacy.example.com",
          "Git repo": "reddoorla/legacy-co",
        },
      },
      NOW,
    );
    await mirrorSiteInsert(
      db,
      {
        id: NATIVE,
        fields: {
          Name: "Native Co",
          Status: "maintained",
          url: "https://native.example.com",
          "Git repo": "reddoorla/native-co",
          "Security Vulns Critical": 0,
          "Security Vulns High": 0,
          "Security Auto-Fix Attempts": 7,
        },
      },
      NOW,
    );
  } finally {
    await db.destroy();
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "fleet-roster-"));
  url = `file:${join(dir, "fleet.db")}`;
  await seed();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const roster = () => readFleetRoster(() => openDb({ url }));

function lhResult(slug: string): AuditResult {
  return {
    audit: "lighthouse",
    site: slug,
    status: "pass",
    summary: "",
    details: {
      summary: { performance: 0.9, accessibility: 1, "best-practices": 0.78, seo: 0.92 },
    },
  };
}

describe("readFleetRoster", () => {
  it("returns every site — rec ids and site_<ULID> ids alike — and closes the connection it opened", async () => {
    let opened: Db | undefined;
    const rows = await readFleetRoster(async () => {
      opened = await openDb({ url });
      return opened;
    });
    expect(rows.map((r) => r.id).sort()).toEqual([NATIVE, "recLegacy"].sort());
    expect(rows.find((r) => r.id === NATIVE)?.gitRepo).toBe("reddoorla/native-co");
    // The roster is a snapshot, not a handle: the db it opened is destroyed.
    await expect(opened!.selectFrom("sites").selectAll().execute()).rejects.toThrow();
  });
});

describe("the audit fleet write-back, driven by the Turso roster", () => {
  it("writes back a site_<ULID> site: Turso gets the fields, the Airtable shadow is skipped", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const base = makeFakeBase({ Websites: [] }); // Airtable has no such record — by design
    const mirrored: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
    const res = await runFleetWriteBack({
      results: [lhResult("native-co")],
      which: ["lighthouse"],
      deps: {
        openBase: () => base,
        roster,
        makeMirror: async () => async (siteId, fields) => {
          mirrored.push({ siteId, fields });
          return true;
        },
        recordEvents: async () => {},
        strict: true,
      },
    });
    expect(res.anyFailed).toBe(false);
    expect(res.summary).toContain("FLEET_WRITE_SUMMARY wrote=1 failed=0 total=1 mirrored=1");
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]!.siteId).toBe(NATIVE);
    expect(mirrored[0]!.fields).toMatchObject({ pScore: 90 });
    // The shadow write is skipped by id shape (step 3), and says so.
    expect(base.__calls.filter((c) => c.kind === "update")).toEqual([]);
    expect(log.mock.calls.flat().join("\n")).toContain(
      `AIRTABLE_SHADOW skipped=non-rec-id writer=updateAuditFields id=${NATIVE}`,
    );
  });

  it("CONTROL — the roster Airtable could return misses that site entirely, and the write-back fails", async () => {
    const base = makeFakeBase({ Websites: [] });
    const res = await runFleetWriteBack({
      results: [lhResult("native-co")],
      which: ["lighthouse"],
      deps: {
        // Exactly what `listWebsites` returns for a fleet whose only site was
        // created in Turso: nothing. This is the state step 4 exists to end.
        roster: async () => (await roster()).filter((r) => r.id.startsWith("rec")),
        openBase: () => base,
        makeMirror: async () => async () => true,
        recordEvents: async () => {},
        strict: true,
      },
    });
    expect(res.anyFailed).toBe(true);
    expect(res.summary).toContain('No Websites row matched slug "native-co"');
  });
});

describe("renovate-dispatch, driven by the Turso roster", () => {
  it("clears a site_<ULID> site's stale auto-fix counter: Turso written, Airtable shadow skipped", async () => {
    vi.stubEnv("GH_TOKEN", "tok");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const base = makeFakeBase({ Websites: [] });
    const mirrored: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const r = await runRenovateDispatchCommand({
      fleet: true,
      base,
      roster,
      siteMirror: {
        created: async () => {},
        hasRow: async () => true,
        health: async (id, fields) => {
          mirrored.push({ id, fields });
        },
        site: async () => {},
      },
    });
    expect(r.code).toBe(0);
    // No target has vulns, so no GitHub client is constructed and no network is
    // touched; the counter bookkeeping is the whole exercise.
    expect(r.output).toContain("RENOVATE_DISPATCH_SUMMARY dispatched=0 skipped=0 failed=0");
    expect(r.output).toContain("AUTO_FIX_ATTEMPTS_SUMMARY written=1 failed=0");
    expect(mirrored).toEqual([{ id: NATIVE, fields: { "Security Auto-Fix Attempts": 0 } }]);
    expect(base.__calls.filter((c) => c.kind === "update")).toEqual([]);
    expect(log.mock.calls.flat().join("\n")).toContain(
      `AIRTABLE_SHADOW skipped=non-rec-id writer=updateAutoFixAttempts id=${NATIVE}`,
    );
  });
});
