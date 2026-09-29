/**
 * #907 review. A run that throws gives its reserved slot back ONLY if it never
 * started spending. The pipeline still runs unwrapped code after the paid
 * stages (goal checklist, fix merging and reconciling, scoring), so a
 * deterministic bug there would throw after every run had paid. If the throw
 * released the slot, the cap would never bind on exactly that runaway.
 *
 * The first spend is the first PAID stage to start: `analyze` (the model),
 * `probes` (answer engines) or `accuracy` (the model again). `analyze` alone
 * is not enough, because a failed checks stage skips it while `probes` still
 * runs and pays.
 *
 * The pipeline is replaced here with a fake that reports chosen stages through
 * `onStage` and then throws, because the real one validates model output
 * (AnalyzeSchema) and offers no honest way to make it throw after a spend.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import type { PipelineDeps, StageName } from "../../src/prospect/pipeline.js";

let script: Array<[StageName, "start" | "ok" | "fail"]> = [];

vi.mock("../../src/prospect/pipeline.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/prospect/pipeline.js")>();
  return {
    ...actual,
    runProspectAudit: vi.fn(async (_url: string, _opts: unknown, deps: PipelineDeps = {}) => {
      for (const [name, status] of script) deps.onStage?.(name, status);
      throw new Error("deterministic bug downstream");
    }),
  };
});

import { runProspectAuditCommand } from "../../src/cli/commands/prospect-audit.js";
import { openDb } from "../../src/db/client.js";
import { countProspectAuditsTowardCap } from "../../src/db/prospect-audits.js";

const ORIGINAL_ENV = { ...process.env };
const NOW = new Date("2026-09-29T12:00:00.000Z");

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  script = [];
  vi.restoreAllMocks();
});

async function slotsHeldAfterAThrow(stages: typeof script): Promise<number> {
  process.env.TURSO_DATABASE_URL = ":memory:";
  vi.spyOn(console, "error").mockImplementation(() => {});
  const db = await openDb({ url: ":memory:" });
  script = stages;
  await expect(
    runProspectAuditCommand("https://acme.example/", {
      probes: false,
      openDb: async () => db,
      now: () => NOW,
    }),
  ).rejects.toThrow("deterministic bug downstream");
  return countProspectAuditsTowardCap(db, NOW);
}

describe("prospect-audit CLI — which throws give the slot back", () => {
  it("a throw at the crawl, before any paid stage, releases the slot", async () => {
    expect(await slotsHeldAfterAThrow([["crawl", "start"]])).toBe(0);
  });

  it("a throw after the free stages but before any paid one still releases it", async () => {
    expect(
      await slotsHeldAfterAThrow([
        ["crawl", "start"],
        ["crawl", "ok"],
        ["checks", "start"],
        ["checks", "ok"],
        ["lighthouse", "start"],
        ["lighthouse", "ok"],
      ]),
    ).toBe(0);
  });

  it("a throw after `analyze` STARTED keeps the slot — the money is spent", async () => {
    expect(
      await slotsHeldAfterAThrow([
        ["crawl", "start"],
        ["crawl", "ok"],
        ["analyze", "start"],
        ["analyze", "ok"],
      ]),
    ).toBe(1);
  });

  it("a throw after `analyze` started and FAILED still keeps it — a failed call can still bill", async () => {
    expect(
      await slotsHeldAfterAThrow([
        ["analyze", "start"],
        ["analyze", "fail"],
      ]),
    ).toBe(1);
  });

  it("a throw after `probes` started keeps it even when `analyze` never ran", async () => {
    // Failed checks skip analyze, and probes still run and pay.
    expect(
      await slotsHeldAfterAThrow([
        ["crawl", "start"],
        ["crawl", "ok"],
        ["checks", "start"],
        ["checks", "fail"],
        ["probes", "start"],
        ["probes", "ok"],
      ]),
    ).toBe(1);
  });

  it("a throw after `accuracy` started keeps it", async () => {
    expect(await slotsHeldAfterAThrow([["accuracy", "start"]])).toBe(1);
  });
});
