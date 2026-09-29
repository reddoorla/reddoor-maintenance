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
 * P1-16: a slot that is kept is kept for the whole 24h window. The row is
 * marked `failed`, with `created_at` re-stamped to the failure, rather than
 * left `running`, which the cap stops counting after the 2h stale window.
 *
 * The pipeline is replaced here with a fake that reports chosen stages through
 * `onStage` and then throws, because the real one validates model output
 * (AnalyzeSchema) and offers no honest way to make it throw after a spend.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import type { PipelineDeps, StageName } from "../../src/prospect/pipeline.js";

let script: Array<[StageName, "start" | "ok" | "fail"]> = [];
let pipelineResolves = false;
let renderThrows = false;
let markFailedThrows = false;
let releaseThrows = false;
let clock: Date;
let beforeStages: (() => Promise<void>) | null = null;

const NOW = new Date("2026-09-29T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const FAILED_AT = new Date(NOW.getTime() + HOUR);
/** One instance, so a test can assert the CLI rethrows THIS error, not a wrapper. */
const PIPELINE_ERROR = new Error("deterministic bug downstream");

vi.mock("../../src/prospect/pipeline.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/prospect/pipeline.js")>();
  return {
    ...actual,
    runProspectAudit: vi.fn(async (_url: string, _opts: unknown, deps: PipelineDeps = {}) => {
      await beforeStages?.();
      for (const [name, status] of script) deps.onStage?.(name, status);
      clock = FAILED_AT;
      if (pipelineResolves) return { url: "https://acme.example/" } as never;
      throw PIPELINE_ERROR;
    }),
  };
});

vi.mock("../../src/prospect/render.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/prospect/render.js")>();
  return {
    ...actual,
    renderProspectReport: vi.fn((result: Parameters<typeof actual.renderProspectReport>[0]) => {
      if (renderThrows) throw PIPELINE_ERROR;
      return actual.renderProspectReport(result);
    }),
  };
});

vi.mock("../../src/db/prospect-audits.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/prospect-audits.js")>();
  return {
    ...actual,
    failProspectAudit: vi.fn(async (...args: Parameters<typeof actual.failProspectAudit>) => {
      if (markFailedThrows) throw new Error("turso blip while marking");
      return actual.failProspectAudit(...args);
    }),
    releaseProspectAuditReservation: vi.fn(
      async (...args: Parameters<typeof actual.releaseProspectAuditReservation>) => {
        if (releaseThrows) throw new Error("turso blip while releasing");
        return actual.releaseProspectAuditReservation(...args);
      },
    ),
  };
});

import { runProspectAuditCommand } from "../../src/cli/commands/prospect-audit.js";
import { openDb } from "../../src/db/client.js";
import { countProspectAuditsTowardCap } from "../../src/db/prospect-audits.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  script = [];
  pipelineResolves = false;
  renderThrows = false;
  markFailedThrows = false;
  releaseThrows = false;
  beforeStages = null;
  vi.restoreAllMocks();
});

type AfterAThrow = {
  rows: Array<{
    id: string;
    token: string;
    status: string;
    created_at: string;
    result_json: string;
  }>;
  reserved: { id: string; token: string } | null;
  /** The cap's count at the failure plus each offset. */
  heldAt: (offsetMs: number) => Promise<number>;
};

async function afterAThrow(stages: typeof script): Promise<AfterAThrow> {
  process.env.TURSO_DATABASE_URL = ":memory:";
  vi.spyOn(console, "error").mockImplementation(() => {});
  const db = await openDb({ url: ":memory:" });
  script = stages;
  clock = NOW;
  let reserved: AfterAThrow["reserved"] = null;
  beforeStages = async () => {
    reserved =
      (await db.selectFrom("prospect_audits").select(["id", "token"]).executeTakeFirst()) ?? null;
  };
  await expect(
    runProspectAuditCommand("https://acme.example/", {
      probes: false,
      openDb: async () => db,
      now: () => clock,
    }),
  ).rejects.toBe(PIPELINE_ERROR);
  const rows = await db
    .selectFrom("prospect_audits")
    .select(["id", "token", "status", "created_at", "result_json"])
    .execute();
  return {
    rows,
    reserved,
    heldAt: (offsetMs) =>
      countProspectAuditsTowardCap(db, new Date(FAILED_AT.getTime() + offsetMs)),
  };
}

async function slotsHeldAfterAThrow(stages: typeof script): Promise<number> {
  return (await afterAThrow(stages)).heldAt(0);
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

describe("prospect-audit CLI — a kept slot is kept for the full 24h (P1-16)", () => {
  const PAID: typeof script = [
    ["crawl", "start"],
    ["crawl", "ok"],
    ["analyze", "start"],
    ["analyze", "ok"],
  ];

  it("a throw after a paid stage marks the run's own row `failed`, placeholder and token intact", async () => {
    const out = await afterAThrow(PAID);
    expect(out.reserved).not.toBeNull();
    expect(out.rows).toEqual([
      {
        id: out.reserved!.id,
        token: out.reserved!.token,
        status: "failed",
        created_at: FAILED_AT.toISOString(),
        result_json: "{}",
      },
    ]);
  });

  it("the failed row counts at +3h and +23h59m from the failure, and not at +24h01m", async () => {
    const out = await afterAThrow(PAID);
    expect(await out.heldAt(3 * HOUR)).toBe(1);
    expect(await out.heldAt(24 * HOUR - 60_000)).toBe(1);
    expect(await out.heldAt(24 * HOUR + 60_000)).toBe(0);
  });

  it("a pre-spend throw still leaves no row at all", async () => {
    const out = await afterAThrow([["crawl", "start"]]);
    expect(out.rows).toEqual([]);
    expect(await out.heldAt(3 * HOUR)).toBe(0);
  });

  it("a render that throws after the paid stages marks the row `failed` too", async () => {
    pipelineResolves = true;
    renderThrows = true;
    const out = await afterAThrow(PAID);
    expect(out.rows.map((r) => r.status)).toEqual(["failed"]);
    expect(await out.heldAt(3 * HOUR)).toBe(1);
  });

  it("when marking the row fails, the CLI still rejects with the pipeline's own error", async () => {
    markFailedThrows = true;
    const out = await afterAThrow(PAID);
    expect(out.rows.map((r) => r.status)).toEqual(["running"]);
  });

  it("a pre-spend throw whose release fails is never marked `failed` — it paid nothing", async () => {
    releaseThrows = true;
    const out = await afterAThrow([["crawl", "start"]]);
    expect(out.rows.map((r) => r.status)).toEqual(["running"]);
  });
});
