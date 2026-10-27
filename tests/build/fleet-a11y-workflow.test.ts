import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  isScheduled,
  stepEnv,
  stepRunScript,
  workflowPath,
  workflowSteps,
} from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * P1-78c. Accessibility runs weekly in its own workflow, so a failed Sunday must be
 * loud: without the tracking issue the verdicts would just go stale after 8 days and
 * the alarm would quietly read nothing. These run the steps' own shell, not the prose.
 */
const FILE = "fleet-a11y.yml";
const OPEN = "Open/update the weekly-a11y-failure tracking issue";
const CLOSE = "Close the weekly-a11y-failure issue on recovery";

async function source(): Promise<string> {
  return readFile(workflowPath(FILE), "utf-8");
}

/** Run a step's script with a stub `gh` that records its arguments and answers
 *  `issue list` with `listed`. */
async function runWithGh(step: string, listed: string): Promise<string[]> {
  const script = stepRunScript(await source(), step).replace(/\$\{\{[^}]*\}\}/g, "x");
  const dir = await mkdtemp(join(tmpdir(), "fleet-a11y-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  const log = join(dir, "gh.log");
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh\necho "$*" >> "${log}"\ncase "$1 $2" in "issue list") printf '%s' '${listed}';; esac\n`,
    "utf-8",
  );
  await chmod(join(bin, "gh"), 0o755);
  await execFileAsync("bash", ["-c", script], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, JOB_STATUS: "failure" },
  });
  return (await readFile(log, "utf-8")).trim().split("\n");
}

describe("fleet-a11y.yml", () => {
  it("runs on its own weekly schedule", async () => {
    expect(isScheduled(await source())).toBe(true);
    expect(await source()).toMatch(/cron: "\d+ \d+ \* \* 1"/);
  });

  it("audits a11y alone, writing back, on fresh clones it installs", async () => {
    const run = stepRunScript(await source(), "Fleet a11y audit + write-back");
    expect(run).toMatch(/--only a11y \\/);
    expect(run).toContain("--write-back");
    expect(stepEnv(await source(), "Fleet a11y audit + write-back").REDDOOR_A11Y_INSTALL).toBe(
      '"1"',
    );
  });

  it("a failed run opens the tracking issue", async () => {
    const step = workflowSteps(await source()).find((s) => s.label === OPEN)!;
    expect(step.if).toContain("failure()");
    const calls = await runWithGh(OPEN, "");
    expect(calls.some((c) => c.startsWith("issue create --title Weekly fleet a11y failing"))).toBe(
      true,
    );
  });

  it("a second failure updates the open issue rather than filing another", async () => {
    const calls = await runWithGh(OPEN, "42");
    expect(calls.some((c) => c.startsWith("issue comment 42"))).toBe(true);
    expect(calls.some((c) => c.startsWith("issue create"))).toBe(false);
  });

  it("a green run closes it", async () => {
    const step = workflowSteps(await source()).find((s) => s.label === CLOSE)!;
    expect(step.if).toContain("success()");
    const calls = await runWithGh(CLOSE, "42");
    expect(calls.some((c) => c.startsWith("issue close 42"))).toBe(true);
  });
});
