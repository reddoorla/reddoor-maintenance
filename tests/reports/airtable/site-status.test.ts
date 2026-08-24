import { describe, it, expect } from "vitest";
import {
  canonicalizeStatus,
  toAirtableStatus,
  AIRTABLE_USES_NEW_VOCABULARY,
  CANONICAL_STATUSES,
  AIRTABLE_STATUS_ALIASES,
  type Status,
} from "../../../src/reports/airtable/site-status.js";
import {
  ACTIVE_STATUSES,
  PRE_LAUNCH_STATUSES,
  ARCHIVED_STATUSES,
  KNOWN_STATUSES,
  isDashboardVisible,
  isPreLaunch,
  isArchivedStatus,
  isUnrecognizedStatus,
  mapRow,
  type WebsiteRow,
} from "../../../src/reports/airtable/websites.js";
import { ELIGIBLE_STATUSES } from "../../../src/reports/due.js";

/**
 * THE behaviour-equivalence instrument for the #539 Phase 4 status-vocabulary
 * rename (stage 1).
 *
 * BASELINE below was captured by RUNNING every status predicate over every
 * Airtable Status cell value against the PRE-RENAME code (origin/main @ 5a97866),
 * not by reading it off the source. It is a frozen record of what the fleet
 * selected before the rename. Every row must still hold after canonicalization,
 * so a mis-mapped alias (`hosting` → `maintained`, say) fails HERE with a named
 * row rather than silently changing which sites get audited, reported on, or
 * notified.
 *
 * Two rows are load-bearing beyond the obvious:
 *  - `launch period` is TRUE for BOTH `dashboardVisible` and `preLaunch`. That
 *    dual membership (cockpit-visible, not production-audited) is deliberate and
 *    was explicitly re-approved as-is with the vocabulary — it is NOT a bug to
 *    fix under cover of a rename.
 *  - `(empty)` — a non-blank-but-empty cell — is `unrecognized: true`, NOT null.
 *    `due.ts`/`preflight.ts` treat a null status as eligible-by-default, so
 *    nulling anything non-absent would ACTIVATE the row.
 */
const BASELINE = {
  "in development": {
    dashboardVisible: false,
    preLaunch: true,
    archived: false,
    unrecognized: false,
    eligible: false,
    active: false,
    known: true,
    spamHandling: false,
    notifyToPoc: false,
  },
  "launch period": {
    dashboardVisible: true,
    preLaunch: true,
    archived: false,
    unrecognized: false,
    eligible: false,
    active: true,
    known: true,
    spamHandling: true,
    notifyToPoc: false,
  },
  maintenance: {
    dashboardVisible: true,
    preLaunch: false,
    archived: false,
    unrecognized: false,
    eligible: true,
    active: true,
    known: true,
    spamHandling: true,
    notifyToPoc: true,
  },
  hosting: {
    dashboardVisible: false,
    preLaunch: false,
    archived: false,
    unrecognized: false,
    eligible: true,
    active: false,
    known: true,
    spamHandling: true,
    notifyToPoc: false,
  },
  "probably not our problem": {
    dashboardVisible: false,
    preLaunch: false,
    archived: false,
    unrecognized: false,
    eligible: false,
    active: false,
    known: true,
    spamHandling: true,
    notifyToPoc: false,
  },
  legacy: {
    dashboardVisible: false,
    preLaunch: false,
    archived: true,
    unrecognized: false,
    eligible: false,
    active: false,
    known: true,
    spamHandling: true,
    notifyToPoc: false,
  },
  deprecated: {
    dashboardVisible: false,
    preLaunch: false,
    archived: true,
    unrecognized: false,
    eligible: false,
    active: false,
    known: true,
    spamHandling: true,
    notifyToPoc: false,
  },
  // A genuine typo: outside the union in BOTH vocabularies.
  wat: {
    dashboardVisible: false,
    preLaunch: false,
    archived: false,
    unrecognized: true,
    eligible: false,
    active: false,
    known: false,
    spamHandling: true,
    notifyToPoc: false,
  },
  "(empty)": {
    dashboardVisible: false,
    preLaunch: false,
    archived: false,
    unrecognized: true,
    eligible: false,
    active: false,
    known: false,
    spamHandling: true,
    notifyToPoc: false,
  },
  "(null)": {
    dashboardVisible: false,
    preLaunch: false,
    archived: false,
    unrecognized: false,
    eligible: false,
    active: false,
    known: false,
    spamHandling: true,
    notifyToPoc: false,
  },
} as const;

/** The Airtable cell a BASELINE key stands for. */
function cellFor(key: string): unknown {
  if (key === "(null)") return undefined;
  if (key === "(empty)") return "";
  return key;
}

/** Every predicate that reads a site Status, evaluated on a canonical value.
 *  `spamHandling` is `src/forms/ingest.ts`'s gate and `notifyToPoc` is
 *  `src/forms/notify.ts`'s — the two inline literal comparisons the rename
 *  touches, restated here so a mis-mapped alias moves them too. */
function predicates(status: Status | null) {
  return {
    dashboardVisible: isDashboardVisible({ status } as WebsiteRow),
    preLaunch: isPreLaunch(status),
    archived: isArchivedStatus(status),
    unrecognized: isUnrecognizedStatus(status),
    eligible: status !== null && ELIGIBLE_STATUSES.has(status),
    active: status !== null && ACTIVE_STATUSES.has(status),
    known: status !== null && KNOWN_STATUSES.has(status),
    spamHandling: status !== "building",
    notifyToPoc: status === "maintained",
  };
}

describe("site-status: behaviour equivalence across the vocabulary rename", () => {
  for (const [key, expected] of Object.entries(BASELINE)) {
    it(`Airtable cell ${JSON.stringify(key)} selects exactly what it selected before the rename`, () => {
      expect(predicates(canonicalizeStatus(cellFor(key)))).toEqual(expected);
    });
  }

  it("covers every Airtable Status value the alias map knows, plus a typo and both blanks", () => {
    // A new alias with no BASELINE row would slip through the loop above
    // unmeasured — this is the completeness gate on the table.
    for (const old of Object.keys(AIRTABLE_STATUS_ALIASES)) {
      expect(BASELINE, `BASELINE has no row for the alias '${old}'`).toHaveProperty(old);
    }
  });

  it("reaches every canonical status (no canonical value is left unexercised)", () => {
    const reached = new Set(
      Object.keys(BASELINE)
        .map((k) => canonicalizeStatus(cellFor(k)))
        .filter((s): s is Status => s !== null),
    );
    for (const s of CANONICAL_STATUSES) {
      expect(reached, `no BASELINE row canonicalizes to '${s}'`).toContain(s);
    }
  });
});

describe("canonicalizeStatus", () => {
  it("maps every old Airtable name to its approved canonical name", () => {
    expect(canonicalizeStatus("in development")).toBe("building");
    expect(canonicalizeStatus("launch period")).toBe("launching");
    expect(canonicalizeStatus("maintenance")).toBe("maintained");
    expect(canonicalizeStatus("hosting")).toBe("hosted-only");
    expect(canonicalizeStatus("probably not our problem")).toBe("external");
    expect(canonicalizeStatus("legacy")).toBe("archived");
    expect(canonicalizeStatus("deprecated")).toBe("archived");
  });

  it("passes a canonical name through unchanged (stage 2 reads the SAME code)", () => {
    for (const s of CANONICAL_STATUSES) expect(canonicalizeStatus(s)).toBe(s);
  });

  it("returns null only for an ABSENT cell — never for a present one", () => {
    expect(canonicalizeStatus(undefined)).toBeNull();
    expect(canonicalizeStatus(null)).toBeNull();
    expect(canonicalizeStatus(42)).toBeNull(); // non-string cell shape
    // Present-but-unknown must survive: due.ts/preflight.ts treat null as
    // eligible-by-default, so nulling a typo would ACTIVATE the row.
    expect(canonicalizeStatus("wat")).toBe("wat");
    expect(canonicalizeStatus("")).toBe("");
    expect(canonicalizeStatus("maintenance ")).toBe("maintenance "); // padded ≠ known
  });

  it("does NOT flag an old-vocabulary cell as unrecognized (the transition-window pin)", () => {
    for (const old of Object.keys(AIRTABLE_STATUS_ALIASES)) {
      expect(isUnrecognizedStatus(canonicalizeStatus(old)), `'${old}' must not alarm`).toBe(false);
    }
  });

  it("still flags a genuine typo as unrecognized", () => {
    expect(isUnrecognizedStatus(canonicalizeStatus("maintenence"))).toBe(true);
    expect(isUnrecognizedStatus(canonicalizeStatus("maintenance "))).toBe(true);
    expect(isUnrecognizedStatus(canonicalizeStatus("wat"))).toBe(true);
  });
});

describe("toAirtableStatus (stage 1: the Airtable single-select still holds OLD options)", () => {
  it("is still switched to the OLD vocabulary — stage 2 flips this ONE constant", () => {
    expect(AIRTABLE_USES_NEW_VOCABULARY).toBe(false);
  });

  it("emits the OLD Airtable option for every canonical status", () => {
    expect(toAirtableStatus("building")).toBe("in development");
    expect(toAirtableStatus("launching")).toBe("launch period");
    expect(toAirtableStatus("maintained")).toBe("maintenance");
    expect(toAirtableStatus("hosted-only")).toBe("hosting");
    expect(toAirtableStatus("external")).toBe("probably not our problem");
    // Many-to-one: `legacy` AND `deprecated` both canonicalize to `archived`, so
    // there is no reverse map. "deprecated" is the DELIBERATE choice — it is the
    // archived option the dashboard status editor offers today, and site-details
    // documents `legacy` as Airtable-only. Writing back what the editor offers
    // keeps that dropdown byte-identical this stage.
    expect(toAirtableStatus("archived")).toBe("deprecated");
  });

  it("round-trips: every canonical status survives write-then-read", () => {
    for (const s of CANONICAL_STATUSES) {
      expect(canonicalizeStatus(toAirtableStatus(s))).toBe(s);
    }
  });

  it("passes an unknown blind-cast value through verbatim (the --restore escape hatch)", () => {
    // `forms-notify-target --restore <status>` takes operator free text. Today it
    // writes it verbatim; that must not change into a silent substitution.
    expect(toAirtableStatus("something else" as Status)).toBe("something else");
  });
});

describe("mapRow status seam", () => {
  const row = (fields: Record<string, unknown>): WebsiteRow =>
    mapRow({ id: "recTEST", fields: { Name: "Acme", ...fields } });

  it("canonicalizes the Airtable cell at the read boundary", () => {
    expect(row({ Status: "maintenance" }).status).toBe("maintained");
    expect(row({ Status: "legacy" }).status).toBe("archived");
  });

  it("accepts a NEW-vocabulary cell too (so stage 2 needs no reader change)", () => {
    expect(row({ Status: "maintained" }).status).toBe("maintained");
  });

  it("keeps an unrecognized cell NON-NULL so it cannot become eligible-by-default", () => {
    const r = row({ Status: "wat" });
    expect(r.status).toBe("wat");
    expect(isUnrecognizedStatus(r.status)).toBe(true);
  });

  it("maps an absent Status cell to null", () => {
    expect(row({}).status).toBeNull();
  });

  it("preserves the RAW cell in statusRaw (what the dashboard editor round-trips)", () => {
    expect(row({ Status: "legacy" }).statusRaw).toBe("legacy");
    expect(row({ Status: "maintenance" }).statusRaw).toBe("maintenance");
    expect(row({}).statusRaw).toBeNull();
  });
});

describe("the four status sets are stated in the canonical vocabulary", () => {
  it("holds only canonical values", () => {
    const canonical = new Set<string>(CANONICAL_STATUSES);
    for (const [name, set] of [
      ["ACTIVE_STATUSES", ACTIVE_STATUSES],
      ["PRE_LAUNCH_STATUSES", PRE_LAUNCH_STATUSES],
      ["ARCHIVED_STATUSES", ARCHIVED_STATUSES],
      ["KNOWN_STATUSES", KNOWN_STATUSES],
      ["ELIGIBLE_STATUSES", ELIGIBLE_STATUSES],
    ] as const) {
      for (const v of set) {
        expect(canonical, `${name} holds the non-canonical value '${v}'`).toContain(v);
      }
    }
  });

  it("KNOWN_STATUSES is exactly the canonical set", () => {
    expect([...KNOWN_STATUSES].sort()).toEqual([...CANONICAL_STATUSES].sort());
  });
});
