import { describe, it, expect } from "vitest";
import {
  setSiteDetail,
  EDITABLE_SITE_FIELDS,
  WATCH_CONDITION_OPTIONS,
  type SiteDetailDeps,
} from "../../src/dashboard/site-details.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import type { AirtableCellValue } from "../../src/reports/airtable/websites.js";

function harness(over: Partial<SiteDetailDeps> = {}) {
  const writes: Array<{ id: string; column: string; value: AirtableCellValue }> = [];
  const deps: SiteDetailDeps = {
    getSite: async () => makeWebsiteRow({ id: "recA", name: "Acme" }),
    updateField: async (id, column, value) => {
      writes.push({ id, column, value });
    },
    ...over,
  };
  return { deps, writes };
}

describe("setSiteDetail", () => {
  it("rejects an unknown field BEFORE any read (bad-field)", async () => {
    let read = false;
    const r = await setSiteDetail(
      {
        getSite: async () => {
          read = true;
          return makeWebsiteRow({ id: "r", name: "X" });
        },
        updateField: async () => {},
      },
      "acme",
      "DNS password",
      "hax",
    );
    expect(r.status).toBe("bad-field");
    expect(read).toBe(false);
  });

  it("writes an enum field to its exact Airtable column", async () => {
    const { deps, writes } = harness();
    const r = await setSiteDetail(deps, "acme", "status", "hosted-only");
    expect(r.status).toBe("updated");
    expect(writes).toEqual([{ id: "recA", column: "Status", value: "hosted-only" }]);
  });

  it("rejects an enum value not in the options (invalid, no write)", async () => {
    const { deps, writes } = harness();
    const r = await setSiteDetail(deps, "acme", "maintenanceFreq", "Weekly");
    expect(r.status).toBe("invalid");
    expect(writes).toEqual([]);
  });

  it("writes maintenanceFreq to the misspelled Airtable column", async () => {
    const { deps, writes } = harness();
    await setSiteDetail(deps, "acme", "maintenanceFreq", "Monthly");
    expect(writes[0]!.column).toBe("maintenence freq");
  });

  it("validates an email field and rejects a malformed address", async () => {
    const { deps, writes } = harness();
    expect((await setSiteDetail(deps, "acme", "pointOfContact", "not-an-email")).status).toBe(
      "invalid",
    );
    expect(writes).toEqual([]);
    expect((await setSiteDetail(deps, "acme", "pointOfContact", "a@b.com")).status).toBe("updated");
  });

  it("normalizes an emails list (split, trim, rejoin) and rejects a bad member", async () => {
    const { deps, writes } = harness();
    await setSiteDetail(deps, "acme", "reportRecipientsTo", "a@b.com,\n c@d.com ");
    expect(writes[0]).toEqual({
      id: "recA",
      column: "Report recipients (To)",
      value: "a@b.com, c@d.com",
    });
    expect((await setSiteDetail(deps, "acme", "reportRecipientsTo", "a@b.com, nope")).status).toBe(
      "invalid",
    );
  });

  it("validates a git repo shape (owner/repo)", async () => {
    const { deps } = harness();
    expect((await setSiteDetail(deps, "acme", "gitRepo", "not a repo")).status).toBe("invalid");
    expect((await setSiteDetail(deps, "acme", "gitRepo", "reddoorla/acme")).status).toBe("updated");
  });

  it("allows clearing a text/email field to empty", async () => {
    const { deps, writes } = harness();
    expect((await setSiteDetail(deps, "acme", "searchQuery", "  ")).status).toBe("updated");
    expect(writes[0]!.value).toBe("");
  });

  it("returns not-found when the slug resolves to no site", async () => {
    const r = await setSiteDetail(
      { getSite: async () => null, updateField: async () => {} },
      "ghost",
      "status",
      "hosted-only",
    );
    expect(r.status).toBe("not-found");
  });

  it("EDITABLE_SITE_FIELDS column strings match the Airtable mapRow columns", () => {
    expect(EDITABLE_SITE_FIELDS.status!.column).toBe("Status");
    expect(EDITABLE_SITE_FIELDS.pointOfContact!.column).toBe("point of contact");
    expect(EDITABLE_SITE_FIELDS.copyIntro!.column).toBe("Copy — Intro");
  });
});

/**
 * #539 Phase 4: the fields the design lists as "the eight nothing renders
 * today". Each `column` here was taken from the LIVE base schema, not inferred
 * from the reader — the Airtable types drive what a valid value even is
 * (`maintenance day`/`testing day` are `date`, `Notify Routing` is
 * `multilineText`, the rest `singleLineText`).
 *
 * `Mailchimp API Key` is the ninth and is deliberately NOT here: it is a live
 * credential, and every field in this map is rendered back into the page with
 * its stored value. It needs a write-only kind first.
 */
describe("setSiteDetail — Phase 4 field coverage", () => {
  it("writes each newly-covered field to its exact Airtable column", async () => {
    const cases: Array<[field: string, value: string, column: string]> = [
      ["netlifyId", "nlf-abc123", "Netlify ID"],
      ["searchConsoleProperty", "sc-domain:acme.com", "Search Console property"],
      ["mailchimpAudienceId", "aud123", "Mailchimp Audience ID"],
      ["newsletterWebhook", "https://hooks.example.com/x", "Newsletter Webhook"],
      ["maintenanceDay", "2026-08-25", "maintenance day"],
      ["testingDay", "2026-08-25", "testing day"],
    ];
    for (const [field, value, column] of cases) {
      const { deps, writes } = harness();
      const r = await setSiteDetail(deps, "acme", field, value);
      expect(r.status, `${field} should be writable`).toBe("updated");
      expect(writes[0]).toMatchObject({ column, value });
    }
  });

  it("url: accepts http(s) and REFUSES any other scheme", async () => {
    const { deps } = harness();
    const ok = async (v: string) =>
      (await setSiteDetail(deps, "acme", "newsletterWebhook", v)).status;
    expect(await ok("https://hooks.example.com/abc")).toBe("updated");
    expect(await ok("http://hooks.example.com/abc")).toBe("updated");
    // The same scheme allowlist the deployed-audit target uses: a `file://` or
    // `javascript:` webhook is a local-file read or an injection sink, and this
    // value is fetched by the newsletter forwarder.
    expect(await ok("file:///etc/passwd")).toBe("invalid");
    expect(await ok("javascript:alert(1)")).toBe("invalid");
    expect(await ok("ftp://example.com")).toBe("invalid");
    expect(await ok("not a url")).toBe("invalid");
  });

  it("date: accepts YYYY-MM-DD only, and rejects a non-date that Date.parse would accept", async () => {
    const { deps } = harness();
    const ok = async (v: string) => (await setSiteDetail(deps, "acme", "maintenanceDay", v)).status;
    expect(await ok("2026-08-25")).toBe("updated");
    expect(await ok("25/08/2026")).toBe("invalid");
    expect(await ok("2026-8-5")).toBe("invalid");
    // Shape-valid but not a real day — `new Date()` would happily roll this over
    // into September, silently rescheduling the site.
    expect(await ok("2026-02-31")).toBe("invalid");
    expect(await ok("2026-13-01")).toBe("invalid");
  });

  it("notifyRouting: accepts only what the PRODUCTION reader would accept", async () => {
    // Validated with parseNotifyRouting itself, so the editor cannot store a
    // value the reader silently drops to null — which would look like "routing
    // saved" while every form notification kept going to the old target.
    const { deps, writes } = harness();
    const ok = async (v: string) => (await setSiteDetail(deps, "acme", "notifyRouting", v)).status;
    expect(await ok('{"field":"Department","routes":{"Sales":"sales@acme.com"}}')).toBe("updated");
    expect(writes.at(-1)!.column).toBe("Notify Routing");
    expect(await ok("{not json")).toBe("invalid");
    expect(await ok('["an","array"]')).toBe("invalid");
    expect(await ok('{"routes":{"Sales":"s@acme.com"}}')).toBe("invalid"); // no `field`
    // `routes` is required too — a routing with only a `field` selects nothing,
    // and the reader drops it. Writing the schema out here from memory got this
    // wrong on the first pass; the production parser is what caught it, which is
    // the whole reason this kind validates through `parseNotifyRouting`.
    expect(await ok('{"field":"Department"}')).toBe("invalid");
  });

  it("every newly-covered field can be CLEARED to empty", async () => {
    // Every one of these is optional in production; a field that can be set but
    // not unset traps an operator in whatever they first typed.
    for (const field of [
      "netlifyId",
      "searchConsoleProperty",
      "mailchimpAudienceId",
      "newsletterWebhook",
      "maintenanceDay",
      "testingDay",
      "notifyRouting",
    ]) {
      const { deps, writes } = harness();
      const r = await setSiteDetail(deps, "acme", field, "   ");
      expect(r.status, `${field} should be clearable`).toBe("updated");
      expect(writes[0]!.value).toBe("");
    }
  });

  it("does NOT expose the Mailchimp API key as an editable field", async () => {
    // A live credential. Until a write-only kind exists, the allowlist must not
    // carry it — every entry in the map is rendered back with its stored value.
    const { deps } = harness();
    expect(EDITABLE_SITE_FIELDS.mailchimpApiKey).toBeUndefined();
    expect((await setSiteDetail(deps, "acme", "mailchimpApiKey", "x")).status).toBe("bad-field");
  });
});

/**
 * The two editor fields Airtable will not accept as strings: `Require Turnstile`
 * is a checkbox and `Accepted Watch Conditions` a multipleSelects. They travel
 * as a boolean and a string[] rather than being stringified here and coerced
 * back later (#539 Phase 4).
 */
describe("setSiteDetail — the non-text fields", () => {
  it("writes Require Turnstile as a real boolean, never the string 'true'", async () => {
    const { deps, writes } = harness();
    expect((await setSiteDetail(deps, "acme", "requireTurnstile", "true")).status).toBe("updated");
    expect(writes[0]).toMatchObject({ column: "Require Turnstile", value: true });
    expect((await setSiteDetail(deps, "acme", "requireTurnstile", "false")).status).toBe("updated");
    expect(writes[1]!.value).toBe(false);
  });

  it("Require Turnstile accepts only the two checkbox states", async () => {
    // Not a free-text field: anything else is a malformed request, not a value
    // to guess at. `""` is NOT treated as "clear" here — a checkbox has no empty.
    const { deps } = harness();
    for (const bad of ["", "yes", "1", "on", "TRUE "]) {
      expect((await setSiteDetail(deps, "acme", "requireTurnstile", bad)).status).toBe("invalid");
    }
  });

  it("writes Accepted Watch Conditions as an ARRAY of existing options", async () => {
    const { deps, writes } = harness();
    const r = await setSiteDetail(deps, "acme", "acceptedWatchConditions", "Performance, SEO");
    expect(r.status).toBe("updated");
    expect(writes[0]).toMatchObject({
      column: "Accepted Watch Conditions",
      value: ["Performance", "SEO"],
    });
  });

  it("REFUSES a watch condition that is not an option in the field", async () => {
    // `Accepted Watch Conditions` is a multipleSelects, and the Airtable API
    // creates a missing option as a side effect only with `typecast` — the exact
    // silent-option-creation hazard this codebase refuses everywhere. Writing an
    // unknown value must fail here rather than mint a junk option.
    const { deps, writes } = harness();
    expect(
      (await setSiteDetail(deps, "acme", "acceptedWatchConditions", "Performance, Nonsense"))
        .status,
    ).toBe("invalid");
    expect(writes).toEqual([]);
  });

  it("clears Accepted Watch Conditions to an EMPTY ARRAY, not an empty string", async () => {
    const { deps, writes } = harness();
    expect((await setSiteDetail(deps, "acme", "acceptedWatchConditions", "  ")).status).toBe(
      "updated",
    );
    expect(writes[0]!.value).toEqual([]);
  });

  it("offers exactly the options the live Airtable field carries", () => {
    // Read off the base schema on 2026-08-25. The API cannot add options to a
    // select (422 — proven during the status migration), so offering one that
    // does not exist would produce a write Airtable rejects.
    expect([...WATCH_CONDITION_OPTIONS]).toEqual([
      "Performance",
      "Accessibility",
      "Best Practices",
      "SEO",
      "stale repo",
      "no custom domain",
    ]);
  });
});
