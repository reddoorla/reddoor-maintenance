import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { runAudits, runAuditsAcross } from "../../src/audits/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "../fixtures");

describe("runAudits", () => {
  it("runs only the deps audit when `which` is restricted", async () => {
    const results = await runAudits({ path: resolve(fixtures, "pristine-starter") }, ["deps"]);
    expect(results).toHaveLength(1);
    expect(results[0]?.audit).toBe("deps");
  });

  it("runs all audits when `which` is undefined", async () => {
    const results = await runAudits({ path: resolve(fixtures, "pristine-starter") });
    const names = results.map((r) => r.audit).sort();
    expect(names).toEqual(["a11y", "deps", "lighthouse", "lint", "security"]);
  });

  it("rejects an unknown audit name with a usage error", async () => {
    await expect(() =>
      runAudits({ path: resolve(fixtures, "pristine-starter") }, ["nope" as never]),
    ).rejects.toThrow(/unknown audit/i);
  });
});

describe("runAuditsAcross", () => {
  it("aggregates results from multiple sites", async () => {
    const results = await runAuditsAcross(
      [
        { path: resolve(fixtures, "pristine-starter"), name: "a" },
        { path: resolve(fixtures, "drifted-configs"), name: "b" },
      ],
      ["deps"],
    );
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.site).sort()).toEqual(["a", "b"]);
  });
});
