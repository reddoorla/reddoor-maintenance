import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mirrorWrite } from "../../src/db/mirror-write.js";

/**
 * #612 / MED-9 of the 2026-08-26 review: the Netlify request handlers do not use
 * the mirror factories — they call `mirrorReportPatch` / `mirrorSiteField`
 * directly, and four of them once wrapped the call in a hand-rolled
 * `try { … } catch { console.error }`. With Turso the only store, each of those
 * was a lost write whose only trace was a log line.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mirrorWrite", () => {
  it("raises a failed write and names it", async () => {
    await expect(
      mirrorWrite("approve-report", () => Promise.reject(new Error("SQLITE_BUSY"))),
    ).rejects.toThrow(/\[approve-report\] Turso write failed: Error: SQLITE_BUSY/);
  });

  it("keeps the underlying error as the cause", async () => {
    const boom = new Error("boom");
    await expect(mirrorWrite("probe", () => Promise.reject(boom))).rejects.toMatchObject({
      cause: boom,
    });
  });

  it("#647: a write that matched no row is `missed`, logged and raised", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(mirrorWrite("stamp-sent recX", () => Promise.resolve(false))).rejects.toThrow(
      /\[stamp-sent recX\].*no such row in Turso/,
    );
    expect(err).toHaveBeenCalledOnce();
    expect(String(err.mock.calls[0]?.[0])).toContain("mirrored=missed");
  });

  it("is transparent on success, for a counted and an uncounted writer", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const counted = vi.fn(() => Promise.resolve(true));
    const uncounted = vi.fn(() => Promise.resolve());
    await expect(mirrorWrite("probe", counted)).resolves.toBeUndefined();
    await expect(mirrorWrite("probe", uncounted)).resolves.toBeUndefined();
    expect(counted).toHaveBeenCalledOnce();
    expect(uncounted).toHaveBeenCalledOnce();
    expect(err).not.toHaveBeenCalled();
  });
});

/**
 * The lockstep gate. Every place that calls a Turso writer directly has to route
 * through `mirrorWrite`, so a failure throws. A new handler that hand-rolls the
 * swallow fails here rather than being discovered in production.
 */
describe("every direct mirroring call site routes through mirrorWrite", () => {
  /** Files that call a `mirror*` writer directly (not via a mirror factory). */
  function mirroringFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          walk(p);
          continue;
        }
        if (!/\.(ts|mts)$/.test(e.name)) continue;
        const src = fs.readFileSync(p, "utf8");
        // A direct call to one of fleet-state's mirror writers.
        if (
          /\bmirror(ReportPatch|SiteField|SiteFields|HealthFields|ScheduleFields)\s*\(/.test(src)
        ) {
          out.push(path.relative(ROOT, p));
        }
      }
    };
    walk(path.join(ROOT, "netlify"));
    walk(path.join(ROOT, "src"));
    return out.sort();
  }

  /**
   * Call sites allowed NOT to route through `mirrorWrite`, each with a reason a
   * reviewer can veto. `fleet-state.ts` defines the writers themselves; the
   * mirror factories raise failures internally and are covered by
   * `mirror-factories.test.ts`.
   */
  const EXEMPT: Record<string, string> = {
    "src/db/fleet-state.ts": "defines the mirror writers; has no error policy of its own",
    "src/db/site-mirror.ts": "a mirror FACTORY — raises failures itself",
    "src/audits/health-mirror.ts": "a mirror FACTORY — raises failures itself",
    "src/reports/report-mirror.ts": "a mirror FACTORY — raises failures itself",
  };

  it("every file that mirrors directly either uses mirrorWrite or is exempted", () => {
    const offenders = mirroringFiles().filter(
      (f) =>
        !(f in EXEMPT) && !/\bmirrorWrite\s*\(/.test(fs.readFileSync(path.join(ROOT, f), "utf8")),
    );
    expect(
      offenders,
      "writes to Turso without mirrorWrite — wrap the write so a failure throws",
    ).toEqual([]);
  });

  it("no exemption is stale", () => {
    // Dead permission is how a gate stops meaning anything: an entry that no
    // longer names a real mirroring file silently excuses a future one.
    const actual = new Set(mirroringFiles());
    expect(Object.keys(EXEMPT).filter((f) => !actual.has(f))).toEqual([]);
  });

  it("finds the call sites at all", () => {
    // Vacuity guard: if the detector's pattern ever stops matching, both tests
    // above pass by finding nothing.
    expect(mirroringFiles().length).toBeGreaterThan(3);
  });
});
