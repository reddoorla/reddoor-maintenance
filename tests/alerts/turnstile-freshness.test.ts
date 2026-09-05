import { describe, it, expect } from "vitest";
import { collectTurnstileGuardrailAlerts } from "../../src/alerts/digest-collectors.js";
import { updateAuditFields } from "../../src/reports/airtable/websites.js";
import { formE2eResultFromAudit, hasFormE2eResult } from "../../src/audits/form-e2e-airtable.js";
import { formE2eAudit } from "../../src/audits/form-e2e.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

const NOW = new Date("2026-09-10T00:00:00.000Z");
const FRESH = "2026-09-09T10:15:00.000Z";
const STALE = "2026-07-01T10:15:00.000Z";

/**
 * `turnstileWidget` moved to form-e2e (#689), so the CRITICAL alarm must age it
 * against FORM-E2E's stamp. It used to read `functionHealthCheckedAt`, a clock
 * fleet-lighthouse re-stamps at 08:00 nightly whether or not anything looked at a
 * widget — which after the ownership move would freeze a stale "fail" into a red
 * that pages every morning and can never be muted (AttentionItems ride above the
 * accept loop).
 */
describe("the Turnstile alarm ages on the verdict's OWN clock", () => {
  const gated = (over: Record<string, unknown> = {}) =>
    makeWebsiteRow({
      id: "recA",
      name: "Acme",
      requireTurnstile: true,
      turnstileWidget: "fail",
      ...over,
    });

  it("alarms on a fresh form-e2e verdict even when function-health is stale", () => {
    const items = collectTurnstileGuardrailAlerts(
      [gated({ formE2eCheckedAt: FRESH, functionHealthCheckedAt: STALE })],
      "https://d.example",
      NOW,
    );
    expect(items).toHaveLength(1);
  });

  it("does NOT alarm on a stale verdict, however fresh function-health looks", () => {
    // The frozen-red regression. function-health re-stamps nightly forever, so
    // gating on it would make this item permanent and un-mutable.
    const items = collectTurnstileGuardrailAlerts(
      [gated({ formE2eCheckedAt: STALE, functionHealthCheckedAt: FRESH })],
      "https://d.example",
      NOW,
    );
    expect(items).toEqual([]);
  });
});

/**
 * The coupling that makes the gate above sound: a verdict must never outlive the
 * stamp that ages it. Asserted over the audit's REAL exits rather than by reading
 * the writer, because the bug this prevents is a path that writes one without the
 * other.
 */
describe("verdict and stamp are written together, on every form-e2e exit", () => {
  const site = { path: "/x", name: "acme", deployedUrl: "https://acme.example.com" };
  const base = () => makeFakeBase({ Websites: [{ id: "recA", fields: { Name: "Acme" } }] });

  const EXITS: Array<[string, Record<string, unknown>]> = [
    ["submitted and passed", { formPresent: true, success: true }],
    ["submitted and failed", { formPresent: true, success: false }],
    ["no contact form (n/a)", { formPresent: false }],
    ["testMode undeclared", { testModeUndeclared: true }],
  ];

  it.each(EXITS)("%s: writes the stamp only alongside a verdict", async (_label, outcome) => {
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: { submit: async () => outcome as never },
    });
    if (!hasFormE2eResult(r)) return; // nothing written at all is always safe
    const fields = await updateAuditFields(base(), "recA", {
      formE2e: formE2eResultFromAudit(r),
    });
    const wroteStamp = Object.keys(fields).includes("Form E2E checked at");
    const wroteVerdict = Object.keys(fields).includes("Turnstile widget");
    // The invariant: refreshing the clock without refreshing the verdict is what
    // lets months-old evidence read as current.
    if (wroteStamp) {
      expect(wroteVerdict, "stamp refreshed without a verdict").toBe(true);
    }
  });

  it("the testMode-undeclared skip clears the verdict without touching the form's", async () => {
    // It cannot browse the site, so it has no form verdict — but it MUST still
    // defuse any legacy value, because after the ownership move nothing else can
    // ever rewrite that cell for this site.
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: { submit: async () => ({ testModeUndeclared: true }) as never },
    });
    const fields = await updateAuditFields(base(), "recA", { formE2e: formE2eResultFromAudit(r) });
    expect(Object.keys(fields)).toEqual(["Turnstile widget"]);
    expect(fields["Turnstile widget"]).toBeNull();
  });
});
