import { describe, it, expect } from "vitest";
import { SUBMISSION_FORM_TYPES } from "../../src/forms/types.js";

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
});
