import { describe, it, expect, vi } from "vitest";
import { formsNotifyTarget, VERIFY_STATUS } from "../../src/recipes/forms-notify-target.js";
import {
  formatNotifyTarget,
  runFormsNotifyTargetCommand,
} from "../../src/cli/commands/forms-notify-target.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";
import type { Status, WebsiteRow } from "../../src/reports/airtable/websites.js";
import { canonicalizeStatus, toAirtableStatus } from "../../src/reports/airtable/site-status.js";

/** Stands in for the Airtable base. `writesLand` is the knob that matters:
 *  with it off, `updateSiteField` succeeds and the row does NOT change — the
 *  exact 2026-08-03 shape, where the flip was believed to have happened. */
const fake = vi.hoisted(() => ({
  rows: [] as WebsiteRow[],
  /** Every Status cell written to TURSO — the store the read-back confirms. */
  updates: [] as string[],
  /** Every Status cell written to the Airtable SHADOW. */
  airtableUpdates: [] as string[],
  writesLand: true,
  /** Store a DIFFERENT cell than the one written. Null = store what was sent.
   *  This used to model the shape a canonical-only read-back guard could not
   *  see — "legacy" and "deprecated" being one canonical status. Stage 3 deleted
   *  the alias map, so canonicalization is the identity and no two distinct
   *  cells share a canonical value any more. The substitution it models is
   *  therefore still a real failure the guard must catch, but this fixture can
   *  no longer distinguish a RAW comparison from a canonical one. */
  substituteWrite: null as string | null,
}));

/** The TURSO Status write, shared by the deps helper and the mocked
 *  `makeSiteMirror` the CLI composition root builds — so the CLI path lands its
 *  write exactly as the direct calls do. */
function applyStatus(
  canonicalize: (raw: string) => Status | null,
  id: string,
  value: string,
): void {
  fake.updates.push(`${id}.Status=${value}`);
  if (!fake.writesLand) return;
  const stored = fake.substituteWrite ?? value;
  // A re-read goes through the row mapper, which sets BOTH the canonical status
  // and the raw cell verbatim. Modelling only `status` would hide the class of
  // bug where the cell that landed is not the one asked for.
  fake.rows = fake.rows.map((r) =>
    r.id === id ? { ...r, status: canonicalize(stored), statusRaw: stored } : r,
  );
}

// #612: the CLI composition root builds a real makeSiteMirror, which under the
// freeze constant refuses to build without libSQL creds. Mocked so the flip
// stays a one-line change rather than a change plus a sweep of test files.
vi.mock("../../src/db/site-mirror.js", async () => {
  const { canonicalizeStatus: canon } = await import("../../src/reports/airtable/site-status.js");
  return {
    makeSiteMirror: async () => ({
      created: async () => {},
      hasRow: async () => true,
      health: async () => {},
      // #646 step 4: this is the write that decides, so the CLI path must land it
      // in the fake fleet the read-back reads.
      site: async (id: string, fields: Record<string, unknown>) =>
        applyStatus(canon, id, String(fields.Status ?? "")),
    }),
  };
});
vi.mock("../../src/reports/airtable/client.js", async (orig) => {
  const actual = await orig<typeof import("../../src/reports/airtable/client.js")>();
  return { ...actual, readAirtableConfig: () => ({}), openBase: () => ({}) };
});

// The Airtable SHADOW write. Since #646 step 4 it no longer feeds the read-back:
// the cell that decides who a submission emails is the TURSO one (form ingest
// reads `getSiteBySlug`), so the fleet below is what the mirror writes into.
vi.mock("../../src/reports/airtable/websites.js", async (orig) => {
  const actual = await orig<typeof import("../../src/reports/airtable/websites.js")>();
  return {
    ...actual,
    updateSiteField: async (_b: unknown, id: string, column: string, value: string) => {
      // The real writer skips a non-`rec` id (#646 step 3); the fake keeps that
      // rule so a `site_<ULID>` case here behaves as production does.
      if (!id.startsWith("rec")) return;
      fake.airtableUpdates.push(`${id}.${column}=${value}`);
    },
  };
});
// The CLI composition root reads the roster from Turso; this is that read.
vi.mock("../../src/fleet/roster.js", () => ({
  readFleetRoster: async () => fake.rows.map((r) => ({ ...r })),
}));

function row(status: Status | null, statusRaw?: string | null): WebsiteRow {
  return {
    id: "recSite",
    name: "1836dig",
    status,
    // What mapRow would have read out of the cell behind `status`. Since stage 3
    // that is the same string, so the default suffices for every canonical
    // value; callers exercising a cell the code does not recognize pass it
    // explicitly.
    statusRaw:
      statusRaw !== undefined ? statusRaw : status === null ? null : toAirtableStatus(status),
    pointOfContact: "owner@client.com",
    notifyRouting: null,
    reportRecipientsTo: null,
  } as unknown as WebsiteRow;
}

const base = {} as AirtableBase;

/** The Turso half of the recipe's deps: the fleet read, and the Status write the
 *  read-back confirms. `writesLand` off is the 2026-08-03 shape — the write call
 *  returns and the cell never changes. */
function D(over: Partial<Parameters<typeof formsNotifyTarget>[0]> & { site: string }) {
  return {
    base,
    roster: async () => fake.rows.map((r) => ({ ...r })),
    siteMirror: {
      created: async () => {},
      hasRow: async () => true,
      health: async () => {},
      site: async (id: string, fields: Record<string, unknown>) =>
        applyStatus(canonicalizeStatus, id, String(fields.Status ?? "")),
    },
    ...over,
  } as Parameters<typeof formsNotifyTarget>[0];
}

function setup(status: Status | null, writesLand = true, id = "recSite") {
  fake.rows = [{ ...row(status), id } as WebsiteRow];
  fake.updates = [];
  fake.airtableUpdates = [];
  fake.writesLand = writesLand;
  fake.substituteWrite = null;
}

describe("formsNotifyTarget", () => {
  it("reads without writing — asking must never be riskier than not asking", async () => {
    setup("maintained");
    const r = await formsNotifyTarget(D({ site: "1836dig" }));
    expect(r.target.audience).toBe("client");
    expect(fake.updates).toEqual([]);
    expect(r.flip).toBeUndefined();
  });

  it("accepts the slug or the Airtable name", async () => {
    setup("maintained");
    for (const s of ["1836dig", "1836DIG"]) {
      expect((await formsNotifyTarget(D({ site: s }))).site).toBe("1836dig");
    }
  });

  it("flipping on writes the guard and confirms it by re-reading", async () => {
    setup("maintained");
    const r = await formsNotifyTarget(D({ site: "1836dig", set: "on" }));
    // A LITERAL, not `${VERIFY_STATUS}`: this pins the exact cell value the write
    // puts in Airtable, which since the stage-2 flip is the NEW option name.
    // Interpolating the canonical constant would track whatever the code emits and
    // stop pinning anything — it must keep failing if the emitted value drifts.
    expect(fake.updates).toEqual(["recSite.Status=launching"]);
    expect(r.flip).toMatchObject({ from: "maintained", to: VERIFY_STATUS, confirmed: true });
    expect(r.target.audience).toBe("operator");
  });

  it("writes the SAME cell to Turso and to the Airtable shadow (#539 Phase 5)", async () => {
    // Turso is what `/api/forms/:slug` reads to decide who a submission emails,
    // and what the console shows; the Airtable cell is the shadow, compared
    // raw-to-raw by parity, so the two must carry the identical string.
    setup("maintained");
    const mirrored: Array<{ id: string; fields: Record<string, unknown> }> = [];

    await formsNotifyTarget(
      D({
        site: "1836dig",
        set: "on",
        siteMirror: {
          created: async () => {},
          hasRow: async () => true,
          health: async () => {},
          site: async (id: string, fields: Record<string, unknown>) => {
            mirrored.push({ id, fields });
          },
        },
      }),
    );

    expect(mirrored).toEqual([{ id: "recSite", fields: { Status: "launching" } }]);
    expect(fake.airtableUpdates).toEqual(["recSite.Status=launching"]);
  });

  it("flips a Turso-only `site_<ULID>` site, whose Airtable shadow writes nothing", async () => {
    // The case an Airtable roster could not even find (#646 steps 3–4): the site
    // has no Websites record, so the shadow skips and the guard lives in Turso
    // alone — which is exactly the cell form ingest reads.
    setup("maintained", true, "site_01ARYZ6S41TSV4RRFFQ69G5FAV");
    const r = await formsNotifyTarget(D({ site: "1836dig", set: "on" }));
    expect(r.flip).toMatchObject({ from: "maintained", to: VERIFY_STATUS, confirmed: true });
    expect(r.target.audience).toBe("operator");
    expect(fake.updates).toEqual(["site_01ARYZ6S41TSV4RRFFQ69G5FAV.Status=launching"]);
    expect(fake.airtableUpdates).toEqual([]);
  });

  it("REGRESSION: a flip that does NOT land is reported unconfirmed, never as success", async () => {
    // The exact 2026-08-03 failure: the write call returned, the field never
    // changed, and nothing said so. A returning write is not evidence.
    setup("maintained", false);
    const r = await formsNotifyTarget(D({ site: "1836dig", set: "on" }));
    expect(fake.updates).toHaveLength(1); // the write was attempted
    expect(r.flip).toMatchObject({ confirmed: false });
    expect(r.target.audience).toBe("client"); // still dangerous — and it says so
    const out = formatNotifyTarget(r);
    expect(out).toMatch(/NOT CONFIRMED/);
    expect(out).toMatch(/do not test-submit/i);
  });

  it("refuses to flip a site that is already guarded, rather than rewriting its status", async () => {
    setup("hosted-only");
    await expect(formsNotifyTarget(D({ site: "1836dig", set: "on" }))).rejects.toThrow(
      /nothing to flip/i,
    );
    expect(fake.updates).toEqual([]);
  });

  it("refuses --set off without --restore — the status is never inferred", async () => {
    setup(VERIFY_STATUS);
    await expect(formsNotifyTarget(D({ site: "1836dig", set: "off" }))).rejects.toThrow(
      /--restore/,
    );
    expect(fake.updates).toEqual([]);
  });

  it("restores to the status it was given, not to a guessed one", async () => {
    setup(VERIFY_STATUS);
    const r = await formsNotifyTarget(
      D({
        site: "1836dig",
        set: "off",
        restore: "hosted-only",
      }),
    );
    expect(fake.updates).toEqual(["recSite.Status=hosted-only"]);
    expect(r.flip).toMatchObject({ confirmed: true });
    expect(r.status).toBe("hosted-only");
  });

  it("writes a RETIRED name verbatim — stale operator input must not be silently fixed", async () => {
    // This test's original point was that operator free text must never be
    // routed through the canonical→Airtable map, because that map was
    // many-to-one: `--restore legacy` would have landed "deprecated", rewriting
    // a real cell to a value nobody asked for, and unlike every other change in
    // this rename `git revert` cannot undo a rewritten cell.
    //
    // Stage 3 deleted that map, so the specific hazard is gone — but the
    // property matters MORE now, not less. "legacy" is no longer an option in
    // the Airtable field at all, so the only two possible behaviours are: write
    // it verbatim and let Airtable reject an option that does not exist, or
    // quietly translate it into one that does. The first tells the operator
    // their input is stale; the second hands them a status they never typed.
    setup(VERIFY_STATUS);
    const r = await formsNotifyTarget(D({ site: "1836dig", set: "off", restore: "legacy" }));
    expect(fake.updates).toEqual(["recSite.Status=legacy"]);
    expect(fake.updates).not.toContain("recSite.Status=archived");
    // Reported as itself — a retired name is an unrecognized status now, which
    // is what puts it in front of a human instead of into the archived bucket.
    expect(r.status).toBe("legacy");
    // Confirmation is checked against the RAW cell, so "I wrote legacy and
    // legacy is what is there" is what `confirmed` actually means.
    expect(r.flip).toMatchObject({ confirmed: true });
  });

  it("does not report a flip confirmed when the cell that landed differs from the one sent", async () => {
    // The read-back guard's whole job: what is IN the cell afterwards, not what
    // the write call returned. See the note on `substituteWrite` — this no
    // longer proves the guard compares RAW rather than canonical values (nothing
    // can, now that canonicalization is the identity), only that a substituted
    // cell is caught at all.
    setup(VERIFY_STATUS);
    fake.substituteWrite = "archived";
    const r = await formsNotifyTarget(
      D({
        site: "1836dig",
        set: "off",
        restore: "hosted-only",
      }),
    );
    expect(r.flip).toMatchObject({ confirmed: false });
  });

  it("an unknown site is a clean exit-2, not a crash", async () => {
    setup("maintained");
    await expect(formsNotifyTarget(D({ site: "nope" }))).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe("formatNotifyTarget", () => {
  it("warns, with the un-recallable consequence stated, when the client is the target", async () => {
    setup("maintained");
    const out = formatNotifyTarget(await formsNotifyTarget(D({ site: "1836dig" })));
    expect(out).toMatch(/THE CLIENT/);
    expect(out).toMatch(/cannot be recalled/i);
    expect(out).toMatch(/--set on/);
  });

  it("a confirmed verify flip prints the exact restore command, carrying the prior status", async () => {
    setup("maintained");
    const out = formatNotifyTarget(await formsNotifyTarget(D({ site: "1836dig", set: "on" })));
    expect(out).toMatch(/Safe to test/);
    // The printed restore command carries the canonical name; `--restore` accepts
    // either vocabulary, so the copy-pasteable line stays correct.
    expect(out).toMatch(/--set off --restore maintained/);
  });
});

describe("runFormsNotifyTargetCommand", () => {
  it("REGRESSION: an unconfirmed flip exits NON-ZERO", async () => {
    // Anything reading exit status — a script, or a person skimming — would
    // otherwise take "I flipped it" on faith. That assumption is what sent a
    // client a test lead.
    setup("maintained", false);
    const r = await runFormsNotifyTargetCommand("1836dig", { set: "on" });
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/NOT CONFIRMED/);
  });

  it("a confirmed flip exits 0", async () => {
    setup("maintained");
    expect((await runFormsNotifyTargetCommand("1836dig", { set: "on" })).code).toBe(0);
  });

  it("rejects a missing site and a bad --set without touching Airtable", async () => {
    setup("maintained");
    expect((await runFormsNotifyTargetCommand(undefined, {})).code).toBe(2);
    expect((await runFormsNotifyTargetCommand("1836dig", { set: "maybe" })).code).toBe(2);
    expect(fake.updates).toEqual([]);
  });

  it("surfaces a refusal as its exit code rather than throwing", async () => {
    setup("hosted-only");
    const r = await runFormsNotifyTargetCommand("1836dig", { set: "on" });
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/nothing to flip/i);
  });
});
