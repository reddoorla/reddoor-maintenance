/**
 * #646 step 4: `--fleet turso` reads the fleet roster from the database, driven
 * here against a temp `file:` db through the `openDb` seam.
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
  it("returns the Turso roster, including a site_<ULID> site", async () => {
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
