import { describe, it, expect } from "vitest";
import {
  canonicalizeStatus,
  toAirtableStatus,
  CANONICAL_STATUSES,
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
import { SITE_STATUS_OPTIONS } from "../../../src/dashboard/site-details.js";

/**
 * THE behaviour-equivalence instrument for the #539 Phase 4 status-vocabulary
 * rename, now carried through all three stages.
 *
 * The VALUES in BASELINE below are the original frozen capture: they were
 * recorded by RUNNING every status predicate over every Airtable Status cell
 * value against the PRE-RENAME code (origin/main @ 5a97866), not by reading them
 * off the source. Not one of them has been edited since.
 *
 * What stage 3 changed is the KEY, not the value. The rows used to be addressed
 * by the old Airtable cell name; the alias map that connected those names to
 * canonical ones is now deleted, so each row is addressed by the canonical
 * status the old name mapped to:
 *
 *   in development → building        probably not our problem → external
 *   launch period  → launching       legacy    ┐
 *   maintenance    → maintained      deprecated ┴ archived
 *   hosting        → hosted-only
 *
 * `legacy` and `deprecated` collapse to a single `archived` row. That is safe
 * for this table specifically because their two captured rows were IDENTICAL in
 * all nine predicates — checked against the frozen capture before merging them,
 * not assumed from the fact that ARCHIVED_STATUSES held both.
 *
 * So the property this still pins is the one that matters going forward: the
 * canonical vocabulary selects exactly the sites the old vocabulary selected. A
 * future edit to ELIGIBLE_STATUSES, ACTIVE_STATUSES or either inline literal
 * fails HERE with a named row rather than silently changing which sites get
 * audited, reported on, or notified.
 *
 * Three rows are load-bearing beyond the obvious:
 *  - `launching` is TRUE for BOTH `dashboardVisible` and `preLaunch`. That dual
 *    membership (cockpit-visible, not production-audited) is deliberate and was
 *    explicitly re-approved as-is with the vocabulary — it is NOT a bug to fix
 *    under cover of a rename.
 *  - `(empty)` — a non-blank-but-empty cell — is `unrecognized: true`, NOT null.
 *    `due.ts`/`preflight.ts` treat a null status as eligible-by-default, so
 *    nulling anything non-absent would ACTIVATE the row.
 *  - `(null)` — an ABSENT cell — is the other side of that same rule, and is the
 *    one row where `eligible` is TRUE without the status being in
 *    ELIGIBLE_STATUSES. That is production, not an oversight: `due.ts:86,118`
 *    skip only a non-null ineligible status, and `preflight.ts:374` selects
 *    `w.status === null` explicitly.
 */
/** The seven Airtable option names that existed before the migration, kept ONLY
 *  as test data. Stage 3 deleted the alias map that used to translate them, so
 *  this list is what "an old value must now alarm" is checked against — it is
 *  no longer imported from production code, because production code no longer
 *  knows these strings. */
const OLD_AIRTABLE_VALUES = [
  "in development",
  "launch period",
  "maintenance",
  "hosting",
  "probably not our problem",
  "legacy",
  "deprecated",
] as const;

const BASELINE = {
  building: {
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
  launching: {
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
  maintained: {
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
  "hosted-only": {
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
  external: {
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
  archived: {
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
    // TRUE, and deliberately so — this row is the exception the file header
    // states. `due.ts` skips only `status !== null && !ELIGIBLE.has(status)` and
    // `preflight.ts` selects `w.status === null || ELIGIBLE.has(...)`, so an
    // ABSENT Status cell is eligible-by-default (back-compat with rows that
    // pre-date the Status convention). Recording `false` here would freeze the
    // opposite of production into a table whose only value is being a true
    // record of it.
    eligible: true,
    active: false,
    known: false,
    spamHandling: true,
    notifyToPoc: false,
  },
} as const;

/** The BASELINE rows that are NOT canonical statuses: a genuine typo plus the
 *  two blank shapes. Named so the completeness gate can require them by name
 *  rather than trusting the table to still contain them. `(empty)` is the
 *  ACTIVATE-risk row the header calls out; deleting it must red a test, not
 *  shrink a loop. */
const NON_STATUS_BASELINE_KEYS = ["wat", "(empty)", "(null)"] as const;

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
    // Exactly the polarity `due.ts` and `preflight.ts` use: an ABSENT status is
    // eligible-by-default. Writing `status !== null && …` here would invert the
    // null case against production.
    eligible: status === null || ELIGIBLE_STATUSES.has(status),
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

  it("covers every canonical status, plus a typo and both blanks", () => {
    // The completeness gate on the table, in BOTH directions — because the loop
    // above measures whatever rows exist, so a DELETED row shrinks the loop
    // silently rather than failing anything. Losing `(empty)` in particular would
    // drop the one row that guards against nulling a present-but-empty cell and
    // thereby ACTIVATING it for scheduled client reports.
    //
    // Required from CANONICAL_STATUSES rather than a literal list, so ADDING a
    // status to the vocabulary without capturing its selection behaviour fails
    // here — which is the direction this gate will actually be tested in now
    // that the old names are gone.
    const required = new Set<string>([...CANONICAL_STATUSES, ...NON_STATUS_BASELINE_KEYS]);
    for (const key of required) {
      expect(BASELINE, `BASELINE has no row for '${key}'`).toHaveProperty(key);
    }
    // …and no row may exist that nothing requires: an unexplained key means the
    // set above is out of date, which is how a gate quietly stops gating.
    expect([...Object.keys(BASELINE)].sort()).toEqual([...required].sort());
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
  it("no longer TRANSLATES an old Airtable name — stage 3 deleted the alias map", () => {
    // The direct inverse of the stage-1/2 assertion this replaces. Each of these
    // used to yield its canonical partner; the mapping is now gone, so each cell
    // survives verbatim and lands in the unrecognized bucket (asserted just
    // below). Kept as an explicit list rather than folded into the loop below so
    // the retired mapping stays legible at the point where it stopped applying.
    expect(canonicalizeStatus("in development")).toBe("in development");
    expect(canonicalizeStatus("launch period")).toBe("launch period");
    expect(canonicalizeStatus("maintenance")).toBe("maintenance");
    expect(canonicalizeStatus("hosting")).toBe("hosting");
    expect(canonicalizeStatus("probably not our problem")).toBe("probably not our problem");
    expect(canonicalizeStatus("legacy")).toBe("legacy");
    expect(canonicalizeStatus("deprecated")).toBe("deprecated");
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

  it("FLAGS an old-vocabulary cell as unrecognized — stage 3 removed the tolerance", () => {
    // The inverse of the stage-1/2 pin, and deliberately so. The seven old
    // options no longer exist in the Airtable field (verified against the live
    // base before this landed: the single-select carries exactly the six
    // canonical choices), so an old value can no longer be entered. If one
    // reappears it is a genuine anomaly — a restored backup, a scripted write,
    // an API caller with a stale constant — and must surface as a cockpit watch
    // row rather than being silently translated into a status nobody chose.
    for (const old of OLD_AIRTABLE_VALUES) {
      expect(isUnrecognizedStatus(canonicalizeStatus(old)), `'${old}' must alarm`).toBe(true);
      expect(canonicalizeStatus(old), `'${old}' must survive verbatim`).toBe(old);
    }
  });

  it("still flags a genuine typo as unrecognized", () => {
    expect(isUnrecognizedStatus(canonicalizeStatus("maintenence"))).toBe(true);
    expect(isUnrecognizedStatus(canonicalizeStatus("maintenance "))).toBe(true);
    expect(isUnrecognizedStatus(canonicalizeStatus("wat"))).toBe(true);
  });
});

describe("toAirtableStatus (stage 2: the Airtable single-select now carries the NEW options)", () => {
  it("emits the NEW Airtable option — the canonical name itself — for every status", () => {
    expect(toAirtableStatus("building")).toBe("building");
    expect(toAirtableStatus("launching")).toBe("launching");
    expect(toAirtableStatus("maintained")).toBe("maintained");
    expect(toAirtableStatus("hosted-only")).toBe("hosted-only");
    expect(toAirtableStatus("external")).toBe("external");
    // The many-to-one merge is fully RESOLVED: `archived` is a real Airtable
    // option and the two old names it absorbed no longer exist in the field, so
    // there is nothing left for a write to pick between. Stage 3 deleted the
    // reverse map that used to make this the interesting case.
    expect(toAirtableStatus("archived")).toBe("archived");
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

  it("reads a canonical cell through unchanged", () => {
    for (const s of CANONICAL_STATUSES) expect(row({ Status: s }).status).toBe(s);
  });

  it("no longer translates a retired cell — it reads as itself, and alarms", () => {
    // What this seam used to do (`maintenance` in, `maintained` out) is exactly
    // what stage 3 removed. Pinned here as well as at canonicalizeStatus because
    // this is the boundary production actually crosses.
    expect(row({ Status: "maintenance" }).status).toBe("maintenance");
    expect(row({ Status: "legacy" }).status).toBe("legacy");
    expect(isUnrecognizedStatus(row({ Status: "legacy" }).status)).toBe(true);
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
    // HONEST NOTE ON WHAT THIS STILL PROVES. `status` is now the identity on
    // every string, so for any value the Status single-select can actually hold,
    // `status` and `statusRaw` are the SAME string — this can no longer
    // demonstrate the divergence it was written for (a `legacy` cell reading as
    // `archived` while displaying as "legacy"). What it does still pin is that
    // statusRaw is a verbatim, un-narrowed copy of the cell: an unrecognized
    // value survives intact for the editor to round-trip, and an absent cell is
    // null rather than "". Both fields are kept because the read/display split is
    // the architecture that made this migration survivable; the seam is dormant,
    // not wrong. See the equality pin below, which is what would actually fail if
    // canonicalization were ever reintroduced.
    expect(row({ Status: "wat" }).statusRaw).toBe("wat");
    expect(row({ Status: "maintained" }).statusRaw).toBe("maintained");
    expect(row({}).statusRaw).toBeNull();
  });

  it("status and statusRaw now COINCIDE for every value a single-select can hold", () => {
    // The load-bearing half of the note above, stated as an assertion so it
    // cannot quietly stop being true. If a future change reintroduces any
    // translation at this seam, this fails and forces the raw-vs-canonical
    // question to be answered deliberately rather than discovered in the cockpit.
    for (const cell of [...CANONICAL_STATUSES, ...OLD_AIRTABLE_VALUES, "wat", ""]) {
      const r = row({ Status: cell });
      expect(r.status, `status/statusRaw diverged for ${JSON.stringify(cell)}`).toBe(r.statusRaw);
    }
  });
});

describe("the status sets are stated in the canonical vocabulary", () => {
  it("holds only canonical values", () => {
    const canonical = new Set<string>(CANONICAL_STATUSES);
    // KNOWN_STATUSES is deliberately NOT in this list. It is literally
    // `new Set(CANONICAL_STATUSES)`, so asserting its members are canonical is
    // a tautology no production mutation can red — a guarantee-shaped assertion
    // that guarantees nothing. It is pinned below against an independent literal
    // instead, which is a check that can actually fail. The four sets here are
    // hand-written elsewhere and genuinely can drift.
    for (const [name, set] of [
      ["ACTIVE_STATUSES", ACTIVE_STATUSES],
      ["PRE_LAUNCH_STATUSES", PRE_LAUNCH_STATUSES],
      ["ARCHIVED_STATUSES", ARCHIVED_STATUSES],
      ["ELIGIBLE_STATUSES", ELIGIBLE_STATUSES],
    ] as const) {
      for (const v of set) {
        expect(canonical, `${name} holds the non-canonical value '${v}'`).toContain(v);
      }
    }
  });

  it("the canonical vocabulary is exactly these six names, in this order", () => {
    // Written out as an INDEPENDENT literal, not derived from CANONICAL_STATUSES.
    // The order is load-bearing (see below), and every derived-from-itself
    // assertion in this area has to be one a mutation can actually red.
    expect([...CANONICAL_STATUSES]).toEqual([
      "building",
      "launching",
      "maintained",
      "hosted-only",
      "external",
      "archived",
    ]);
    // KNOWN_STATUSES is that vocabulary as a set — pinned against the same
    // independent literal, so widening either one alone fails here.
    expect([...KNOWN_STATUSES].sort()).toEqual(
      ["archived", "building", "external", "hosted-only", "launching", "maintained"].sort(),
    );
  });

  it("the dashboard status dropdown offers exactly these Airtable options, in this order", () => {
    // `SITE_STATUS_OPTIONS = CANONICAL_STATUSES.map(toAirtableStatus)` is the
    // ONLY consumer of CANONICAL_STATUSES' ORDER, and until this pin existed
    // nothing read it: reversing the array left the whole suite green while
    // silently reordering an operator-facing dropdown.
    //
    // This matters MORE now that stage 2 has landed. `render.ts` preselects
    // `site.statusRaw`, not `site.status`, and for the 44 live rows those two are
    // now the same string — so that mutation is no longer caught by a vocabulary
    // mismatch. It is still caught, but only by the one remaining case where raw
    // and canonical differ (a `legacy` cell → the placeholder, pinned in
    // tests/dashboard/render.test.ts). Pinning the option list keeps an
    // independent check on the dropdown itself.
    expect([...SITE_STATUS_OPTIONS]).toEqual([
      "building",
      "launching",
      "maintained",
      "hosted-only",
      "external",
      "archived",
    ]);
  });
});
