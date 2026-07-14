import { describe, it, expect } from "vitest";
import { classifySpam, SPAM_THRESHOLD } from "../../src/forms/spam-classifier.js";
import type { FormType } from "../../src/forms/types.js";
import type { TurnstileOutcome } from "../../src/forms/turnstile.js";

/** Neutral baseline: no signal fires. Override one field per test. */
function clean(over: Partial<Parameters<typeof classifySpam>[0]> = {}) {
  return classifySpam({
    name: "Jane Doe",
    email: "jane@example.com",
    message: "Hello, I would like some more information please.",
    formType: "contact" as FormType,
    extraFields: {},
    turnstile: "unverifiable" as TurnstileOutcome,
    ...over,
  });
}

describe("classifySpam", () => {
  it("exports SPAM_THRESHOLD = 100", () => {
    expect(SPAM_THRESHOLD).toBe(100);
  });

  it("scores a clean submission 0 with no reasons", () => {
    expect(clean()).toEqual({ score: 0, reasons: [] });
  });

  it("turnstile 'fail' adds 50 (turnstile-fail); pass/unverifiable/absent add 0", () => {
    expect(clean({ turnstile: "fail" as TurnstileOutcome })).toEqual({
      score: 50,
      reasons: ["turnstile-fail"],
    });
    expect(clean({ turnstile: "pass" as TurnstileOutcome })).toEqual({ score: 0, reasons: [] });
    expect(clean({ turnstile: "unverifiable" as TurnstileOutcome })).toEqual({
      score: 0,
      reasons: [],
    });
  });

  it("counts each URL in the message at 30, reason links:N", () => {
    expect(clean({ message: "see http://a.com please" })).toEqual({
      score: 30,
      reasons: ["links:1"],
    });
  });

  it("caps link points at 90 (three bare links) but reports the real count", () => {
    expect(clean({ message: "http://a.com http://b.com http://c.com" })).toEqual({
      score: 90,
      reasons: ["links:3"],
    });
    // more than three URLs still caps points at 90; reason shows the actual count
    const five = clean({ message: "www.a.com www.b.com www.c.com www.d.com www.e.com" });
    expect(five.score).toBe(90);
    expect(five.reasons).toEqual(["links:5"]);
  });

  it("counts a scheme+www URL once, not twice (no double-count)", () => {
    expect(clean({ message: "check https://www.example.com" })).toEqual({
      score: 30,
      reasons: ["links:1"],
    });
    // two scheme+www links must score as 2 links, not 4
    expect(clean({ message: "see https://www.a.com and https://www.b.com for details" })).toEqual({
      score: 60,
      reasons: ["links:2"],
    });
  });

  it("flags html/bbcode link markup at 40 (link-markup) without a bare-URL match", () => {
    // relative href: markup present, but no http(s)/www so links does NOT fire
    expect(clean({ message: 'click <a href="/contact">here</a>' })).toEqual({
      score: 40,
      reasons: ["link-markup"],
    });
    expect(clean({ message: "[url=/x]link[/url]" })).toEqual({
      score: 40,
      reasons: ["link-markup"],
    });
  });

  it("counts each spam keyword at 25 capped at 75, reason keywords:N", () => {
    expect(clean({ message: "buy viagra today" })).toEqual({
      score: 25,
      reasons: ["keywords:1"],
    });
    const many = clean({ message: "viagra casino porn buy crypto" });
    expect(many.score).toBe(75); // 4 hits -> capped
    expect(many.reasons).toEqual(["keywords:4"]);
  });

  it("does not false-positive on legitimate finance/SEO client inquiries", () => {
    // bare "crypto"/"bitcoin"/"forex" and a plain "SEO services" request are
    // plausible real inquiries — only the narrowed, clearly-promotional
    // phrasing should fire.
    expect(clean({ message: "We run a crypto exchange and need a new site." })).toEqual({
      score: 0,
      reasons: [],
    });
    expect(clean({ message: "I'm a bitcoin trader looking for a landing page." })).toEqual({
      score: 0,
      reasons: [],
    });
    expect(clean({ message: "We're a forex brokerage, can you redesign our site?" })).toEqual({
      score: 0,
      reasons: [],
    });
    expect(clean({ message: "Do you offer SEO services for small businesses?" })).toEqual({
      score: 0,
      reasons: [],
    });
  });

  it("still flags clearly-promotional spam phrasing for the narrowed keywords", () => {
    expect(clean({ message: "buy crypto now, guaranteed returns" })).toEqual({
      score: 25,
      reasons: ["keywords:1"],
    });
    expect(clean({ message: "protect your crypto wallet today" })).toEqual({
      score: 25,
      reasons: ["keywords:1"],
    });
    expect(clean({ message: "huge bitcoin investment opportunity" })).toEqual({
      score: 25,
      reasons: ["keywords:1"],
    });
    expect(clean({ message: "get rich with our forex signals" })).toEqual({
      score: 25,
      reasons: ["keywords:1"],
    });
    expect(clean({ message: "cheap seo, rank #1 guaranteed" })).toEqual({
      score: 25,
      reasons: ["keywords:1"],
    });
  });

  it("flags >30% non-latin script in the message OR the name at 50 (non-latin)", () => {
    expect(clean({ message: "Привет это спам сообщение" })).toEqual({
      score: 50,
      reasons: ["non-latin"],
    });
    expect(clean({ name: "Привет" })).toEqual({ score: 50, reasons: ["non-latin"] });
  });

  it("flags a disposable-email domain at 45 (disposable-email)", () => {
    expect(clean({ email: "bot@mailinator.com" })).toEqual({
      score: 45,
      reasons: ["disposable-email"],
    });
  });

  it("flags a URL in the name field at 45 (url-in-name)", () => {
    expect(clean({ name: "http://spam.example" })).toEqual({
      score: 45,
      reasons: ["url-in-name"],
    });
  });

  it("flags degenerate content at 40 (message == name, or body is only a URL)", () => {
    expect(clean({ name: "Hello", message: "Hello" })).toEqual({
      score: 40,
      reasons: ["degenerate"],
    });
    // body is only a URL: links (30) + degenerate (40)
    expect(clean({ name: "Jane", message: "http://spam.example" })).toEqual({
      score: 70,
      reasons: ["links:1", "degenerate"],
    });
  });

  it("flags an all-caps shout (len>20 & >70% uppercase) at 15 (all-caps)", () => {
    expect(clean({ message: "THIS IS A HUGE SHOUTING MESSAGE" })).toEqual({
      score: 15,
      reasons: ["all-caps"],
    });
    // <=20 chars never fires
    expect(clean({ message: "SHORT SHOUT" })).toEqual({ score: 0, reasons: [] });
  });

  it("scores spam signals found in extraFields free text, not just message", () => {
    const spamText = "buy viagra now http://a.com http://b.com";
    const viaMessage = clean({ message: spamText });
    const viaExtra = clean({ message: "", extraFields: { comments: spamText } });
    expect(viaExtra).toEqual(viaMessage);
    expect(viaExtra.score).toBeGreaterThan(0);
  });

  it("ignores non-string extraFields values when building the scanned body", () => {
    expect(
      clean({
        message: "",
        extraFields: { count: 5, agreed: true, meta: { nested: "viagra" }, empty: null },
      }),
    ).toEqual({ score: 0, reasons: [] });
  });

  it("threshold boundaries: fail + one link = 80 -> under threshold; fail + two links = 110 -> over", () => {
    // A "fail" plus ONE benign co-signal (a single pasted URL) must NOT
    // auto-spam a possibly-real human — this exact combination shipped as
    // spam_auto before the 70->50 reweight.
    const under = clean({ turnstile: "fail" as TurnstileOutcome, message: "visit http://a.com" });
    expect(under).toEqual({ score: 80, reasons: ["turnstile-fail", "links:1"] });
    expect(under.score >= SPAM_THRESHOLD).toBe(false);

    const over = clean({
      turnstile: "fail" as TurnstileOutcome,
      message: "http://a.com http://b.com",
    });
    expect(over).toEqual({ score: 110, reasons: ["turnstile-fail", "links:2"] });
    expect(over.score >= SPAM_THRESHOLD).toBe(true);

    const linksOnly = clean({ message: "http://a.com http://b.com http://c.com" });
    expect(linksOnly.score).toBe(90);
    expect(linksOnly.score >= SPAM_THRESHOLD).toBe(false);
  });
});
