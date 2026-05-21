import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { lintAudit } from "../../src/audits/lint.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "../fixtures");

describe("audits/lint", () => {
  it("pristine-starter passes", async () => {
    const result = await lintAudit({
      site: { path: resolve(fixtures, "pristine-starter") },
    });
    expect(result.audit).toBe("lint");
    expect(result.status).toBe("pass");
  });

  it("drifted-configs fails on the unused-var violation", async () => {
    const result = await lintAudit({
      site: { path: resolve(fixtures, "drifted-configs") },
    });
    expect(result.status).toBe("fail");
    const details = result.details as { eslintErrors: number; prettierUnformatted: string[] };
    expect(details.eslintErrors).toBeGreaterThan(0);
  });

  it("skips with a clear summary when no eslint.config.js exists", async () => {
    const result = await lintAudit({
      site: { path: resolve(fixtures, "pre-svelte5") },
    });
    expect(result.status).toBe("skip");
    expect(result.summary).toMatch(/no eslint config/i);
  });
});
