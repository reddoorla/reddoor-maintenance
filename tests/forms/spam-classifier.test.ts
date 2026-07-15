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
  it("exports SPAM_THRESHOLD = 60", () => {
    expect(SPAM_THRESHOLD).toBe(60);
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

  it("counts each URL in the message at 25, reason links:N", () => {
    expect(clean({ message: "see http://a.com please" })).toEqual({
      score: 25,
      reasons: ["links:1"],
    });
  });

  it("caps link points at 50 (two-plus bare links) but reports the real count", () => {
    expect(clean({ message: "http://a.com http://b.com http://c.com" })).toEqual({
      score: 50,
      reasons: ["links:3"],
    });
    // more than two URLs still caps points at 50; reason shows the actual count
    const five = clean({ message: "www.a.com www.b.com www.c.com www.d.com www.e.com" });
    expect(five.score).toBe(50);
    expect(five.reasons).toEqual(["links:5"]);
  });

  it("counts a scheme+www URL once, not twice (no double-count)", () => {
    expect(clean({ message: "check https://www.example.com" })).toEqual({
      score: 25,
      reasons: ["links:1"],
    });
    // two scheme+www links must score as 2 links, not 4 (capped at 50)
    expect(clean({ message: "see https://www.a.com and https://www.b.com for details" })).toEqual({
      score: 50,
      reasons: ["links:2"],
    });
  });

  it("counts comma/semicolon-glued URLs individually (bots pack links with no separators)", () => {
    expect(clean({ message: "deals at http://a.com,http://b.com today" })).toEqual({
      score: 50,
      reasons: ["links:2"],
    });
    const glued = clean({ message: "grab www.a.com,www.b.com;www.c.com now" });
    expect(glued.score).toBe(50); // 3 links, capped at 50
    expect(glued.reasons).toEqual(["links:3"]);
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
    const many = clean({ message: "viagra online casino porn buy crypto" });
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

  it("does not false-positive on legitimate casino/wellness/escort/lending/SEO-audit verticals", () => {
    // bare vertical vocabulary from a plausible real business enquiry — only
    // the narrowed, clearly-promotional phrasing should fire.
    expect(
      clean({ message: "Our resort features a casino and spa; can you redesign our site?" }),
    ).toEqual({ score: 0, reasons: [] });
    expect(clean({ message: "I run a weight loss studio and need a booking page." })).toEqual({
      score: 0,
      reasons: [],
    });
    expect(
      clean({ message: "We provide secure transport and escort services for private events." }),
    ).toEqual({ score: 0, reasons: [] });
    expect(
      clean({ message: "We're a payday loan storefront and need a compliance page." }),
    ).toEqual({ score: 0, reasons: [] });
    expect(clean({ message: "Can you audit the backlinks pointing to our domain?" })).toEqual({
      score: 0,
      reasons: [],
    });
  });

  it("legit vertical mention + two links stays under threshold (links 50 only, no keyword hit)", () => {
    const wellness = clean({
      message: "I run a weight loss studio, here are our sites: http://a.com http://b.com",
    });
    expect(wellness).toEqual({ score: 50, reasons: ["links:2"] });
    expect(wellness.score >= SPAM_THRESHOLD).toBe(false);

    const resort = clean({
      message: "Our resort has a casino, portfolio at http://a.com and http://b.com",
    });
    expect(resort).toEqual({ score: 50, reasons: ["links:2"] });
    expect(resort.score >= SPAM_THRESHOLD).toBe(false);
  });

  it("still flags promotional phrasing for the narrowed vertical keywords at 25 each", () => {
    for (const message of [
      "play at our online casino tonight",
      "claim your casino bonus now",
      "weight loss pills that melt fat fast",
      "buy backlinks cheap, DA 90+",
      "payday loans online, instant approval",
      "hot escort girls in your city",
    ]) {
      // label the message so a single-phrase regression is identifiable
      expect(clean({ message }), message).toEqual({ score: 25, reasons: ["keywords:1"] });
    }
  });

  it("flags >30% non-latin script in the message body at 25 (non-latin); the name never scores", () => {
    expect(clean({ message: "Привет это спам сообщение" })).toEqual({
      score: 25,
      reasons: ["non-latin"],
    });
    // a native-script name is not a spam signal
    expect(clean({ name: "王小明" })).toEqual({ score: 0, reasons: [] });
    expect(clean({ name: "Владимир" })).toEqual({ score: 0, reasons: [] });
  });

  it("non-latin still needs corroboration: native-script name + two links = 50 -> under; non-latin body + two links = 75 -> over (threshold 60)", () => {
    const nameCase = clean({ name: "王小明", message: "see http://a.com and http://b.com" });
    expect(nameCase).toEqual({ score: 50, reasons: ["links:2"] });
    expect(nameCase.score >= SPAM_THRESHOLD).toBe(false);

    // A non-latin body PLUS two links now crosses the lowered 60 threshold (25 + 50).
    // For an LA-fleet creative site a native-script message with multiple pasted links
    // is far more likely a bot than a lead — and spam_auto is recoverable.
    const bodyCase = clean({
      message: "Портфолио: http://a.com http://b.com — жду вашего ответа, спасибо",
    });
    expect(bodyCase).toEqual({ score: 75, reasons: ["links:2", "non-latin"] });
    expect(bodyCase.score >= SPAM_THRESHOLD).toBe(true);
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
    // body is only a URL: links (25) + degenerate (40) = 65
    expect(clean({ name: "Jane", message: "http://spam.example" })).toEqual({
      score: 65,
      reasons: ["links:1", "degenerate"],
    });
    // Guardrail: URL_RE stops at `,`/`;` (2 links) but ONLY_URL_RE deliberately
    // keeps `\S+`, so a comma-glued URL body is still one token => degenerate.
    // links (2 -> capped 50) + degenerate (40) = 90.
    expect(clean({ name: "Jane", message: "http://a.com,http://b.com" })).toEqual({
      score: 90,
      reasons: ["links:2", "degenerate"],
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

  it("threshold boundaries (60): forged-token 'fail' + one link = 75 -> spam; two links alone = 50 -> under", () => {
    // Post-#400 a "fail" is a FORGED token (invalid-input-response) — near-certainly a
    // bot — so fail (50) + one pasted link (25) crossing 60 is correct. A real human's
    // expired/duplicate token is "unverifiable", never "fail".
    const failPlusLink = clean({
      turnstile: "fail" as TurnstileOutcome,
      message: "visit http://a.com",
    });
    expect(failPlusLink).toEqual({ score: 75, reasons: ["turnstile-fail", "links:1"] });
    expect(failPlusLink.score >= SPAM_THRESHOLD).toBe(true);

    // The URL cap protects a genuine lead pasting their site + portfolio: two links
    // alone score 50, under the 60 threshold — never auto-bucketed on links alone.
    const twoLinks = clean({ message: "http://a.com http://b.com" });
    expect(twoLinks).toEqual({ score: 50, reasons: ["links:2"] });
    expect(twoLinks.score >= SPAM_THRESHOLD).toBe(false);

    // three+ links still cap at 50, still under
    const threeLinks = clean({ message: "http://a.com http://b.com http://c.com" });
    expect(threeLinks.score).toBe(50);
    expect(threeLinks.score >= SPAM_THRESHOLD).toBe(false);
  });
});

describe("classifySpam — cold-outreach / gibberish / bare-domain tuning (2026-07-15)", () => {
  it("scores each new cold-outreach / SEO phrase as a keyword (25)", () => {
    for (const message of [
      "I'd love to write a guest post for your blog",
      "our link building service gets results",
      "we get you on the first page of google",
      "we can position your brand for more reach",
      "results within 24 hours guaranteed",
      "we provide a trained virtual assistant",
      "we noticed an seo problem on your site",
      "we could increase your traffic significantly",
    ]) {
      const v = clean({ message });
      expect(v.reasons, message).toContain("keywords:1");
      expect(v.score, message).toBe(25);
    }
  });

  it("does NOT bucket a single ambiguous outreach phrase on its own (needs corroboration)", () => {
    // A genuine lead can plausibly ask for a "free consultation" — 25 alone is < 60.
    const v = clean({ message: "Could I get a free consultation about a new website?" });
    expect(v.reasons).toContain("keywords:1");
    expect(v.score).toBeLessThan(SPAM_THRESHOLD);
  });

  it("flags a random keyboard-mash body at 35 (gibberish-body)", () => {
    const v = clean({ message: "zddDVjhArCJbvfgXJmqQ" });
    expect(v.reasons).toContain("gibberish-body");
    expect(v.score).toBe(35);
  });

  it("gibberish-name needs a single long low-vowel token; a bot with a mashed name+body is caught, a real consonant-heavy surname is not bucketed", () => {
    // bot: single mashed name token (35) + mashed body (35) = 70, bucketed
    const bot = clean({ name: "OsDMQohNGefhfCqqQCwr", message: "zddDVjhArCJbvfgXJmqQ" });
    expect(bot.reasons).toEqual(expect.arrayContaining(["gibberish-body", "gibberish-name"]));
    expect(bot.score).toBe(70);
    expect(bot.score >= SPAM_THRESHOLD).toBe(true);

    // A real consonant-heavy surname may trip gibberish-name (+35) but with a normal
    // message that is the only signal — 35 is well under the 60 threshold, never bucketed.
    const surname = clean({
      name: "Krzysztofowicz",
      message: "Hi, could you help redesign our homepage?",
    });
    expect(surname.score).toBeLessThan(SPAM_THRESHOLD);

    // A native-script (non-latin) name never trips gibberish — latin a-z only.
    expect(clean({ name: "王小明" }).reasons).not.toContain("gibberish-name");
  });

  it("flags a bare pasted domain (no scheme/www) at 20, only when no real URL is present, and not an email domain", () => {
    const bare = clean({ message: "reach us at medicalsolutionsoftx.com for details" });
    expect(bare.reasons).toContain("bare-domain");
    expect(bare.score).toBe(20);

    // a real http URL is counted as a link, NOT double-counted as bare-domain
    const real = clean({ message: "visit http://medicalsolutionsoftx.com" });
    expect(real.reasons).toContain("links:1");
    expect(real.reasons).not.toContain("bare-domain");

    // an email address's domain in the body is excluded (not a pasted marketing domain)
    expect(clean({ message: "email me at jane@foo.com anytime" }).reasons).not.toContain(
      "bare-domain",
    );
  });

  it("URL cap protects a genuine two-link lead: site + portfolio = 50 < 60", () => {
    expect(clean({ message: "our site http://a.com and portfolio http://b.com" })).toEqual({
      score: 50,
      reasons: ["links:2"],
    });
  });

  it("buckets a representative multi-phrase SEO outreach pitch (>= 60)", () => {
    // "position your brand" + "above competitors" + "within 24 hours" = 3 phrases -> 75
    const v = clean({
      message: "We can position your brand above competitors within 24 hours.",
    });
    expect(v.reasons).toContain("keywords:3");
    expect(v.score).toBeGreaterThanOrEqual(SPAM_THRESHOLD);
  });
});
