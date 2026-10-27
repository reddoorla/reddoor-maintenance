import { describe, it, expect } from "vitest";
import { collectTurnstileGuardrailAlerts } from "../../src/alerts/digest-collectors.js";
import { auditFields } from "../../src/fleet/site-fields.js";
import { formE2eResultFromAudit, hasFormE2eResult } from "../../src/audits/form-e2e-fields.js";
import { formE2eAudit } from "../../src/audits/form-e2e.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";
import { recordingMirror } from "../_helpers/recording-mirror.js";
import { writeFleetAudits, fleetWriteGate } from "../../src/audits/write-audits.js";

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

  it("does NOT alarm on a legacy 'fail' with no stamp at all (#1710)", () => {
    // A null stamp means no form-e2e run ever wrote this verdict: it is a
    // function-health legacy value. Since #1706 an unreadable /health keeps the
    // stored verdict, so a site whose /health never reads would page every
    // morning, un-mutably. Unstamped is as unverified as stale; assignTier's
    // watch carries it.
    const items = collectTurnstileGuardrailAlerts(
      [gated({ formE2eCheckedAt: null, functionHealthCheckedAt: FRESH })],
      "https://d.example",
      NOW,
    );
    expect(items).toEqual([]);
  });

  it("still alarms when the stamp is unparseable: never silently drop a real failure", () => {
    const items = collectTurnstileGuardrailAlerts(
      [gated({ formE2eCheckedAt: "not a date" })],
      "https://d.example",
      NOW,
    );
    expect(items).toHaveLength(1);
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

  const EXITS: Array<[string, Record<string, unknown>]> = [
    ["submitted and passed", { formPresent: true, success: true }],
    ["submitted and failed", { formPresent: true, success: false }],
    ["no contact form (n/a)", { formPresent: false }],
    ["testMode undeclared", { testModeUndeclared: true }],
    ["/health unreadable", { testModeUndeclared: true, healthUnreadable: "timed out after 10s" }],
  ];

  it.each(EXITS)("%s: writes the stamp only alongside a verdict", async (_label, outcome) => {
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: { submit: async () => outcome as never },
    });
    if (!hasFormE2eResult(r)) return; // nothing written at all is always safe
    const fields = auditFields({ formE2e: formE2eResultFromAudit(r) });
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
    const fields = auditFields({ formE2e: formE2eResultFromAudit(r) });
    expect(Object.keys(fields)).toEqual(["Turnstile widget"]);
    expect(fields["Turnstile widget"]).toBeNull();
  });

  it("an unreadable /health writes nothing, so a declared site keeps its verdict (#1698)", async () => {
    // The site may well declare testMode; its /health just did not answer. A
    // verdict it earned stays, and keeps ageing on its own unrefreshed stamp.
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: {
        submit: async () =>
          ({ testModeUndeclared: true, healthUnreadable: "timed out after 10s" }) as never,
      },
    });
    expect(auditFields({ formE2e: formE2eResultFromAudit(r) })).toEqual({});
  });
});

describe("an unreadable /health in the nightly fleet write (#1698)", () => {
  it("writes nothing for the site and never counts toward the red gate", async () => {
    // A refused probe is a warning in fleet-form-e2e.yml, deliberately never a
    // threshold; the workflow names the site on its own unreadable line.
    // One of five sites times out twice; the other four submit and pass.
    const slugs = ["a", "b", "c", "d", "e"];
    const results = await Promise.all(
      slugs.map((slug, i) =>
        formE2eAudit({
          site: { path: `/${slug}`, name: slug, deployedUrl: `https://${slug}.example.com` },
          now: NOW,
          formRunner: {
            submit: async () =>
              (i === 0
                ? { testModeUndeclared: true, healthUnreadable: "timed out after 10s" }
                : { formPresent: true, success: true }) as never,
          },
        }),
      ),
    );
    const result = await writeFleetAudits({
      websites: websiteRowsFrom(
        slugs.map((s, i) => ({ id: `rec${i}`, fields: { Name: s, Status: "maintenance" } })),
      ),
      results,
      mirror: recordingMirror().mirror,
      expectedSites: slugs,
    });
    expect(result.failed).toEqual([]);
    expect(result.written.map((w) => w.siteName)).toEqual(["b", "c", "d", "e"]);
    // Neither written nor "not applicable": it kept its verdicts, and says why.
    expect(result.notApplicable).toEqual([]);
    expect(result.kept).toEqual([{ slug: "a", reason: `form-e2e: ${results[0]!.summary}` }]);
    expect(fleetWriteGate(result).red).toBe(false);
  });
});
