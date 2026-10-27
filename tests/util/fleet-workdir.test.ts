import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fleetWorkdir } from "../../src/util/fleet-workdir.js";

describe("fleetWorkdir", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it("uses ~/.reddoor-maint/sites when HOME is set", () => {
    process.env.HOME = "/home/operator";
    expect(fleetWorkdir()).toBe(join("/home/operator", ".reddoor-maint", "sites"));
  });

  it("falls back to a tmpdir-based path when HOME is unset (cron/minimal CI)", () => {
    delete process.env.HOME;
    const wd = fleetWorkdir();
    expect(wd).toBe(join(tmpdir(), ".reddoor-maint", "sites"));
    // Never a filesystem-root path like /.reddoor-maint/sites.
    expect(wd.startsWith("/.reddoor-maint")).toBe(false);
  });

  it("falls back to tmpdir when HOME is empty/whitespace", () => {
    process.env.HOME = "   ";
    const wd = fleetWorkdir();
    expect(wd).toBe(join(tmpdir(), ".reddoor-maint", "sites"));
    expect(wd.startsWith("/.reddoor-maint")).toBe(false);
  });
});
