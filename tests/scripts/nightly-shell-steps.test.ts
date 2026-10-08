import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stepRunScript, workflowPath } from "../build/_helpers/workflow-source.js";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const wf = (f: string) => readFileSync(workflowPath(f), "utf-8");

function runStep(
  file: string,
  step: string,
  env: Record<string, string>,
  fakes: { ghOut?: string; ghFail?: boolean; hhmm?: string; day?: string } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "nightly-step-"));
  roots.push(dir);
  const log = join(dir, "calls.log");
  const stub = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  stub("node", `printf 'node %s\\n' "$*" >> "${log}"`);
  stub(
    "gh",
    `printf 'gh %s\\n' "$*" >> "${log}"
${fakes.ghFail ? "exit 1" : ""}
case "$1" in
  api) printf '%s\\n' "${fakes.ghOut ?? "0"}" ;;
  issue) [ "$2" = list ] && printf '%s\\n' "${fakes.ghOut ?? ""}" ;;
esac`,
  );
  stub(
    "date",
    `case "$*" in
  "-u +%H%M") echo "${fakes.hhmm ?? "1700"}" ;;
  "-u +%F") echo "${fakes.day ?? "2026-10-09"}" ;;
  *) /bin/date "$@" ;;
esac`,
  );
  const script = join(dir, "step.sh");
  writeFileSync(script, stepRunScript(wf(file), step).replace(/\$\{\{[^}]*\}\}/g, "x"));
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
    encoding: "utf-8",
    env: { PATH: `${dir}:/usr/bin:/bin`, RUNNER_TEMP: dir, ...env },
  });
  const calls = existsSync(log)
    ? readFileSync(log, "utf-8").trim().split("\n").filter(Boolean)
    : [];
  return { code: r.status, out: r.stdout + r.stderr, calls };
}

const sends = (calls: string[]) =>
  calls.filter((c) => c === "node dist/cli/bin.js report --send-ready");

describe("daily-reports — the send step, run as GitHub runs it", () => {
  const SEND = "Send approved reports";
  const base = { MODE: "send", REPO: "reddoorla/reddoor-maintenance" };

  it("a dispatched send run sends", () => {
    const r = runStep("daily-reports.yml", SEND, { ...base, EVENT: "workflow_dispatch" });
    expect(r.code).toBe(0);
    expect(sends(r.calls)).toHaveLength(1);
  });

  it("a draft run never sends", () => {
    const r = runStep("daily-reports.yml", SEND, {
      ...base,
      MODE: "draft",
      EVENT: "workflow_dispatch",
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([]);
  });

  it("the fallback cron never sends before 16:37Z, whatever GitHub's delay", () => {
    for (const hhmm of ["1323", "1606", "1636"]) {
      const r = runStep(
        "daily-reports.yml",
        SEND,
        { ...base, EVENT: "schedule" },
        { hhmm, ghOut: "0" },
      );
      expect(r.code, hhmm).toBe(0);
      expect(r.calls, hhmm).toEqual([]);
    }
  });

  it("after 16:37Z the fallback sends nothing when today's send already succeeded", () => {
    const r = runStep(
      "daily-reports.yml",
      SEND,
      { ...base, EVENT: "schedule" },
      { hhmm: "1912", ghOut: "1" },
    );
    expect(r.code).toBe(0);
    expect(sends(r.calls)).toEqual([]);
    const query = r.calls.find((c) => c.startsWith("gh api"))!;
    expect(query).toContain("created=>=2026-10-09T00:00:00Z");
    expect(query).toContain("branch=main");
    expect(query).toContain("status=success");
    expect(query).toContain('"daily-reports send"');
  });

  it("after 16:37Z with no send today, the fallback sends late and fails the run so it is seen", () => {
    const r = runStep(
      "daily-reports.yml",
      SEND,
      { ...base, EVENT: "schedule" },
      { hhmm: "1637", ghOut: "0" },
    );
    expect(sends(r.calls)).toHaveLength(1);
    expect(r.code).toBe(1);
    expect(r.out).toContain("send-clock-missed");
  });

  it("when today's runs cannot be read, the fallback sends nothing and fails", () => {
    const r = runStep(
      "daily-reports.yml",
      SEND,
      { ...base, EVENT: "schedule" },
      { hhmm: "1900", ghFail: true },
    );
    expect(sends(r.calls)).toEqual([]);
    expect(r.code).toBe(1);
  });

  it("the run-name the fallback reads is the one the workflow writes", () => {
    expect(wf("daily-reports.yml")).toContain(
      "run-name: ${{ inputs.preview_site && format('daily-reports preview {0}', inputs.preview_site) || format('daily-reports {0}', inputs.mode || 'send') }}",
    );
  });
});

describe("daily-reports — the draft and digest guards, run", () => {
  it("a send run drafts nothing and sends no digest; a draft run does both", () => {
    const draftInSend = runStep("daily-reports.yml", "Draft due reports", {
      MODE: "send",
      PREVIEW_SITE: "",
    });
    expect(draftInSend.code).toBe(0);
    expect(draftInSend.calls).toEqual([]);
    const draft = runStep("daily-reports.yml", "Draft due reports", {
      MODE: "draft",
      PREVIEW_SITE: "",
    });
    expect(draft.calls).toContain("node dist/cli/bin.js report --due");
    const digestInSend = runStep("daily-reports.yml", "Email the operator digest", {
      MODE: "send",
    });
    expect(digestInSend.code).toBe(0);
    expect(digestInSend.calls).toEqual([]);
    const digest = runStep("daily-reports.yml", "Email the operator digest", { MODE: "draft" });
    expect(digest.calls[0]).toBe("node dist/cli/bin.js report --digest");
  });
});

describe("daily-reports — a green run closes only the failure issues of the modes it ran", () => {
  const CLOSE = "Close the daily-reports-failing issue on recovery";
  const searched = (calls: string[]) =>
    calls
      .filter((c) => c.startsWith("gh issue list"))
      .map((c) => /Daily reports run failing \((\w+)\)/.exec(c)?.[1]);

  it("send closes send, draft closes draft, all closes every mode", () => {
    expect(searched(runStep("daily-reports.yml", CLOSE, { RUN_MODE: "send" }).calls)).toEqual([
      "send",
    ]);
    expect(searched(runStep("daily-reports.yml", CLOSE, { RUN_MODE: "draft" }).calls)).toEqual([
      "draft",
    ]);
    expect(searched(runStep("daily-reports.yml", CLOSE, { RUN_MODE: "all" }).calls)).toEqual([
      "all",
      "draft",
      "send",
    ]);
  });

  it("the open step files under the same per-mode title", () => {
    const r = runStep(
      "daily-reports.yml",
      "Open/update the daily-reports-failing tracking issue",
      { MODE: "draft", JOB_STATUS: "failure" },
      { ghOut: "" },
    );
    expect(
      r.calls.some((c) => c.includes("issue create --title Daily reports run failing (draft)")),
    ).toBe(true);
  });
});

describe("fleet-nightly — the step hands the conductor its ref and inputs", () => {
  const STEP = "Dispatch the nightlies in order";
  const argv = (env: Record<string, string>) =>
    runStep("fleet-nightly.yml", STEP, env).calls.filter((c) => c.startsWith("node "));

  it("always passes the ref, and only, force when set", () => {
    expect(argv({ REF: "main", ONLY: "", FORCE: "false" })).toEqual([
      "node scripts/nightly-conductor.mjs --ref main",
    ]);
    expect(argv({ REF: "claude/x", ONLY: "fleet-smoke", FORCE: "true" })).toEqual([
      "node scripts/nightly-conductor.mjs --ref claude/x --only fleet-smoke --force",
    ]);
  });
});
