import { describe, it, expect, beforeEach, vi } from "vitest";
import { launch } from "../../src/recipes/launch.js";
import type { AuditResult, RecipeResult, Site } from "../../src/types.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

// uploadAttachment (src/reports/airtable/attachments.ts) POSTs to content.airtable.com
// via global fetch. Stub fetch so the preview upload "succeeds" without a network call;
// AIRTABLE_PAT/BASE_ID are also required by uploadAttachment before it fetches.
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
  }) as unknown as typeof global.fetch;
  process.env.AIRTABLE_PAT = "pat_test";
  process.env.AIRTABLE_BASE_ID = "app_test";
});

function siteOf(): Site {
  return { path: "/fake/acme", name: "Acme Co" };
}

/** A lighthouse AuditResult with real scores in the LHCI summary shape (floats in
 *  [0,1] under details.summary, keyed by the canonical category ids). */
function lighthouseResult(): AuditResult {
  return {
    audit: "lighthouse",
    site: "Acme Co",
    status: "pass",
    summary: "lighthouse ok",
    details: {
      summary: {
        performance: 0.87,
        accessibility: 0.91,
        "best-practices": 1.0,
        seo: 0.95,
      },
    },
  };
}

/** Seed a Websites row whose siteSlug matches the launched site. */
function websitesSeed() {
  return {
    Websites: [
      {
        id: "rec_site_acme",
        fields: { Name: "Acme Co", url: "https://acme.example.com", Status: "launch period" },
      },
    ],
    Reports: [] as Array<{ id: string; fields: Record<string, unknown> }>,
  };
}

function deps(base: ReturnType<typeof makeFakeBase>) {
  return {
    base,
    bootstrap: async (): Promise<RecipeResult> => ({
      recipe: "self-updating",
      site: "Acme Co",
      status: "applied",
      commits: ["abc123"],
    }),
    audit: async (): Promise<AuditResult[]> => [lighthouseResult()],
  };
}

describe("recipes/launch", () => {
  it("runs bootstrap + audit + draft and reports complete=true", async () => {
    const base = makeFakeBase(websitesSeed());
    const result = await launch(siteOf(), deps(base));

    expect(result.complete).toBe(true);
    expect(result.steps.map((s) => s.name)).toEqual(["self-updating", "audit", "draft"]);
  });

  it("creates a Launch draft carrying the audited Lighthouse scores", async () => {
    const base = makeFakeBase(websitesSeed());
    await launch(siteOf(), deps(base));

    const create = base.__calls.find((c) => c.kind === "create" && c.table === "Reports");
    if (!create || create.kind !== "create") throw new Error("expected a Reports create");
    const fields = create.records[0]!.fields;
    expect(fields["Report type"]).toBe("Launch");
    expect(fields["Lighthouse — Performance"]).toBe(87);
    expect(fields["Lighthouse — Accessibility"]).toBe(91);
    expect(fields["Lighthouse — Best Practices"]).toBe(100);
    expect(fields["Lighthouse — SEO"]).toBe(95);
  });

  it("flips Draft ready=true so the launch draft enters the approve queue (BLOCKER)", async () => {
    const base = makeFakeBase(websitesSeed());
    await launch(siteOf(), deps(base));

    const draftReadyUpdate = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Reports" &&
        c.records[0]!.fields["Draft ready"] === true,
    );
    expect(draftReadyUpdate).toBeDefined();
  });

  it("reuses an existing Launch row on a re-run instead of creating a second", async () => {
    const today = new Date();
    const period = today.toISOString().slice(0, 7);
    const base = makeFakeBase({
      Websites: websitesSeed().Websites,
      Reports: [
        {
          id: "rec_existing_launch",
          fields: {
            "Report ID": "Acme Co — Launch — existing",
            Site: ["rec_site_acme"],
            "Report type": "Launch",
            Period: period,
          },
        },
      ],
    });

    const result = await launch(siteOf(), deps(base));

    expect(result.complete).toBe(true);
    // No second Reports row created — the existing one is reused.
    const reportCreates = base.__calls.filter((c) => c.kind === "create" && c.table === "Reports");
    expect(reportCreates).toHaveLength(0);
    // It is still made Draft-ready (idempotent re-flip).
    const draftReadyUpdate = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Reports" &&
        c.records[0]!.id === "rec_existing_launch" &&
        c.records[0]!.fields["Draft ready"] === true,
    );
    expect(draftReadyUpdate).toBeDefined();
  });

  it("refreshes the reused Launch row's Lighthouse scores with the fresh audit (no stale email)", async () => {
    const today = new Date();
    const period = today.toISOString().slice(0, 7);
    // Seed an existing Launch row carrying STALE scores from a prior run.
    const base = makeFakeBase({
      Websites: websitesSeed().Websites,
      Reports: [
        {
          id: "rec_existing_launch",
          fields: {
            "Report ID": "Acme Co — Launch — existing",
            Site: ["rec_site_acme"],
            "Report type": "Launch",
            Period: period,
            "Lighthouse — Performance": 10,
            "Lighthouse — Accessibility": 20,
            "Lighthouse — Best Practices": 30,
            "Lighthouse — SEO": 40,
          },
        },
      ],
    });

    await launch(siteOf(), deps(base));

    // The reuse path updates the existing row's Lighthouse cells to the fresh audit
    // (lighthouseResult: 87/91/100/95) — NOT a second create.
    const scoreUpdate = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Reports" &&
        c.records[0]!.id === "rec_existing_launch" &&
        c.records[0]!.fields["Lighthouse — Performance"] !== undefined,
    );
    expect(scoreUpdate).toBeDefined();
    if (!scoreUpdate || scoreUpdate.kind !== "update") throw new Error("expected a score update");
    expect(scoreUpdate.records[0]!.fields).toMatchObject({
      "Lighthouse — Performance": 87,
      "Lighthouse — Accessibility": 91,
      "Lighthouse — Best Practices": 100,
      "Lighthouse — SEO": 95,
    });
    // Completed on is refreshed too (today, YYYY-MM-DD).
    expect(scoreUpdate.records[0]!.fields["Completed on"]).toBe(today.toISOString().slice(0, 10));
  });

  it("still completes (and flips Draft ready) when the preview upload fails", async () => {
    // A preview-upload hiccup must not fail the launch — it's wrapped in try/catch.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
    }) as unknown as typeof global.fetch;

    const base = makeFakeBase(websitesSeed());
    const result = await launch(siteOf(), deps(base));

    expect(result.complete).toBe(true);
    const draftReadyUpdate = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Reports" &&
        c.records[0]!.fields["Draft ready"] === true,
    );
    expect(draftReadyUpdate).toBeDefined();
  });
});
