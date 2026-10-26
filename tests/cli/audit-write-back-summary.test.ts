import { describe, it, expect } from "vitest";
import { formatWriteSummary, writeBackTitle } from "../../src/cli/commands/audit.js";
import { writeBackOneSite } from "../../src/audits/write-audits.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";
import type { AuditResult } from "../../src/types.js";

/** #1716: the single-site `audit --write-back` output. Its title counted `writes`
 *  without asking whether any field was written, and `formatWriteSummary` rendered
 *  every audit but lighthouse, a11y and deps as `security: undefinedC/…`. */

const websites = websiteRowsFrom([
  { id: "recA", fields: { Name: "Acme Co", Status: "maintenance" } },
]);
const at = "2026-10-26T12:00:00.000Z";

function result(audit: AuditResult["audit"], details: unknown): AuditResult {
  return { audit, site: "acme-co", status: "pass", summary: `${audit} summary`, details };
}

/** Drives the production entry point, recording what reached the mirror. */
async function writeBack(results: AuditResult[]) {
  const mirrored: Array<Record<string, unknown>> = [];
  const summary = await writeBackOneSite({
    websites,
    slug: "acme-co",
    results,
    mirrorHealth: async (_siteId, fields) => {
      mirrored.push(fields);
      return true;
    },
  });
  return { summary, mirrored };
}

describe("audit --write-back: nothing to write (#1716)", () => {
  // The issue's input: form-e2e refused because the site's /health was unreadable,
  // so the result carries a checkedAt and no verdict.
  const keptFormE2e = () => result("form-e2e", { checkedAt: at });

  it("a form-e2e run with no verdict writes no field and says the verdicts were kept", async () => {
    const { summary, mirrored } = await writeBack([keptFormE2e()]);
    // Precondition: the field set really is empty (the bug was printing "Wrote" over it).
    expect(mirrored).toEqual([{}]);
    expect(writeBackTitle(summary)).toBe("Websites[Acme Co]: nothing to write (verdicts kept)");
    const out = formatWriteSummary(summary);
    expect(out).toContain("→ Websites[Acme Co]: nothing to write (verdicts kept)");
    expect(out).not.toMatch(/wrote/i);
    expect(out).not.toContain("undefined");
  });

  // The fleet files these two under `failed` and `notApplicable`, not `kept` (#1735 round 1).
  it("an audit that measured nothing says so, by the fleet's own classification", async () => {
    const { summary, mirrored } = await writeBack([
      { audit: "deps", site: "acme-co", status: "fail", summary: "install failed" },
    ]);
    expect(mirrored).toEqual([{}]);
    expect(writeBackTitle(summary)).toBe(
      "Websites[Acme Co]: nothing measured: deps: install failed",
    );
    expect(formatWriteSummary(summary)).toBe(
      "→ Websites[Acme Co]: nothing measured: deps: install failed",
    );
  });

  it("a run whose every audit said not applicable says so", async () => {
    const { summary } = await writeBack([
      {
        audit: "smoke",
        site: "acme-co",
        status: "pass",
        summary: "no test:smoke script",
        notApplicable: true,
      },
    ]);
    expect(writeBackTitle(summary)).toBe("Websites[Acme Co]: not applicable, nothing to write");
    expect(formatWriteSummary(summary)).toBe(
      "→ Websites[Acme Co]: not applicable, nothing to write",
    );
  });

  it("an audit that wrote a field still reports the write (positive control)", async () => {
    const { summary } = await writeBack([result("smoke", { ok: "pass", checkedAt: at })]);
    expect(writeBackTitle(summary)).toBe("Wrote to Websites[Acme Co] (1 audit type)");
    expect(formatWriteSummary(summary)).toBe("→ wrote to Websites[Acme Co]:\n  smoke: pass");
  });

  it("a kept form-e2e beside a written audit is counted as one type, not two", async () => {
    const { summary } = await writeBack([
      keptFormE2e(),
      result("smoke", { ok: "fail", checkedAt: at }),
    ]);
    expect(writeBackTitle(summary)).toBe("Wrote to Websites[Acme Co] (1 audit type)");
    expect(formatWriteSummary(summary)).toBe(
      "→ wrote to Websites[Acme Co]:\n  smoke: fail\n  form-e2e: no form verdict this run (kept)",
    );
  });
});

describe("formatWriteSummary: one case per audit (#1716)", () => {
  it("renders each audit kind by its own fields, never `undefined`", async () => {
    const { summary } = await writeBack([
      result("lighthouse", {
        summary: { performance: 0.9, accessibility: 1, "best-practices": 0.78, seo: 0.92 },
      }),
      result("a11y", { totalViolations: 2 }),
      result("deps", { entries: [{ drift: "major" }, { drift: "minor" }, { drift: "same" }] }),
      result("security", { counts: { critical: 1, high: 2, moderate: 3, low: 4 } }),
      result("domain", { resolved: true, certDaysRemaining: 41, checkedAt: at }),
      result("browser", {
        desktopOk: true,
        mobileOk: false,
        linksOk: false,
        reachableOk: true,
        titleMetaOk: true,
        brokenLinks: 3,
        checkedAt: at,
      }),
      result("netlify-deploy", { state: "ready", deployedAt: at, logUrl: null, checkedAt: at }),
      result("function-health", {
        ok: true,
        prismic: "ok",
        forms: { turnstile: false },
        checkedAt: at,
      }),
      result("smoke", { ok: "fail", checkedAt: at }),
      result("form-e2e", { ok: "pass", checkedAt: at, turnstileWidget: "pass" }),
    ]);
    const out = formatWriteSummary(summary);
    expect(out).not.toContain("undefined");
    const lines = out.split("\n").slice(1);
    expect(lines).toEqual([
      "  lighthouse: P=90 A=100 BP=78 SEO=92",
      "  a11y: 2 violations",
      "  deps: 2 drifted (1 major)",
      "  security: 1C/2H/3M/4L",
      "  domain: certificate 41 days left",
      "  browser: desktop pass, mobile fail, links fail, reachable pass, title/meta pass, 3 broken link(s)",
      "  netlify-deploy: ready",
      "  function-health: pass, cms pass, turnstile fail",
      "  smoke: fail",
      "  form-e2e: pass, turnstile pass",
    ]);
  });
});

describe("formatWriteSummary: the values a run may leave empty (#1716)", () => {
  it("names an unknown certificate, a missing deploy and a no-form page instead of `null`", async () => {
    const { summary } = await writeBack([
      // NO_LCP: the performance category is missing, so its score is null.
      result("lighthouse", {
        summary: { accessibility: 0.95, "best-practices": 1, seo: 0.92 },
      }),
      result("domain", { resolved: false, certDaysRemaining: null, checkedAt: at }),
      result("netlify-deploy", { state: null, deployedAt: null, logUrl: null, checkedAt: at }),
      result("function-health", { ok: false, prismic: "skipped", forms: null, checkedAt: at }),
      result("form-e2e", { ok: null, checkedAt: at, turnstileWidget: null }),
    ]);
    expect(formatWriteSummary(summary).split("\n").slice(1)).toEqual([
      "  lighthouse: P=n/a A=95 BP=100 SEO=92",
      "  domain: certificate unknown",
      "  netlify-deploy: no deploy",
      "  function-health: fail, cms n/a, turnstile n/a",
      "  form-e2e: n/a (no form), turnstile n/a",
    ]);
  });
});

describe("formatWriteSummary: an audit it has no case for (#1716)", () => {
  it("names the audit instead of reading it as security", () => {
    const out = formatWriteSummary({
      siteName: "Acme Co",
      writes: [{ audit: "prismic-models", counts: { pushed: 2 } }],
    });
    expect(out).toBe("→ wrote to Websites[Acme Co]:\n  prismic-models: written");
  });
});
