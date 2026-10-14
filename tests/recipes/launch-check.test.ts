import { describe, it, expect } from "vitest";
import {
  LAUNCH_CHECK_STEPS,
  blockingLines,
  formatLaunchCheck,
  launchCheck,
  parseAllowMissing,
  type FetchedPage,
  type LaunchCheckDeps,
  type LaunchCheckLine,
  type LaunchCheckStep,
} from "../../src/recipes/launch-check.js";
import { runLaunchCheckCommand } from "../../src/cli/commands/launch-check.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";

const STREAM = "G-ABCDEFGHIJ";
const OTHER = "G-ZZZZZZZZZZ";
const URL_ = "https://www.example.com/";
const HOME = `<html><body><footer><a href="/privacy">Privacy</a></footer></body></html>`;

function row(fields: Record<string, unknown> = {}): WebsiteRow {
  return websiteRowsFrom([
    {
      id: "rec_site",
      fields: {
        Name: "Example Co",
        url: URL_,
        Status: "building",
        "point of contact": "owner@example.com",
        "maintenence freq": "Quarterly",
        "maintenance day": "2026-10-14",
        "GA4 property ID": "123456789",
        "Search Console property": "sc-domain:example.com",
        "Header image": [{ url: "", filename: "exampleHeader.jpg", type: "image/jpeg" }],
        ...fields,
      },
    },
  ])[0]!;
}

/** The two Williamson rows as Turso held them on 2026-10-14. */
function williamson(): WebsiteRow {
  return websiteRowsFrom([
    {
      id: "recsAHrgOL2A6By0k",
      fields: {
        Name: "Williamson Construction Co",
        url: "http://www.williamson-construction.com/",
        Status: "building",
      },
    },
  ])[0]!;
}

function pages(map: Record<string, FetchedPage | Error>): LaunchCheckDeps["fetchPage"] {
  return async (url) => {
    const hit = map[url];
    if (hit instanceof Error) throw hit;
    if (hit) return hit;
    return { status: 404, url, body: "<h1>404</h1>" };
  };
}

/** Every dependency answering as a fully launched site's would. */
function goodDeps(over: Partial<LaunchCheckDeps> = {}): LaunchCheckDeps {
  return {
    subjects: () => ["reports@reddoorla.com", "backup@reddoorla.com"],
    readProperty: async () => ({ ok: true, users: 12 }),
    readStreams: async () => ({ ok: true, measurementIds: [STREAM] }),
    probeTag: async () => ({ loadedIds: [STREAM], failed: [] }),
    fetchPage: pages({
      [URL_]: { status: 200, url: URL_, body: HOME },
      "https://www.example.com/privacy": { status: 200, url: "", body: "<h1>Privacy</h1>" },
    }),
    now: () => new Date("2026-10-14T12:00:00Z"),
    readSearch: async (r) => ({
      ok: true,
      propertyFound: true,
      property: r.searchConsoleProperty,
    }),
    ...over,
  };
}

function stateOf(lines: LaunchCheckLine[], step: LaunchCheckStep): string {
  return lines.find((l) => l.step === step)!.state;
}

function detailOf(lines: LaunchCheckLine[], step: LaunchCheckStep): string {
  return lines.find((l) => l.step === step)!.detail;
}

describe("launchCheck", () => {
  it("passes every step on a fully launched site, one line per step in order", async () => {
    const lines = await launchCheck(row(), goodDeps());
    expect(lines.map((l) => l.step)).toEqual([...LAUNCH_CHECK_STEPS]);
    expect(lines.filter((l) => l.state !== "ok")).toEqual([]);
  });

  it("fails Williamson on every step it was missing on 2026-10-14", async () => {
    const lines = await launchCheck(williamson(), goodDeps());
    expect(Object.fromEntries(lines.map((l) => [l.step, l.state]))).toEqual({
      url: "missing",
      contact: "missing",
      schedule: "missing",
      "header-image": "missing",
      "ga-property": "missing",
      "ga-tag": "missing",
      privacy: "unverified",
      "search-console": "missing",
    });
    expect(detailOf(lines, "url")).toContain("is not https://");
    expect(detailOf(lines, "contact")).toContain("recipients-missing");
  });

  describe("schedule", () => {
    it("is missing when the frequency is set but maintenance_day is blank", async () => {
      const lines = await launchCheck(row({ "maintenance day": undefined }), goodDeps());
      expect(stateOf(lines, "schedule")).toBe("missing");
      expect(detailOf(lines, "schedule")).toContain("maintenance_day is blank");
    });

    it("accepts an explicit None with no day", async () => {
      const lines = await launchCheck(
        row({ "maintenence freq": "None", "maintenance day": undefined }),
        goodDeps(),
      );
      expect(stateOf(lines, "schedule")).toBe("ok");
    });

    it("is missing when testing_freq is set but testing_day is blank", async () => {
      const lines = await launchCheck(row({ "testing freq": "Yearly" }), goodDeps());
      expect(stateOf(lines, "schedule")).toBe("missing");
      expect(detailOf(lines, "schedule")).toContain("testing_day");
    });

    it("is missing when maintenance_day is more than a year ahead", async () => {
      const lines = await launchCheck(row({ "maintenance day": "2062-10-14" }), goodDeps());
      expect(stateOf(lines, "schedule")).toBe("missing");
    });

    it("parses testing_day too", async () => {
      const lines = await launchCheck(
        row({ "testing freq": "Monthly", "testing day": "banana" }),
        goodDeps(),
      );
      expect(stateOf(lines, "schedule")).toBe("missing");
      expect(detailOf(lines, "schedule")).toContain("testing_day");
    });

    it("is missing when maintenance_day is not a date", async () => {
      const lines = await launchCheck(row({ "maintenance day": "next week" }), goodDeps());
      expect(stateOf(lines, "schedule")).toBe("missing");
    });

    it("is missing when maintenance_day is more than 13 months old", async () => {
      const lines = await launchCheck(row({ "maintenance day": "2025-08-01" }), goodDeps());
      expect(stateOf(lines, "schedule")).toBe("missing");
      const recent = await launchCheck(row({ "maintenance day": "2026-01-01" }), goodDeps());
      expect(stateOf(recent, "schedule")).toBe("ok");
    });

    it("is missing for a frequency the code does not know", async () => {
      const lines = await launchCheck(row({ "maintenence freq": "Quaterly" }), goodDeps());
      expect(stateOf(lines, "schedule")).toBe("missing");
    });
  });

  it("is missing a contact when the only To is the operator's own address", async () => {
    const lines = await launchCheck(
      row({ "point of contact": "tucker@reddoorla.com" }),
      goodDeps(),
    );
    expect(stateOf(lines, "contact")).toBe("missing");
    expect(detailOf(lines, "contact")).toContain("recipient-operator-address");
  });

  describe("ga-property", () => {
    it("is unverified, not ok, with no credentials here", async () => {
      const lines = await launchCheck(row(), goodDeps({ subjects: () => null }));
      expect(stateOf(lines, "ga-property")).toBe("unverified");
      expect(stateOf(lines, "ga-tag")).toBe("unverified");
      expect(stateOf(lines, "search-console")).toBe("unverified");
    });

    it("reads as EVERY subject, so a backup subject with no access is missing", async () => {
      const seen: string[] = [];
      const lines = await launchCheck(
        row(),
        goodDeps({
          readProperty: async (_id, subject) => {
            seen.push(subject);
            return subject === "backup@reddoorla.com"
              ? { ok: false, kind: "denied", error: "The caller does not have permission" }
              : { ok: true, users: 3 };
          },
        }),
      );
      expect(seen).toEqual(["reports@reddoorla.com", "backup@reddoorla.com"]);
      expect(stateOf(lines, "ga-property")).toBe("missing");
      expect(detailOf(lines, "ga-property")).toContain("backup@reddoorla.com");
    });

    it("is unverified when the API is unavailable", async () => {
      const lines = await launchCheck(
        row(),
        goodDeps({ readProperty: async () => ({ ok: false, kind: "unavailable", error: "503" }) }),
      );
      expect(stateOf(lines, "ga-property")).toBe("unverified");
    });

    it("is missing for a G- measurement ID on the row", async () => {
      const lines = await launchCheck(row({ "GA4 property ID": STREAM }), goodDeps());
      expect(stateOf(lines, "ga-property")).toBe("missing");
      expect(detailOf(lines, "ga-property")).toContain("measurement ID");
    });

    it("filters the read to the row's own hostnames", async () => {
      let hosts: string[] = [];
      await launchCheck(
        row(),
        goodDeps({
          readProperty: async (_id, _s, h) => {
            hosts = h;
            return { ok: true, users: 1 };
          },
        }),
      );
      expect(hosts).toEqual(["example.com", "www.example.com"]);
    });
  });

  describe("ga-tag", () => {
    it("is missing when the page loads some other property's tag", async () => {
      const lines = await launchCheck(
        row(),
        goodDeps({ probeTag: async () => ({ loadedIds: [OTHER], failed: [] }) }),
      );
      expect(stateOf(lines, "ga-tag")).toBe("missing");
      expect(detailOf(lines, "ga-tag")).toContain(OTHER);
    });

    it("is missing, naming CSP, when the loader is refused", async () => {
      const lines = await launchCheck(
        row(),
        goodDeps({
          probeTag: async () => ({
            loadedIds: [],
            failed: [{ id: STREAM, reason: "net::ERR_BLOCKED_BY_CSP" }],
          }),
        }),
      );
      expect(stateOf(lines, "ga-tag")).toBe("missing");
      expect(detailOf(lines, "ga-tag")).toContain("ERR_BLOCKED_BY_CSP");
    });

    it("is missing when the probe saw no loader and the HTML names none", async () => {
      const lines = await launchCheck(
        row(),
        goodDeps({ probeTag: async () => ({ loadedIds: [], failed: [] }) }),
      );
      expect(stateOf(lines, "ga-tag")).toBe("missing");
    });

    it("is only unverified when the HTML names the stream but no browser ran", async () => {
      const html = `${HOME}<script async src="https://www.googletagmanager.com/gtag/js?id=${STREAM}"></script>`;
      const lines = await launchCheck(
        row(),
        goodDeps({
          probeTag: null,
          fetchPage: pages({
            [URL_]: { status: 200, url: URL_, body: html },
            "https://www.example.com/privacy": { status: 200, url: "", body: "" },
          }),
        }),
      );
      expect(stateOf(lines, "ga-tag")).toBe("unverified");
    });

    it("is unverified when the probe throws", async () => {
      const lines = await launchCheck(
        row(),
        goodDeps({
          probeTag: async () => {
            throw new Error("chromium did not launch");
          },
        }),
      );
      expect(stateOf(lines, "ga-tag")).toBe("unverified");
      expect(detailOf(lines, "ga-tag")).toContain("chromium did not launch");
    });

    it("is missing when the property has no web stream", async () => {
      const lines = await launchCheck(
        row(),
        goodDeps({ readStreams: async () => ({ ok: true, measurementIds: [] }) }),
      );
      expect(stateOf(lines, "ga-tag")).toBe("missing");
    });

    it("is missing when the Admin API refuses the property, unverified when it is down", async () => {
      const denied = await launchCheck(
        row(),
        goodDeps({ readStreams: async () => ({ ok: false, kind: "denied", error: "403" }) }),
      );
      expect(stateOf(denied, "ga-tag")).toBe("missing");
      const down = await launchCheck(
        row(),
        goodDeps({ readStreams: async () => ({ ok: false, kind: "unavailable", error: "503" }) }),
      );
      expect(stateOf(down, "ga-tag")).toBe("unverified");
    });
  });

  it("passes both GA steps for a row that accepts `no analytics`", async () => {
    const lines = await launchCheck(
      row({ "GA4 property ID": undefined, "Accepted Watch Conditions": ["no analytics"] }),
      goodDeps({ subjects: () => null }),
    );
    expect(stateOf(lines, "ga-property")).toBe("ok");
    expect(stateOf(lines, "ga-tag")).toBe("ok");
  });

  describe("privacy", () => {
    it("is missing when /privacy 404s", async () => {
      const lines = await launchCheck(
        row(),
        goodDeps({ fetchPage: pages({ [URL_]: { status: 200, url: URL_, body: HOME } }) }),
      );
      expect(stateOf(lines, "privacy")).toBe("missing");
    });

    it("is missing when the home page does not link to it", async () => {
      const lines = await launchCheck(
        row(),
        goodDeps({
          fetchPage: pages({
            [URL_]: { status: 200, url: URL_, body: "<footer>no link</footer>" },
            "https://www.example.com/privacy": { status: 200, url: "", body: "" },
          }),
        }),
      );
      expect(stateOf(lines, "privacy")).toBe("missing");
      expect(detailOf(lines, "privacy")).toContain("does not link");
    });
  });

  it("does not count a link to another site's /privacy", async () => {
    const lines = await launchCheck(
      row(),
      goodDeps({
        fetchPage: pages({
          [URL_]: {
            status: 200,
            url: URL_,
            body: '<a href="https://policies.google.com/privacy">Google</a>',
          },
          "https://www.example.com/privacy": { status: 200, url: "", body: "" },
        }),
      }),
    );
    expect(stateOf(lines, "privacy")).toBe("missing");
  });

  it("does not count a data-href attribute as a link", async () => {
    const lines = await launchCheck(
      row(),
      goodDeps({
        fetchPage: pages({
          [URL_]: { status: 200, url: URL_, body: '<div data-href="/privacy"></div>' },
          "https://www.example.com/privacy": { status: 200, url: "", body: "" },
        }),
      }),
    );
    expect(stateOf(lines, "privacy")).toBe("missing");
  });

  it("counts an absolute link to the site's own /privacy", async () => {
    const lines = await launchCheck(
      row(),
      goodDeps({
        fetchPage: pages({
          [URL_]: {
            status: 200,
            url: URL_,
            body: '<a href="https://example.com/privacy/">Privacy</a>',
          },
          "https://www.example.com/privacy": { status: 200, url: "", body: "" },
        }),
      }),
    );
    expect(stateOf(lines, "privacy")).toBe("ok");
  });

  it("is missing a url when the home page answers 503", async () => {
    const lines = await launchCheck(
      row(),
      goodDeps({ fetchPage: pages({ [URL_]: { status: 503, url: URL_, body: "" } }) }),
    );
    expect(stateOf(lines, "url")).toBe("missing");
  });

  describe("search-console", () => {
    it("is missing when the recorded property is for another host", async () => {
      const lines = await launchCheck(
        row({ "Search Console property": "sc-domain:elsewhere.com" }),
        goodDeps(),
      );
      expect(stateOf(lines, "search-console")).toBe("missing");
    });

    it("is missing a URL-prefix property for another scheme or host", async () => {
      for (const p of ["https://example.com/", "http://www.example.com/"]) {
        const lines = await launchCheck(row({ "Search Console property": p }), goodDeps());
        expect(stateOf(lines, "search-console"), p).toBe("missing");
      }
      const exact = await launchCheck(
        row({ "Search Console property": "https://www.example.com/" }),
        goodDeps(),
      );
      expect(stateOf(exact, "search-console")).toBe("ok");
    });

    it("lets a Domain property cover a subdomain", async () => {
      const lines = await launchCheck(
        row({
          url: "https://shop.example.com/",
          "Search Console property": "sc-domain:example.com",
        }),
        goodDeps({
          fetchPage: pages({
            "https://shop.example.com/": { status: 200, url: "", body: HOME },
            "https://shop.example.com/privacy": { status: 200, url: "", body: "" },
          }),
        }),
      );
      expect(stateOf(lines, "search-console")).toBe("ok");
      const notSub = await launchCheck(
        row({ "Search Console property": "sc-domain:ample.com" }),
        goodDeps(),
      );
      expect(stateOf(notSub, "search-console")).toBe("missing");
    });

    it("is missing when the lookup finds no property", async () => {
      const lines = await launchCheck(
        row(),
        goodDeps({ readSearch: async () => ({ ok: true, propertyFound: false, property: null }) }),
      );
      expect(stateOf(lines, "search-console")).toBe("missing");
    });

    it("is missing when a subject is refused, unverified when the API is down", async () => {
      const denied = await launchCheck(
        row(),
        goodDeps({
          readSearch: async (_r, s) =>
            s === "backup@reddoorla.com"
              ? { ok: false, kind: "denied", error: "User does not have sufficient permission" }
              : { ok: true, propertyFound: true, property: "sc-domain:example.com" },
        }),
      );
      expect(stateOf(denied, "search-console")).toBe("missing");
      const down = await launchCheck(
        row(),
        goodDeps({ readSearch: async () => ({ ok: false, kind: "unavailable", error: "503" }) }),
      );
      expect(stateOf(down, "search-console")).toBe("unverified");
    });

    it("passes a row that accepts `no search console`", async () => {
      const lines = await launchCheck(
        row({
          "Search Console property": undefined,
          "Accepted Watch Conditions": ["no search console"],
        }),
        goodDeps(),
      );
      expect(stateOf(lines, "search-console")).toBe("ok");
    });
  });
});

describe("an error inside a step is unverified, never ok", () => {
  const boom = async (): Promise<never> => {
    throw new Error("boom");
  };

  it("ga-property, when the Data API read throws", async () => {
    const lines = await launchCheck(row(), goodDeps({ readProperty: boom }));
    expect(stateOf(lines, "ga-property")).toBe("unverified");
  });

  it("ga-tag, when the Admin API read throws", async () => {
    const lines = await launchCheck(row(), goodDeps({ readStreams: boom }));
    expect(stateOf(lines, "ga-tag")).toBe("unverified");
  });

  it("search-console, when the lookup throws", async () => {
    const lines = await launchCheck(row(), goodDeps({ readSearch: boom }));
    expect(stateOf(lines, "search-console")).toBe("unverified");
  });

  it("url and privacy, when the home page does not answer at all", async () => {
    const lines = await launchCheck(
      row(),
      goodDeps({
        fetchPage: pages({
          [URL_]: new Error("ECONNRESET"),
          "https://www.example.com/privacy": { status: 200, url: "", body: "" },
        }),
      }),
    );
    expect(stateOf(lines, "url")).toBe("unverified");
    expect(stateOf(lines, "privacy")).toBe("unverified");
  });

  it("privacy, when GET /privacy throws", async () => {
    const lines = await launchCheck(
      row(),
      goodDeps({
        fetchPage: pages({
          [URL_]: { status: 200, url: URL_, body: HOME },
          "https://www.example.com/privacy": new Error("ETIMEDOUT"),
        }),
      }),
    );
    expect(stateOf(lines, "privacy")).toBe("unverified");
  });
});

describe("redirects are judged where they land", () => {
  it("is missing a url that redirects off the site's hosts", async () => {
    const lines = await launchCheck(
      row(),
      goodDeps({
        fetchPage: pages({
          [URL_]: { status: 200, url: "https://parked.example.net/", body: HOME },
          "https://www.example.com/privacy": { status: 200, url: "", body: "" },
        }),
      }),
    );
    expect(stateOf(lines, "url")).toBe("missing");
    expect(detailOf(lines, "url")).toContain("parked.example.net");
  });

  it("is missing a url that redirects down to http", async () => {
    const lines = await launchCheck(
      row(),
      goodDeps({
        fetchPage: pages({
          [URL_]: { status: 200, url: "http://www.example.com/", body: HOME },
          "https://www.example.com/privacy": { status: 200, url: "", body: "" },
        }),
      }),
    );
    expect(stateOf(lines, "url")).toBe("missing");
  });

  it("is missing a url whose site lands on the other host of the pair", async () => {
    const lines = await launchCheck(
      row({ url: "https://example.com/", "Search Console property": "https://example.com/" }),
      goodDeps({
        fetchPage: pages({
          "https://example.com/": { status: 200, url: "https://www.example.com/", body: HOME },
          "https://example.com/privacy": { status: 200, url: "", body: "" },
        }),
      }),
    );
    expect(stateOf(lines, "url")).toBe("missing");
    expect(detailOf(lines, "url")).toContain("https://www.example.com/");
  });

  it("accepts a /privacy that lands on the apex/www twin", async () => {
    const lines = await launchCheck(
      row(),
      goodDeps({
        fetchPage: pages({
          [URL_]: { status: 200, url: URL_, body: HOME },
          "https://www.example.com/privacy": {
            status: 200,
            url: "https://example.com/privacy/",
            body: "",
          },
        }),
      }),
    );
    expect(stateOf(lines, "url")).toBe("ok");
    expect(stateOf(lines, "privacy")).toBe("ok");
  });

  it("is missing a /privacy that redirects to the home page", async () => {
    const lines = await launchCheck(
      row(),
      goodDeps({
        fetchPage: pages({
          [URL_]: { status: 200, url: URL_, body: HOME },
          "https://www.example.com/privacy": { status: 200, url: URL_, body: HOME },
        }),
      }),
    );
    expect(stateOf(lines, "privacy")).toBe("missing");
  });

  it("is missing a /privacy served from another host", async () => {
    const lines = await launchCheck(
      row(),
      goodDeps({
        fetchPage: pages({
          [URL_]: { status: 200, url: URL_, body: HOME },
          "https://www.example.com/privacy": {
            status: 200,
            url: "https://other.example.net/privacy",
            body: "",
          },
        }),
      }),
    );
    expect(stateOf(lines, "privacy")).toBe("missing");
  });
});

describe("blockingLines", () => {
  const lines: LaunchCheckLine[] = [
    { step: "url", state: "ok", detail: "" },
    { step: "ga-tag", state: "unverified", detail: "" },
    { step: "privacy", state: "missing", detail: "" },
  ];

  it("blocks on unverified as well as missing", () => {
    expect(blockingLines(lines, new Set()).map((l) => l.step)).toEqual(["ga-tag", "privacy"]);
  });

  it("lets through only the steps named", () => {
    expect(blockingLines(lines, new Set(["privacy"])).map((l) => l.step)).toEqual(["ga-tag"]);
  });
});

describe("parseAllowMissing", () => {
  it("takes repeated and comma-separated steps", () => {
    const r = parseAllowMissing(["privacy,ga-tag", "schedule"]);
    expect(r.ok && [...r.steps]).toEqual(["privacy", "ga-tag", "schedule"]);
  });

  it("refuses an unknown step rather than ignoring it", () => {
    const r = parseAllowMissing("privcy");
    expect(r.ok).toBe(false);
  });

  it("allows nothing when absent", () => {
    const r = parseAllowMissing(undefined);
    expect(r.ok && r.steps.size).toBe(0);
  });
});

describe("formatLaunchCheck", () => {
  it("prints one line per step and a summary line", () => {
    const out = formatLaunchCheck("example", [
      { step: "url", state: "ok", detail: "answers 200" },
      { step: "privacy", state: "missing", detail: "404" },
    ]);
    expect(out.split("\n")).toEqual([
      "[example] launch-check — NOT READY",
      "url             ok         answers 200",
      "privacy         missing    404",
      "LAUNCH_CHECK_SUMMARY site=example ready=false ok=1 missing=1 unverified=0",
    ]);
  });
});

describe("runLaunchCheckCommand", () => {
  it("exits 0 for a ready site and 1 for Williamson", async () => {
    const roster = async () => [row(), williamson()];
    const good = await runLaunchCheckCommand("example-co", { roster, check: goodDeps() });
    expect(good.code).toBe(0);
    const bad = await runLaunchCheckCommand("williamson-construction-co", {
      roster,
      check: goodDeps(),
    });
    expect(bad.code).toBe(1);
    expect(bad.output).toContain("ready=false");
  });

  it("exits 1 for a site with no row", async () => {
    const r = await runLaunchCheckCommand("nope", { roster: async () => [], check: goodDeps() });
    expect(r.code).toBe(1);
  });
});
