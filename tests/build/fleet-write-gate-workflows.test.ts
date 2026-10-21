import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { runFleetWriteBack } from "../../src/cli/commands/audit.js";
import { formatFleetWriteSummary } from "../../src/audits/write-audits.js";
import { formatUnmeasuredSmokeSummary } from "../../src/audits/smoke.js";
import type { AuditResult } from "../../src/types.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";
import { stepRunScript, workflowPath } from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * #1605, run through the workflows' own text. Five nightlies read
 * `FLEET_WRITE_SUMMARY`; each now also reads the `FLEET_WRITE_GATE` verdict the
 * write-back prints. This file extracts each step's bash and executes it against a
 * stubbed `node` whose stdout is what the REAL `runFleetWriteBack` printed for the
 * scenario, so neither side can drift without a test going red.
 *
 * The known-good case runs first in every workflow: until it passes, a red below is
 * the gate's bug, not a finding.
 */

/** `exit` is the CLI's exit code on a good night: an audit sweep exits 1 whenever any
 *  site's audit reports `fail`, which is why those steps run it under `|| true`; the
 *  Prismic sweep exits 0 and its step reads anything else as an outage. */
const STEPS = [
  {
    file: "fleet-lighthouse.yml",
    step: "Fleet Lighthouse + domain + browser audit + write-back",
    exit: 1,
    label: "fleet Lighthouse",
  },
  {
    file: "fleet-smoke.yml",
    step: "Fleet smoke suite + write-back",
    exit: 1,
    label: "fleet smoke",
  },
  {
    file: "fleet-security.yml",
    step: "Fleet security + deps audit + write-back",
    exit: 1,
    label: "fleet security",
  },
  {
    file: "fleet-form-e2e.yml",
    step: "Fleet form-e2e + write-back",
    exit: 1,
    label: "fleet form-e2e",
  },
  {
    file: "fleet-prismic-drift.yml",
    step: "Sweep the fleet for Prismic model drift",
    exit: 0,
    label: "fleet prismic drift",
  },
] as const;

async function runStep(
  file: string,
  step: string,
  stdout: string,
  exit: number,
): Promise<{ code: number; out: string }> {
  const gate = stepRunScript(await readFile(workflowPath(file), "utf-8"), step);
  const dir = await mkdtemp(join(tmpdir(), "fleet-write-gate-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(dir, "canned.txt"), stdout, "utf-8");
  await writeFile(
    join(bin, "node"),
    `#!/bin/sh\ncat "${join(dir, "canned.txt")}"\nexit ${exit}\n`,
    "utf-8",
  );
  await chmod(join(bin, "node"), 0o755);
  try {
    const { stdout: o, stderr } = await execFileAsync("bash", ["-e", "-c", gate], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, RUNNER_TEMP: dir },
    });
    return { code: 0, out: o + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

const SLUGS = Array.from({ length: 8 }, (_, i) => `site-${i}`);
const websites = websiteRowsFrom(
  SLUGS.map((s, i) => ({ id: `rec${i}`, fields: { Name: s, Status: "maintenance" } })),
);

const smokeMeasured = (site: string): AuditResult => ({
  audit: "smoke",
  site,
  status: "pass",
  summary: "smoke: suite green",
  details: { ok: "pass", checkedAt: "2026-10-21T06:43:00.000Z" },
});

/** What the CLI prints after the table for `results`: the real write-back block, plus
 *  the smoke workflow's own FLEET_SMOKE_UNMEASURED line. */
async function cliOutput(args: {
  results: AuditResult[];
  expectedSites: string[];
  missRow?: string;
}): Promise<string> {
  const wb = await runFleetWriteBack({
    results: args.results,
    which: ["smoke"],
    expectedSites: args.expectedSites,
    deps: {
      roster: async () => websites,
      makeMirror: async () => async (siteId: string) => siteId !== args.missRow,
      recordEvents: async () => {},
    },
  });
  return `${formatUnmeasuredSmokeSummary(args.results)}\n\n${wb.summary}\n`;
}

describe.each(STEPS)("$file reads the write gate's verdict", ({ file, step, exit, label }) => {
  it("known-good: eight sites measured and written stays green", async () => {
    const r = await runStep(
      file,
      step,
      await cliOutput({ results: SLUGS.map(smokeMeasured), expectedSites: SLUGS }),
      exit,
    );
    expect(r.out).not.toContain("::error::");
    expect(r.code).toBe(0);
  });

  it("every site's deps failed to install: written nothing, so red", async () => {
    const results: AuditResult[] = SLUGS.map((site) => ({
      audit: "smoke",
      site,
      status: "skip",
      summary: "smoke: pnpm install failed (exit 1) — deps unavailable",
    }));
    const r = await runStep(file, step, await cliOutput({ results, expectedSites: SLUGS }), exit);
    expect(r.code).toBe(1);
    if (file === "fleet-prismic-drift.yml") {
      // Prismic keeps its own wrote=0 diagnostic first; the gate is the floor behind it.
      expect(r.out).toContain("::error::fleet prismic drift wrote 0 of 8 verdict(s)");
    } else if (file === "fleet-smoke.yml") {
      // Smoke names the cause first: no suite ran on any site (#1611).
      expect(r.out).toContain("::error::fleet smoke: 8 site(s) never measured");
    } else {
      // The gate speaks first, naming what happened rather than blaming the Turso creds.
      expect(r.out).toContain(`::error::${label}: wrote 0 of 8 site(s)`);
      expect(r.out).not.toContain("check the Turso creds");
    }
  });

  it("one of eight resolved sites missing: green, with the warning annotation naming it", async () => {
    const r = await runStep(
      file,
      step,
      await cliOutput({ results: SLUGS.slice(0, 7).map(smokeMeasured), expectedSites: SLUGS }),
      exit,
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain(`::warning::${label}: 1 of 8 site(s) never reached write-back: site-7`);
  });

  it("six of eight resolved sites never reached write-back: red", async () => {
    const r = await runStep(
      file,
      step,
      await cliOutput({ results: SLUGS.slice(0, 2).map(smokeMeasured), expectedSites: SLUGS }),
      exit,
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain(`::error::${label}: 6 of 8 site(s) not written or missing (>25%)`);
  });

  it("one site of eight with no site_health row: red, where `failed*4 > total` alone stays green", async () => {
    const r = await runStep(
      file,
      step,
      await cliOutput({ results: SLUGS.map(smokeMeasured), expectedSites: SLUGS, missRow: "rec5" }),
      exit,
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain(`::error::${label}: 1 site(s) with no row to write to: site-5`);
  });

  it("an output with the summary but no verdict line is red", async () => {
    const summaryOnly = formatFleetWriteSummary({
      written: SLUGS.map((s) => ({ siteName: s, writes: [] })),
      failed: [],
    })
      .split("\n")
      .filter((l) => !l.startsWith("FLEET_WRITE_GATE"))
      .join("\n");
    const r = await runStep(
      file,
      step,
      `${formatUnmeasuredSmokeSummary([])}\n${summaryOnly}\n`,
      exit,
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("printed no FLEET_WRITE_GATE verdict");
  });
});
