import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");
const fixtures = resolve(here, "../fixtures");

const FAKE_LHCI = `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const dir = join(process.cwd(), ".lighthouseci");
mkdirSync(dir, { recursive: true });
for (let i = 0; i < 3; i++) {
  writeFileSync(join(dir, "lhr-" + i + ".json"), JSON.stringify({
    requestedUrl: "https://x.example/",
    categories: {
      performance: { score: 1, auditRefs: [] },
      accessibility: { score: 1, auditRefs: [] },
      "best-practices": { score: 0.78, auditRefs: [{ id: "deprecations", weight: 5 }, { id: "doctype", weight: 1 }] },
      seo: { score: 1, auditRefs: [] },
    },
    audits: { deprecations: { score: 0 }, doctype: { score: 1 } },
  }));
}
writeFileSync(join(dir, "assertion-results.json"), JSON.stringify([
  { name: "minScore", expected: 0.9, actual: 0.78, values: [0.78, 0.78, 0.78], operator: ">=", passed: false, auditProperty: "best-practices", auditId: "categories", level: "error", url: "https://x.example/" },
]));
process.exit(1);
`;

describe("cli: audit names the failing Lighthouse audits", () => {
  beforeAll(() => {
    if (!existsSync(binPath)) throw new Error("run `pnpm build` first");
  });

  async function runAudit(extra: string[]): Promise<string> {
    const bin = await mkdtemp(join(tmpdir(), "fake-npx-"));
    await writeFile(join(bin, "npx"), FAKE_LHCI, "utf-8");
    await chmod(join(bin, "npx"), 0o755);
    try {
      return execFileSync(
        process.execPath,
        [
          binPath,
          "audit",
          resolve(fixtures, "pristine-starter"),
          "--only",
          "lighthouse",
          "--url",
          "https://x.example/",
          ...extra,
        ],
        {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
        },
      );
    } catch (err) {
      return (err as { stdout?: string }).stdout ?? "";
    }
  }

  it("prints a LIGHTHOUSE_FAILURES line for a site whose assertion failed", async () => {
    expect(await runAudit([])).toMatch(
      /^LIGHTHOUSE_FAILURES assertions=best-practices:0\.78<0\.9 audits=best-practices\/deprecations:w5:3\/3 site=\S/m,
    );
  });

  it("keeps --json output parseable, with the audits in the result details", async () => {
    const stdout = await runAudit(["--json"]);
    expect(stdout).not.toContain("LIGHTHOUSE_FAILURES");
    const [result] = JSON.parse(stdout) as Array<{
      details: { failingAudits: Array<{ id: string }> };
    }>;
    expect(result!.details.failingAudits.map((f) => f.id)).toEqual(["deprecations"]);
  });
});
