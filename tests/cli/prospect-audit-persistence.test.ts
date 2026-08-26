// Coverage for the delivery tail of runProspectAuditCommand: by the time the
// pipeline resolves, the money is already spent (only the crawl is fatal), so
// the --out write and the Turso persist are attempted independently and must
// not be able to take each other down — and a run that lands NEITHER place
// must still leave something on disk. Every test here uses
// TURSO_DATABASE_URL=":memory:" (the same pattern tests/dashboard/
// prospect-report.test.ts uses) so the real persist path — the one nothing in
// prospect-audit-command.test.ts exercises, since that file always deletes
// TURSO_DATABASE_URL — actually runs.
import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runProspectAuditCommand } from "../../src/cli/commands/prospect-audit.js";
import { createProspectAudit } from "../../src/db/prospect-audits.js";
import type { PipelineDeps } from "../../src/prospect/pipeline.js";

let forcePersistFailure = false;

// vi.mock calls are hoisted above every import in this file, so this mock is
// active before runProspectAuditCommand's own dynamic `await
// import("../../db/prospect-audits.js")` ever resolves.
vi.mock("../../src/db/prospect-audits.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/prospect-audits.js")>();
  return {
    ...actual,
    createProspectAudit: vi.fn(async (...args: Parameters<typeof actual.createProspectAudit>) => {
      if (forcePersistFailure) throw new Error("simulated turso outage");
      return actual.createProspectAudit(...args);
    }),
  };
});

const ORIGINAL_ENV = { ...process.env };

/** Same offline crawl/analyze/lighthouse stubs prospect-audit-command.test.ts
 *  uses, factored out so each persistence scenario only states what differs. */
function stubDeps(): PipelineDeps {
  return {
    crawl: {
      async fetchUrl(url: string) {
        if (url === "https://acme.example/")
          return {
            status: 200,
            body: "<html><head><title>Acme</title></head><body><h1>Acme</h1><p>Roofing in Boise.</p></body></html>",
            headers: {},
          };
        return { status: 404, body: "", headers: {} };
      },
      async renderPages() {
        return new Map<string, string>();
      },
      maxPages: 2,
      delayMs: 0,
    },
    analyze: {
      run: async () => ({
        businessName: "Acme Roofing",
        business: "A residential roofing company operating in Boise, Idaho.",
        entityClarity: { score: 50, missing: [] },
        categoryQueries: [
          "roof repair contractor Boise",
          "roof replacement cost",
          "flat roof repair Idaho",
        ],
        buyerQuestions: [
          { question: "cost?", answered: "no", quotable: false, page: null, evidence: null },
          {
            question: "free estimates?",
            answered: "no",
            quotable: false,
            page: null,
            evidence: null,
          },
          {
            question: "service areas?",
            answered: "no",
            quotable: false,
            page: null,
            evidence: null,
          },
          {
            question: "licensed/insured?",
            answered: "no",
            quotable: false,
            page: null,
            evidence: null,
          },
          {
            question: "how long does a job take?",
            answered: "no",
            quotable: false,
            page: null,
            evidence: null,
          },
          {
            question: "storm damage claims?",
            answered: "no",
            quotable: false,
            page: null,
            evidence: null,
          },
        ],
        fixes: [],
        narrative: { findability: "a", readability: "b", answers: "c" },
      }),
    },
    lighthouse: async () => {
      throw new Error("skipped in test");
    },
    probeDelayMs: 0,
  };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  forcePersistFailure = false;
});

describe("prospect-audit CLI — Turso persistence", () => {
  it("a successful run with Turso configured returns a real reddoorla.com/audit/{token} link", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      deps: stubDeps(),
    });
    expect(code).toBe(0);
    expect(output).toMatch(/\/audit\/[A-Za-z0-9_-]{22}$/);
  });

  it("--json still persists to Turso and includes the link in the JSON payload", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      json: true,
      deps: stubDeps(),
    });
    expect(code).toBe(0);
    const payload = JSON.parse(output) as { link: string | null; token: string | null };
    expect(payload.link).toMatch(/\/audit\/[A-Za-z0-9_-]{22}$/);
    expect(payload.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("a persist that throws still leaves the report on disk (recovery copy) and says so", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    forcePersistFailure = true;
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      json: true,
      deps: stubDeps(),
    });
    // Neither --out nor the database took it, so the run is a non-zero-code
    // failure even though a recovery copy exists — automation must be able to
    // tell "delivered where asked" apart from "fell back to a rescue file".
    expect(code).toBe(1);
    const payload = JSON.parse(output) as {
      link: string | null;
      warnings: string[];
      recovery: { htmlPath: string; jsonPath: string } | null;
    };
    expect(payload.link).toBeNull();
    expect(payload.warnings.some((w) => /database/i.test(w))).toBe(true);
    expect(payload.recovery).not.toBeNull();
    try {
      expect(existsSync(payload.recovery!.htmlPath)).toBe(true);
      expect(existsSync(payload.recovery!.jsonPath)).toBe(true);
      expect(readFileSync(payload.recovery!.htmlPath, "utf-8")).toContain("Acme Roofing");
    } finally {
      rmSync(payload.recovery!.htmlPath, { force: true });
      rmSync(payload.recovery!.jsonPath, { force: true });
    }
  });

  it("an unwritable --out path does not prevent the Turso persist from succeeding", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const badOut = resolve(tmpdir(), `prospect-cli-missing-dir-${Date.now()}`, "out.html");
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      out: badOut,
      deps: stubDeps(),
    });
    expect(existsSync(badOut)).toBe(false);
    // The persist succeeded — a working link — despite the bad --out path.
    // (Not anchored with `$`: the --out warning prints after the link line.)
    expect(code).toBe(0);
    expect(output).toMatch(/\/audit\/[A-Za-z0-9_-]{22}/);
    expect(output).toMatch(/could not write --out/i);
    // Nothing failed to land anywhere overall, so no recovery copy either.
    expect(output).not.toMatch(/recovery copy/i);
  });
});

// Item 3: the `status` column was written unconditionally as "complete" and
// never read back. The pipeline already models partial failure precisely
// (StageResult) — the CLI is the one place that actually knows whether every
// stage succeeded, so it computes the real value and passes it through.
describe("prospect-audit CLI — status column", () => {
  it("passes status: 'partial' to createProspectAudit when a stage failed or was skipped", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    // stubDeps()'s lighthouse always throws, and probes:false skips that
    // stage too — both make this a partial run.
    const { code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      deps: stubDeps(),
    });
    expect(code).toBe(0);
    const calls = vi.mocked(createProspectAudit).mock.calls;
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[1].status).toBe("partial");
  });

  it("passes status: 'complete' to createProspectAudit when every stage succeeded", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const deps = stubDeps();
    deps.lighthouse = async () => ({
      performance: 80,
      accessibility: 90,
      bestPractices: 70,
      seo: 100,
      summary: "lighthouse: all categories passing",
      status: "pass" as const,
    });
    deps.engines = [
      {
        name: "perplexity",
        ask: async () => ({ answer: "Acme Roofing is a roofer.", citedDomains: ["acme.example"] }),
      },
    ];
    deps.probeDelayMs = 0;
    const { code } = await runProspectAuditCommand("https://acme.example/", { deps });
    expect(code).toBe(0);
    const calls = vi.mocked(createProspectAudit).mock.calls;
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[1].status).toBe("complete");
  });
});
