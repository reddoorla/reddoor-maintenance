import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { check as prettierCheck } from "prettier";
import { lintAudit } from "../../src/audits/lint.js";

// Its own file: typescript-eslint caches one tsconfig root per process and
// fails a second fixture linted in the same worker ("multiple candidate
// TSConfigRootDirs"), so this cannot share a file with lint.test.ts.
const fixture = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/prettierignored-generated",
);

describe("audits/lint and the site's .prettierignore", () => {
  it("does not count a file the site's .prettierignore lists as unformatted", async () => {
    const result = await lintAudit({ site: { path: fixture } });
    const details = result.details as { prettierUnformatted: string[] };
    expect(details.prettierUnformatted).toEqual([]);
    expect(result.status).toBe("pass");
  });

  it("the ignored fixture file really is unformatted, so the case above can fail", async () => {
    const file = resolve(fixture, "prismicio-types.d.ts");
    const ok = await prettierCheck(await readFile(file, "utf-8"), { filepath: file });
    expect(ok).toBe(false);
  });
});
