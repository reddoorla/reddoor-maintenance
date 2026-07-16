import { describe, it, expect } from "vitest";
import { autoTickChecklist, type AutoTickSignals } from "../../src/reports/auto-tick.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { gatingFields } from "../../src/reports/checklist.js";

const NOW = new Date("2026-06-18T12:00:00.000Z");
const GOOGLE = "Maint: Google Indexed";

function signals(over: Partial<AutoTickSignals> = {}): AutoTickSignals {
  return { search: { value: null, softFailed: false }, ...over };
}

describe("autoTickChecklist — Google Indexed", () => {
  it("passes when Search Console shows page 1, with the position in the note", () => {
    const ev = autoTickChecklist(
      makeWebsiteRow(),
      "Maintenance",
      NOW,
      signals({
        search: {
          value: { foundOnPage1: true, position: 3, propertyFound: true },
          softFailed: false,
        },
      }),
    );
    const g = ev.get(GOOGLE)!;
    expect(g.result).toBe("pass");
    expect(g.checkedAt).toBe(NOW.toISOString());
    expect(g.note).toMatch(/page 1/i);
    expect(g.note).toContain("3");
  });

  it("fails (no tick) when not on page 1", () => {
    const ev = autoTickChecklist(
      makeWebsiteRow(),
      "Maintenance",
      NOW,
      signals({
        search: {
          value: { foundOnPage1: false, position: 18, propertyFound: true },
          softFailed: false,
        },
      }),
    );
    expect(ev.get(GOOGLE)!.result).toBe("fail");
  });

  it("is unknown (no tick) when the Search Console call soft-failed", () => {
    const ev = autoTickChecklist(
      makeWebsiteRow(),
      "Maintenance",
      NOW,
      signals({ search: { value: null, softFailed: true } }),
    );
    expect(ev.get(GOOGLE)!.result).toBe("unknown");
  });

  it("emits no Google evidence when search is not configured (value null, not soft-failed)", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Maintenance", NOW, signals());
    expect(ev.has(GOOGLE)).toBe(false);
  });

  it("emits Google evidence for a Testing report too (Testing gates on all 13)", () => {
    const ev = autoTickChecklist(
      makeWebsiteRow(),
      "Testing",
      NOW,
      signals({
        search: {
          value: { foundOnPage1: true, position: 1, propertyFound: true },
          softFailed: false,
        },
      }),
    );
    expect(ev.get(GOOGLE)!.result).toBe("pass");
  });

  it("emits nothing for Launch/Announcement (no checklist)", () => {
    const ev = autoTickChecklist(
      makeWebsiteRow(),
      "Launch",
      NOW,
      signals({
        search: {
          value: { foundOnPage1: true, position: 1, propertyFound: true },
          softFailed: false,
        },
      }),
    );
    expect(ev.size).toBe(0);
  });
});

const DOMAIN = "Maint: Domain, DNS & SSL";
const FRESH = "2026-06-17T12:00:00.000Z"; // < 3 days before NOW

describe("autoTickChecklist — Domain, DNS & SSL", () => {
  it("passes for a custom domain with a fresh check and a comfortable cert", () => {
    const site = makeWebsiteRow({
      url: "https://acme.com",
      certDaysRemaining: 73,
      domainCheckedAt: FRESH,
    });
    const ev = autoTickChecklist(site, "Maintenance", NOW, signals());
    const d = ev.get(DOMAIN)!;
    expect(d.result).toBe("pass");
    expect(d.note).toMatch(/73d/);
  });

  it("fails (no tick) when the cert is within the 14-day renew window", () => {
    const site = makeWebsiteRow({
      url: "https://acme.com",
      certDaysRemaining: 9,
      domainCheckedAt: FRESH,
    });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(DOMAIN)!.result).toBe("fail");
  });

  it("treats exactly 14 days as fail and 15 days as pass (strict >14 boundary)", () => {
    const at14 = makeWebsiteRow({
      url: "https://acme.com",
      certDaysRemaining: 14,
      domainCheckedAt: FRESH,
    });
    const at15 = makeWebsiteRow({
      url: "https://acme.com",
      certDaysRemaining: 15,
      domainCheckedAt: FRESH,
    });
    expect(autoTickChecklist(at14, "Maintenance", NOW, signals()).get(DOMAIN)!.result).toBe("fail");
    expect(autoTickChecklist(at15, "Maintenance", NOW, signals()).get(DOMAIN)!.result).toBe("pass");
  });

  it("fails when the domain did not resolve / had no cert (certDaysRemaining null)", () => {
    const site = makeWebsiteRow({
      url: "https://acme.com",
      certDaysRemaining: null,
      domainCheckedAt: FRESH,
    });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(DOMAIN)!.result).toBe("fail");
  });

  it("is unknown (no tick) when the domain check is stale", () => {
    const site = makeWebsiteRow({
      url: "https://acme.com",
      certDaysRemaining: 73,
      domainCheckedAt: "2026-06-01T00:00:00.000Z", // >3 days old
    });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(DOMAIN)!.result).toBe(
      "unknown",
    );
  });

  it("omits domain evidence for a *.netlify.app site (no custom domain to verify)", () => {
    const site = makeWebsiteRow({
      url: "https://acme.netlify.app",
      certDaysRemaining: 73,
      domainCheckedAt: FRESH,
    });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(DOMAIN)!.result).toBe(
      "unknown",
    );
  });

  it("omits domain evidence when the domain was never checked", () => {
    const site = makeWebsiteRow({ url: "https://acme.com", domainCheckedAt: null });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(DOMAIN)!.result).toBe(
      "unknown",
    );
  });
});

const SECURITY = "Maint: Security Updates";

describe("autoTickChecklist — Security Updates", () => {
  it("passes when fresh with 0 critical and 0 high vulns", () => {
    const site = makeWebsiteRow({
      securityVulnsCritical: 0,
      securityVulnsHigh: 0,
      lastSecurityAuditAt: FRESH,
    });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(SECURITY)!.result).toBe(
      "pass",
    );
  });

  it("fails (with the count) when there are critical/high vulns", () => {
    const site = makeWebsiteRow({
      securityVulnsCritical: 2,
      securityVulnsHigh: 1,
      lastSecurityAuditAt: FRESH,
    });
    const e = autoTickChecklist(site, "Maintenance", NOW, signals()).get(SECURITY)!;
    expect(e.result).toBe("fail");
    expect(e.note).toMatch(/2 critical \/ 1 high/);
  });

  it("is unknown when the security audit is stale", () => {
    const site = makeWebsiteRow({
      securityVulnsCritical: 0,
      securityVulnsHigh: 0,
      lastSecurityAuditAt: "2026-06-01T00:00:00.000Z",
    });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(SECURITY)!.result).toBe(
      "unknown",
    );
  });

  it("omits when the security audit never ran (null counts / no timestamp)", () => {
    expect(
      autoTickChecklist(makeWebsiteRow(), "Maintenance", NOW, signals()).get(SECURITY)!.result,
    ).toBe("unknown");
  });
});

const DESKTOP = "Test: Desktop Browsers";
const MOBILE = "Test: Mobile Browsers";
const LINKS = "Test: Links & Navigation";

describe("autoTickChecklist — browser checks (Desktop / Mobile / Links)", () => {
  it("passes Desktop/Mobile/Links when the browser audit verdicts are true and fresh", () => {
    const site = makeWebsiteRow({
      crossbrowserOk: true,
      mobileOk: true,
      linksOk: true,
      brokenLinks: 0,
      browserCheckedAt: FRESH,
    });
    const ev = autoTickChecklist(site, "Testing", NOW, signals());
    expect(ev.get(DESKTOP)!.result).toBe("pass");
    expect(ev.get(MOBILE)!.result).toBe("pass");
    expect(ev.get(LINKS)!.result).toBe("pass");
  });

  it("fails a verdict that's false (with the broken-link count in the Links note)", () => {
    const site = makeWebsiteRow({
      crossbrowserOk: false,
      mobileOk: true,
      linksOk: false,
      brokenLinks: 3,
      browserCheckedAt: FRESH,
    });
    const ev = autoTickChecklist(site, "Testing", NOW, signals());
    expect(ev.get(DESKTOP)!.result).toBe("fail");
    expect(ev.get(MOBILE)!.result).toBe("pass");
    expect(ev.get(LINKS)!.result).toBe("fail");
    expect(ev.get(LINKS)!.note).toMatch(/3 broken/);
  });

  it("is unknown when the browser check is stale", () => {
    const site = makeWebsiteRow({
      crossbrowserOk: true,
      browserCheckedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(DESKTOP)!.result).toBe("unknown");
  });

  it("omits browser evidence entirely when the audit never ran (null verdict / no timestamp)", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Testing", NOW, signals());
    expect(ev.get(DESKTOP)!.result).toBe("unknown");
    expect(ev.get(MOBILE)!.result).toBe("unknown");
    expect(ev.get(LINKS)!.result).toBe("unknown");
  });
});

describe("autoTickChecklist — the semantic inversion (a status for every gating item)", () => {
  it("emits 'unknown' for every gating Maintenance field when nothing has been measured", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Maintenance", NOW, signals());
    for (const field of gatingFields("Maintenance")) {
      expect(ev.get(field)?.result).toBe("unknown");
    }
    // Google Indexed is ADVISORY for Maintenance → still omitted when unconfigured.
    expect(ev.has("Maint: Google Indexed")).toBe(false);
  });
  it("emits 'unknown' for every one of the 13 gating Testing fields when nothing has been measured", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Testing", NOW, signals());
    for (const field of gatingFields("Testing")) {
      expect(ev.get(field)?.result).toBe("unknown");
    }
  });
  it("emits nothing for Launch/Announcement (no gating fields)", () => {
    expect(autoTickChecklist(makeWebsiteRow(), "Launch", NOW, signals()).size).toBe(0);
  });
});

// --- Dispatch-level integration tests for the 7 new evidence fns (health-gate Plan 4, Task 3) --
//
// Per R4.2, these tests are green only once `autoTickChecklist` dispatches the 7 evidence fns
// (this task). The fns themselves are module-private — exercised ONLY through
// `autoTickChecklist(...).get(FIELD)`, never called directly — so a swapped case body or a
// mistyped field-string literal in the dispatch switch (auto-tick.ts) fails these assertions
// instead of shipping undetected.
const STALE = "2026-06-01T00:00:00.000Z"; // > 3 days before NOW
const DEPLOY = "Maint: Deploy & Function Health";
const CMS = "Maint: CMS Checked";
const UPTIME = "Maint: Uptime Checked";
const TITLES = "Test: Page Titles & Meta";
const FORMS = "Test: Form Functionality";
const INTERACTIONS = "Test: Interactions & Animations";
const UPDATES = "Test: Verified After Updates";

describe("autoTickChecklist — Deploy & Function Health evidence", () => {
  it("passes when the build is ready AND function-health is pass, both fresh", () => {
    const site = makeWebsiteRow({
      deployStatus: "ready",
      deployCheckedAt: FRESH,
      functionHealth: "pass",
      functionHealthCheckedAt: FRESH,
    });
    const e = autoTickChecklist(site, "Maintenance", NOW, signals()).get(DEPLOY)!;
    expect(e.result).toBe("pass");
    expect(e.note).toMatch(/build ready/i);
  });

  it("fails when the build is not ready", () => {
    const site = makeWebsiteRow({
      deployStatus: "error",
      deployCheckedAt: FRESH,
      functionHealth: "pass",
      functionHealthCheckedAt: FRESH,
    });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(DEPLOY)!.result).toBe("fail");
  });

  it("fails when the function is unhealthy", () => {
    const site = makeWebsiteRow({
      deployStatus: "ready",
      deployCheckedAt: FRESH,
      functionHealth: "fail",
      functionHealthCheckedAt: FRESH,
    });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(DEPLOY)!.result).toBe("fail");
  });

  it("is unknown when either freshness stamp is stale", () => {
    const site = makeWebsiteRow({
      deployStatus: "ready",
      deployCheckedAt: FRESH,
      functionHealth: "pass",
      functionHealthCheckedAt: STALE,
    });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(DEPLOY)!.result).toBe(
      "unknown",
    );
  });
});

describe("autoTickChecklist — CMS Checked evidence", () => {
  it("passes when cmsReachable is pass and the function-health stamp is fresh", () => {
    const site = makeWebsiteRow({ cmsReachable: "pass", functionHealthCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(CMS)!.result).toBe("pass");
  });

  it("fails when cmsReachable is fail", () => {
    const site = makeWebsiteRow({ cmsReachable: "fail", functionHealthCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(CMS)!.result).toBe("fail");
  });

  it("is unknown when the check is stale", () => {
    const site = makeWebsiteRow({ cmsReachable: "pass", functionHealthCheckedAt: STALE });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(CMS)!.result).toBe("unknown");
  });
});

describe("autoTickChecklist — Uptime evidence", () => {
  it("passes when reachableOk is pass and the browser check is fresh", () => {
    const site = makeWebsiteRow({ reachableOk: "pass", browserCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(UPTIME)!.result).toBe("pass");
  });

  it("fails when reachableOk is fail", () => {
    const site = makeWebsiteRow({ reachableOk: "fail", browserCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(UPTIME)!.result).toBe("fail");
  });

  it("is unknown when the browser check is stale", () => {
    const site = makeWebsiteRow({ reachableOk: "pass", browserCheckedAt: STALE });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(UPTIME)!.result).toBe(
      "unknown",
    );
  });
});

describe("autoTickChecklist — Titles & Meta evidence (Testing)", () => {
  it("passes when titleMetaOk is pass and fresh", () => {
    const site = makeWebsiteRow({ titleMetaOk: "pass", browserCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(TITLES)!.result).toBe("pass");
  });

  it("fails when titleMetaOk is fail", () => {
    const site = makeWebsiteRow({ titleMetaOk: "fail", browserCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(TITLES)!.result).toBe("fail");
  });

  it("is unknown when the browser check is stale", () => {
    const site = makeWebsiteRow({ titleMetaOk: "pass", browserCheckedAt: STALE });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(TITLES)!.result).toBe("unknown");
  });
});

describe("autoTickChecklist — Form Functionality evidence (Testing)", () => {
  it("passes when formE2eOk is pass and fresh", () => {
    const site = makeWebsiteRow({ formE2eOk: "pass", formE2eCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(FORMS)!.result).toBe("pass");
  });

  it("fails when formE2eOk is fail", () => {
    const site = makeWebsiteRow({ formE2eOk: "fail", formE2eCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(FORMS)!.result).toBe("fail");
  });

  it("is n/a when the audit ran but the site has no contact form (verdict cleared, stamp set)", () => {
    const site = makeWebsiteRow({ formE2eOk: null, formE2eCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(FORMS)!.result).toBe("n/a");
  });

  it("is unknown when the form-e2e check is stale", () => {
    const site = makeWebsiteRow({ formE2eOk: "pass", formE2eCheckedAt: STALE });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(FORMS)!.result).toBe("unknown");
  });
});

describe("autoTickChecklist — Interactions evidence (Testing)", () => {
  it("passes when smokeOk is pass and fresh", () => {
    const site = makeWebsiteRow({ smokeOk: "pass", lastSmokeAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(INTERACTIONS)!.result).toBe(
      "pass",
    );
  });

  it("fails when smokeOk is fail", () => {
    const site = makeWebsiteRow({ smokeOk: "fail", lastSmokeAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(INTERACTIONS)!.result).toBe(
      "fail",
    );
  });

  it("is unknown when the smoke suite is stale", () => {
    const site = makeWebsiteRow({ smokeOk: "pass", lastSmokeAt: STALE });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(INTERACTIONS)!.result).toBe(
      "unknown",
    );
  });
});

describe("autoTickChecklist — Tested After Updates evidence (Testing)", () => {
  it("passes when defaultBranchCi is passing and fresh", () => {
    const site = makeWebsiteRow({ defaultBranchCi: "passing", githubSignalsAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(UPDATES)!.result).toBe("pass");
  });

  it("fails when defaultBranchCi is failing", () => {
    const site = makeWebsiteRow({ defaultBranchCi: "failing", githubSignalsAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(UPDATES)!.result).toBe("fail");
  });

  it("is n/a when the repo has no CI (defaultBranchCi === 'none'), even if the stamp is stale", () => {
    const site = makeWebsiteRow({ defaultBranchCi: "none", githubSignalsAt: STALE });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(UPDATES)!.result).toBe("n/a");
  });

  it("is unknown when defaultBranchCi is pending", () => {
    const site = makeWebsiteRow({ defaultBranchCi: "pending", githubSignalsAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(UPDATES)!.result).toBe("unknown");
  });

  it("is unknown when a passing/failing signal is stale", () => {
    const site = makeWebsiteRow({ defaultBranchCi: "passing", githubSignalsAt: STALE });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(UPDATES)!.result).toBe("unknown");
  });
});
