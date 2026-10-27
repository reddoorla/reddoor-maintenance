import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { validateCoverage } from "../../../src/blux/validate.js";

/**
 * Plan 4d fidelity gate: the the-pointe catalog render must reproduce the live
 * Blux export's visible text. This is the controller's LOCAL ritual, not CI:
 * it scores a rendered-HTML artifact against the export and self-skips when
 * either is absent (a fork's machine, CI). Produce the artifact by building the
 * starter gate route:
 *
 *   (starter worktree) pnpm run build   →   build/dev/blux-pointe.html
 *
 * then run this test (optionally set POINTE_RENDERED_HTML / POINTE_EXPORT_HTML
 * to override the paths).
 *
 * Recorded result (2026-07-21): 99% — 77/78 runs. The single miss is
 * "email protected", the Cloudflare email-obfuscation placeholder
 * (__cf_email__ / data-cfemail) the EXPORT ships in place of the two leasing
 * emails; the catalog render carries the real addresses (Todd.Doney@cbre.com,
 * Doug.Marlow@cbre.com), so it is strictly MORE faithful, not less. That run is
 * allowlisted below; any OTHER miss is a real content gap and fails the gate.
 */
const EXPORT_HTML =
  process.env.POINTE_EXPORT_HTML ?? `${process.env.HOME}/Desktop/thePointe/index.html`;
const RENDERED_HTML =
  process.env.POINTE_RENDERED_HTML ??
  "/private/tmp/claude-501/-Users-tuckerlemos-Documents-GitHub-reddoor-starter/4e4b6729-02ba-49d5-a7f4-952ed54e3e23/scratchpad/starter-4c/build/dev/blux-pointe.html";

// Export-side artifacts that are NOT real content, so their absence from the
// render is correct (not a fidelity gap). Matched against the missing runs.
const ALLOWED_MISSING = [/^email protected$/i];

const haveArtifacts = existsSync(EXPORT_HTML) && existsSync(RENDERED_HTML);

describe("the-pointe catalog fidelity: text coverage vs the export", () => {
  it.skipIf(!haveArtifacts)(
    "covers the export's visible text (≥95%; misses only Cloudflare-obfuscated content)",
    () => {
      const report = validateCoverage(
        readFileSync(EXPORT_HTML, "utf-8"),
        readFileSync(RENDERED_HTML, "utf-8"),
      );
      const realMisses = report.missing.filter((m) => !ALLOWED_MISSING.some((re) => re.test(m)));
      if (realMisses.length) console.log("UNEXPECTED MISSING RUNS:", realMisses.slice(0, 20));
      expect(realMisses).toEqual([]);
      expect(report.coveragePct).toBeGreaterThanOrEqual(95);
    },
  );
});
