import { describe, it, expect } from "vitest";
import { defaultReply } from "../../src/forms/default-replies.js";
import { SUBMISSION_FORM_TYPES } from "../../src/forms/types.js";
import { buildAutoresponder } from "../../src/forms/notify.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

describe("defaultReply", () => {
  it("covers every declared form type with a distinct subject", () => {
    const subjects = SUBMISSION_FORM_TYPES.map((t) => defaultReply(t, "Acme").subject);
    expect(new Set(subjects).size).toBe(SUBMISSION_FORM_TYPES.length);
    for (const t of SUBMISSION_FORM_TYPES) {
      const r = defaultReply(t, "Acme");
      expect(r.subject.trim()).not.toBe("");
      expect(r.paragraphs.every((p) => p.trim() !== "")).toBe(true);
    }
  });

  it("names the site in the copy", () => {
    expect(defaultReply("newsletter", "Gallery Sonder").paragraphs[0]).toContain("Gallery Sonder");
  });

  it("falls back to the contact wording for an unknown type", () => {
    expect(defaultReply("not-a-form", "Acme")).toEqual(defaultReply("contact", "Acme"));
  });
});

describe("buildAutoresponder — per-form-type defaults", () => {
  const site = () =>
    makeWebsiteRow({
      name: "Acme Co",
      url: "https://acme.com",
      pointOfContact: "owner@acme.com",
      copyIntro: null,
      copyContact: null,
      copyFooter: null,
    });

  it("uses the newsletter default instead of the old generic line", () => {
    const input = buildAutoresponder(
      site(),
      makeSubmissionRow({ formType: "newsletter", email: "lead@x.com" }),
    )!;
    expect(input.subject).toBe("You're subscribed");
    expect(input.html).toContain("Thanks for subscribing to updates from Acme Co.");
    expect(input.html).not.toContain("Thanks for reaching out to");
  });

  it("gives an inquiry its own wording, distinct from contact", () => {
    const inquiry = buildAutoresponder(
      site(),
      makeSubmissionRow({ formType: "inquiry", email: "lead@x.com" }),
    )!;
    const contact = buildAutoresponder(
      site(),
      makeSubmissionRow({ formType: "contact", email: "lead@x.com" }),
    )!;
    expect(inquiry.subject).toBe("Thanks for your inquiry");
    expect(contact.subject).toBe("We got your message");
    expect(inquiry.html).not.toBe(contact.html);
  });

  it("still prefers a site's own legacy copy where it is set", () => {
    const withCopy = makeWebsiteRow({
      name: "Acme Co",
      url: "https://acme.com",
      pointOfContact: "owner@acme.com",
      copyIntro: "Hand-written intro.",
      copyContact: null,
    });
    const input = buildAutoresponder(
      withCopy,
      makeSubmissionRow({ formType: "newsletter", email: "lead@x.com" }),
    )!;
    expect(input.html).toContain("Hand-written intro.");
    // The unset half still improves to the per-type default.
    expect(input.html).toContain("unsubscribe from any email");
  });

  it("keeps the event name ahead of the rsvp default subject", () => {
    const input = buildAutoresponder(
      site(),
      makeSubmissionRow({
        formType: "rsvp",
        email: "lead@x.com",
        extraFields: JSON.stringify({ event: "Euphorbia" }),
      }),
    )!;
    expect(input.subject).toBe("You're on the list for Euphorbia");
  });
});
