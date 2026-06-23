import { describe, it, expect } from "vitest";
import { normalizeSubmission } from "../../src/forms/payload.js";

describe("normalizeSubmission", () => {
  it("folds firstName+lastName into name and lowercases email", () => {
    const r = normalizeSubmission({
      firstName: "Jane",
      lastName: "Doe",
      email: "JANE@Example.com",
    });
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

  it("keeps a valid formType and defaults an ABSENT/blank one to contact", () => {
    const r = normalizeSubmission({ email: "a@b.co", formType: "rsvp" });
    expect(r.ok && r.value.formType).toBe("rsvp");
    // No formType at all → the long-standing minimal-form default.
    const d = normalizeSubmission({ email: "a@b.co" });
    expect(d.ok && d.value.formType).toBe("contact");
    const blank = normalizeSubmission({ email: "a@b.co", formType: "  " });
    expect(blank.ok && blank.value.formType).toBe("contact");
  });

  it("REJECTS a present-but-unrecognized formType (no silent coerce to contact)", () => {
    // A typo'd/off-list type ('news' instead of 'newsletter') previously stored as
    // contact, silently dropping the Mailchimp add. Now it's surfaced as invalid —
    // matching createIngestEndpoint's reject-invalid behavior.
    const r = normalizeSubmission({ email: "a@b.co", formType: "news" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("formType is not a recognized form type");
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

  it("folds a single name half without a stray space", () => {
    const r = normalizeSubmission({ firstName: "Jane", email: "a@b.co" });
    expect(r.ok && r.value.name).toBe("Jane");
  });

  it("drops prototype-pollution keys from extraFields (untrusted boundary)", () => {
    const r = normalizeSubmission({
      email: "a@b.co",
      extra: { ["__proto__"]: { polluted: true }, constructor: "x", safe: 1 },
      prototype: "y",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.extraFields).toEqual({ safe: 1 });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });
});
