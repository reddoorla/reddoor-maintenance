import { describe, it, expect } from "vitest";
import { SUBMISSION_FORM_TYPES } from "../../src/forms/types.js";
import { SUBMISSION_FORM_TYPES as fromSubmissions } from "../../src/reports/airtable/submissions.js";

describe("form types leaf", () => {
  it("exposes the canonical form-type tuple", () => {
    expect([...SUBMISSION_FORM_TYPES]).toEqual([
      "contact",
      "inquiry",
      "newsletter",
      "rsvp",
      "reserve",
    ]);
  });

  it("is re-exported unchanged from the submissions module (back-compat)", () => {
    expect(fromSubmissions).toBe(SUBMISSION_FORM_TYPES);
  });
});
