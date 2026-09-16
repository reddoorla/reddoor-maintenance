import { describe, it, expect } from "vitest";
import {
  parseBounceDetail,
  isPermanentBounce,
  BOUNCE_MESSAGE_MAX_LEN,
} from "../../src/reports/webhook-events.js";

/**
 * #783. Resend's `email.bounced` payload carries `data.bounce = { message,
 * subType, type }` (confirmed against Resend's own webhook payload docs, which
 * also confirm `email.complained` carries no such object). The handler read
 * only `data.email_id`, so the classification was dropped on the floor and a
 * content rejection became indistinguishable from a dead mailbox.
 *
 * This is the parser for that object, kept pure and separate from the handler
 * for the same reason `classifyUnmatchedEvent` is: the wire-shape decisions are
 * testable without booting a Netlify function or signing a payload.
 */

const FULL = {
  email_id: "56761188",
  bounce: {
    message: "The recipient's email address is on the suppression list.",
    subType: "Suppressed",
    type: "Permanent",
  },
};

describe("parseBounceDetail", () => {
  it("reads the three fields Resend sends", () => {
    expect(parseBounceDetail(FULL)).toEqual({
      type: "Permanent",
      subType: "Suppressed",
      message: "The recipient's email address is on the suppression list.",
    });
  });

  it("returns null when there is no bounce object (a complaint, or a delivered event)", () => {
    expect(parseBounceDetail({ email_id: "x" })).toBeNull();
  });

  it("returns null for a bounce field that is not an object", () => {
    // Defensive rather than theoretical: this is parsing a third party's wire
    // format, and a shape change must degrade to "no diagnosis" rather than
    // throw inside a webhook that would then 500 and be redelivered forever.
    for (const bad of ["Permanent", 42, null, true, ["Permanent"]]) {
      expect(parseBounceDetail({ bounce: bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it("keeps the fields that ARE strings and nulls the ones that are not", () => {
    expect(parseBounceDetail({ bounce: { message: "550 no such user" } })).toEqual({
      type: null,
      subType: null,
      message: "550 no such user",
    });
    expect(parseBounceDetail({ bounce: { type: "Permanent", subType: 7, message: {} } })).toEqual({
      type: "Permanent",
      subType: null,
      message: null,
    });
  });

  it("returns null when the bounce object carries none of the three fields", () => {
    // An empty object is not a diagnosis; storing three nulls would make the row
    // look classified when nothing was said.
    expect(parseBounceDetail({ bounce: {} })).toBeNull();
    expect(parseBounceDetail({ bounce: { somethingElse: "x" } })).toBeNull();
  });

  it("truncates a very long server message rather than storing it whole", () => {
    // The message is remote-supplied text that lands in a dashboard chip and a
    // row we keep forever. Bound it at the boundary where it enters our store.
    const long = "x".repeat(BOUNCE_MESSAGE_MAX_LEN + 500);
    const parsed = parseBounceDetail({ bounce: { type: "Permanent", message: long } })!;
    expect(parsed.message!.length).toBe(BOUNCE_MESSAGE_MAX_LEN);
  });

  it("leaves a message at exactly the cap untouched", () => {
    const exact = "y".repeat(BOUNCE_MESSAGE_MAX_LEN);
    expect(parseBounceDetail({ bounce: { message: exact } })!.message).toBe(exact);
  });
});

describe("isPermanentBounce", () => {
  it("is TRUE for a permanent bounce — the case that keeps the old alarm wording", () => {
    // The grant side. Without this the whole change would read as "nothing is
    // ever permanent now", which would be a quieter alarm, not a truer one.
    expect(isPermanentBounce({ type: "Permanent", subType: "Suppressed", message: null })).toBe(
      true,
    );
    expect(isPermanentBounce({ type: "Permanent", subType: "General", message: null })).toBe(true);
  });

  it("matches case-insensitively, so a casing change upstream is not a silent downgrade", () => {
    expect(isPermanentBounce({ type: "permanent", subType: null, message: null })).toBe(true);
    expect(isPermanentBounce({ type: "PERMANENT", subType: null, message: null })).toBe(true);
  });

  it("is FALSE for the classifications that are not a dead address", () => {
    for (const type of ["Transient", "Undetermined"]) {
      expect(isPermanentBounce({ type, subType: "ContentRejected", message: null }), type).toBe(
        false,
      );
    }
  });

  it("is FALSE for an absent or unrecognized classification", () => {
    // The safe direction: an unknown type must not be promoted to "the address
    // is dead", which is the exact wrong diagnosis #783 is about.
    expect(isPermanentBounce(null)).toBe(false);
    expect(isPermanentBounce({ type: null, subType: null, message: null })).toBe(false);
    expect(isPermanentBounce({ type: "SomethingNew", subType: null, message: null })).toBe(false);
  });
});
