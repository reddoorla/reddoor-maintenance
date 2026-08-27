import type { ChecksResult, CrawlResult, PageCapture, PageExtract } from "./types.js";

/**
 * Can a visitor do the one thing this site needs them to do?
 *
 * Every other check in this audit is generic — crawlable, readable, not broken.
 * Those are worth measuring and they are the same questions for every site,
 * which is exactly the problem: a dentist's site succeeds when somebody books an
 * appointment and a branding studio's succeeds when a qualified enquiry arrives
 * with a budget attached. Grading both against one template scores neither
 * against what it is for.
 *
 * So one goal is named, and the findings are read against it. The goal is
 * inferred from the site by the analyze stage and may be overridden by the
 * operator — and an inference we get wrong is itself worth reporting, because if
 * a model that has just read twenty pages cannot tell what the site is for,
 * neither can a visitor.
 *
 * Findings carry a `scope`, and the report orders by it. That ordering is the
 * only place the commercial ladder appears: a stale phone link is an afternoon,
 * "you have never published a price and every buyer asks" is a content
 * engagement, and "there is no way to publish or update any of this" is a
 * platform conversation. The report must never say those words. Ordering does
 * the work, and a prospect who reads to the bottom arrives at the conversation
 * on their own.
 */

export type SiteGoal =
  "book" | "enquire" | "call" | "visit" | "buy" | "demo" | "partner" | "unknown";

export const GOAL_LABELS: Record<SiteGoal, string> = {
  book: "book an appointment",
  enquire: "start a project or ask for a quote",
  call: "pick up the phone",
  visit: "come to you in person",
  buy: "buy something",
  demo: "talk to your sales team",
  partner: "ask about distribution or partnership",
  unknown: "— we could not tell",
};

/** How much work putting one thing right is. Orders the report; never printed
 *  as a tier, and never priced. */
export type Scope = "quick" | "content" | "structural";

/**
 * Three states, not two — and the third is the one that matters.
 *
 * Caught on live data: `reachable` and `tappable-phone` both read their input
 * from `checks`, which older stored reports do not carry. With a boolean they
 * came back `false`, and the report said "no way to reach you from where they
 * land" about sites that have one — turning our own missing measurement into
 * the prospect's defect. That is the single error this whole codebase is built
 * not to make, and a two-state field makes it the default.
 */
export type RequirementStatus = "met" | "missing" | "unmeasured";

export type GoalRequirement = {
  key: string;
  /** What the visitor needs, in the visitor's terms. */
  label: string;
  status: RequirementStatus;
  /** Where we found it — the receipt. Null when we did not. */
  evidence: string | null;
  /** Why this one matters for THIS goal, not in general. */
  why: string;
  scope: Scope;
};

export type GoalFit = {
  goal: SiteGoal;
  /** "operator" when supplied at dispatch, "inferred" when the analyze stage
   *  read it off the site. A reader is owed that distinction. */
  source: "inferred" | "operator";
  requirements: GoalRequirement[];
  met: number;
  /** Requirements we could actually judge — `met` + `missing`. Excludes
   *  `unmeasured`, so "3 of 4" never counts something we did not look at. */
  total: number;
};

/** Third-party scheduling a visitor can actually complete. Deliberately a list
 *  of hosts rather than a guess at markup: a booking widget is nearly always an
 *  outbound link or an iframe to one of these, and inferring "booking" from a
 *  form containing a date field catches every event RSVP on the web. */
const BOOKING_HOSTS = [
  "zocdoc.com",
  "calendly.com",
  "acuityscheduling.com",
  "squarespacescheduling.com",
  "nexhealth.com",
  "localmed.com",
  "setmore.com",
  "simplybook.me",
  "appointy.com",
  "cal.com",
  "savvycal.com",
  "youcanbook.me",
  "meetings.hubspot.com",
  "chilipiper.com",
  "patientpop.com",
  "doctolib",
  "getweave.com",
  "flexbooker.com",
  "bookem",
  "vagaro.com",
  "mindbodyonline.com",
];

const MAP_HOSTS = ["google.com/maps", "goo.gl/maps", "maps.app.goo.gl", "maps.apple.com"];

/** Day-of-week followed by a time, which is what an opening-hours line looks
 *  like in prose regardless of how it is formatted. */
const HOURS_IN_TEXT =
  /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*[-–—:]?\s*(?:[a-z]*\s*)?\d{1,2}\s*(?::\d{2})?\s*(?:am|pm)/i;

/** A currency amount. Anchored on the symbol so "17% revenue lift" in a case
 *  study is not read as a price. */
const MONEY = /[$£€]\s?\d[\d,]*(?:\.\d{2})?(?:\s?[kKmM]\b)?/;

const PRICE_WORDS =
  /\b(pricing|price list|starting at|starts at|from \$|per project|per month|retainer|packages?|rates?|fees?|budget starts)\b/i;

function extractOf(page: PageCapture): PageExtract | null {
  return page.rendered ?? page.raw;
}

/** All visible text across every readable page, lower-cased once. */
function siteText(pages: PageCapture[]): string {
  return pages
    .map((p) => extractOf(p)?.text ?? "")
    .join(" ")
    .toLowerCase();
}

function allAnchors(pages: PageCapture[]): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const page of pages) {
    for (const a of extractOf(page)?.anchors ?? []) out.push({ href: a.href, text: a.text });
  }
  return out;
}

/** A short quotation around the first match, so a finding can show its work. */
function quote(haystack: string, pattern: RegExp): string | null {
  const m = pattern.exec(haystack);
  if (!m || m.index === undefined) return null;
  const start = Math.max(0, m.index - 40);
  return `…${haystack
    .slice(start, m.index + m[0].length + 40)
    .replace(/\s+/g, " ")
    .trim()}…`;
}

type Signals = {
  text: string;
  anchors: { href: string; text: string }[];
  schemaTypes: string[];
  /** Best enquiry form on the site, by field count. */
  bestEnquiryFields: number;
  /** Any phone written as a `tel:` link anywhere. */
  hasTappablePhone: boolean;
  /** False when there is no phone number at all, or when the report predates
   *  `linked` being recorded — either way the tappable check cannot be judged. */
  phoneLinkMeasured: boolean;
  /** Worst-case clicks from a crawled page to any contact route. */
  worstClicks: number | null;
};

/**
 * A price word with actual money beside it.
 *
 * Both patterns matched anywhere on the site was not enough, and live data
 * showed why: Ludlow Kingsley scored a price signal off the word "package" in a
 * sentence about photographing product packaging, with the `$` coming from an
 * unrelated case study on another page. Requiring the two within a window of
 * each other is the difference between "we charge from $12,000" and a portfolio
 * that happens to contain both a dollar sign and the word "packages".
 */
const PRICE_WINDOW = 120;

function priceSignal(text: string): string | null {
  const words = new RegExp(PRICE_WORDS.source, "gi");
  for (let m = words.exec(text); m !== null; m = words.exec(text)) {
    const from = Math.max(0, m.index - PRICE_WINDOW);
    const window = text.slice(from, m.index + m[0].length + PRICE_WINDOW);
    const money = MONEY.exec(window);
    if (!money || money.index === undefined) continue;
    // Centre the receipt on the AMOUNT, not on the word that led us to it. The
    // client reads this quote as the proof, and a quote containing "packages"
    // but no number does not look like evidence of a price.
    const at = from + money.index;
    const quoted = text.slice(Math.max(0, at - 70), at + money[0].length + 70);
    return `…${quoted.replace(/\s+/g, " ").trim()}…`;
  }
  return null;
}

function gather(crawl: CrawlResult, checks: ChecksResult | null): Signals {
  const text = siteText(crawl.pages);
  const phones = checks?.consistency?.phones ?? [];
  let bestEnquiryFields = 0;
  for (const page of crawl.pages) {
    for (const form of extractOf(page)?.forms ?? []) {
      if (form.kind === "enquiry") bestEnquiryFields = Math.max(bestEnquiryFields, form.fieldCount);
    }
  }
  return {
    text,
    anchors: allAnchors(crawl.pages),
    schemaTypes: checks?.schema.typesFound ?? [],
    bestEnquiryFields,
    // `linked` is optional on reports stored before it existed; only an explicit
    // true counts as tappable, and only an explicit false makes the question
    // answerable at all.
    hasTappablePhone: phones.some((p) => p.linked === true),
    phoneLinkMeasured: phones.length > 0 && phones.some((p) => p.linked !== undefined),
    worstClicks: checks?.journey?.worstClicksToContact ?? null,
  };
}

const linksTo = (s: Signals, hosts: string[]): string | null => {
  for (const a of s.anchors) {
    const href = a.href.toLowerCase();
    for (const host of hosts) if (href.includes(host)) return a.href;
  }
  return null;
};

const has = (s: Signals, re: RegExp): string | null => quote(s.text, re);

/** One requirement, phrased once. `evidence` non-null means met; null means
 *  missing. Pass `measured: false` for a check whose INPUT was unavailable —
 *  that is a gap in our data, not a finding about the site. */
function req(
  key: string,
  label: string,
  why: string,
  scope: Scope,
  evidence: string | null,
  measured = true,
): GoalRequirement {
  return {
    key,
    label,
    status: !measured ? "unmeasured" : evidence !== null ? "met" : "missing",
    evidence,
    why,
    scope,
  };
}

/**
 * Requirements shared by every goal that ends in a human conversation. Pulled
 * out because four of the seven goals need exactly these and duplicating them
 * is how they drift apart.
 */
function contactBasics(s: Signals): GoalRequirement[] {
  return [
    req(
      "tappable-phone",
      "A phone number they can tap",
      "Most of your visitors are on a phone. A number written as text has to be memorised and retyped, at the exact moment they had decided to call.",
      "quick",
      s.hasTappablePhone ? "tel: link found" : null,
      // A site with no phone number anywhere has nothing to make tappable, and
      // a report stored before `linked` was recorded cannot answer this at all.
      s.phoneLinkMeasured,
    ),
    req(
      "reachable",
      "A route to you from wherever they land",
      "Search engines and AI answers send people to whichever page answers their question, not to your home page.",
      "quick",
      s.worstClicks !== null && s.worstClicks <= 2 ? `at most ${s.worstClicks} clicks away` : null,
      s.worstClicks !== null,
    ),
  ];
}

export function checkGoal(
  goal: SiteGoal,
  source: "inferred" | "operator",
  crawl: CrawlResult,
  checks: ChecksResult | null,
): GoalFit {
  const s = gather(crawl, checks);
  let requirements: GoalRequirement[] = [];

  const hours = req(
    "hours",
    "Your opening hours, in text",
    "It is the second thing anyone checks and the first thing that goes stale. When your site does not say, an AI answer will take it from a directory listing you do not control.",
    "quick",
    has(s, HOURS_IN_TEXT) ??
      (s.schemaTypes.some((t) => /openinghours/i.test(t)) ? "openingHours in schema" : null),
  );

  const address = req(
    "address",
    "An address and a map link",
    "Somebody deciding whether to come to you needs to know where you are without leaving your site to find out.",
    "quick",
    linksTo(s, MAP_HOSTS) ??
      (s.schemaTypes.includes("PostalAddress") ? "PostalAddress schema" : null),
  );

  const price = req(
    "price-signal",
    "Some signal of what it costs",
    "It is the most common question buyers ask before making contact, and the one most sites never answer. A range, a starting point or a worked example is enough — silence sends them to someone who does say.",
    "content",
    priceSignal(s.text),
  );

  const qualifying = req(
    "qualifying-form",
    "A form that asks enough to have a real first conversation",
    "A name-and-email box produces enquiries you have to qualify by hand. Three or four more fields turn a lead into a briefed conversation.",
    "content",
    s.bestEnquiryFields >= 4 ? `enquiry form with ${s.bestEnquiryFields} fields` : null,
  );

  switch (goal) {
    case "book":
      requirements = [
        req(
          "booking",
          "A way to book without calling",
          "A caller has to reach you during your hours. A booking link works at 11pm, which is when people schedule.",
          "structural",
          linksTo(s, BOOKING_HOSTS),
        ),
        hours,
        ...contactBasics(s),
        req(
          "new-clients",
          "Whether you are taking new clients",
          "Nobody wants to fill in a form to find out you are full.",
          "content",
          has(s, /\b(accepting new|new patients|now accepting|taking on new|new clients)\b/i),
        ),
        address,
      ];
      break;

    case "enquire":
      requirements = [qualifying, price, ...contactBasics(s)];
      break;

    case "call":
      requirements = [
        ...contactBasics(s),
        hours,
        req(
          "what-to-expect",
          "What happens when they call",
          "A first call is easier to make when the visitor knows who picks up and what it costs them.",
          "content",
          has(
            s,
            /\b(free consultation|no obligation|we will call you back|same day|what to expect)\b/i,
          ),
        ),
      ];
      break;

    case "visit":
      requirements = [
        address,
        hours,
        ...contactBasics(s),
        req(
          "getting-there",
          "Parking or transit",
          "The last hundred metres are where a visit gets abandoned.",
          "content",
          has(s, /\b(parking|park in|valet|metro|subway|bus stop|transit|garage)\b/i),
        ),
      ];
      break;

    case "buy":
      requirements = [
        req(
          "shipping",
          "Shipping cost and timing",
          "Unexpected shipping cost is the single most common reason a cart is abandoned.",
          "content",
          has(s, /\b(shipping|delivery)\b/i),
        ),
        req(
          "returns",
          "A returns policy",
          "Buyers look for it before their first order from a company they do not know.",
          "content",
          has(s, /\b(returns?|refund|exchange policy|money back)\b/i),
        ),
        price,
        ...contactBasics(s),
      ];
      break;

    case "demo":
      requirements = [
        req(
          "demo-path",
          "A demo request that is not the general contact form",
          "Someone ready for a demo is further along than someone with a question, and sending both to one box loses the difference.",
          "structural",
          linksTo(s, BOOKING_HOSTS) ??
            (s.anchors.some((a) =>
              /\b(book a demo|get a demo|request a demo|see it in action)\b/i.test(a.text),
            )
              ? "demo link in navigation"
              : null),
        ),
        qualifying,
        price,
        ...contactBasics(s),
      ];
      break;

    case "partner":
      requirements = [
        req(
          "partner-route",
          "A named route for partners, separate from customers",
          "A distributor who lands on a customer contact form usually leaves.",
          "content",
          has(
            s,
            /\b(distributor|distribution|become a partner|reseller|partnership enquir|wholesale)\b/i,
          ),
        ),
        req(
          "requirements",
          "What you are looking for in a partner",
          "Territory, volume or credentials — enough for someone to tell whether it is worth writing to you.",
          "content",
          has(s, /\b(territor|minimum order|requirements|qualification|credential|volume)\b/i),
        ),
        ...contactBasics(s),
      ];
      break;

    case "unknown":
      // Deliberately no requirements. Inventing a checklist for a purpose we
      // could not identify would grade the site against our guess and report
      // the result as their failing. The finding IS that we could not tell.
      requirements = [];
      break;
  }

  return {
    goal,
    source,
    requirements,
    met: requirements.filter((r) => r.status === "met").length,
    // Only what we could judge. A denominator that counts unmeasured checks
    // would report "3 of 6" for a site where we looked at four things.
    total: requirements.filter((r) => r.status !== "unmeasured").length,
  };
}

/** Report order: unmet before met, then by how much work it is. A reader should
 *  hit the afternoon's work first and arrive at the structural questions having
 *  already agreed with everything above them. */
const SCOPE_ORDER: Record<Scope, number> = { quick: 0, content: 1, structural: 2 };
/** Missing first, then met, then the ones we could not judge — which belong at
 *  the bottom because they are a note about our measurement, not about them. */
const STATUS_ORDER: Record<RequirementStatus, number> = { missing: 0, met: 1, unmeasured: 2 };

export function orderRequirements(reqs: GoalRequirement[]): GoalRequirement[] {
  return [...reqs].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope],
  );
}
