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
  updates: [] as string[],
  writesLand: true,
  /** Store a DIFFERENT cell than the one written — the shape a canonical-only
   *  read-back guard cannot see, because "legacy" and "deprecated" are the same
   *  canonical status. Null = store what was sent. */
  substituteWrite: null as string | null,
}));

vi.mock("../../src/reports/airtable/client.js", async (orig) => {
  const actual = await orig<typeof import("../../src/reports/airtable/client.js")>();
  return { ...actual, readAirtableConfig: () => ({}), openBase: () => ({}) };
});

vi.mock("../../src/reports/airtable/websites.js", async (orig) => {
  const actual = await orig<typeof import("../../src/reports/airtable/websites.js")>();
  return {
    ...actual,
    listWebsites: async () => fake.rows.map((r) => ({ ...r })),
    updateSiteField: async (_b: unknown, id: string, column: string, value: string) => {
      fake.updates.push(`${id}.${column}=${value}`);
      if (!fake.writesLand) return;
      const stored = fake.substituteWrite ?? value;
      fake.rows = fake.rows.map((r) =>
        // The write lands as an AIRTABLE cell value; a re-read goes through
        // mapRow, which sets BOTH fields — the canonical status and the raw cell
        // verbatim. Modelling only `status` here would hide the whole class of
        // bug where the cell that landed is not the cell that was asked for.
        r.id === id && column === "Status"
          ? { ...r, status: canonicalizeStatus(stored), statusRaw: stored }
          : r,
      );
    },
  };
});

function row(status: Status | null, statusRaw?: string | null): WebsiteRow {
  return {
    id: "recSite",
    name: "1836dig",
    status,
    // What mapRow would have read out of the cell behind `status`. Callers that
    // care about the raw cell (an archived row is `legacy` OR `deprecated`) pass
    // it explicitly.
    statusRaw:
      statusRaw !== undefined ? statusRaw : status === null ? null : toAirtableStatus(status),
    pointOfContact: "owner@client.com",
    notifyRouting: null,
    reportRecipientsTo: null,
  } as unknown as WebsiteRow;
}

const base = {} as AirtableBase;

function setup(status: Status | null, writesLand = true) {
  fake.rows = [row(status)];
  fake.updates = [];
  fake.writesLand = writesLand;
  fake.substituteWrite = null;
}

describe("formsNotifyTarget", () => {
  it("reads without writing — asking must never be riskier than not asking", async () => {
    setup("maintained");
    const r = await formsNotifyTarget({ base, site: "1836dig" });
    expect(r.target.audience).toBe("client");
    expect(fake.updates).toEqual([]);
    expect(r.flip).toBeUndefined();
  });

  it("accepts the slug or the Airtable name", async () => {
    setup("maintained");
    for (const s of ["1836dig", "1836DIG"]) {
      expect((await formsNotifyTarget({ base, site: s })).site).toBe("1836dig");
    }
  });

  it("flipping on writes the guard and confirms it by re-reading", async () => {
    setup("maintained");
    const r = await formsNotifyTarget({ base, site: "1836dig", set: "on" });
    // A LITERAL, not `${VERIFY_STATUS}`: the cell written is Airtable's OLD
    // option name while AIRTABLE_USES_NEW_VOCABULARY is false. Interpolating the
    // canonical constant would follow the stage-2 flip and stop pinning anything.
    expect(fake.updates).toEqual(["recSite.Status=launch period"]);
    expect(r.flip).toMatchObject({ from: "maintained", to: VERIFY_STATUS, confirmed: true });
    expect(r.target.audience).toBe("operator");
  });

  it("REGRESSION: a flip that does NOT land is reported unconfirmed, never as success", async () => {
    // The exact 2026-08-03 failure: the write call returned, the field never
    // changed, and nothing said so. A returning write is not evidence.
    setup("maintained", false);
    const r = await formsNotifyTarget({ base, site: "1836dig", set: "on" });
    expect(fake.updates).toHaveLength(1); // the write was attempted
    expect(r.flip).toMatchObject({ confirmed: false });
    expect(r.target.audience).toBe("client"); // still dangerous — and it says so
    const out = formatNotifyTarget(r);
    expect(out).toMatch(/NOT CONFIRMED/);
    expect(out).toMatch(/do not test-submit/i);
  });

  it("refuses to flip a site that is already guarded, rather than rewriting its status", async () => {
    setup("hosted-only");
    await expect(formsNotifyTarget({ base, site: "1836dig", set: "on" })).rejects.toThrow(
      /nothing to flip/i,
    );
    expect(fake.updates).toEqual([]);
  });

  it("refuses --set off without --restore — the status is never inferred", async () => {
    setup(VERIFY_STATUS);
    await expect(formsNotifyTarget({ base, site: "1836dig", set: "off" })).rejects.toThrow(
      /--restore/,
    );
    expect(fake.updates).toEqual([]);
  });

  it("restores to the status it was given, not to a guessed one", async () => {
    setup(VERIFY_STATUS);
    const r = await formsNotifyTarget({ base, site: "1836dig", set: "off", restore: "hosting" });
    // The ROUND-TRIPPING case: "hosting" canonicalizes to `hosted-only` and maps
    // straight back to "hosting", so what lands is byte-identical to what was
    // typed. `r.status` shows the canonical name the rest of the code sees.
    expect(fake.updates).toEqual(["recSite.Status=hosting"]);
    expect(r.flip).toMatchObject({ confirmed: true });
    expect(r.status).toBe("hosted-only");
  });

  it("writes --restore legacy VERBATIM — never the 'deprecated' it canonicalizes to", async () => {
    // `legacy` and `deprecated` are the one many-to-one merge in the Phase 4
    // vocabulary: both canonicalize to `archived`, which maps BACK to
    // "deprecated". Routing operator free text through that map would rewrite a
    // real Airtable cell to a value nobody asked for — and unlike every other
    // change in this rename, `git revert` cannot undo a rewritten cell.
    setup(VERIFY_STATUS);
    const r = await formsNotifyTarget({ base, site: "1836dig", set: "off", restore: "legacy" });
    expect(fake.updates).toEqual(["recSite.Status=legacy"]);
    expect(fake.updates).not.toContain("recSite.Status=deprecated");
    // Reported canonically (both archived cells are `archived` to the code)…
    expect(r.status).toBe("archived");
    // …but confirmation is checked against the RAW cell, so "I wrote legacy and
    // legacy is what is there" is what `confirmed` actually means.
    expect(r.flip).toMatchObject({ confirmed: true });
  });

  it("does not report a flip confirmed when the cell that landed differs from the one sent", async () => {
    // The read-back guard's whole job. An Airtable that quietly stores a
    // DIFFERENT archived option than the one written still canonicalizes to the
    // same `archived`, so a canonical-only comparison would call this confirmed.
    setup(VERIFY_STATUS);
    fake.substituteWrite = "deprecated";
    const r = await formsNotifyTarget({ base, site: "1836dig", set: "off", restore: "legacy" });
    expect(r.flip).toMatchObject({ confirmed: false });
  });

  it("an unknown site is a clean exit-2, not a crash", async () => {
    setup("maintained");
    await expect(formsNotifyTarget({ base, site: "nope" })).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe("formatNotifyTarget", () => {
  it("warns, with the un-recallable consequence stated, when the client is the target", async () => {
    setup("maintained");
    const out = formatNotifyTarget(await formsNotifyTarget({ base, site: "1836dig" }));
    expect(out).toMatch(/THE CLIENT/);
    expect(out).toMatch(/cannot be recalled/i);
    expect(out).toMatch(/--set on/);
  });

  it("a confirmed verify flip prints the exact restore command, carrying the prior status", async () => {
    setup("maintained");
    const out = formatNotifyTarget(await formsNotifyTarget({ base, site: "1836dig", set: "on" }));
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
