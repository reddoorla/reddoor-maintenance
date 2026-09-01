import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mirrorWrite, TURSO_IS_AUTHORITATIVE } from "../../src/db/freeze.js";

/**
 * #612 / MED-9 of the 2026-08-26 review: nothing enforced that a writer honours
 * the freeze switch, and the writers that FORGET the parameter are precisely the
 * ones a search for the constant cannot find.
 *
 * It had already happened four times. The Netlify request handlers do not use the
 * mirror factories — they call `mirrorReportPatch` / `mirrorSiteField` directly
 * inside a hand-rolled `try { … } catch { console.error }`, each with a comment
 * saying "the sync converges it". At the freeze there is no sync, so each of
 * those is silent, permanent divergence between the two stores.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mirrorWrite — both sides of the switch", () => {
  it("swallows a failure and logs while Airtable is authoritative", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      mirrorWrite("probe", () => Promise.reject(new Error("SQLITE_BUSY")), false),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledOnce();
    expect(String(err.mock.calls[0]?.[0])).toContain("sync will converge");
  });

  it("RAISES the same failure once Turso is authoritative", async () => {
    // The inversion the freeze is: identical input, opposite obligation.
    await expect(
      mirrorWrite("probe", () => Promise.reject(new Error("SQLITE_BUSY")), true),
    ).rejects.toThrow(/NOT recoverable by the hourly sync/);
  });

  it("says which write was lost, not just that one was", async () => {
    await expect(
      mirrorWrite("approve-report", () => Promise.reject(new Error("boom")), true),
    ).rejects.toThrow(/\[approve-report\]/);
  });

  it("is transparent on success in BOTH worlds", async () => {
    // The positive control. Without it every assertion above is satisfied by a
    // helper that simply always throws, or always swallows.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const strict of [false, true]) {
      const run = vi.fn(() => Promise.resolve());
      await expect(mirrorWrite("probe", run, strict)).resolves.toBeUndefined();
      expect(run).toHaveBeenCalledOnce();
    }
    expect(err).not.toHaveBeenCalled();
  });

  it("defaults to the shipped constant", () => {
    // The ONE assertion on the shipped value; everything else injects.
    // `true` since 2026-08-31: the freeze — Turso is authoritative.
    expect(TURSO_IS_AUTHORITATIVE).toBe(true);
  });
});

/**
 * The lockstep gate. Every place that writes to Turso as a shadow of an Airtable
 * write has to route through `mirrorWrite`, so the freeze reaches it. A new
 * handler that hand-rolls the swallow fails here rather than being discovered
 * after the flip.
 */
describe("every mirroring call site is freeze-aware", () => {
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
   * mirror factories implement the same strict/loose split internally and are
   * covered by `freeze-semantics.test.ts`.
   */
  const EXEMPT: Record<string, string> = {
    "src/db/fleet-state.ts": "defines the mirror writers; has no error policy of its own",
    "src/db/site-mirror.ts": "a mirror FACTORY — implements the strict/loose split itself",
    "src/audits/health-mirror.ts": "a mirror FACTORY — implements the strict/loose split itself",
    "src/reports/report-mirror.ts": "a mirror FACTORY — implements the strict/loose split itself",
  };

  it("every file that mirrors directly either uses mirrorWrite or is exempted", () => {
    const offenders = mirroringFiles().filter(
      (f) =>
        !(f in EXEMPT) && !/\bmirrorWrite\s*\(/.test(fs.readFileSync(path.join(ROOT, f), "utf8")),
    );
    expect(
      offenders,
      "mirrors to Turso without honouring the freeze switch — wrap the write in mirrorWrite()",
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
