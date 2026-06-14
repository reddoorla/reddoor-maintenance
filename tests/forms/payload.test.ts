import { describe, it, expect } from "vitest";
import { normalizeSubmission } from "../../src/forms/payload.js";

describe("normalizeSubmission", () => {
  it("folds firstName+lastName into name and lowercases email", () => {
    const r = normalizeSubmission({ firstName: "Jane", lastName: "Doe", email: "JANE@Example.com" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("Jane Doe");
      expect(r.value.email).toBe("jane@example.com");
    }
  });

  it("prefers an explicit name over first/last", () => {
    const r = normalizeSubmission({ name: "Ada L.", firstName: "Ada", email: "a@b.co" });
    expect(r.ok && r.value.name).toBe("Ada L.");
  });

  it("captures unknown keys into extraFields and merges explicit extra", () => {
    const r = normalizeSubmission({
      email: "a@b.co",
      company: "Acme",
      guests: 3,
      extra: { event: "gala" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.extraFields).toEqual({ event: "gala", company: "Acme", guests: 3 });
  });

  it("falls back to formType=contact for unknown types", () => {
    expect(normalizeSubmission({ email: "a@b.co", formType: "nope" }).ok).toBe(true);
    const r = normalizeSubmission({ email: "a@b.co", formType: "rsvp" });
    expect(r.ok && r.value.formType).toBe("rsvp");
  });

  it("rejects when neither email nor message is present", () => {
    const r = normalizeSubmission({ name: "Jane" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("at least one of email or message is required");
  });

  it("rejects a malformed email", () => {
    const r = normalizeSubmission({ email: "not-an-email", message: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("email is not a valid address");
  });

  it("rejects a non-object payload", () => {
    expect(normalizeSubmission("nope").ok).toBe(false);
    expect(normalizeSubmission(null).ok).toBe(false);
  });
});
