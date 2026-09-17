/**
 * #646 step 4: `--fleet turso` reads the fleet roster from the database, and the
 * old `--fleet airtable` keyword is a deprecated ALIAS for it — it reads Turso too,
 * and says so on stderr every time.
 *
 * Both are driven against a temp `file:` db through the `openDb` seam. The
 * `AIRTABLE_*` variables are stubbed EMPTY: a keyword that still reached for
 * Airtable would throw "AIRTABLE_PAT not set" rather than quietly succeed, and
 * no real base is ever reachable from here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/client.js";
import { insertSiteRows, mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { mintSiteId } from "../../src/fleet/site-id.js";
import { resolveSites } from "../../src/cli/fleet/resolve-sites.js";

let dir: string;
let url: string;
const NATIVE = mintSiteId(Date.parse("2026-09-17T00:00:00.000Z"));

beforeEach(async () => {
  vi.stubEnv("AIRTABLE_PAT", "");
  vi.stubEnv("AIRTABLE_BASE_ID", "");
  dir = mkdtempSync(join(tmpdir(), "resolve-sites-turso-"));
  url = `file:${join(dir, "fleet.db")}`;
  const db = await openDb({ url });
  try {
    await mirrorSiteInsert(
      db,
      {
        id: "recLegacy1",
        fields: { Name: "Legacy Co", url: "https://legacy.example.com", Status: "maintained" },
      },
      "2026-09-17T00:00:00.000Z",
    );
    await insertSiteRows(
      db,
      {
        id: NATIVE,
        slug: "native-co",
        name: "Native Co",
        status: "maintained",
        url: "https://native.example.com",
        pointOfContact: null,
        gitRepo: "reddoorla/native-co",
      },
      "2026-09-17T00:00:00.000Z",
    );
  } finally {
    await db.destroy();
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("resolveSites --fleet turso", () => {
  it("returns the Turso roster, including a site_<ULID> site that has no Airtable record", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sites = await resolveSites({
      fleet: "turso",
      workdir: "/w",
      cwd: "/nonexistent",
      openDb: () => openDb({ url }),
    });
    expect(sites.map((s) => s.name).sort()).toEqual(["legacy-co", "native-co"]);
    expect(sites.find((s) => s.name === "native-co")?.meta?.siteId).toBe(NATIVE);
    expect(warn).not.toHaveBeenCalled();
  });

  it("--fleet airtable is a deprecated alias: the SAME Turso roster, plus a warning naming the store read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const viaAlias = await resolveSites({
      fleet: "airtable",
      workdir: "/w",
      cwd: "/nonexistent",
      openDb: () => openDb({ url }),
    });
    const viaTurso = await resolveSites({
      fleet: "turso",
      workdir: "/w",
      cwd: "/nonexistent",
      openDb: () => openDb({ url }),
    });
    expect(viaAlias).toEqual(viaTurso);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(
      /--fleet airtable is deprecated.*read from Turso.*--fleet turso/,
    );
  });

  it("still refuses a positional site combined with the keyword", async () => {
    await expect(
      resolveSites({
        site: "x",
        fleet: "turso",
        cwd: "/nonexistent",
        openDb: () => openDb({ url }),
      }),
    ).rejects.toThrow(/cannot combine/);
  });
});
