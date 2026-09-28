// The nightly model sweep's verdict, as the fleet's own inventory records it.
//
// THE RULE THIS FILE IS WRITTEN AGAINST, landing where an operator reads it:
// "I could not read X" must never produce the same result as "X does not exist"
// — here, "we could not check this site" must never read as "this site is fine".
//
// The cockpit and the digest read these
// three columns, and nothing downstream re-derives them. So the column has to be
// able to say "no verdict was established", which is why the cell is FOUR-valued
// (`pass` / `fail` / `unknown` / blank) rather than the pass/fail every other
// verdict column in this table uses. A site whose check failed and whose row
// still said `pass` would be a green tick in the dashboard for a site nobody
// managed to look at — and, unlike a stale `fail`, NOTHING ages a stale `pass`
// out: the freshness gate in the collector only ever examines failures.
import { describe, it, expect } from "vitest";
import { mapRow, prismicModelsFields } from "../../src/reports/airtable/websites.js";

const writtenFields = (models: Parameters<typeof prismicModelsFields>[0]) =>
  prismicModelsFields(models) as Record<string, string | null>;

describe("mapRow — Prismic model columns", () => {
  it("maps the verdict, the timestamp, and the drift detail", () => {
    const row = mapRow({
      id: "rec1",
      fields: {
        Name: "Espada",
        "Prismic Models": "fail",
        "Prismic Models Checked At": "2026-08-12T06:00:00.000Z",
        "Prismic Models Drift": "CHANGED  slice hero",
      },
    });
    expect(row.prismicModels).toBe("fail");
    expect(row.prismicModelsCheckedAt).toBe("2026-08-12T06:00:00.000Z");
    expect(row.prismicModelsDrift).toBe("CHANGED  slice hero");
  });

  // THE READ SIDE OF THE GOVERNING RULE. `unknown` is what the sweep writes for a
  // site it could not check. Reading it through the shared `toVerdict` — which
  // maps anything that is not literally pass/fail to null — would turn "the check
  // ran and failed" back into "the check never ran", silently, in the one place
  // an operator would otherwise see the outage.
  it("reads an unknown verdict as unknown, not as never-ran", () => {
    const row = mapRow({ id: "rec1", fields: { Name: "Espada", "Prismic Models": "unknown" } });
    expect(row.prismicModels).toBe("unknown");
  });

  it("nulls all three when the operator has not added the columns yet", () => {
    const row = mapRow({ id: "rec1", fields: { Name: "Espada" } });
    expect(row.prismicModels).toBeNull();
    expect(row.prismicModelsCheckedAt).toBeNull();
    expect(row.prismicModelsDrift).toBeNull();
  });

  it("ignores a value that is not one of the three verdicts", () => {
    expect(
      mapRow({ id: "r", fields: { Name: "x", "Prismic Models": "maybe" } }).prismicModels,
    ).toBeNull();
  });
});

describe("prismicModelsFields", () => {
  it("carries all three columns in one FieldSet", () => {
    expect(
      prismicModelsFields({
        verdict: "pass",
        checkedAt: "2026-08-12T06:00:00.000Z",
        detail: null,
      }),
    ).toEqual({
      "Prismic Models": "pass",
      "Prismic Models Checked At": "2026-08-12T06:00:00.000Z",
      "Prismic Models Drift": null,
    });
  });

  // MUTATION TARGET. A check that FAILED must never be softened on its way into
  // the record — not into `pass` (a green tick for a site nobody read), and not
  // into a dropped field (which leaves YESTERDAY's verdict standing, with the
  // same effect and no trace).
  it("writes an unknown verdict verbatim, never as pass and never by omission", () => {
    const fields = writtenFields({
      verdict: "unknown",
      checkedAt: "2026-08-12T06:00:00.000Z",
      detail: "could not read Prismic models: 403",
    });
    expect(fields).toHaveProperty("Prismic Models");
    expect(fields["Prismic Models"]).toBe("unknown");
    expect(fields["Prismic Models Drift"]).toContain("403");
  });

  // A site with no Prismic config has no verdict to hold. Blanking the cell is
  // how the record says so — and it is what clears a `pass` that stopped being
  // true when the site's Prismic config went away.
  it("clears the cell for a null verdict rather than omitting the field", () => {
    const fields = writtenFields({
      verdict: null,
      checkedAt: "2026-08-12T06:00:00.000Z",
      detail: "not a Prismic site",
    });
    expect(fields).toHaveProperty("Prismic Models");
    expect(fields["Prismic Models"]).toBeNull();
  });

  it("truncates a very long drift detail", () => {
    const fields = writtenFields({
      verdict: "fail",
      checkedAt: "2026-08-12T06:00:00.000Z",
      detail: "x".repeat(120_000),
    });
    const stored = fields["Prismic Models Drift"]!;
    expect(stored.length).toBeLessThanOrEqual(50_000);
    expect(stored).toMatch(/truncated/);
    // A cut that does not say how much it cut is a report that looks complete and
    // is not — the same failure the PR comment's truncation notice exists to
    // prevent, one surface along.
    expect(stored).toContain("120000");
  });

  it("leaves a detail at the limit alone", () => {
    const fields = writtenFields({
      verdict: "fail",
      checkedAt: "t",
      detail: "x".repeat(50_000),
    });
    expect(fields["Prismic Models Drift"]).toBe("x".repeat(50_000));
  });

  // The cut is by code unit, so it can land between the halves of an astral
  // character. A lone surrogate is not valid text: it survives JSON.stringify as
  // an unpaired escape and can make a store reject the whole write — losing the
  // finding entirely to a cosmetic detail. Both lengths are tried because only
  // one of the two puts the cut on an odd index.
  it.each([
    ["even", "🙂".repeat(30_000)],
    ["odd", `x${"🙂".repeat(30_000)}`],
  ])("emits no lone surrogate when the cut lands mid-character (%s)", (_name, detail) => {
    const fields = writtenFields({
      verdict: "fail",
      checkedAt: "t",
      detail,
    });
    const stored = fields["Prismic Models Drift"]!;
    expect(stored.length).toBeLessThanOrEqual(50_000);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(stored)).toBe(false);
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(stored)).toBe(false);
  });
});
