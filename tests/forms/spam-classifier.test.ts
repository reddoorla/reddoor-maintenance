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

  it("counts each seller keyword at 30 capped at 90, reason keywords:N", () => {
    expect(clean({ message: "buy viagra today" })).toEqual({
      score: 30,
      reasons: ["keywords:1"],
    });
    const many = clean({ message: "viagra online casino porn buy crypto" });
    expect(many.score).toBe(90); // 4 hits -> capped at 3
    expect(many.reasons).toEqual(["keywords:4"]);
  });

  it("TWO seller phrases bucket outright (operator 2026-07-15: solicitation language pairs never occur in genuine leads)", () => {
    const v = clean({ message: "buy viagra at our online casino" });
    expect(v.score).toBe(60);
    expect(v.score >= SPAM_THRESHOLD).toBe(true);
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
      score: 30,
      reasons: ["keywords:1"],
    });
    expect(clean({ message: "protect your crypto wallet today" })).toEqual({
      score: 30,
      reasons: ["keywords:1"],
    });
    expect(clean({ message: "huge bitcoin investment opportunity" })).toEqual({
      score: 30,
      reasons: ["keywords:1"],
    });
    expect(clean({ message: "get rich with our forex signals" })).toEqual({
      score: 30,
      reasons: ["keywords:1"],
    });
    expect(clean({ message: "cheap seo, rank #1 guaranteed" })).toEqual({
      score: 30,
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
    // POLICY CHANGE (operator 2026-07-15): "backlinks" is now a seller keyword —
    // SEO-topic asks through the public form are deliberately filtered (clients ask
    // the agency directly; the fleet's sites rank top for their own specific names).
    // One phrase alone still scores 30 < 60, so a lone audit ask is DELIVERED —
    // it only buckets alongside a second solicitation signal.
    const backlinkAsk = clean({ message: "Can you audit the backlinks pointing to our domain?" });
    expect(backlinkAsk).toEqual({ score: 30, reasons: ["keywords:1"] });
    expect(backlinkAsk.score >= SPAM_THRESHOLD).toBe(false);
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

  it("still flags promotional phrasing for the narrowed vertical keywords at 30 each", () => {
    for (const message of [
      "play at our online casino tonight",
      "claim your casino bonus now",
      "weight loss pills that melt fat fast",
      "buy backlinks cheap, DA 90+",
      "payday loans online, instant approval",
      "hot escort girls in your city",
    ]) {
      // label the message so a single-phrase regression is identifiable
      expect(clean({ message }), message).toEqual({ score: 30, reasons: ["keywords:1"] });
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
  it("scores each SELLER-VOICE cold-outreach / SEO phrase as a keyword (30)", () => {
    for (const message of [
      "I'd love to write a guest post for your blog",
      "our link building service gets results",
      "we get you on the first page of google",
      "we can position your brand for more reach",
      "we could increase your traffic significantly",
      "no obligation, would love to chat",
      // SEO-topic phrases moved (back) to seller per the 2026-07-15 operator policy:
      // SEO asks through the public form are solicitation on this fleet.
      "we noticed an seo problem on your site",
      "we provide a trained virtual assistant",
      "your backlinks are weak",
      "we can get you to the top of search results",
    ]) {
      const v = clean({ message });
      expect(v.reasons, message).toContain("keywords:1");
      expect(v.score, message).toBe(30);
    }
  });

  it("folds hyphens before matching — 'link-building' / 'custom-built AI' were live keyword dodges", () => {
    expect(clean({ message: "I run a link-building package that fixes this" }).reasons).toContain(
      "keywords:1",
    );
    const mavis = clean({
      message: "our custom-built AI tool MAVIS handles your advertising",
    });
    // "custom built ai" + "mavis" = 2 seller hits = 60: bucketed.
    expect(mavis.reasons).toContain("keywords:2");
    expect(mavis.score).toBeGreaterThanOrEqual(SPAM_THRESHOLD);
  });

  it("scores BUYER-COMPATIBLE phrases at a weak 10 (capped 20) without seller corroboration", () => {
    // Each of these is natural in a genuine prospect's own words — alone they must
    // never carry a message toward the threshold.
    for (const message of [
      "results within 24 hours guaranteed",
      "could we book a free consultation next week?",
    ]) {
      const v = clean({ message });
      expect(v.reasons, message).toContain("keywords-buyer:1");
      expect(v.score, message).toBe(10);
    }
    const both = clean({
      message: "We'd like a free consultation and we need the quote within 24 hours please.",
    });
    expect(both.reasons).toContain("keywords-buyer:2");
    expect(both.score).toBe(20);
  });

  it("a seller-voice phrase PROMOTES buyer phrases to full weight (pitch corroborates itself)", () => {
    // "virtual assistant" + "would you be interested" (seller) + free consultation +
    // within 24 hours (buyer) -> 4 hits, capped at 3 -> 90: the classic VA pitch.
    const pitch = clean({
      message:
        "I'm a virtual assistant. Would you be interested in a free consultation? I can start within 24 hours.",
    });
    expect(pitch.reasons).toContain("keywords:4");
    expect(pitch.score).toBeGreaterThanOrEqual(SPAM_THRESHOLD);
  });

  it("buckets each observed live-flood family (2026-07-15 miss corpus)", () => {
    // Every message here is a (lightly trimmed) real submission the previous
    // classifier delivered; each family must now reach >= 60.
    const families: Record<string, string> = {
      mavis:
        "I'm Amanda with Trusted Virtual Team. We offer MAVIS (My Advanced Virtual Intelligent System), that easily replaces a 20-man team.",
      "search-results":
        "We specialize in putting businesses like yours right at the top of search results. Setup is fast and effortless.",
      "seo-questionnaire":
        "Most websites don't have an SEO problem — they have a visibility problem. Getting the right traffic that turns into leads and sales is hard.",
      backlinks:
        "I looked up your site. You're not on page one. I run a link-building package — 46 types of premium backlinks.",
      wikipedia:
        "The Wiki links show up on the 1st page of Google 97% of the time. Thinking of getting a Wikipedia Page created?",
      "searching-for-what-you-sell":
        "We place your business directly in front of people already searching for what you sell - live within 24 hours. Would you be interested?",
      "product-blast":
        "Get yours today with 50% OFF: https://caredogbest.com FREE Shipping on all orders.",
    };
    for (const [family, message] of Object.entries(families)) {
      expect(clean({ message }).score, family).toBeGreaterThanOrEqual(SPAM_THRESHOLD);
    }
  });

  it("flags lorem-ipsum filler at 60 (buckets alone — machine content, zero genuine use)", () => {
    // Live bot bodies: truncated Latin filler, too short for velocity, invisible to
    // gibberish (real words).
    for (const message of ["Velit ullam reprehen", "Dolore harum volupta"]) {
      const v = clean({ message });
      expect(v.reasons, message).toContain("lorem-ipsum");
      expect(v.score, message).toBeGreaterThanOrEqual(SPAM_THRESHOLD);
    }
    // A single romance-language cognate never fires — two DISTINCT stems required.
    expect(
      clean({ message: "The voluptuous figures in this painting are striking." }).reasons,
    ).not.toContain("lorem-ipsum");
  });

  it("does NOT bucket a single ambiguous outreach phrase on its own (needs corroboration)", () => {
    // A genuine lead can plausibly ask for a "free consultation" — weak +10, < 60.
    const v = clean({ message: "Could I get a free consultation about a new website?" });
    expect(v.reasons).toContain("keywords-buyer:1");
    expect(v.score).toBeLessThan(SPAM_THRESHOLD);
  });

  it("flags a random keyboard-mash body at 35 (gibberish-body)", () => {
    const v = clean({ message: "zddDVjhArCJbvfgXJmqQ" });
    expect(v.reasons).toContain("gibberish-body");
    expect(v.score).toBe(35);
  });

  it("flags case-flip mash whose consonant runs stay short (the second live-mash shape)", () => {
    // Live samples 'IjIiJuhkojCYrNDFTXe' / 'XiwkUDgrboTgMSVX' max out at a 6-run with
    // y-as-vowel — the >=3 interior lower→upper flips discriminator catches them.
    for (const message of ["IjIiJuhkojCYrNDFTXe", "XiwkUDgrboTgMSVX"]) {
      expect(clean({ message }).reasons, message).toContain("gibberish-body");
    }
    // Real CamelCase brands have at most 1-2 humps — never flagged.
    for (const message of [
      "we build on JavaScript and TypeScript",
      "our shop runs on SquareSpace with MailChimp",
    ]) {
      expect(clean({ message }).reasons, message).not.toContain("gibberish-body");
    }
  });

  it("gibberish-name needs a single long low-vowel token; a bot with a mashed name+body is caught, a real consonant-heavy surname never trips at all", () => {
    // bot: single mashed name token (35) + mashed body (35) = 70, bucketed
    const bot = clean({ name: "OsDMQohNGefhfCqqQCwr", message: "zddDVjhArCJbvfgXJmqQ" });
    expect(bot.reasons).toEqual(expect.arrayContaining(["gibberish-body", "gibberish-name"]));
    expect(bot.score).toBe(70);
    expect(bot.score >= SPAM_THRESHOLD).toBe(true);

    // A real consonant-heavy surname no longer trips gibberish-name AT ALL under the
    // 7-run/y-as-vowel rule (Krzysztofowicz's longest run is 3) — so surname + a pasted
    // site link can never stack toward the threshold.
    const surname = clean({
      name: "Krzysztofowicz",
      message: "Hi, could you help redesign our homepage?",
    });
    expect(surname.reasons).not.toContain("gibberish-name");
    expect(surname.score).toBe(0);

    // A native-script (non-latin) name never trips gibberish — latin a-z only.
    expect(clean({ name: "王小明" }).reasons).not.toContain("gibberish-name");
  });

  it("gibberish never fires on ordinary long English words (7-run, y-as-vowel) — the psych* regression", () => {
    // The original >=5-consonant-run rule (y as consonant) fired on 3,138 dictionary
    // words: every psych* word >= 10 letters (p-s-y-c-h is itself a 5-run),
    // "worthwhile" (rthwh), "downstream" (wnstr), "nightclubs" (ghtcl), "catchphrase"
    // (tchphr, a 6-run), "arrhythmia" (rrhythm) — so gibberish(35) + one pasted
    // link(25) silently bucketed whole genuine-lead verticals. Pin each named word.
    for (const word of [
      "psychology",
      "psychiatrist",
      "psychotherapy",
      "worthwhile",
      "downstream",
      "nightclubs",
      "catchphrase",
      "postscript",
      "arrhythmia",
      "strengthens",
    ]) {
      expect(clean({ message: `regarding ${word} services` }).reasons, word).not.toContain(
        "gibberish-body",
      );
    }

    // THE archetypal genuine lead that the review proved was silently bucketed at 60:
    const therapist = clean({
      message: "We run a psychology practice and want a modern site. Current one: https://x.com",
    });
    expect(therapist.reasons).toEqual(["links:1"]);
    expect(therapist.score).toBeLessThan(SPAM_THRESHOLD);
  });

  it("SEO-topic asks: a single phrase is DELIVERED, stacked SEO phrasing is filtered (operator policy 2026-07-15)", () => {
    // POLICY: the fleet's sites are niche and rank top for their own names; clients
    // wanting SEO/marketing help ask the agency directly. Multi-phrase SEO content
    // through the public form is deliberately filtered — overblock accepted,
    // spam_auto is recoverable. (This inverts the earlier buyer-protection for the
    // SEO-topic phrases specifically.)
    const stacked = clean({
      message:
        "Our google ranking tanked after the redesign. We want to rank higher and drive traffic to the booking page. Do you offer a free consultation? Site: https://sunsetyoga.com",
    });
    expect(stacked.score).toBeGreaterThanOrEqual(SPAM_THRESHOLD);

    const bareDomain = clean({
      message: "sunsetbakery.com has an seo problem and we'd like to rank higher locally",
    });
    expect(bareDomain.score).toBeGreaterThanOrEqual(SPAM_THRESHOLD);

    // A lead who grazes ONE SEO phrase while asking for real work is still delivered.
    const single = clean({
      message: "We want to rank higher on Google — could you redesign our site with that in mind?",
    });
    expect(single.reasons).toEqual(["keywords:1"]);
    expect(single.score).toBeLessThan(SPAM_THRESHOLD);
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
    // "position your brand" + "above competitors" (seller) + "within 24 hours"
    // (buyer, promoted) = 3 hits -> 90
    const v = clean({
      message: "We can position your brand above competitors within 24 hours.",
    });
    expect(v.reasons).toContain("keywords:3");
    expect(v.score).toBeGreaterThanOrEqual(SPAM_THRESHOLD);
  });
});
