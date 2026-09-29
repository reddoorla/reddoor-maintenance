import { describe, it, expect } from "vitest";
import {
  mapRow,
  autoFixAttemptsFields,
  gitHubSignalsFields,
  launchedFields,
  nextDueDatesFields,
} from "../../src/fleet/site-fields.js";

describe("mapRow Header image", () => {
  // REGRESSION (2026-08-24): mapRow took `attachments[0]`, but uploads
  // APPEND — so the newest file is the TAIL. Any field that ever held
  // more than one served its OLDEST image forever, which is how a pre-clean-plate header
  // reached a live announcement and got a second headline stamped over it (#574/#577).
  it("maps the NEWEST Header image attachment, not the first ever uploaded", () => {
    const row = mapRow({
      id: "rec0",
      fields: {
        Name: "Acme Co",
        Status: "maintenance",
        "Header image": [
          { url: "https://x/old.jpg", filename: "old.jpg", type: "image/jpeg" },
          { url: "https://x/new.jpg", filename: "new.jpg", type: "image/jpeg" },
        ],
      },
    });
    expect(row.headerImage?.filename).toBe("new.jpg");
  });
});

describe("autoFixAttemptsFields", () => {
  it("carries the counter in the Security Auto-Fix Attempts field", () => {
    expect(autoFixAttemptsFields(3)).toEqual({ "Security Auto-Fix Attempts": 3 });
  });
});

describe("gitHubSignalsFields", () => {
  it("carries all four fields when every value is present", () => {
    expect(
      gitHubSignalsFields({
        renovateFailingCis: 2,
        ciState: "failing",
        lastCommitAt: "2026-06-01T00:00:00Z",
        sweptAt: "2026-06-12T08:30:00Z",
      }),
    ).toEqual({
      "Renovate Failing CIs": 2,
      "Default Branch CI": "failing",
      "Last Commit At": "2026-06-01T00:00:00Z",
      "GitHub Signals At": "2026-06-12T08:30:00Z",
    });
  });

  it("omits a null lastCommitAt rather than clobbering a prior value", () => {
    const fields = gitHubSignalsFields({
      renovateFailingCis: 0,
      ciState: "none",
      lastCommitAt: null,
      sweptAt: "2026-06-12T08:30:00Z",
    });
    expect("Last Commit At" in fields).toBe(false);
    expect(fields).toMatchObject({
      "Renovate Failing CIs": 0,
      "Default Branch CI": "none",
    });
  });
});

describe("launchedFields", () => {
  it("carries Status=maintained + Launched at", () => {
    expect(launchedFields("2026-06-12T00:00:00Z")).toEqual({
      Status: "maintained",
      "Launched at": "2026-06-12T00:00:00Z",
    });
  });
});

describe("nextDueDatesFields", () => {
  it("carries both next-due dates", () => {
    expect(nextDueDatesFields({ maintenanceAt: "2026-07-30", testingAt: "2026-09-30" })).toEqual({
      "Next maintenance at": "2026-07-30",
      "Next testing at": "2026-09-30",
    });
  });

  it("clears a field with null when that schedule is absent", () => {
    expect(nextDueDatesFields({ maintenanceAt: "2026-07-30", testingAt: null })).toEqual({
      "Next maintenance at": "2026-07-30",
      "Next testing at": null,
    });
  });
});
