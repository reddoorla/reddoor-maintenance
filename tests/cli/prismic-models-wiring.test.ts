// The renderer's reconciliation is a safeguard, and a safeguard is worth exactly
// what it is wired to. `renderModelReport` cross-checks the facts it is handed
// TWICE — diff.remoteOnly vs report.remoteOnlyReported, opts.apply vs
// report.mode, and the sent/failed bucket invariant — but every one of those
// checks reads `opts.report`, and `checkOneSite` is the only place in the
// pipeline that constructs `ReportOptions`. Handing it `failed: report.failed`
// instead of the whole report leaves `opts.report` undefined at the sole call
// site, and the entire reconciliation becomes dead code that ships dark and
// never executes once.
//
// That cannot be caught with the real `pushModels`, because a real push report
// always agrees with the diff it was built from — agreement by construction is
// the very argument the reconciliation exists to distrust. So this file replaces
// `pushModels` with one that returns a report DISAGREEING with the diff, and
// asserts the command notices. It lives in its own file because `vi.mock` is
// hoisted per module and would otherwise stub the push out from under every
// other test.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/prismic/models/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/prismic/models/index.js")>();
  return {
    ...actual,
    // Disagrees with the diff twice over: it names a remote-only model the
    // comparison never saw, and it accounts for neither of the models the diff
    // is pushing.
    pushModels: vi.fn(async () => ({
      mode: "dry" as const,
      sent: [],
      failed: [],
      remoteOnlyReported: [{ kind: "customtype" as const, id: "ghost" }],
    })),
  };
});

import { runPrismicModelsCommand } from "../../src/cli/commands/prismic-models.js";
import type { PrismicModelsDeps } from "../../src/cli/commands/prismic-models.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-wiring-"));
  await writeFile(
    join(dir, "slicemachine.config.json"),
    JSON.stringify({ repositoryName: "espada", libraries: ["./src/lib/slices"] }),
  );
  await mkdir(join(dir, "customtypes", "page"), { recursive: true });
  await writeFile(
    join(dir, "customtypes", "page", "index.json"),
    JSON.stringify({ id: "page", label: "Page v2" }),
  );
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const deps = (): PrismicModelsDeps => ({
  remoteModels: vi.fn(async () => [
    { kind: "customtype" as const, id: "page", model: { id: "page", label: "Page" } },
  ]),
  sendModel: vi.fn(async () => {}),
  env: { PRISMIC_WRITE_TOKEN: "tok" },
  spawn: vi.fn<SpawnFn>(async () => ({ code: 0, stdout: "", stderr: "" })),
  // No test in this file writes to Airtable. Required (not optional) on the deps
  // type precisely so that stays true by construction: a stub that throws is the
  // only way this path can be reached from here.
  openVerdictSink: async () => {
    throw new Error("this test never opens Airtable");
  },
});

describe("checkOneSite hands the renderer the WHOLE push report", () => {
  it("marks the report INCONSISTENT when the push run disagrees with the diff", async () => {
    const r = await runPrismicModelsCommand(undefined, { cwd: dir }, deps());
    expect(r.output).toContain("INCONSISTENT");
    expect(r.output).toContain("remote-only per the push report, absent from the comparison");
    expect(r.output).toContain("the push run neither sent nor failed it");
  });
});
