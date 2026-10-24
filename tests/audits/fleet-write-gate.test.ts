import { describe, it, expect } from "vitest";
import {
  writeFleetAudits,
  formatFleetWriteSummary,
  fleetWriteGate,
  type FleetWriteResult,
} from "../../src/audits/write-audits.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";
import { recordingMirror } from "../_helpers/recording-mirror.js";
import type { AuditName, AuditResult } from "../../src/types.js";

/**
 * #1605: three ways the shared write gate went green with nothing measured, each
 * reproduced by the P1-33 next-5 sweep at ac83236e. Every red case below has a
 * control beside it that must stay green, and the first describe is the known-good
 * fleet: a stricter gate that reds a healthy night is the gate's bug.
 */

const CHECKED_AT = "2026-10-21T06:30:00.000Z";

/** A result that carries data, in the shape each audit's `has*` predicate accepts. */
function measured(audit: AuditName, site: string): AuditResult {
  const details: Record<AuditName, unknown> = {
    lighthouse: { summary: { performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 } },
    domain: { certDaysRemaining: 60, checkedAt: CHECKED_AT },
    browser: { desktopOk: true, mobileOk: true, checkedAt: CHECKED_AT },
    "netlify-deploy": { state: "ready", checkedAt: CHECKED_AT },
    "function-health": { ok: true, prismic: "ok", checkedAt: CHECKED_AT },
    smoke: { ok: "pass", checkedAt: CHECKED_AT },
    security: { counts: { critical: 0, high: 0, moderate: 0, low: 0 }, advisories: [] },
    "form-e2e": { ok: "pass", formPresent: true, checkedAt: CHECKED_AT },
    deps: undefined,
    a11y: undefined,
    lint: undefined,
    analytics: undefined,
  };
  return { audit, site, status: "pass", summary: `${audit} ok`, details: details[audit] };
}

/** A result with no data: what an install failure, an unreadable lockfile or a runner
 *  that threw leaves behind. */
function blind(
  audit: AuditName,
  site: string,
  summary: string,
  status: AuditResult["status"] = "skip",
): AuditResult {
  return { audit, site, status, summary };
}

const LIGHTHOUSE_SWEEP: AuditName[] = [
  "lighthouse",
  "domain",
  "browser",
  "netlify-deploy",
  "function-health",
];

function fleet(n: number): { slugs: string[]; websites: ReturnType<typeof websiteRowsFrom> } {
  const slugs = Array.from({ length: n }, (_, i) => `site-${i}`);
  return {
    slugs,
    websites: websiteRowsFrom(
      slugs.map((s, i) => ({ id: `rec${i}`, fields: { Name: s, Status: "maintenance" } })),
    ),
  };
}

async function sweep(args: {
  n: number;
  results: (slug: string, i: number) => AuditResult[];
  expected?: number;
  mirror?: (siteId: string, fields: Record<string, unknown>) => Promise<boolean>;
}): Promise<{ result: FleetWriteResult; out: string }> {
  const { slugs, websites } = fleet(Math.max(args.n, args.expected ?? 0));
  const results = slugs.slice(0, args.n).flatMap((s, i) => args.results(s, i));
  const result = await writeFleetAudits({
    websites,
    results,
    mirror: args.mirror ?? recordingMirror().mirror,
    ...(args.expected !== undefined ? { expectedSites: slugs.slice(0, args.expected) } : {}),
  });
  return { result, out: formatFleetWriteSummary(result) };
}

describe("known-good first: a healthy fleet stays green with nothing to warn about", () => {
  it("17 sites, every lighthouse-sweep audit measured, all resolved sites present", async () => {
    // The 10-20 nightly's shape: fleet-lighthouse `wrote=17 failed=0 total=17`, every
    // site with all five audits reporting data (run 39554652180).
    const { result, out } = await sweep({
      n: 17,
      expected: 17,
      results: (s) => LIGHTHOUSE_SWEEP.map((a) => measured(a, s)),
    });
    expect(fleetWriteGate(result)).toEqual({ red: false, reasons: [], warnings: [] });
    expect(out).toContain("FLEET_WRITE_SUMMARY wrote=17 failed=0 total=17");
    expect(out).toContain("\nFLEET_WRITE_GATE verdict=green");
    expect(out).not.toContain("FLEET_WRITE_GATE_");
  });

  it("a site that skips by design is counted as not applicable, and stays green", async () => {
    // Two of four sites have not adopted `test:smoke` (the rollout fleet-smoke.yml
    // describes). They are neither written nor failed, and they are counted.
    const { result, out } = await sweep({
      n: 4,
      expected: 4,
      results: (s, i) =>
        i < 2
          ? [measured("smoke", s)]
          : [{ ...blind("smoke", s, "no test:smoke script"), notApplicable: true }],
    });
    expect(result.written).toHaveLength(2);
    expect(result.failed).toEqual([]);
    expect(result.notApplicable).toEqual(["site-2", "site-3"]);
    expect(out).toContain("FLEET_WRITE_SUMMARY wrote=2 failed=0 total=4");
    expect(out).toContain(" na=2 missing=0");
    expect(fleetWriteGate(result).red).toBe(false);
  });
});

describe("1. a site whose audits wrote nothing is never `written`", () => {
  it.each([
    ["smoke", "smoke: pnpm install failed (exit 1) — deps unavailable"],
    ["security", "cannot run audit — pnpm: no lockfile; npm: no lockfile"],
    [
      "form-e2e",
      "live form-e2e disabled (central testMode ingest suppression not yet wired — set REDDOOR_FORM_E2E_LIVE=1 once it is)",
    ],
  ] as const)("%s measuring nothing on every site reds the gate", async (audit, summary) => {
    const { result, out } = await sweep({
      n: 4,
      expected: 4,
      results: (s) => [blind(audit, s, summary)],
    });
    expect(result.written).toEqual([]);
    expect(result.failed.map((f) => f.slug)).toEqual(["site-0", "site-1", "site-2", "site-3"]);
    expect(result.failed[0]!.error).toBe(`nothing measured: ${audit}: ${summary}`);
    expect(out).toContain("FLEET_WRITE_SUMMARY wrote=0 failed=4 total=4");
    expect(out).toContain("\nFLEET_WRITE_GATE verdict=red");
  });

  it("control: the same failure on one site of eight warns and stays green", async () => {
    const { result } = await sweep({
      n: 8,
      expected: 8,
      results: (s, i) =>
        i === 0
          ? [blind("smoke", s, "smoke: pnpm install failed (exit 1)")]
          : [measured("smoke", s)],
    });
    const gate = fleetWriteGate(result);
    expect(gate.red).toBe(false);
    expect(gate.warnings).toContain("1 of 8 site(s) not written");
  });

  it("lighthouse landed but browser and function-health measured nothing on every site: red", async () => {
    // The sweep's lighthouse case: `wrote=10 failed=0`, exit 0, with two of five audits
    // broken fleet-wide. The site is written (its scores landed); the audits are not.
    const { result, out } = await sweep({
      n: 10,
      expected: 10,
      results: (s) => [
        measured("lighthouse", s),
        measured("domain", s),
        measured("netlify-deploy", s),
        blind("browser", s, "browser: unexpected error — Error: browserType.launch", "fail"),
        blind("function-health", s, "health endpoint unreachable / not adopted"),
      ],
    });
    expect(result.written).toHaveLength(10);
    const gate = fleetWriteGate(result);
    expect(gate.red).toBe(true);
    expect(gate.reasons.some((r) => r.startsWith("browser measured nothing on 10 of 10"))).toBe(
      true,
    );
    expect(
      gate.reasons.some((r) => r.startsWith("function-health measured nothing on 10 of 10")),
    ).toBe(true);
    expect(out).toContain("\nFLEET_WRITE_GATE_REASON browser measured nothing on 10 of 10");
  });

  it("control: one site whose /health is unreachable warns, names the site, and stays green", async () => {
    const { result, out } = await sweep({
      n: 10,
      expected: 10,
      results: (s, i) =>
        LIGHTHOUSE_SWEEP.map((a) =>
          a === "function-health" && i === 3
            ? blind(a, s, "health endpoint unreachable / not adopted")
            : measured(a, s),
        ),
    });
    expect(fleetWriteGate(result).red).toBe(false);
    expect(out).toContain(
      "\nFLEET_WRITE_GATE_WARNING function-health measured nothing on 1 of 10 site(s): site-3",
    );
  });

  it("a site with no deployed URL is not applicable for the URL audits, not blind", async () => {
    const { result } = await sweep({
      n: 4,
      expected: 4,
      results: (s, i) =>
        i === 0
          ? [
              measured("lighthouse", s),
              { ...blind("browser", s, "no deployed URL"), notApplicable: true },
              { ...blind("function-health", s, "no deployed URL"), notApplicable: true },
            ]
          : [measured("lighthouse", s), measured("browser", s), measured("function-health", s)],
    });
    expect(result.unmeasuredAudits).toEqual({});
    expect(fleetWriteGate(result)).toEqual({ red: false, reasons: [], warnings: [] });
  });
});

describe("2. `total` is checked against the sites the run resolved, not derived from itself", () => {
  it("the roster read returns 4 sites but only 1 reaches write-back: red", async () => {
    const { result, out } = await sweep({
      n: 1,
      expected: 4,
      results: (s) => [measured("smoke", s)],
    });
    expect(result.missing).toEqual(["site-1", "site-2", "site-3"]);
    expect(out).toContain("FLEET_WRITE_SUMMARY wrote=1 failed=0 total=4");
    expect(out).toContain(" missing=3");
    expect(out).toContain(
      "⚠ 3 site(s) on the roster never reached write-back: site-1, site-2, site-3",
    );
    expect(fleetWriteGate(result).red).toBe(true);
  });

  it("8 of 10 sites dropped at prep: red", async () => {
    const { result } = await sweep({
      n: 2,
      expected: 10,
      results: (s) => [measured("security", s)],
    });
    expect(result.missing).toHaveLength(8);
    expect(fleetWriteGate(result).reasons).toContain(
      "8 of 10 site(s) not written or missing (>25%)",
    );
  });

  it("control: one site of ten dropped at prep warns, names it, and stays green", async () => {
    const { result } = await sweep({
      n: 9,
      expected: 10,
      results: (s) => [measured("security", s)],
    });
    const gate = fleetWriteGate(result);
    expect(gate.red).toBe(false);
    expect(gate.warnings).toContain("1 of 10 site(s) never reached write-back: site-9");
  });

  it("without a resolved roster (a single-site or JSON-less caller) nothing is missing", async () => {
    const { result, out } = await sweep({ n: 2, results: (s) => [measured("smoke", s)] });
    expect(result.missing).toBeUndefined();
    expect(out).toContain(" na=0 missing=0");
  });
});

describe("3. a failure that recurs every night is not a flake", () => {
  it("one site of ten with no site_health row reds the gate", async () => {
    const { result, out } = await sweep({
      n: 10,
      expected: 10,
      results: (s) => [measured("smoke", s)],
      mirror: async (siteId) => siteId !== "rec4",
    });
    expect(result.mirrorMissed).toBe(1);
    expect(out).toContain("\nFLEET_WRITE_GATE verdict=red");
    expect(out).toContain("\nFLEET_WRITE_GATE_REASON 1 site(s) with no row to write to: site-4");
  });

  it("one site of ten whose result names no site row reds the gate", () => {
    const result: FleetWriteResult = {
      written: Array.from({ length: 9 }, (_, i) => ({ siteName: `s${i}`, writes: [] })),
      failed: [{ slug: "ghost", error: 'No Websites row matched slug "ghost"' }],
    };
    expect(fleetWriteGate(result).red).toBe(true);
  });

  it("control: one site of ten whose Turso write threw once is a flake: warn, stay green", async () => {
    const { result } = await sweep({
      n: 10,
      expected: 10,
      results: (s) => [measured("smoke", s)],
      mirror: async (siteId) => {
        if (siteId === "rec4") throw new Error("HTTP 503");
        return true;
      },
    });
    const gate = fleetWriteGate(result);
    expect(gate.red).toBe(false);
    expect(gate.warnings).toEqual(["1 of 10 site(s) not written"]);
  });
});

describe("the verdict line's contract", () => {
  it("prints exactly one verdict line, after the summary line", async () => {
    const { out } = await sweep({ n: 2, expected: 2, results: (s) => [measured("smoke", s)] });
    const lines = out.split("\n");
    const summaryAt = lines.findIndex((l) => l.startsWith("FLEET_WRITE_SUMMARY "));
    const verdicts = lines.filter((l) => /^FLEET_WRITE_GATE verdict=(red|green)$/.test(l));
    expect(verdicts).toEqual(["FLEET_WRITE_GATE verdict=green"]);
    expect(lines.indexOf(verdicts[0]!)).toBe(summaryAt + 1);
  });

  it("wrote=0 of an empty run is red: a sweep that attempted nothing measured nothing", () => {
    expect(fleetWriteGate({ written: [], failed: [] }).reasons).toEqual(["wrote 0 of 0 site(s)"]);
  });
});

describe("review round 1: the denominators count only sites with something to measure", () => {
  it("four blind adopters among thirteen sites with no smoke script is red, not diluted", async () => {
    // 18 sites: 1 measured, 4 whose deps would not install, 13 that have not adopted
    // `test:smoke`. Four of the five measurable sites are blind.
    const { result, out } = await sweep({
      n: 18,
      expected: 18,
      results: (s, i) =>
        i === 0
          ? [measured("smoke", s)]
          : i <= 4
            ? [blind("smoke", s, "smoke: pnpm install failed (exit 1) — deps unavailable")]
            : [{ ...blind("smoke", s, "no test:smoke script"), notApplicable: true }],
    });
    expect(out).toContain("FLEET_WRITE_SUMMARY wrote=1 failed=4 total=18");
    const gate = fleetWriteGate(result);
    expect(gate.reasons).toContain("4 of 5 site(s) not written or missing (>25%)");
    // The per-audit share counts the blind sites as applicable, not only the written one.
    expect(gate.reasons).toContain(
      "smoke measured nothing on 4 of 5 site(s): site-1, site-2, site-3, site-4 (>25%)",
    );
  });

  it("an audit is judged against the sites it applied to: netlify blind on 2 of its 2", async () => {
    const { result } = await sweep({
      n: 8,
      expected: 8,
      results: (s, i) => [
        measured("lighthouse", s),
        i < 6
          ? { ...blind("netlify-deploy", s, "no netlify id"), notApplicable: true }
          : blind("netlify-deploy", s, "no NETLIFY_PAT"),
      ],
    });
    expect(fleetWriteGate(result).reasons).toContain(
      "netlify-deploy measured nothing on 2 of 2 site(s): site-6, site-7 (>25%)",
    );
  });

  it("exactly a quarter is a warning, not red: 2 of 8 sites short", async () => {
    const { result } = await sweep({ n: 6, expected: 8, results: (s) => [measured("smoke", s)] });
    const gate = fleetWriteGate(result);
    expect(gate.red).toBe(false);
    expect(gate.warnings).toContain("2 of 8 site(s) never reached write-back: site-6, site-7");
  });

  it("exactly a quarter is a warning, not red: one audit blind on 1 of 4 sites", async () => {
    const { result } = await sweep({
      n: 4,
      expected: 4,
      results: (s, i) => [
        measured("lighthouse", s),
        i === 0
          ? blind("domain", s, "domain: unexpected error — ENOTFOUND", "fail")
          : measured("domain", s),
      ],
    });
    const gate = fleetWriteGate(result);
    expect(gate.red).toBe(false);
    expect(gate.warnings).toEqual(["domain measured nothing on 1 of 4 site(s): site-0"]);
  });
});

describe("review round 1: every persisted audit is watched", () => {
  it.each([
    "a11y",
    "deps",
    "security",
    "domain",
    "browser",
    "netlify-deploy",
    "function-health",
    "smoke",
    "form-e2e",
  ] as const)(
    "%s measuring nothing on every site, beside a lighthouse that landed, is red",
    async (audit) => {
      const { result } = await sweep({
        n: 4,
        expected: 4,
        results: (s) => [
          measured("lighthouse", s),
          blind(audit, s, `${audit}: unexpected error — boom`, "fail"),
        ],
      });
      expect(result.written).toHaveLength(4);
      expect(fleetWriteGate(result).reasons).toContain(
        `${audit} measured nothing on 4 of 4 site(s): site-0, site-1, site-2, site-3 (>25%)`,
      );
    },
  );

  it("a site whose lighthouse missed and whose other audit does not apply is failed, not n/a", async () => {
    const { result } = await sweep({
      n: 4,
      expected: 4,
      results: (s, i) => [
        i === 0
          ? {
              audit: "lighthouse",
              site: s,
              status: "fail",
              summary: "lighthouse: no scores",
              details: { summary: {} },
            }
          : measured("lighthouse", s),
        { ...blind("browser", s, "no deployed URL"), notApplicable: true },
      ],
    });
    expect(result.notApplicable).toEqual([]);
    expect(result.failed.map((f) => f.slug)).toEqual(["site-0"]);
    expect(result.failed[0]!.error).toMatch(/^Lighthouse audit produced no scores/);
    // Filed once, as a lighthouse failure, not again as an audit that measured nothing.
    expect(result.unmeasuredAudits).toEqual({});
  });
});

describe("review round 1: the real paths, not hand-built results", () => {
  it("a result whose slug has no site row reds the gate through planAuditWrite's own throw", async () => {
    const { websites } = fleet(8);
    const results = [...fleet(8).slugs, "ghost-site"].map((s) => measured("smoke", s));
    const result = await writeFleetAudits({ websites, results, mirror: recordingMirror().mirror });
    const out = formatFleetWriteSummary(result);
    expect(out).toContain("\nFLEET_WRITE_GATE verdict=red");
    expect(out).toContain(
      "\nFLEET_WRITE_GATE_REASON 1 site(s) with no row to write to: ghost-site",
    );
  });

  it.each([2, 3, 12])(
    "the Prismic sweep's ambiguous match (%i rows) is as permanent as no match",
    (n) => {
      const result: FleetWriteResult = {
        written: Array.from({ length: 9 }, (_, i) => ({ siteName: `s${i}`, writes: [] })),
        failed: [{ slug: "twin", error: `${n} Websites rows match "Twin" — refusing to guess` }],
      };
      expect(fleetWriteGate(result).reasons).toEqual(["1 site(s) with no row to write to: twin"]);
    },
  );

  it("a slug listed twice in the roster is missing once, and an audit miss counts it once", async () => {
    const { websites } = fleet(4);
    const twin = websiteRowsFrom([
      { id: "recTwin", fields: { Name: "site-0", Status: "maintenance" } },
    ]);
    const result = await writeFleetAudits({
      websites: [...websites, ...twin],
      results: [
        measured("lighthouse", "site-0"),
        blind("browser", "site-0", "browser: unexpected error — boom", "fail"),
        blind("browser", "site-0", "browser: unexpected error — boom", "fail"),
        ...["site-1", "site-2"].flatMap((s) => [measured("lighthouse", s), measured("browser", s)]),
      ],
      mirror: recordingMirror().mirror,
      expectedSites: ["site-0", "site-1", "site-2", "site-3", "site-3"],
    });
    expect(result.missing).toEqual(["site-3"]);
    expect(result.unmeasuredAudits?.browser).toEqual(["site-0"]);
    // Counted once as applicable too: 1 of 3 is red, where a double count (1 of 4) is not.
    expect(result.applicableAudits?.browser).toEqual(["site-0", "site-1", "site-2"]);
    expect(fleetWriteGate(result).reasons).toContain(
      "browser measured nothing on 1 of 3 site(s): site-0 (>25%)",
    );
  });
});

describe("review round 2", () => {
  it("warnings count against the sites owed a write, not the n/a ones", async () => {
    // 13 sites: 4 with no smoke script, one whose Turso write threw, 8 written.
    const { result } = await sweep({
      n: 13,
      expected: 13,
      results: (s, i) =>
        i < 4
          ? [{ ...blind("smoke", s, "no test:smoke script"), notApplicable: true }]
          : [measured("smoke", s)],
      mirror: async (siteId) => {
        if (siteId === "rec4") throw new Error("HTTP 503");
        return true;
      },
    });
    expect(fleetWriteGate(result).warnings).toEqual(["1 of 9 site(s) not written"]);
  });

  it("the missing-site warning counts against the sites owed a write too", async () => {
    const { result } = await sweep({
      n: 12,
      expected: 13,
      results: (s, i) =>
        i < 4
          ? [{ ...blind("smoke", s, "no test:smoke script"), notApplicable: true }]
          : [measured("smoke", s)],
    });
    expect(fleetWriteGate(result).warnings).toEqual([
      "1 of 9 site(s) never reached write-back: site-12",
    ]);
  });

  it("every site not applicable is red, and says so rather than blaming the write", async () => {
    const { result } = await sweep({
      n: 3,
      expected: 3,
      results: (s) => [{ ...blind("smoke", s, "no test:smoke script"), notApplicable: true }],
    });
    expect(fleetWriteGate(result)).toEqual({
      red: true,
      reasons: ["every one of 3 site(s) was not applicable: nothing was measured"],
      warnings: [],
    });
  });
});

describe("#1698: a site that ran and had nothing new to write kept its verdicts", () => {
  const unread = (site: string): AuditResult => ({
    audit: "form-e2e",
    site,
    status: "skip",
    summary: "site /health could not be read (timed out after 10s) — probe refused",
    details: { checkedAt: CHECKED_AT },
  });

  it("is named as kept, not written, failed or not applicable, and stays green", async () => {
    const { result, out } = await sweep({
      n: 4,
      expected: 4,
      results: (s, i) => [i === 0 ? unread(s) : measured("form-e2e", s)],
    });
    expect(result.written).toHaveLength(3);
    expect(result.failed).toEqual([]);
    expect(result.notApplicable).toEqual([]);
    expect(result.kept).toEqual([{ slug: "site-0", reason: `form-e2e: ${unread("x").summary}` }]);
    expect(out).toContain(
      `· 1 site(s) kept their verdicts, nothing new to write: site-0 (form-e2e: ${unread("x").summary})`,
    );
    expect(out).toContain("FLEET_WRITE_SUMMARY wrote=3 failed=0 total=4");
    expect(out).toContain(" kept=1");
    expect(fleetWriteGate(result)).toEqual({ red: false, reasons: [], warnings: [] });
  });

  it("every site kept is red, under a reason that names what the audits said", async () => {
    const { result } = await sweep({ n: 7, expected: 7, results: (s) => [unread(s)] });
    const gate = fleetWriteGate(result);
    expect(gate.red).toBe(true);
    expect(gate.reasons).toHaveLength(1);
    // Each reason once, with the sites that gave it.
    expect(gate.reasons[0]).toBe(
      `every one of 7 site(s) had nothing new to write and kept its verdicts — ` +
        `form-e2e: ${unread("x").summary}: site-0, site-1, site-2, site-3, site-4 and 2 more`,
    );
  });

  it("a night that wrote nothing, mostly kept, says so rather than blaming the store", async () => {
    // Seven sites' /health unreadable and one runner that threw: on main this night
    // wrote seven nulls; here it writes nothing, and must not read as a Turso outage.
    const { result } = await sweep({
      n: 8,
      expected: 8,
      results: (s, i) =>
        i === 7
          ? [blind("form-e2e", s, "browserType.launch: Timeout 30000ms exceeded", "fail")]
          : [unread(s)],
    });
    const gate = fleetWriteGate(result);
    expect(gate.red).toBe(true);
    expect(gate.reasons[0]).toBe(
      `wrote 0 of 8 site(s): 7 had nothing new to write and kept their verdicts — ` +
        `form-e2e: ${unread("x").summary}: site-0, site-1, site-2, site-3, site-4 and 2 more`,
    );
  });

  it("a site whose every audit said not applicable is still not applicable", async () => {
    const { result } = await sweep({
      n: 2,
      expected: 2,
      results: (s, i) =>
        i === 0
          ? [measured("smoke", s)]
          : [{ ...blind("smoke", s, "no test:smoke script"), notApplicable: true }],
    });
    expect(result.notApplicable).toEqual(["site-1"]);
    expect(result.kept).toEqual([]);
  });
});
