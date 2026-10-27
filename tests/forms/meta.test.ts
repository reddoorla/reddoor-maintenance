import { describe, it, expect } from "vitest";
import { readMeta } from "../../src/forms/meta.js";

describe("readMeta", () => {
  it("reads token/ip and ignores a legacy userAgent field (older senders still send it)", () => {
    const m = readMeta({
      email: "a@b.co",
      _meta: { turnstileToken: "tok", clientIp: "1.2.3.4", userAgent: "Mozilla/5.0" },
    });
    expect(m).toEqual({ turnstileToken: "tok", clientIp: "1.2.3.4" });
  });

  it("trims whitespace and drops blank string fields", () => {
    const m = readMeta({ _meta: { turnstileToken: "  tok  ", clientIp: "   ", userAgent: "" } });
    expect(m).toEqual({ turnstileToken: "tok" });
  });

  it("drops non-string fields (a bot can't smuggle a non-string clientIp/ua)", () => {
    const m = readMeta({ _meta: { turnstileToken: 123, clientIp: { x: 1 }, userAgent: null } });
    expect(m).toEqual({});
  });

  it("returns an empty object when _meta is absent, wrong-typed, or the payload is not an object", () => {
    expect(readMeta({ email: "a@b.co" })).toEqual({});
    expect(readMeta({ _meta: "nope" })).toEqual({});
    expect(readMeta(null)).toEqual({});
    expect(readMeta("nope")).toEqual({});
  });
});

import { buildSubmissionMeta } from "../../src/forms/meta.js";

type MetaEvent = Parameters<typeof buildSubmissionMeta>[0];

function metaEvent(
  opts: {
    ip?: string | (() => string);
    userAgent?: string;
    omitGetter?: boolean;
  } = {},
): MetaEvent {
  const headers = new Headers();
  if (opts.userAgent) headers.set("user-agent", opts.userAgent);
  const getClientAddress =
    typeof opts.ip === "function" ? opts.ip : opts.ip ? () => opts.ip as string : undefined;
  return {
    request: { headers },
    ...(opts.omitGetter ? {} : { getClientAddress }),
  } as unknown as MetaEvent;
}

describe("buildSubmissionMeta", () => {
  it("returns turnstileToken and clientIp; the user-agent is deliberately NOT forwarded", () => {
    const meta = buildSubmissionMeta(
      metaEvent({ ip: "203.0.113.7", userAgent: "Mozilla/5.0 (X)" }),
      "TOKEN123",
    );
    expect(meta).toEqual({
      turnstileToken: "TOKEN123",
      clientIp: "203.0.113.7",
    });
  });

  it("returns undefined when no field yields a value (a lone user-agent doesn't count)", () => {
    expect(buildSubmissionMeta(metaEvent(), null)).toBeUndefined();
    expect(buildSubmissionMeta(metaEvent(), undefined)).toBeUndefined();
    // Central never consumes the UA, so an event carrying ONLY a user-agent
    // must not produce an envelope.
    expect(buildSubmissionMeta(metaEvent({ userAgent: "UA-only" }), null)).toBeUndefined();
  });

  it("trims values and drops a blank turnstile token", () => {
    const meta = buildSubmissionMeta(
      metaEvent({ ip: "  198.51.100.4 ", userAgent: "  UA-9 " }),
      "   ",
    );
    expect(meta).toEqual({ clientIp: "198.51.100.4" });
  });

  it("swallows a throwing getClientAddress and still returns the other fields", () => {
    const meta = buildSubmissionMeta(
      metaEvent({
        ip: () => {
          throw new Error("adapter has no client address");
        },
        userAgent: "UA-throw",
      }),
      "TOK",
    );
    expect(meta).toEqual({ turnstileToken: "TOK" });
  });

  it("skips clientIp when getClientAddress is not a function", () => {
    const meta = buildSubmissionMeta(metaEvent({ omitGetter: true }), "TOK2");
    expect(meta).toEqual({ turnstileToken: "TOK2" });
  });
});
