import { describe, it, expect, vi } from "vitest";
import { resolveReplyCopy, type PrismicReader } from "../../src/forms/prismic.js";

const SETTINGS = {
  data: {
    signature: [{ type: "paragraph", text: "Gallery Sonder, Corona del Mar" }],
    replies: [
      {
        form_type: "rsvp",
        subject: "You're on the list",
        body: [
          { type: "paragraph", text: "Thanks for RSVPing." },
          { type: "paragraph", text: "" },
          { type: "paragraph", text: "Doors at 6." },
        ],
      },
      { form_type: "contact", subject: "We got your note", body: [] },
    ],
  },
};

const EVENT = {
  uid: "euphorbia",
  data: {
    name: "Euphorbia",
    reply_subject: "You're on the list for Euphorbia",
    reply_body: [{ type: "paragraph", text: "See you at the opening." }],
    start_time: "2026-09-12T18:00:00+0000",
    end_time: "2026-09-12T21:00:00+0000",
    location: "3435 E Coast Highway",
  },
};

function reader(over: Partial<PrismicReader> = {}): PrismicReader {
  return {
    getSingle: vi.fn().mockResolvedValue(SETTINGS),
    getByUID: vi.fn().mockResolvedValue(EVENT),
    ...over,
  };
}

describe("resolveReplyCopy", () => {
  it("uses the site default for a form type with no event", async () => {
    const copy = await resolveReplyCopy(reader(), { formType: "contact" });
    expect(copy).toEqual({
      subject: "We got your note",
      signature: "Gallery Sonder, Corona del Mar",
    });
  });

  it("maps rich text to blocks, dropping empty ones", async () => {
    const copy = await resolveReplyCopy(reader({ getByUID: vi.fn() }), { formType: "rsvp" });
    expect(copy?.body).toEqual([
      { type: "paragraph", text: "Thanks for RSVPing." },
      { type: "paragraph", text: "Doors at 6." },
    ]);
  });

  it("carries formatting through, mapping Prismic's hyperlink onto link", async () => {
    const rich = {
      data: {
        signature: [],
        replies: [
          {
            form_type: "rsvp",
            subject: "s",
            body: [
              {
                type: "paragraph",
                text: "See the show",
                spans: [
                  { start: 0, end: 3, type: "strong" },
                  {
                    start: 8,
                    end: 12,
                    type: "hyperlink",
                    data: { url: "https://gallerysonder.com" },
                  },
                  { start: 0, end: 3, type: "label" },
                ],
              },
              { type: "list-item", text: "Doors at 6" },
            ],
          },
        ],
      },
    };
    const copy = await resolveReplyCopy(
      reader({ getSingle: vi.fn().mockResolvedValue(rich), getByUID: vi.fn() }),
      { formType: "rsvp" },
    );
    expect(copy?.body).toEqual([
      {
        type: "paragraph",
        text: "See the show",
        spans: [
          { start: 0, end: 3, type: "strong" },
          { start: 8, end: 12, type: "link", url: "https://gallerysonder.com" },
        ],
      },
      { type: "list-item", text: "Doors at 6" },
    ]);
  });

  it("lets the event override the site default and adds the calendar", async () => {
    const copy = await resolveReplyCopy(reader(), { formType: "rsvp", eventUid: "euphorbia" });
    expect(copy?.subject).toBe("You're on the list for Euphorbia");
    expect(copy?.body).toEqual([{ type: "paragraph", text: "See you at the opening." }]);
    expect(copy?.signature).toBe("Gallery Sonder, Corona del Mar");
    expect(copy?.calendar).toMatchObject({
      title: "Euphorbia",
      location: "3435 E Coast Highway",
    });
  });

  it("omits the calendar when the event has no start_time", async () => {
    const noStart = { ...EVENT, data: { ...EVENT.data, start_time: null } };
    const copy = await resolveReplyCopy(reader({ getByUID: vi.fn().mockResolvedValue(noStart) }), {
      formType: "rsvp",
      eventUid: "euphorbia",
    });
    expect(copy?.calendar).toBeUndefined();
    expect(copy?.subject).toBe("You're on the list for Euphorbia");
  });

  it("falls back to the default location and attaches the event url", async () => {
    const noLoc = { ...EVENT, data: { ...EVENT.data, location: null } };
    const copy = await resolveReplyCopy(reader({ getByUID: vi.fn().mockResolvedValue(noLoc) }), {
      formType: "rsvp",
      eventUid: "euphorbia",
      defaultLocation: "Gallery Sonder, Corona del Mar CA",
      eventUrl: "https://gallerysonder.com/rsvp/euphorbia",
    });
    expect(copy?.calendar?.location).toBe("Gallery Sonder, Corona del Mar CA");
    expect(copy?.calendar?.url).toBe("https://gallerysonder.com/rsvp/euphorbia");
  });

  it("yields undefined rather than throwing when Prismic fails", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("404"));
    expect(
      await resolveReplyCopy(reader({ getSingle: boom, getByUID: boom }), {
        formType: "rsvp",
        eventUid: "nope",
      }),
    ).toBeUndefined();
  });

  it("still applies the signature to a form type with no entry of its own", async () => {
    // `signature` is site-wide by definition — "appended to every reply,
    // whatever the form". A type nobody has written copy for gets the sign-off
    // and falls through to the package's own body fallback for the rest.
    const copy = await resolveReplyCopy(reader(), { formType: "inquiry" });
    expect(copy).toEqual({ signature: "Gallery Sonder, Corona del Mar" });
  });

  it("yields undefined when the site has authored nothing at all", async () => {
    const empty = { data: { replies: [], signature: [] } };
    const copy = await resolveReplyCopy(reader({ getSingle: vi.fn().mockResolvedValue(empty) }), {
      formType: "inquiry",
    });
    expect(copy).toBeUndefined();
  });

  it("keeps the event override even when the singleton read fails", async () => {
    const copy = await resolveReplyCopy(
      reader({ getSingle: vi.fn().mockRejectedValue(new Error("no doc")) }),
      { formType: "rsvp", eventUid: "euphorbia" },
    );
    expect(copy?.subject).toBe("You're on the list for Euphorbia");
    expect(copy?.signature).toBeUndefined();
  });
});

describe("resolveReplyCopy — part-way-filled settings", () => {
  it("skips blank rows claiming the same form type and uses the one with copy", async () => {
    // Exactly the shape a real document takes while an editor is filling it in:
    // several rows added at once, Select left at its default, copy written last.
    const partial = {
      data: {
        signature: [],
        replies: [
          { form_type: "contact", subject: "", body: [] },
          { form_type: "contact", subject: "", body: [{ type: "paragraph", text: "  " }] },
          {
            form_type: "contact",
            subject: "We got your message",
            body: [{ type: "paragraph", text: "Someone will reply shortly." }],
          },
        ],
      },
    };
    const copy = await resolveReplyCopy(
      { getSingle: vi.fn().mockResolvedValue(partial), getByUID: vi.fn() },
      { formType: "contact" },
    );
    expect(copy?.subject).toBe("We got your message");
    expect(copy?.body).toEqual([{ type: "paragraph", text: "Someone will reply shortly." }]);
  });

  it("still yields undefined when every row for the type is blank", async () => {
    const allBlank = {
      data: { signature: [], replies: [{ form_type: "contact", subject: "", body: [] }] },
    };
    const copy = await resolveReplyCopy(
      { getSingle: vi.fn().mockResolvedValue(allBlank), getByUID: vi.fn() },
      { formType: "contact" },
    );
    expect(copy).toBeUndefined();
  });
});
