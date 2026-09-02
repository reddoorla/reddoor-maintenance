import { describe, expect, it } from "vitest";
import {
  backstopAbsent,
  buildAccuracyInput,
  checkAccuracy,
  fullSiteText,
  selectPages,
  type Assertion,
} from "../../src/prospect/accuracy.js";
import type {
  CrawlResult,
  PageCapture,
  PageExtract,
  ProbeAnswer,
} from "../../src/prospect/types.js";

function extract(over: Partial<PageExtract> = {}): PageExtract {
  return {
    title: "A page",
    metaDescription: null,
    canonical: null,
    social: {},
    headings: [],
    jsonLd: [],
    images: { total: 0, withAlt: 0 },
    hasViewportMeta: true,
    text: "",
    ...over,
  };
}

function page(url: string, text: string): PageCapture {
  return { url, status: 200, raw: extract({ text }), rendered: null, error: null };
}

function crawl(pages: PageCapture[]): CrawlResult {
  return {
    origin: "https://example.com",
    robotsTxt: null,
    agentAccess: [],
    sitemap: { present: false, urlCount: 0 },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages,
  };
}

function branded(over: Partial<ProbeAnswer> = {}): ProbeAnswer {
  return {
    engine: "claude",
    query: "who is Beachfront Dentistry",
    kind: "branded",
    domainCited: true,
    brandMentioned: true,
    countedAsVisible: true,
    citedDomains: ["drwhitfield.example", "yelp.com", "seaviewdental.example"],
    snippet: "",
    truncated: true,
    askedAt: "2026-08-27T02:00:00.000Z",
    ...over,
  };
}

/** A branded answer from a report stored before `fullAnswer` existed. Built by
 *  omitting the key rather than setting it undefined — under
 *  exactOptionalPropertyTypes those are different things, and the stored JSON
 *  has no key at all. */
function noFullAnswer(): ProbeAnswer {
  const { fullAnswer: _drop, ...rest } = branded({ fullAnswer: "x" });
  return rest;
}

const assertion = (over: Partial<Assertion> = {}): Assertion => ({
  claim: "The practice was formerly known as Marcus Z. Whitfield DDS.",
  verdict: "absent",
  engineQuote: "formerly known as Marcus Z. Whitfield DDS",
  siteQuote: null,
  unverifiedReason: null,
  nearbyMention: null,
  sourceDomains: ["drwhitfield.example"],
  query: "who is Beachfront Dentistry",
  engine: "claude",
  ...over,
});

describe("backstopAbsent — never accuse an engine of inventing what the site published", () => {
  // The one error this stage must not make. The model only sees the pages that
  // fit in the prompt; the site is bigger than that. Reporting "your site does
  // not say this" about a sentence on page fifteen tells a client an engine
  // fabricated a fact they wrote themselves.
  it("downgrades absent to unverified when the site does mention the term", () => {
    const site = "The practice was formerly known as Marcus Z. Whitfield DDS.";
    const terms = new Map([[assertion().claim, ["Marcus Z. Whitfield"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("unverified");
    expect(out?.siteQuote).toContain("Whitfield");
    expect(out?.unverifiedReason).toContain("Whitfield");
  });

  it("keeps the finding but flags what the site DOES say, when the words are scattered", () => {
    // The real Beachfront case, and the one that decided this design. The engine
    // says the practice was "formerly known as Marcus Z. Whitfield DDS"; the site
    // never says that, but its team page lists Dr. Marcus Whitfield.
    //
    // Suppressing it loses the most valuable line in the section — an engine
    // telling the world your history out of your predecessor's website.
    // Printing it bare invites the client to open their own team page and
    // conclude we cannot read. So the verdict stands and the objection is
    // answered on the same line.
    const site = "Meet Your Team. Dr. Priya Raman. Dr. Marcus Whitfield.";
    const terms = new Map([[assertion().claim, ["Marcus Z. Whitfield"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("absent");
    expect(out?.nearbyMention).toBe("Marcus Z. Whitfield");
  });

  it("prefers an exact hit over a scattered one, whatever order the terms arrive in", () => {
    const site = "Dr. Marcus Whitfield. The practice was formerly known as Bayside Dental.";
    const terms = new Map([[assertion().claim, ["Marcus Z. Whitfield", "formerly known"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("unverified");
    expect(out?.siteQuote).toContain("formerly known");
  });

  it("does not fire on a single common word shared with the site", () => {
    // The over-firing has to stop somewhere, or every finding on a dental site
    // dissolves into "unverified".
    const site = "Comprehensive dental care and emergency appointments.";
    const terms = new Map([[assertion().claim, ["Whitfield Dentistry"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("absent");
  });

  it("keeps absent when the term genuinely does not appear", () => {
    const site = "Our team includes Dr. Priya Raman.";
    const terms = new Map([[assertion().claim, ["Marcus Z. Whitfield", "formerly known"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("absent");
    expect(out?.siteQuote).toBeNull();
  });

  it("cannot claim absence at all when the site was too large to read whole", () => {
    const terms = new Map([[assertion().claim, ["Marcus Z. Whitfield"]]]);
    const [out] = backstopAbsent([assertion()], "unrelated text", terms, false);
    expect(out?.verdict).toBe("unverified");
    expect(out?.unverifiedReason).toContain("larger than we read");
  });

  it("ignores terms too short to mean anything", () => {
    // A backstop that fired on "dental" would downgrade every honest finding on
    // a dentist's site and empty the section of its whole purpose.
    const site = "Comprehensive dental care in Redondo Beach.";
    const terms = new Map([[assertion().claim, ["DDS", "care"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("absent");
  });

  it("leaves verdicts other than absent alone", () => {
    const confirmed = assertion({ verdict: "confirmed", siteQuote: "Dr. Priya Raman" });
    const terms = new Map([[confirmed.claim, ["Raman"]]]);
    const [out] = backstopAbsent([confirmed], "Dr. Priya Raman", terms, true);
    expect(out?.verdict).toBe("confirmed");
    expect(out?.siteQuote).toBe("Dr. Priya Raman");
  });

  it("matches across the whitespace the extractor collapses", () => {
    const site = "Our team includes\n\n  Dr. Marcus   Whitfield  today.";
    const terms = new Map([[assertion().claim, ["Marcus Whitfield"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("unverified");
  });
});

describe("checkAccuracy — quotes are verified, not trusted", () => {
  const site = crawl([
    page(
      "https://seaviewdental.example/",
      "Beachfront Dentistry in Riviera Village, Redondo Beach.",
    ),
    page(
      "https://seaviewdental.example/team",
      "Meet Your Team Dr. Priya Raman Dr. Marcus Whitfield",
    ),
  ]);
  const answer = branded({
    fullAnswer:
      "Beachfront Dentistry is a dental practice in the Riviera Village neighborhood of Redondo Beach. " +
      "It was formerly known as Marcus Z. Whitfield DDS. The practice is run by Dr. Priya Raman.",
  });

  // No network in tests: every cited domain comes back unreachable, which is the
  // honest "unknown" and keeps these tests about the quote verification.
  const offline = { fetchPage: async () => null };
  const stub = (assertions: unknown[]) => ({
    run: async () => ({ assertions }),
    ownership: offline,
  });

  it("discards an assertion whose engine quote was never said", async () => {
    // A claim about a real business, built on words the engine did not use, has
    // no salvageable part.
    const r = await checkAccuracy("https://seaviewdental.example", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "They offer 24-hour emergency care.",
            engineQuote: "open twenty-four hours for emergencies",
            verdict: "confirmed",
            siteQuote: null,
            searchTerms: ["emergency"],
          },
        ],
      }),
      ownership: offline,
    });
    expect(r.assertions).toEqual([]);
  });

  it("downgrades a confirmed verdict whose site quote is not on the site", async () => {
    const r = await checkAccuracy("https://seaviewdental.example", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "The practice is run by Dr. Priya Raman.",
            engineQuote: "The practice is run by Dr. Priya Raman",
            verdict: "confirmed",
            siteQuote: "Dr. Priya Raman has practised here since 1998",
            searchTerms: ["Priya Raman"],
          },
        ],
      }),
      ownership: offline,
    });
    expect(r.assertions[0]?.verdict).toBe("unverified");
    expect(r.assertions[0]?.siteQuote).toBeNull();
  });

  it("keeps a confirmed verdict whose site quote is real", async () => {
    const r = await checkAccuracy("https://seaviewdental.example", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "The practice is run by Dr. Priya Raman.",
            engineQuote: "The practice is run by Dr. Priya Raman",
            verdict: "confirmed",
            siteQuote: "Dr. Priya Raman",
            searchTerms: ["Priya Raman"],
          },
        ],
      }),
      ownership: offline,
    });
    expect(r.assertions[0]?.verdict).toBe("confirmed");
    expect(r.assertions[0]?.siteQuote).toBe("Dr. Priya Raman");
  });

  it("names who the engine read instead, and never the prospect themselves", async () => {
    const r = await checkAccuracy("https://seaviewdental.example", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "The practice was formerly known as Marcus Z. Whitfield DDS.",
            engineQuote: "It was formerly known as Marcus Z. Whitfield DDS",
            verdict: "absent",
            siteQuote: null,
            searchTerms: ["formerly known", "Marcus Z. Whitfield"],
          },
        ],
      }),
      ownership: offline,
    });
    const a = r.assertions[0];
    // Absent, with the team-page mention noted rather than used to silence it.
    expect(a?.verdict).toBe("absent");
    expect(a?.nearbyMention).toBe("Marcus Z. Whitfield");
    expect(a?.sourceDomains).toContain("drwhitfield.example");
    expect(a?.sourceDomains).not.toContain("seaviewdental.example");
  });

  it("reports nothing measured when the probes predate full answers", async () => {
    // Not "no claims found" — a report that renders zero assertions as a clean
    // bill of health is our missing data sold as their good news.
    const r = await checkAccuracy(
      "https://seaviewdental.example",
      site,
      [noFullAnswer()],
      [],
      stub([]),
    );
    expect(r.answersRead).toBe(0);
    expect(r.assertions).toEqual([]);
  });

  it("ignores category answers", async () => {
    const r = await checkAccuracy(
      "https://seaviewdental.example",
      site,
      [branded({ kind: "category", fullAnswer: "some category answer" })],
      [],
      stub([]),
    );
    expect(r.answersRead).toBe(0);
  });
});

describe("buildAccuracyInput", () => {
  const site = crawl([
    page("https://x.com/", "home text"),
    page("https://x.com/a/b/c", "deep page"),
    page("https://x.com/team", "shallow page"),
  ]);

  it("fences site and engine text with a tag that changes every call", () => {
    const a = buildAccuracyInput(site, [branded({ fullAnswer: "an answer" })]);
    const b = buildAccuracyInput(site, [branded({ fullAnswer: "an answer" })]);
    const tagOf = (s: string) => s.match(/data_[0-9a-f]{12}/)?.[0];
    expect(tagOf(a.system)).toBeDefined();
    expect(tagOf(a.system)).not.toBe(tagOf(b.system));
    // Both untrusted bodies sit inside it: the site AND the engine's reply.
    expect(a.user).toContain(`<${tagOf(a.system)}>\nan answer`);
    expect(a.user).toContain("home text");
  });

  it("does not truncate a page's text", () => {
    // analyze cuts pages at 1500 chars. Here a fact past the cut would read as
    // absent, so whole pages are dropped instead and the drop is disclosed.
    const long = "z".repeat(40_000);
    const one = buildAccuracyInput(crawl([page("https://x.com/", long)]), [
      branded({ fullAnswer: "a" }),
    ]);
    expect(one.user).toContain(long);
  });

  it("prefers shallow pages when it cannot take them all", () => {
    const { pages } = selectPages(site);
    expect(pages[0]?.url).toBe("https://x.com/");
    expect(pages[1]?.url).toBe("https://x.com/team");
  });

  it("does not count a page we never read as read", () => {
    // The verdict this file says it must never get wrong is `absent` — "your
    // site does not say this" — and `fullyRead` is what licenses it to stand.
    // A page whose fetch was refused has no extract, contributed no text, and
    // was still counted toward "we read your whole site", so an assertion could
    // be declared absent from a page nobody ever read.
    const refused: PageCapture = {
      url: "https://x.com/blocked",
      status: 403,
      raw: null,
      rendered: null,
      error: "HTTP 403",
    };
    const partial = crawl([page("https://x.com/", "home text"), refused]);

    const selected = selectPages(partial);

    expect(selected.fullyRead).toBe(false);
    expect(selected.pages.map((p) => p.url)).toEqual(["https://x.com/"]);
    expect(selected.pagesUnread).toBe(1);
  });

  it("reports fullyRead false when a page had to be dropped", () => {
    const big = crawl([
      page("https://x.com/", "z".repeat(100_000)),
      page("https://x.com/two", "z".repeat(100_000)),
    ]);
    expect(selectPages(big).fullyRead).toBe(false);
    expect(selectPages(site).fullyRead).toBe(true);
  });
});

describe("fullSiteText", () => {
  it("joins every page, including ones that never reach the prompt", () => {
    const text = fullSiteText(
      crawl([page("https://x.com/", "one"), page("https://x.com/b", "two")]),
    );
    expect(text).toContain("one");
    expect(text).toContain("two");
  });
});

describe("backstopAbsent — a single common word is a topic, not an answer", () => {
  const assertion = (claim: string) => ({
    claim,
    verdict: "absent" as const,
    engineQuote: "q",
    siteQuote: null,
    unverifiedReason: null,
    nearbyMention: null,
    sourceDomains: [],
    query: "who is Acme",
    engine: "claude",
  });

  it("does not excuse a claim because one common word appears somewhere", () => {
    // Observed on a real run of our own site. An engine claimed the company has
    // "about 5 employees"; the backstop found the word "employees" inside an
    // unrelated case study about an organisation of 84,000 people, and printed
    // `Your site does say "employees", so we have not counted this as missing.`
    // That is a topic match dressed as an answer, and it reads as a tool that
    // cannot read.
    const site =
      "We turned policy into county-wide action by managing an organization of over 84,000 employees.";
    const [out] = backstopAbsent(
      [assertion("Acme has about 5 employees")],
      site,
      new Map([["Acme has about 5 employees", ["employees"]]]),
      true,
    );
    expect(out!.verdict).toBe("absent");
    expect(out!.nearbyMention).toBeNull();
  });

  it("still excuses a claim when the site uses the actual phrase", () => {
    const site = "Our studio has about 5 employees across three states.";
    const [out] = backstopAbsent(
      [assertion("Acme has about 5 employees")],
      site,
      new Map([["Acme has about 5 employees", ["about 5 employees"]]]),
      true,
    );
    expect(out!.verdict).toBe("unverified");
  });

  it("still trusts a distinctive proper noun on its own", () => {
    // The case the backstop was built for: an engine names a practice after a
    // clinician the site never mentions, and the team page lists a similar
    // name. A single word is enough here precisely because it is a name.
    const site = "Our team is led by Dr Alderson, who founded the practice.";
    const [out] = backstopAbsent(
      [assertion("Formerly known as Alderson Dental")],
      site,
      new Map([["Formerly known as Alderson Dental", ["Alderson"]]]),
      true,
    );
    expect(out!.verdict).toBe("unverified");
  });
});
