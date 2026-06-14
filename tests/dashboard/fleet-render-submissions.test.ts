import { describe, it, expect } from "vitest";
import { renderCockpitHtml } from "../../src/dashboard/fleet-render.js";
import type { CockpitModel } from "../../src/dashboard/fleet-cockpit.js";

function model(over: Partial<CockpitModel> = {}): CockpitModel {
  return {
    summary: {
      attention: 0,
      watch: 0,
      healthy: 0,
      criticalHighVulns: 0,
      lighthouseBelowFloor: 0,
      deliveryFailures: 0,
      renovateFailing: 0,
      ciRed: 0,
      pending: 0,
      newSubmissions: 0,
    },
    cards: [],
    pending: [],
    submissions: [],
    ...over,
  };
}

describe("renderCockpitHtml — submissions", () => {
  it("omits the strip when there are no submissions", () => {
    expect(renderCockpitHtml(model())).not.toContain("subm-strip");
  });

  it("renders the strip with an escaped entry and a count", () => {
    const html = renderCockpitHtml(
      model({
        summary: { ...model().summary, newSubmissions: 1 },
        submissions: [
          {
            submissionId: "s1",
            siteName: "Acme <b>",
            slug: "acme",
            formType: "contact",
            name: "Jane",
            email: "jane@x.com",
            submittedAt: "2026-06-14T12:00:00Z",
          },
        ],
      }),
    );
    expect(html).toContain("subm-strip");
    expect(html).toContain("New submissions (1)");
    expect(html).toContain("Acme &lt;b&gt;");
    expect(html).toContain('href="/s/acme"');
    expect(html).toContain("1 new"); // summary head
  });
});
