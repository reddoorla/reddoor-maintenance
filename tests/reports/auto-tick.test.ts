import { describe, it, expect } from "vitest";
import { autoTickChecklist, type AutoTickSignals } from "../../src/reports/auto-tick.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

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
      signals({ search: { value: { foundOnPage1: true, position: 3 }, softFailed: false } }),
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
      signals({ search: { value: { foundOnPage1: false, position: 18 }, softFailed: false } }),
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
      signals({ search: { value: { foundOnPage1: true, position: 1 }, softFailed: false } }),
    );
    expect(ev.get(GOOGLE)!.result).toBe("pass");
  });

  it("emits nothing for Launch/Announcement (no checklist)", () => {
    const ev = autoTickChecklist(
      makeWebsiteRow(),
      "Launch",
      NOW,
      signals({ search: { value: { foundOnPage1: true, position: 1 }, softFailed: false } }),
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
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).has(DOMAIN)).toBe(false);
  });

  it("omits domain evidence when the domain was never checked", () => {
    const site = makeWebsiteRow({ url: "https://acme.com", domainCheckedAt: null });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).has(DOMAIN)).toBe(false);
  });
});
